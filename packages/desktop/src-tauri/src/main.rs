#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(windows)]
use std::process::Command as NativeCommand;
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager, ipc::Channel};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    sync::watch,
    time::timeout,
};
use uuid::Uuid;

const RESOURCE_ROOT: &str = "pg-runtime";
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_EVENT_LINE_BYTES: usize = 256 * 1024;
const RUNTIME_MODE: &str = env!("PG_RUNTIME_MODE");
const INTERNAL_DEVELOPMENT_MODE: bool = cfg!(debug_assertions);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopErrorV1 {
    schema_version: u8,
    code: String,
    message: String,
    next_action: String,
    target_modified: bool,
}

type CommandResult<T> = Result<T, DesktopErrorV1>;

fn error(code: &str, message: &str, next_action: &str) -> DesktopErrorV1 {
    DesktopErrorV1 {
        schema_version: 1,
        code: code.to_owned(),
        message: message.to_owned(),
        next_action: next_action.to_owned(),
        target_modified: false,
    }
}

fn authorize_generation(
    lifecycle_consent: bool,
    requires_lifecycle_consent: bool,
    allow_planned: bool,
    internal_development_mode: bool,
) -> CommandResult<()> {
    if requires_lifecycle_consent && !lifecycle_consent {
        return Err(error(
            "DESKTOP_CONSENT_REQUIRED",
            "Generation was not started because third-party dependency-execution consent is required.",
            "Read the disclosure and explicitly check the dependency-execution consent box.",
        ));
    }
    if allow_planned && !internal_development_mode {
        return Err(error(
            "DESKTOP_INTERNAL_MODE_REQUIRED",
            "Planned-recipe override is unavailable outside internal development builds.",
            "Use a debug internal build only for approved evidence gathering.",
        ));
    }
    Ok(())
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopSelectionV1 {
    project_name: String,
    parent_directory: String,
    recipe_id: DesktopRecipeId,
    documentation: DesktopDocumentationV1,
    template_id: Option<String>,
    template_variant_id: Option<String>,
    module_path: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
enum DesktopRecipeId {
    #[serde(rename = "FE-01")]
    Fe01,
    #[serde(rename = "FE-02")]
    Fe02,
    #[serde(rename = "FE-03")]
    Fe03,
    #[serde(rename = "FE-04")]
    Fe04,
    #[serde(rename = "FE-05")]
    Fe05,
    #[serde(rename = "FE-06")]
    Fe06,
    #[serde(rename = "FE-07")]
    Fe07,
    #[serde(rename = "FE-08")]
    Fe08,
    #[serde(rename = "FE-09")]
    Fe09,
    #[serde(rename = "FE-10")]
    Fe10,
    #[serde(rename = "FE-11")]
    Fe11,
    #[serde(rename = "FE-12")]
    Fe12,
    #[serde(rename = "FE-13")]
    Fe13,
    #[serde(rename = "FE-14")]
    Fe14,
    #[serde(rename = "FE-15")]
    Fe15,
    #[serde(rename = "BE-01")]
    Be01,
    #[serde(rename = "BE-02")]
    Be02,
    #[serde(rename = "BE-05")]
    Be05,
    #[serde(rename = "BE-06")]
    Be06,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DesktopDocumentationV1 {
    Minimal,
    Standard,
    Full,
}

impl DesktopDocumentationV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Minimal => "minimal",
            Self::Standard => "standard",
            Self::Full => "full",
        }
    }
}

impl DesktopSelectionV1 {
    fn to_core_json(&self, forma_commit_sha: &str) -> Value {
        if matches!(self.recipe_id, DesktopRecipeId::Be01) {
            return json!({
                "schemaVersion": 1,
                "project": {
                    "name": self.project_name,
                    "parentDirectory": self.parent_directory,
                    "type": "backend"
                },
                "backend": { "adapterId": "backend.express", "manager": "npm" },
                "documentation": self.documentation.as_str(),
                "git": { "initialize": false, "initialCommit": false }
            });
        }
        if matches!(self.recipe_id, DesktopRecipeId::Be02) {
            let mut backend =
                json!({ "adapterId": "backend.go-net-http", "manager": "go-modules" });
            if let Some(module_path) = self.module_path.as_ref() {
                backend["modulePath"] = json!(module_path);
            }
            return json!({
                "schemaVersion": 1,
                "project": {
                    "name": self.project_name,
                    "parentDirectory": self.parent_directory,
                    "type": "backend"
                },
                "backend": backend,
                "documentation": self.documentation.as_str(),
                "git": { "initialize": false, "initialCommit": false }
            });
        }
        if matches!(self.recipe_id, DesktopRecipeId::Be06) {
            return json!({
                "schemaVersion": 1,
                "project": {
                    "name": self.project_name,
                    "parentDirectory": self.parent_directory,
                    "type": "backend"
                },
                "backend": { "adapterId": "backend.fastapi", "manager": "uv" },
                "documentation": self.documentation.as_str(),
                "git": { "initialize": false, "initialCommit": false }
            });
        }
        if matches!(self.recipe_id, DesktopRecipeId::Be05) {
            return json!({
                "schemaVersion": 1,
                "project": {
                    "name": self.project_name,
                    "parentDirectory": self.parent_directory,
                    "type": "backend"
                },
                "backend": { "adapterId": "backend.laravel", "manager": "composer" },
                "documentation": self.documentation.as_str(),
                "git": { "initialize": false, "initialCommit": false }
            });
        }
        let (frontend, styling, manager) = match self.recipe_id {
            DesktopRecipeId::Fe01 => ("frontend.react-vite", "styling.css", "npm"),
            DesktopRecipeId::Fe02 => ("frontend.nextjs-app", "styling.tailwind", "npm"),
            DesktopRecipeId::Fe03 => ("frontend.vue-vite", "styling.css", "npm"),
            DesktopRecipeId::Fe04 => ("frontend.react-vite", "styling.bootstrap", "npm"),
            DesktopRecipeId::Fe05 => ("frontend.vue-vite", "styling.bootstrap", "npm"),
            DesktopRecipeId::Fe06 => ("frontend.nuxt", "styling.css", "npm"),
            DesktopRecipeId::Fe07 => ("frontend.angular", "styling.scss", "npm"),
            DesktopRecipeId::Fe08 => ("frontend.react-vite", "styling.scss", "npm"),
            DesktopRecipeId::Fe09 => ("frontend.vue-vite", "styling.scss", "npm"),
            DesktopRecipeId::Fe10 => ("frontend.react-vite", "styling.tailwind", "npm"),
            DesktopRecipeId::Fe11 => ("frontend.vue-vite", "styling.tailwind", "npm"),
            DesktopRecipeId::Fe12 => ("frontend.react-vite", "styling.css", "yarn"),
            DesktopRecipeId::Fe13 => ("frontend.vue-vite", "styling.css", "yarn"),
            DesktopRecipeId::Fe14 => ("frontend.react-vite", "styling.css", "pnpm"),
            DesktopRecipeId::Fe15 => ("frontend.vue-vite", "styling.css", "pnpm"),
            DesktopRecipeId::Be01
            | DesktopRecipeId::Be02
            | DesktopRecipeId::Be05
            | DesktopRecipeId::Be06 => {
                unreachable!("backend selection returned above")
            }
        };
        let mut selection = json!({
            "schemaVersion": 1,
            "project": {
                "name": self.project_name,
                "parentDirectory": self.parent_directory,
                "type": "frontend"
            },
            "frontend": { "adapterId": frontend, "language": "ts", "manager": manager },
            "documentation": self.documentation.as_str(),
            "git": { "initialize": false, "initialCommit": false }
        });
        if self.template_id.is_none() {
            selection["styling"] = json!({ "adapterId": styling });
        }
        if let Some(template_id) = self.template_id.as_ref() {
            let mut template = json!({
                "adapterId": "template.forma",
                "templateId": template_id,
                "commitSha": forma_commit_sha
            });
            if let Some(variant_id) = self.template_variant_id.as_ref() {
                template["variantId"] = json!(variant_id);
            }
            selection["template"] = template;
        }
        selection
    }

    fn validate(&self) -> CommandResult<()> {
        if self.project_name.trim().is_empty() || self.project_name.len() > 4096 {
            return Err(error(
                "GEN_CONFIG_INVALID",
                "Project name must contain 1–4096 UTF-8 bytes.",
                "Enter a valid project name and resolve the plan again.",
            ));
        }
        if self.parent_directory.trim().is_empty() || self.parent_directory.len() > 4096 {
            return Err(error(
                "GEN_CONFIG_INVALID",
                "Parent directory must contain 1–4096 UTF-8 bytes.",
                "Choose a valid parent directory and resolve the plan again.",
            ));
        }
        if self
            .template_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 4096)
            || self
                .template_variant_id
                .as_ref()
                .is_some_and(|value| value.is_empty() || value.len() > 4096)
        {
            return Err(error(
                "GEN_CONFIG_INVALID",
                "Forma template and variant IDs must contain 1–4096 UTF-8 bytes.",
                "Choose a catalog template and variant.",
            ));
        }
        if self.template_variant_id.is_some() && self.template_id.is_none() {
            return Err(error(
                "DESKTOP_SELECTION_INVALID",
                "Forma variant requires a selected Forma template.",
                "Choose a template before choosing its variant.",
            ));
        }
        if self
            .module_path
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.len() > 512)
            || (!matches!(self.recipe_id, DesktopRecipeId::Be02) && self.module_path.is_some())
        {
            return Err(error(
                "GEN_CONFIG_INVALID",
                "Go module path is invalid or belongs to a non-Go recipe.",
                "Enter a valid Go module path or remove it for the selected recipe.",
            ));
        }
        if matches!(
            self.recipe_id,
            DesktopRecipeId::Be01
                | DesktopRecipeId::Be02
                | DesktopRecipeId::Be05
                | DesktopRecipeId::Be06
        ) && (self.template_id.is_some() || self.template_variant_id.is_some())
        {
            return Err(error(
                "DESKTOP_SELECTION_INVALID",
                "Standalone backend recipes cannot include a Forma frontend template.",
                "Remove the template selection and resolve the backend plan again.",
            ));
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatusV1 {
    schema_version: u8,
    mode: String,
    internal_development_mode: bool,
    available: bool,
    version: Option<String>,
    executable_path: Option<String>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliEnvelope {
    schema_version: u8,
    ok: bool,
    data: Option<Value>,
    error: Option<CliError>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliError {
    code: String,
    message: String,
    next_action: String,
    target_modified: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobEventV1 {
    schema_version: u8,
    job_id: String,
    sequence: u64,
    timestamp: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<u8>,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopEventV1 {
    schema_version: u8,
    invocation_id: String,
    event: JobEventV1,
}

struct ConfigFile(PathBuf);

impl Drop for ConfigFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[derive(Clone)]
struct ActiveJob {
    invocation_id: String,
    cancel: watch::Sender<bool>,
}

#[derive(Default)]
struct DesktopState {
    active_job: Arc<Mutex<Option<ActiveJob>>>,
}

fn desktop_error_from_cli(detail: CliError) -> DesktopErrorV1 {
    DesktopErrorV1 {
        schema_version: 1,
        code: detail.code,
        message: detail.message,
        next_action: detail.next_action,
        target_modified: detail.target_modified,
    }
}

fn resource_root(app: &AppHandle) -> CommandResult<PathBuf> {
    let packaged = app
        .path()
        .resource_dir()
        .map(|path| path.join("resources").join(RESOURCE_ROOT))
        .map_err(|_| {
            error(
                "DESKTOP_RESOURCES_UNAVAILABLE",
                "Packaged application resources are unavailable.",
                "Repair or reinstall Project Generator.",
            )
        })?;
    if packaged.is_dir() {
        return Ok(packaged);
    }
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RESOURCE_ROOT);
        if development.is_dir() {
            return Ok(development);
        }
    }
    Err(error(
        "DESKTOP_RESOURCES_UNAVAILABLE",
        "Packaged application resources are unavailable.",
        "Repair or reinstall Project Generator.",
    ))
}

fn system_node_from_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|entry| entry.join("node.exe"))
        .find(|candidate| candidate.is_file())
}

fn engine_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let path = if RUNTIME_MODE == "bundled" {
        resource_root(app)?.join("runtime").join("node.exe")
    } else {
        system_node_from_path().ok_or_else(|| error(
            "DESKTOP_NODE_RUNTIME_MISSING",
            "System Node.js was not found. The desktop shell can open, but its CLI engine and generation doctor need Node.js.",
            "Install a supported Node.js release and npm, or use the bundled-runtime PoC build.",
        ))?
    };
    if !path.is_file() {
        return Err(error(
            "DESKTOP_NODE_RUNTIME_MISSING",
            "The selected Node.js runtime is missing.",
            "Repair or reinstall Project Generator, or install system Node.js for the system-runtime build.",
        ));
    }
    Ok(path)
}

fn cli_entry(app: &AppHandle) -> CommandResult<PathBuf> {
    let path = resource_root(app)?
        .join("cli")
        .join("dist")
        .join("src")
        .join("index.js");
    if !path.is_file() {
        return Err(error(
            "DESKTOP_CLI_UNAVAILABLE",
            "Packaged CLI entry point is missing.",
            "Repair or reinstall Project Generator.",
        ));
    }
    Ok(path)
}

fn node_compatible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(local) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(local);
        }
    }
    path
}

async fn create_config(
    app: &AppHandle,
    selection: &DesktopSelectionV1,
) -> CommandResult<ConfigFile> {
    selection.validate()?;
    let directory = app.path().app_cache_dir().map_err(|_| {
        error(
            "DESKTOP_CONFIG_STORAGE_FAILED",
            "Could not locate per-user temporary configuration storage.",
            "Check the current user's application-data folder permissions.",
        )
    })?;
    fs::create_dir_all(&directory).map_err(|_| {
        error(
            "DESKTOP_CONFIG_STORAGE_FAILED",
            "Could not create per-user temporary configuration storage.",
            "Check the current user's application-data folder permissions.",
        )
    })?;
    let path = directory.join(format!("desktop-config-{}.json", Uuid::new_v4()));
    let forma_commit_sha = if selection.template_id.is_some() {
        packaged_forma_commit_sha(app)?
    } else {
        String::new()
    };
    let bytes = serde_json::to_vec(&selection.to_core_json(&forma_commit_sha)).map_err(|_| {
        error(
            "DESKTOP_CONFIG_INVALID",
            "Could not encode the validated desktop selection.",
            "Review the project name, target folder, recipe, and Forma selection.",
        )
    })?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| {
            error(
                "DESKTOP_CONFIG_STORAGE_FAILED",
                "Could not create a temporary project configuration.",
                "Check the current user's application-data folder permissions.",
            )
        })?;
    if file.write_all(&bytes).is_err() || file.sync_all().is_err() {
        let _ = fs::remove_file(&path);
        return Err(error(
            "DESKTOP_CONFIG_STORAGE_FAILED",
            "Could not write the temporary project configuration.",
            "Check the current user's application-data folder permissions.",
        ));
    }
    Ok(ConfigFile(path))
}

fn packaged_forma_commit_sha(app: &AppHandle) -> CommandResult<String> {
    let path = resource_root(app)?.join("catalog.json");
    let bytes = fs::read(path).map_err(|_| {
        error(
            "DESKTOP_CATALOG_UNAVAILABLE",
            "Pinned Forma catalog metadata is missing.",
            "Repair or reinstall Project Generator.",
        )
    })?;
    let envelope: Value = serde_json::from_slice(&bytes).map_err(|_| {
        error(
            "DESKTOP_CATALOG_INVALID",
            "Pinned Forma catalog metadata is invalid.",
            "Repair or reinstall Project Generator.",
        )
    })?;
    let sha = envelope
        .get("data")
        .and_then(|data| data.get("forma"))
        .and_then(|forma| forma.get("commitSha"))
        .and_then(Value::as_str)
        .filter(|sha| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            error(
                "DESKTOP_CATALOG_INVALID",
                "Pinned Forma commit SHA is missing or malformed.",
                "Repair or reinstall Project Generator.",
            )
        })?;
    Ok(sha.to_owned())
}

#[derive(Clone, Copy)]
enum CliAction {
    Plan,
    Doctor,
    RecoveryInspect,
}

impl CliAction {
    fn args(self, config: Option<&Path>) -> Vec<String> {
        match self {
            Self::Plan => vec![
                "plan".into(),
                "--config".into(),
                config.unwrap().to_string_lossy().into_owned(),
                "--json".into(),
            ],
            Self::Doctor => vec![
                "doctor".into(),
                "--config".into(),
                config.unwrap().to_string_lossy().into_owned(),
                "--json".into(),
            ],
            Self::RecoveryInspect => vec!["recovery".into(), "inspect".into(), "--json".into()],
        }
    }

    fn allows_blocked_exit(self, code: Option<i32>) -> bool {
        matches!((self, code), (Self::Doctor, Some(3)))
    }
}

async fn run_cli_json(
    app: &AppHandle,
    action: CliAction,
    config: Option<&Path>,
) -> CommandResult<Value> {
    let node = node_compatible_path(engine_path(app)?);
    let entry = node_compatible_path(cli_entry(app)?);
    let root = node_compatible_path(resource_root(app)?);
    let mut command = Command::new(node);
    command
        .arg(entry)
        .args(action.args(config))
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|_| {
        error(
            "DESKTOP_CLI_START_FAILED",
            "The packaged CLI could not start under the selected Node.js runtime.",
            "Check the runtime package and application installation.",
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        error(
            "DESKTOP_CLI_PROTOCOL",
            "The CLI output pipe could not be opened.",
            "Restart Project Generator.",
        )
    })?;
    let read_result = timeout(Duration::from_secs(30), async {
        let mut bytes = Vec::new();
        stdout
            .take((MAX_JSON_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .map(|_| bytes)
    })
    .await;
    let bytes = match read_result {
        Ok(Ok(bytes)) if bytes.len() <= MAX_JSON_BYTES => bytes,
        _ => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(error(
                "DESKTOP_CLI_OUTPUT_LIMIT",
                "The CLI response exceeded its time or size limit.",
                "Inspect local recovery state from the CLI and retry.",
            ));
        }
    };
    let status = child.wait().await.map_err(|_| {
        error(
            "DESKTOP_CLI_FAILED",
            "The CLI process ended without a status.",
            "Retry after checking local diagnostics.",
        )
    })?;
    let envelope: CliEnvelope = serde_json::from_slice(&bytes).map_err(|_| {
        error(
            "DESKTOP_CLI_PROTOCOL",
            "The CLI returned invalid JSON or an unsupported response.",
            "Repair or reinstall Project Generator.",
        )
    })?;
    if envelope.schema_version != 1 {
        return Err(error(
            "DESKTOP_CLI_SCHEMA_UNSUPPORTED",
            "The CLI response schema is unsupported.",
            "Update Project Generator to a matching internal build.",
        ));
    }
    if !status.success() && !action.allows_blocked_exit(status.code()) {
        if let Some(detail) = envelope.error {
            return Err(desktop_error_from_cli(detail));
        }
        return Err(error(
            "DESKTOP_CLI_FAILED",
            "The CLI command failed.",
            "Review the selected recipe, prerequisites, and local recovery state.",
        ));
    }
    if !envelope.ok {
        if let Some(detail) = envelope.error {
            return Err(desktop_error_from_cli(detail));
        }
        return Err(error(
            "DESKTOP_CLI_FAILED",
            "The CLI command failed.",
            "Review the selected recipe and local diagnostics.",
        ));
    }
    envelope.data.ok_or_else(|| {
        error(
            "DESKTOP_CLI_PROTOCOL",
            "The CLI response did not contain data.",
            "Repair or reinstall Project Generator.",
        )
    })
}

#[tauri::command]
async fn get_catalog(app: AppHandle) -> CommandResult<Value> {
    let path = resource_root(&app)?.join("catalog.json");
    let bytes = fs::read(path).map_err(|_| {
        error(
            "DESKTOP_CATALOG_UNAVAILABLE",
            "Packaged recipe catalog is missing.",
            "Repair or reinstall Project Generator.",
        )
    })?;
    let envelope: CliEnvelope = serde_json::from_slice(&bytes).map_err(|_| {
        error(
            "DESKTOP_CATALOG_INVALID",
            "Packaged recipe catalog is invalid.",
            "Repair or reinstall Project Generator.",
        )
    })?;
    if envelope.schema_version != 1 || !envelope.ok {
        return Err(error(
            "DESKTOP_CATALOG_INVALID",
            "Packaged recipe catalog has an unsupported schema.",
            "Repair or reinstall Project Generator.",
        ));
    }
    envelope.data.ok_or_else(|| {
        error(
            "DESKTOP_CATALOG_INVALID",
            "Packaged recipe catalog contains no data.",
            "Repair or reinstall Project Generator.",
        )
    })
}

#[tauri::command]
async fn get_runtime_status(app: AppHandle) -> RuntimeStatusV1 {
    let candidate = if RUNTIME_MODE == "bundled" {
        resource_root(&app)
            .ok()
            .map(|root| root.join("runtime").join("node.exe"))
    } else {
        system_node_from_path()
    };
    let (available, version, executable_path, message) = match candidate
        .filter(|path| path.is_file())
    {
        Some(path) => match timeout(
            Duration::from_secs(5),
            Command::new(&path)
                .arg("--version")
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        {
            Ok(Ok(output)) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                let message = if RUNTIME_MODE == "bundled" {
                    "Application engine uses its bundled Node runtime; generation tool requirements appear separately in Doctor.".to_owned()
                } else {
                    "Application engine uses Node.js found on PATH; Node.js is not bundled in this installer.".to_owned()
                };
                (
                    true,
                    Some(version),
                    Some(path.to_string_lossy().into_owned()),
                    message,
                )
            }
            _ => (
                false,
                None,
                Some(path.to_string_lossy().into_owned()),
                "Selected Node.js executable could not run.".to_owned(),
            ),
        },
        None => (
            false,
            None,
            None,
            "Desktop shell is available, but the CLI engine needs system Node.js.".to_owned(),
        ),
    };
    RuntimeStatusV1 {
        schema_version: 1,
        mode: RUNTIME_MODE.to_owned(),
        internal_development_mode: INTERNAL_DEVELOPMENT_MODE,
        available,
        version,
        executable_path,
        message,
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn resolve_plan(app: AppHandle, selection: DesktopSelectionV1) -> CommandResult<Value> {
    let config = create_config(&app, &selection).await?;
    run_cli_json(&app, CliAction::Plan, Some(&config.0)).await
}

#[tauri::command(rename_all = "camelCase")]
async fn run_environment_doctor(
    app: AppHandle,
    selection: DesktopSelectionV1,
) -> CommandResult<Value> {
    let config = create_config(&app, &selection).await?;
    let mut report = run_cli_json(&app, CliAction::Doctor, Some(&config.0)).await?;
    if selection.template_id.is_some() {
        let git = find_git();
        let gcm_available = match git.as_ref() {
            Some(path) => git_credential_manager_available(path).await,
            None => false,
        };
        let tools = report["tools"].as_array_mut().ok_or_else(|| {
            error(
                "DESKTOP_CLI_PROTOCOL",
                "Environment doctor returned an invalid tool list.",
                "Repair or reinstall Project Generator.",
            )
        })?;
        tools.push(json!({
            "id": "git",
            "available": git.is_some(),
            "message": if git.is_some() { "Git for Windows executable found on PATH." } else { "Git for Windows is required for the pinned Forma fetch." }
        }));
        tools.push(json!({
            "id": "git-credential-manager",
            "available": gcm_available,
            "message": if gcm_available { "Git Credential Manager responds to a non-authenticating version probe." } else { "Git Credential Manager is unavailable; private Forma fetch is blocked." }
        }));
        if !gcm_available {
            report["ready"] = json!(false);
        }
    }
    Ok(report)
}

fn find_git() -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|entry| entry.join("git.exe"))
        .find(|candidate| candidate.is_file())
}

async fn git_credential_manager_available(git: &Path) -> bool {
    matches!(
        timeout(
            Duration::from_secs(5),
            Command::new(git)
                .args(["credential-manager", "--version"])
                .env("GIT_TERMINAL_PROMPT", "0")
                .env("GCM_INTERACTIVE", "never")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .status(),
        )
        .await,
        Ok(Ok(status)) if status.success()
    )
}

#[tauri::command]
async fn inspect_recovery(app: AppHandle) -> CommandResult<Value> {
    run_cli_json(&app, CliAction::RecoveryInspect, None).await
}

fn validated_project_directory(path: &str) -> CommandResult<PathBuf> {
    if path.trim().is_empty() || path.len() > 4096 {
        return Err(error(
            "DESKTOP_PROJECT_PATH_INVALID",
            "Project folder path is empty or too long.",
            "Choose a generated project from recent projects and retry.",
        ));
    }
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(error(
            "DESKTOP_PROJECT_PATH_INVALID",
            "Project folder path must be absolute.",
            "Choose a generated project from recent projects and retry.",
        ));
    }
    let canonical = fs::canonicalize(path).map_err(|_| {
        error(
            "DESKTOP_PROJECT_NOT_FOUND",
            "Generated project folder no longer exists or cannot be accessed.",
            "Check the folder location before opening it.",
        )
    })?;
    if !canonical.is_dir() {
        return Err(error(
            "DESKTOP_PROJECT_NOT_FOUND",
            "Generated project path is not a folder.",
            "Check the folder location before opening it.",
        ));
    }
    Ok(canonical)
}

#[tauri::command(rename_all = "camelCase")]
fn open_project_folder(path: String) -> CommandResult<()> {
    let path = validated_project_directory(&path)?;
    #[cfg(windows)]
    {
        let windows = env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        NativeCommand::new(windows.join("explorer.exe"))
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|_| {
                error(
                    "DESKTOP_FOLDER_OPEN_FAILED",
                    "Windows Explorer could not open the project folder.",
                    "Open the folder from File Explorer and check Windows permissions.",
                )
            })
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(error(
            "DESKTOP_ACTION_UNAVAILABLE",
            "Opening project folders is only available in this Windows-first build.",
            "Open the generated folder with your operating system's file manager.",
        ))
    }
}

#[cfg(windows)]
fn vscode_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local_app_data).join("Programs/Microsoft VS Code/Code.exe"));
    }
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("Microsoft VS Code/Code.exe"));
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(program_files_x86).join("Microsoft VS Code/Code.exe"));
    }
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|entry| entry.join("Code.exe")));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[tauri::command]
fn get_vscode_status() -> bool {
    #[cfg(windows)]
    {
        vscode_executable().is_some()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command(rename_all = "camelCase")]
fn open_project_in_vscode(path: String) -> CommandResult<()> {
    let project = validated_project_directory(&path)?;
    #[cfg(windows)]
    {
        let code = vscode_executable().ok_or_else(|| {
            error(
                "DESKTOP_VSCODE_UNAVAILABLE",
                "Visual Studio Code was not found.",
                "Install VS Code or add Code.exe to PATH, then retry.",
            )
        })?;
        NativeCommand::new(code)
            .arg("--new-window")
            .arg(project)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|_| {
                error(
                    "DESKTOP_VSCODE_OPEN_FAILED",
                    "Visual Studio Code could not open the project folder.",
                    "Open the folder from VS Code and check Windows permissions.",
                )
            })
    }
    #[cfg(not(windows))]
    {
        let _ = project;
        Err(error(
            "DESKTOP_ACTION_UNAVAILABLE",
            "Opening projects in VS Code is only available in this Windows-first build.",
            "Open the generated folder with your installed editor.",
        ))
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn start_generation(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    selection: DesktopSelectionV1,
    lifecycle_consent: bool,
    allow_planned: bool,
    on_event: Channel<DesktopEventV1>,
) -> CommandResult<String> {
    authorize_generation(
        lifecycle_consent,
        !matches!(selection.recipe_id, DesktopRecipeId::Be02),
        allow_planned,
        INTERNAL_DEVELOPMENT_MODE,
    )?;
    selection.validate()?;
    if selection.template_id.is_some() {
        let git = find_git().ok_or_else(|| {
            error(
                "GEN_FORMA_GIT_MISSING",
                "Git for Windows is required for the pinned Forma fetch.",
                "Install Git for Windows and retry; no credentials were requested.",
            )
        })?;
        if !git_credential_manager_available(&git).await {
            return Err(error(
                "GEN_FORMA_GCM_MISSING",
                "Git Credential Manager is unavailable for the private Forma fetch.",
                "Configure Git for Windows and Git Credential Manager before retrying.",
            ));
        }
    }

    let invocation_id = Uuid::new_v4().to_string();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut active = state.active_job.lock().map_err(|_| {
            error(
                "DESKTOP_JOB_STATE_FAILED",
                "Generation state is unavailable.",
                "Restart Project Generator.",
            )
        })?;
        if active.is_some() {
            return Err(error(
                "DESKTOP_JOB_ALREADY_RUNNING",
                "Only one generation job can run at a time.",
                "Wait for the active job to finish or cancel it.",
            ));
        }
        *active = Some(ActiveJob {
            invocation_id: invocation_id.clone(),
            cancel: cancel_tx,
        });
    }

    let result = async {
        let config = create_config(&app, &selection).await?;
        let plan = run_cli_json(&app, CliAction::Plan, Some(&config.0)).await?;
        let planned = plan.get("recipeStatus").and_then(Value::as_str) == Some("planned");
        if planned && !allow_planned {
            return Err(error(
                "GEN_RECIPE_UNTESTED",
                "Planned recipes are disabled for normal generation.",
                "Use an approved recipe; internal debug builds may opt in for evidence gathering.",
            ));
        }

        let node = node_compatible_path(engine_path(&app)?);
        let entry = node_compatible_path(cli_entry(&app)?);
        let root = node_compatible_path(resource_root(&app)?);
        let mut command = Command::new(node);
        command
            .arg(entry)
            .arg("generate")
            .arg("--config")
            .arg(&config.0)
            .arg("--jsonl")
            .arg("--desktop-control")
            .args(if allow_planned {
                vec!["--development-allow-planned"]
            } else {
                Vec::new()
            })
            .args(if lifecycle_consent {
                vec!["--allow-dependency-scripts"]
            } else {
                Vec::new()
            })
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let child = command.spawn().map_err(|_| {
            error(
                "DESKTOP_CLI_START_FAILED",
                "The packaged CLI could not start under the selected Node.js runtime.",
                "Check the runtime package and application installation.",
            )
        })?;
        Ok::<_, DesktopErrorV1>((config, child))
    }
    .await;

    let (config, child) = match result {
        Ok(value) => value,
        Err(detail) => {
            clear_active_job(&state.active_job, &invocation_id);
            return Err(detail);
        }
    };
    let active_job = state.active_job.clone();
    let task_app = app.clone();
    let task_id = invocation_id.clone();
    tauri::async_runtime::spawn(async move {
        pump_generation(
            task_app, active_job, task_id, config, child, cancel_rx, on_event,
        )
        .await;
    });
    Ok(invocation_id)
}

fn clear_active_job(active: &Arc<Mutex<Option<ActiveJob>>>, invocation_id: &str) {
    if let Ok(mut current) = active.lock()
        && current
            .as_ref()
            .is_some_and(|job| job.invocation_id == invocation_id)
    {
        *current = None;
    }
}

fn send_event(channel: &Channel<DesktopEventV1>, invocation_id: &str, event: JobEventV1) -> bool {
    channel
        .send(DesktopEventV1 {
            schema_version: 1,
            invocation_id: invocation_id.to_owned(),
            event,
        })
        .is_ok()
}

fn cancellation_terminal_is_confirmed(status: Option<&str>, exit_code: Option<i32>) -> bool {
    status == Some("cancelled") && exit_code == Some(5)
}

fn synthetic_event(
    job_id: &str,
    sequence: u64,
    event_type: &str,
    status: Option<&str>,
    code: &str,
    message: &str,
) -> JobEventV1 {
    JobEventV1 {
        schema_version: 1,
        job_id: job_id.to_owned(),
        sequence,
        timestamp: chrono_free_timestamp(),
        event_type: event_type.to_owned(),
        stage_id: None,
        stage_owner: Some("tauri".to_owned()),
        stage_status: None,
        status: status.map(str::to_owned),
        percent: None,
        message: message.to_owned(),
        code: Some(code.to_owned()),
    }
}

fn chrono_free_timestamp() -> String {
    use time::{OffsetDateTime, format_description::well_known::Rfc3339};
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn parse_cli_event(
    line: &[u8],
    expected_sequence: u64,
    job_id: Option<&str>,
) -> Result<JobEventV1, ()> {
    let event = serde_json::from_slice::<JobEventV1>(line).map_err(|_| ())?;
    let known_type = [
        "job-started",
        "stage-started",
        "stage-progress",
        "stage-finished",
        "validation",
        "warning",
        "error",
        "job-finished",
    ]
    .contains(&event.event_type.as_str());
    if event.schema_version != 1 || event.sequence != expected_sequence || !known_type {
        return Err(());
    }
    match job_id {
        Some(expected) if expected != event.job_id => return Err(()),
        None if event.sequence != 1 || event.event_type != "job-started" => return Err(()),
        _ => {}
    }
    Ok(event)
}

async fn pump_generation(
    _app: AppHandle,
    active_job: Arc<Mutex<Option<ActiveJob>>>,
    invocation_id: String,
    _config: ConfigFile,
    mut child: Child,
    mut cancel_rx: watch::Receiver<bool>,
    channel: Channel<DesktopEventV1>,
) {
    let stdout = child.stdout.take();
    let mut stdin = child.stdin.take();
    let mut sequence = 1_u64;
    let mut cli_job_id: Option<String> = None;
    let mut terminal = false;
    let mut terminal_event: Option<JobEventV1> = None;
    let mut protocol_failed = false;
    let mut cancel_sent = false;
    if let Some(mut pipe) = stdout {
        let mut read_buffer = [0_u8; 8192];
        let mut line = Vec::with_capacity(8192);
        let mut stop_reading = false;
        loop {
            tokio::select! {
                read = pipe.read(&mut read_buffer) => {
                    match read {
                        Ok(0) => {
                            if !line.is_empty() { protocol_failed = true; }
                            break;
                        }
                        Ok(size) => {
                            for byte in &read_buffer[..size] {
                                if *byte != b'\n' {
                                    if line.len() >= MAX_EVENT_LINE_BYTES {
                                        protocol_failed = true;
                                        stop_reading = true;
                                        break;
                                    }
                                    line.push(*byte);
                                    continue;
                                }

                                let parsed = parse_cli_event(&line, sequence, cli_job_id.as_deref());
                                line.clear();
                                let Ok(event) = parsed else {
                                    protocol_failed = true;
                                    stop_reading = true;
                                    break;
                                };
                                if cli_job_id.is_none() { cli_job_id = Some(event.job_id.clone()); }
                                sequence += 1;
                                if event.event_type == "job-finished" {
                                    terminal = true;
                                    terminal_event = Some(event);
                                    stop_reading = true;
                                    break;
                                }
                                if !send_event(&channel, &invocation_id, event) {
                                    cancel_sent = true;
                                    if let Some(pipe) = stdin.as_mut() {
                                        let _ = pipe.write_all(b"{\"schemaVersion\":1,\"kind\":\"cancel\"}\n").await;
                                        let _ = pipe.flush().await;
                                    }
                                }
                            }
                            if stop_reading { break; }
                        }
                        Err(_) => { protocol_failed = true; break; }
                    }
                }
                changed = cancel_rx.changed(), if !cancel_sent => {
                    cancel_sent = true;
                    if changed.is_ok() && *cancel_rx.borrow()
                        && let Some(pipe) = stdin.as_mut() {
                        let _ = pipe.write_all(b"{\"schemaVersion\":1,\"kind\":\"cancel\"}\n").await;
                        let _ = pipe.flush().await;
                    }
                }
            }
        }
    } else {
        protocol_failed = true;
    }
    if protocol_failed && let Some(pipe) = stdin.as_mut() {
        let _ = pipe
            .write_all(b"{\"schemaVersion\":1,\"kind\":\"cancel\"}\n")
            .await;
        let _ = pipe.flush().await;
    }
    drop(stdin.take());
    let status = timeout(Duration::from_secs(15), child.wait()).await;
    let process_succeeded = matches!(&status, Ok(Ok(exit)) if exit.success());
    let cancellation_succeeded = cancellation_terminal_is_confirmed(
        terminal_event
            .as_ref()
            .and_then(|event| event.status.as_deref()),
        match &status {
            Ok(Ok(exit)) => exit.code(),
            _ => None,
        },
    );
    if terminal && (process_succeeded || cancellation_succeeded) && !protocol_failed {
        if let Some(event) = terminal_event {
            let _ = send_event(&channel, &invocation_id, event);
        }
    } else {
        let code = if protocol_failed {
            "DESKTOP_JSONL_PROTOCOL"
        } else if terminal && !process_succeeded {
            "DESKTOP_CLI_EXIT_FAILED"
        } else {
            "DESKTOP_CLI_SIDECAR_FAILED"
        };
        let message = if protocol_failed {
            "Generation event stream was invalid or exceeded its size limit; staging was not treated as successful."
        } else if terminal && !process_succeeded {
            "CLI reported a terminal event but did not exit successfully; inspect recovery state before retrying."
        } else if !terminal {
            "CLI ended without a terminal job event; inspect recovery state before retrying."
        } else {
            "CLI sidecar failed; inspect recovery state before retrying."
        };
        let bridge_job_id = cli_job_id.as_deref().unwrap_or(&invocation_id);
        if cli_job_id.is_none() {
            let _ = send_event(
                &channel,
                &invocation_id,
                synthetic_event(
                    bridge_job_id,
                    sequence,
                    "job-started",
                    Some("running"),
                    code,
                    "Desktop generation request started.",
                ),
            );
            sequence += 1;
        }
        let _ = send_event(
            &channel,
            &invocation_id,
            synthetic_event(bridge_job_id, sequence, "error", None, code, message),
        );
        let _ = send_event(
            &channel,
            &invocation_id,
            synthetic_event(
                bridge_job_id,
                sequence + 1,
                "job-finished",
                Some("failed"),
                code,
                "Generation ended without a confirmed successful result.",
            ),
        );
    }
    clear_active_job(&active_job, &invocation_id);
}

#[tauri::command(rename_all = "camelCase")]
fn cancel_generation(
    state: tauri::State<'_, DesktopState>,
    invocation_id: String,
) -> CommandResult<()> {
    let active = state.active_job.lock().map_err(|_| {
        error(
            "DESKTOP_JOB_STATE_FAILED",
            "Generation state is unavailable.",
            "Restart Project Generator.",
        )
    })?;
    let Some(job) = active
        .as_ref()
        .filter(|job| job.invocation_id == invocation_id)
    else {
        return Err(error(
            "DESKTOP_JOB_NOT_RUNNING",
            "No matching generation job is running.",
            "Refresh job status and recovery state.",
        ));
    };
    job.cancel.send(true).map_err(|_| {
        error(
            "DESKTOP_CANCEL_FAILED",
            "Cancellation request could not reach the generation bridge.",
            "Do not assume the process stopped; inspect local recovery state.",
        )
    })
}

fn main() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            get_catalog,
            get_runtime_status,
            resolve_plan,
            run_environment_doctor,
            inspect_recovery,
            start_generation,
            cancel_generation,
            open_project_folder,
            open_project_in_vscode,
            get_vscode_status
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Project Generator desktop PoC");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_selection_builds_only_pinned_recipe_and_forma_sha() {
        let selection = DesktopSelectionV1 {
            project_name: "demo".into(),
            parent_directory: "C:\\Projects".into(),
            recipe_id: DesktopRecipeId::Fe01,
            documentation: DesktopDocumentationV1::Minimal,
            template_id: Some("focus-planner".into()),
            template_variant_id: Some("coral".into()),
            module_path: None,
        };
        let config = selection.to_core_json("5cf3c4e5b7b0bc454a653f58d12237c56f2548e2");
        assert_eq!(config["frontend"]["adapterId"], "frontend.react-vite");
        assert_eq!(
            config["template"]["commitSha"],
            "5cf3c4e5b7b0bc454a653f58d12237c56f2548e2"
        );
        assert_eq!(config["template"]["templateId"], "focus-planner");
        assert_eq!(config["documentation"], "minimal");
        assert!(config.get("styling").is_none());
        assert!(config.get("command").is_none());

        for (recipe_id, frontend, styling, manager) in [
            (
                DesktopRecipeId::Fe03,
                "frontend.vue-vite",
                "styling.css",
                "npm",
            ),
            (
                DesktopRecipeId::Fe04,
                "frontend.react-vite",
                "styling.bootstrap",
                "npm",
            ),
            (
                DesktopRecipeId::Fe05,
                "frontend.vue-vite",
                "styling.bootstrap",
                "npm",
            ),
            (DesktopRecipeId::Fe06, "frontend.nuxt", "styling.css", "npm"),
            (
                DesktopRecipeId::Fe07,
                "frontend.angular",
                "styling.scss",
                "npm",
            ),
            (
                DesktopRecipeId::Fe08,
                "frontend.react-vite",
                "styling.scss",
                "npm",
            ),
            (
                DesktopRecipeId::Fe09,
                "frontend.vue-vite",
                "styling.scss",
                "npm",
            ),
            (
                DesktopRecipeId::Fe10,
                "frontend.react-vite",
                "styling.tailwind",
                "npm",
            ),
            (
                DesktopRecipeId::Fe11,
                "frontend.vue-vite",
                "styling.tailwind",
                "npm",
            ),
            (
                DesktopRecipeId::Fe12,
                "frontend.react-vite",
                "styling.css",
                "yarn",
            ),
            (
                DesktopRecipeId::Fe13,
                "frontend.vue-vite",
                "styling.css",
                "yarn",
            ),
            (
                DesktopRecipeId::Fe14,
                "frontend.react-vite",
                "styling.css",
                "pnpm",
            ),
            (
                DesktopRecipeId::Fe15,
                "frontend.vue-vite",
                "styling.css",
                "pnpm",
            ),
        ] {
            let generated = DesktopSelectionV1 {
                project_name: "demo".into(),
                parent_directory: "C:\\Projects".into(),
                recipe_id,
                documentation: DesktopDocumentationV1::Minimal,
                template_id: None,
                template_variant_id: None,
                module_path: None,
            }
            .to_core_json("");
            assert_eq!(generated["frontend"]["adapterId"], frontend);
            assert_eq!(generated["styling"]["adapterId"], styling);
            assert_eq!(generated["frontend"]["manager"], manager);
        }

        let backend = DesktopSelectionV1 {
            project_name: "demo-api".into(),
            parent_directory: "C:\\Projects".into(),
            recipe_id: DesktopRecipeId::Be01,
            documentation: DesktopDocumentationV1::Standard,
            template_id: None,
            template_variant_id: None,
            module_path: None,
        }
        .to_core_json("");
        assert_eq!(backend["project"]["type"], "backend");
        assert_eq!(backend["backend"]["adapterId"], "backend.express");
        assert_eq!(backend["backend"]["manager"], "npm");
        assert!(backend.get("frontend").is_none());
        assert!(backend.get("styling").is_none());

        let go_backend = DesktopSelectionV1 {
            project_name: "demo-api".into(),
            parent_directory: "C:\\Projects".into(),
            recipe_id: DesktopRecipeId::Be02,
            documentation: DesktopDocumentationV1::Standard,
            template_id: None,
            template_variant_id: None,
            module_path: Some("github.com/example/demo-api".into()),
        }
        .to_core_json("");
        assert_eq!(go_backend["backend"]["adapterId"], "backend.go-net-http");
        assert_eq!(go_backend["backend"]["manager"], "go-modules");
        assert_eq!(
            go_backend["backend"]["modulePath"],
            "github.com/example/demo-api"
        );

        let laravel_backend = DesktopSelectionV1 {
            project_name: "demo-api".into(),
            parent_directory: "C:\\Projects".into(),
            recipe_id: DesktopRecipeId::Be05,
            documentation: DesktopDocumentationV1::Standard,
            template_id: None,
            template_variant_id: None,
            module_path: None,
        }
        .to_core_json("");
        assert_eq!(laravel_backend["backend"]["adapterId"], "backend.laravel");
        assert_eq!(laravel_backend["backend"]["manager"], "composer");
        assert!(laravel_backend.get("frontend").is_none());

        let fastapi_backend = DesktopSelectionV1 {
            project_name: "demo-api".into(),
            parent_directory: "C:\\Projects".into(),
            recipe_id: DesktopRecipeId::Be06,
            documentation: DesktopDocumentationV1::Standard,
            template_id: None,
            template_variant_id: None,
            module_path: None,
        }
        .to_core_json("");
        assert_eq!(fastapi_backend["backend"]["adapterId"], "backend.fastapi");
        assert_eq!(fastapi_backend["backend"]["manager"], "uv");
        assert!(fastapi_backend.get("frontend").is_none());

        let standalone = DesktopSelectionV1 {
            project_name: "demo".into(),
            parent_directory: "C:\\Projects".into(),
            recipe_id: DesktopRecipeId::Fe01,
            documentation: DesktopDocumentationV1::Standard,
            template_id: None,
            template_variant_id: None,
            module_path: None,
        }
        .to_core_json("");
        assert_eq!(standalone["styling"]["adapterId"], "styling.css");
    }

    #[test]
    fn runtime_mode_is_fixed_to_supported_build_variant() {
        assert!(matches!(RUNTIME_MODE, "system" | "bundled"));
    }

    #[cfg(windows)]
    #[test]
    fn node_cli_paths_drop_windows_verbatim_prefix() {
        assert_eq!(
            node_compatible_path(PathBuf::from(r"\\?\E:\Projects\pg-runtime")),
            PathBuf::from(r"E:\Projects\pg-runtime")
        );
        assert_eq!(
            node_compatible_path(PathBuf::from(r"\\?\UNC\server\share\pg-runtime")),
            PathBuf::from(r"\\server\share\pg-runtime")
        );
    }

    #[test]
    fn selection_validation_bounds_values_before_temp_config_write() {
        let mut selection = DesktopSelectionV1 {
            project_name: "demo".into(),
            parent_directory: "C:\\Projects".into(),
            recipe_id: DesktopRecipeId::Fe01,
            documentation: DesktopDocumentationV1::Full,
            template_id: None,
            template_variant_id: Some("coral".into()),
            module_path: None,
        };
        assert_eq!(
            selection.validate().unwrap_err().code,
            "DESKTOP_SELECTION_INVALID"
        );
        selection.template_variant_id = None;
        selection.project_name = "x".repeat(4097);
        assert_eq!(selection.validate().unwrap_err().code, "GEN_CONFIG_INVALID");
    }

    #[test]
    fn opening_project_requires_existing_absolute_directory() {
        let path = std::env::temp_dir().join(format!("pg-desktop-open-{}", Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        let result = validated_project_directory(&path.to_string_lossy())
            .ok()
            .expect("generated temp directory should validate");
        assert!(result.is_dir());
        let invalid = validated_project_directory("relative-project");
        assert_eq!(
            invalid.err().map(|detail| detail.code),
            Some("DESKTOP_PROJECT_PATH_INVALID".to_owned())
        );
        fs::remove_dir(path).unwrap();
    }

    #[test]
    fn cli_event_bridge_rejects_wrong_schema_sequence_and_job() {
        let first = br#"{"schemaVersion":1,"jobId":"job-1","sequence":1,"timestamp":"2026-11-13T00:00:00Z","type":"job-started","status":"running","message":"started"}"#;
        assert!(parse_cli_event(first, 1, None).is_ok());
        assert!(parse_cli_event(first, 2, None).is_err());
        assert!(parse_cli_event(first, 1, Some("job-2")).is_err());
        let unsupported = br#"{"schemaVersion":2,"jobId":"job-1","sequence":1,"timestamp":"2026-11-13T00:00:00Z","type":"job-started","status":"running","message":"started"}"#;
        assert!(parse_cli_event(unsupported, 1, None).is_err());
        assert!(
            parse_cli_event(
                &serde_json::to_vec(&synthetic_event(
                    "job-1",
                    1,
                    "job-started",
                    Some("running"),
                    "DESKTOP_TEST",
                    "started",
                ))
                .unwrap(),
                1,
                None
            )
            .is_ok()
        );
    }

    #[test]
    fn cli_cancel_terminal_requires_expected_cancel_exit_code() {
        assert!(cancellation_terminal_is_confirmed(
            Some("cancelled"),
            Some(5)
        ));
        assert!(!cancellation_terminal_is_confirmed(
            Some("cancelled"),
            Some(4)
        ));
        assert!(!cancellation_terminal_is_confirmed(Some("failed"), Some(5)));
        assert!(!cancellation_terminal_is_confirmed(Some("cancelled"), None));
    }

    #[test]
    fn generation_requires_explicit_consent_and_release_build_cannot_override_planned() {
        assert_eq!(
            authorize_generation(false, true, false, true)
                .unwrap_err()
                .code,
            "DESKTOP_CONSENT_REQUIRED"
        );
        assert_eq!(
            authorize_generation(true, true, true, false)
                .unwrap_err()
                .code,
            "DESKTOP_INTERNAL_MODE_REQUIRED"
        );
        assert!(authorize_generation(true, true, false, false).is_ok());
        assert!(authorize_generation(true, true, true, true).is_ok());
        assert!(authorize_generation(false, false, true, true).is_ok());
    }

    #[test]
    fn compiled_build_profile_controls_planned_recipe_override() {
        assert_eq!(INTERNAL_DEVELOPMENT_MODE, cfg!(debug_assertions));
        assert_eq!(
            authorize_generation(true, true, true, INTERNAL_DEVELOPMENT_MODE).is_ok(),
            cfg!(debug_assertions)
        );
    }
}

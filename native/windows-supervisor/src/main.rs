#[cfg(windows)]
mod windows {
    use serde::{Deserialize, Serialize};
    use std::collections::BTreeMap;
    use std::ffi::c_void;
    use std::io::{self, BufRead, Read};
    use std::mem::{ManuallyDrop, offset_of, size_of, size_of_val, zeroed};
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use std::path::{Component, Path, Prefix};
    use std::ptr::{null, null_mut};
    use std::sync::mpsc::{self, TryRecvError};
    use std::thread;
    use std::time::{Duration, Instant};
    use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows_sys::Wdk::Storage::FileSystem::{
        FILE_CREATE, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
        FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT, NtCreateFile,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_READ, GENERIC_WRITE, GetLastError, HANDLE, HANDLE_FLAG_INHERIT,
        INVALID_HANDLE_VALUE, SetHandleInformation, WAIT_FAILED, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::Foundation::{OBJ_CASE_INSENSITIVE, UNICODE_STRING};
    use windows_sys::Win32::Security::{
        GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, CreateFileW, DELETE, FILE_ADD_SUBDIRECTORY,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_ATTRIBUTE_TAG_INFO, FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO, FILE_LIST_DIRECTORY,
        FILE_READ_ATTRIBUTES, FILE_RENAME_INFO, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, FileAttributeTagInfo, FileDispositionInfo, FileIdBothDirectoryInfo,
        FileIdBothDirectoryRestartInfo, FileRenameInfo, GetFileInformationByHandle,
        GetFileInformationByHandleEx, OPEN_EXISTING, SYNCHRONIZE, SetFileInformationByHandle,
    };
    use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, IsProcessInJob, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
        QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::Threading::{
        CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
        DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess,
        GetExitCodeProcess, InitializeProcThreadAttributeList, OpenProcessToken,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
        ResumeThread, STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute,
        WaitForSingleObject,
    };

    const OUTPUT_LIMIT: usize = 256 * 1024;
    const MAX_REQUEST_BYTES: usize = 1024 * 1024;
    const POLL_INTERVAL: Duration = Duration::from_millis(20);
    const DESCENDANT_DRAIN_GRACE: Duration = Duration::from_millis(300);
    const TERMINATION_WAIT: Duration = Duration::from_secs(10);
    const EXIT_CODE_CANCELLED: u32 = 0xC000_013A;
    const MAX_DELETE_ENTRIES: usize = 200_000;
    const MAX_DELETE_DEPTH: usize = 256;
    const MAX_MARKER_BYTES: usize = 16 * 1024;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RunRequest {
        executable: String,
        args: Vec<String>,
        cwd: String,
        env: BTreeMap<String, String>,
        timeout_ms: Option<u64>,
    }

    #[derive(Deserialize)]
    struct ControlMessage {
        kind: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RunResponse {
        started: bool,
        exit_code: i32,
        stdout: String,
        stderr: String,
        truncated: bool,
        cancelled: bool,
        timed_out: bool,
        termination_confirmed: bool,
        peak_active_processes: u32,
        orphaned_descendants: bool,
        error: Option<&'static str>,
        system_error: Option<u32>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StageRequest {
        stage_path: String,
        parent_path: String,
        job_id: String,
        project_name: Option<String>,
        target_path: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CreateStageRequest {
        stage_path: String,
        parent_path: String,
        job_id: String,
        project_name: String,
        target_path: String,
    }

    #[derive(Deserialize)]
    struct OwnershipMarker {
        schema_version: u32,
        job_id: String,
        stage_name: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct FsResponse {
        ok: bool,
        code: Option<&'static str>,
        system_error: Option<u32>,
    }

    struct FsFailure {
        code: &'static str,
        system_error: Option<u32>,
    }

    type FsResult<T> = Result<T, FsFailure>;

    struct ValidatedStage {
        _parent_chain: Vec<Handle>,
        stage_handle: Handle,
        volume: u32,
    }

    impl RunResponse {
        fn failed_before_start(message: &'static str, system_error: Option<u32>) -> Self {
            Self {
                started: false,
                exit_code: 1,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                cancelled: false,
                timed_out: false,
                termination_confirmed: true,
                peak_active_processes: 0,
                orphaned_descendants: false,
                error: Some(message),
                system_error,
            }
        }
    }

    struct Handle(HANDLE);

    impl Handle {
        fn new(raw: HANDLE) -> io::Result<Self> {
            if raw.is_null() || raw == INVALID_HANDLE_VALUE {
                Err(last_error())
            } else {
                Ok(Self(raw))
            }
        }

        fn raw(&self) -> HANDLE {
            self.0
        }

        fn into_raw(self) -> HANDLE {
            let this = ManuallyDrop::new(self);
            this.0
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    struct AttributeList {
        storage: Vec<usize>,
        list: *mut c_void,
        initialized: bool,
    }

    impl AttributeList {
        fn new(count: u32) -> io::Result<Self> {
            let mut bytes = 0usize;
            unsafe { InitializeProcThreadAttributeList(null_mut(), count, 0, &mut bytes) };
            if bytes == 0 || bytes > 1024 * 1024 {
                return Err(io::Error::other("attribute list size invalid"));
            }
            let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
            let list = storage.as_mut_ptr().cast::<c_void>();
            if unsafe { InitializeProcThreadAttributeList(list, count, 0, &mut bytes) } == 0 {
                return Err(last_error());
            }
            Ok(Self {
                storage,
                list,
                initialized: true,
            })
        }
    }

    impl Drop for AttributeList {
        fn drop(&mut self) {
            if self.initialized {
                unsafe { DeleteProcThreadAttributeList(self.list) };
            }
            let _ = self.storage.len();
        }
    }

    struct Capture {
        bytes: Vec<u8>,
        truncated: bool,
    }

    fn last_error() -> io::Error {
        io::Error::from_raw_os_error(unsafe { GetLastError() } as i32)
    }

    fn wide(value: &str) -> io::Result<Vec<u16>> {
        if value.contains('\0') {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "NUL in string"));
        }
        Ok(value.encode_utf16().chain(Some(0)).collect())
    }

    fn quote_windows_arg(value: &str) -> io::Result<String> {
        if value.contains('\0') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "NUL in argument",
            ));
        }
        let mut out = String::from("\"");
        let mut slashes = 0usize;
        for ch in value.chars() {
            match ch {
                '\\' => slashes += 1,
                '"' => {
                    out.push_str(&"\\".repeat(slashes * 2 + 1));
                    out.push('"');
                    slashes = 0;
                }
                _ => {
                    out.push_str(&"\\".repeat(slashes));
                    out.push(ch);
                    slashes = 0;
                }
            }
        }
        out.push_str(&"\\".repeat(slashes * 2));
        out.push('"');
        Ok(out)
    }

    fn build_environment(env: &BTreeMap<String, String>) -> io::Result<Vec<u16>> {
        let mut entries: Vec<(&String, &String)> = env.iter().collect();
        entries.sort_by_key(|(key, _)| key.to_ascii_lowercase());
        for pair in entries.windows(2) {
            if pair[0].0.eq_ignore_ascii_case(pair[1].0) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "duplicate environment key",
                ));
            }
        }
        let mut block = Vec::new();
        for (key, value) in entries {
            if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid environment entry",
                ));
            }
            block.extend(key.encode_utf16());
            block.push('=' as u16);
            block.extend(value.encode_utf16());
            block.push(0);
        }
        block.push(0);
        if block.len() > 32_767 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "environment block too large",
            ));
        }
        Ok(block)
    }

    fn active_processes(job: HANDLE) -> io::Result<u32> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let ok = unsafe {
            QueryInformationJobObject(
                job,
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        };
        if ok == 0 {
            Err(last_error())
        } else {
            Ok(info.ActiveProcesses)
        }
    }

    fn wait_job_empty(job: HANDLE, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            match active_processes(job) {
                Ok(0) => return true,
                Ok(_) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                _ => return false,
            }
        }
    }

    fn terminate_job(job: HANDLE) -> bool {
        match active_processes(job) {
            Ok(0) => true,
            Ok(_) if unsafe { TerminateJobObject(job, EXIT_CODE_CANCELLED) } != 0 => {
                wait_job_empty(job, TERMINATION_WAIT)
            }
            _ => false,
        }
    }

    fn drain_pipe(handle: HANDLE) -> thread::JoinHandle<Capture> {
        let handle_value = handle as usize;
        thread::spawn(move || {
            let mut file = unsafe { std::fs::File::from_raw_handle(handle_value as RawHandle) };
            let mut capture = Capture {
                bytes: Vec::new(),
                truncated: false,
            };
            let mut buffer = [0u8; 8192];
            loop {
                match file.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        let available = OUTPUT_LIMIT.saturating_sub(capture.bytes.len());
                        let keep = available.min(count);
                        capture.bytes.extend_from_slice(&buffer[..keep]);
                        capture.truncated |= keep < count;
                    }
                }
            }
            capture
        })
    }

    fn capture_text(join: thread::JoinHandle<Capture>) -> io::Result<Capture> {
        join.join()
            .map_err(|_| io::Error::other("output reader failed"))
    }

    fn response_after_process(request: RunRequest, job: &Handle) -> RunResponse {
        match run_process(request, job) {
            Ok(response) => response,
            Err((message, confirmed, peak)) => RunResponse {
                started: true,
                exit_code: 1,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                cancelled: false,
                timed_out: false,
                termination_confirmed: confirmed,
                peak_active_processes: peak,
                orphaned_descendants: false,
                error: Some(message),
                system_error: None,
            },
        }
    }

    fn run_process(
        request: RunRequest,
        job: &Handle,
    ) -> Result<RunResponse, (&'static str, bool, u32)> {
        if request.executable.is_empty()
            || !std::path::Path::new(&request.executable).is_absolute()
            || !std::path::Path::new(&request.cwd).is_absolute()
            || request.args.len() > 4096
            || request.args.iter().map(String::len).sum::<usize>() > 28_000
        {
            return Err(("invalid process request", true, 0));
        }
        let environment = build_environment(&request.env)
            .map_err(|_| ("invalid process environment", true, 0))?;
        let mut command_line = quote_windows_arg(&request.executable)
            .map_err(|_| ("invalid executable argument", true, 0))?;
        for arg in &request.args {
            command_line.push(' ');
            command_line.push_str(
                &quote_windows_arg(arg).map_err(|_| ("invalid process argument", true, 0))?,
            );
        }
        if command_line.encode_utf16().count() >= 32_767 {
            return Err(("process command line too long", true, 0));
        }
        let command_line =
            wide(&command_line).map_err(|_| ("invalid process command line", true, 0))?;
        let executable =
            wide(&request.executable).map_err(|_| ("invalid executable path", true, 0))?;
        let cwd = wide(&request.cwd).map_err(|_| ("invalid working directory", true, 0))?;

        let security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        let mut stdout_read = null_mut();
        let mut stdout_write = null_mut();
        let mut stderr_read = null_mut();
        let mut stderr_write = null_mut();
        if unsafe { CreatePipe(&mut stdout_read, &mut stdout_write, &security, 0) } == 0 {
            return Err(("stdout pipe creation failed", true, 0));
        }
        let stdout_read =
            Handle::new(stdout_read).map_err(|_| ("stdout pipe creation failed", true, 0))?;
        let stdout_write =
            Handle::new(stdout_write).map_err(|_| ("stdout pipe creation failed", true, 0))?;
        if unsafe { SetHandleInformation(stdout_read.raw(), HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(("stdout pipe setup failed", true, 0));
        }
        if unsafe { CreatePipe(&mut stderr_read, &mut stderr_write, &security, 0) } == 0 {
            return Err(("stderr pipe creation failed", true, 0));
        }
        let stderr_read =
            Handle::new(stderr_read).map_err(|_| ("stderr pipe creation failed", true, 0))?;
        let stderr_write =
            Handle::new(stderr_write).map_err(|_| ("stderr pipe creation failed", true, 0))?;
        if unsafe { SetHandleInformation(stderr_read.raw(), HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(("stderr pipe setup failed", true, 0));
        }

        let nul = wide("NUL").map_err(|_| ("stdin setup failed", true, 0))?;
        let stdin = Handle::new(unsafe {
            CreateFileW(
                nul.as_ptr(),
                GENERIC_READ,
                FILE_SHARE_READ,
                &security,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                null_mut(),
            )
        })
        .map_err(|_| ("stdin setup failed", true, 0))?;

        let attributes = AttributeList::new(2)
            .map_err(|_| ("process attributes initialization failed", true, 0))?;
        let child_handles = [stdin.raw(), stdout_write.raw(), stderr_write.raw()];
        if unsafe {
            UpdateProcThreadAttribute(
                attributes.list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                child_handles.as_ptr().cast(),
                size_of_val(&child_handles),
                null_mut(),
                null_mut(),
            )
        } == 0
        {
            return Err(("child handle-list setup failed", true, 0));
        }
        let jobs = [job.raw()];
        if unsafe {
            UpdateProcThreadAttribute(
                attributes.list,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                jobs.as_ptr().cast(),
                size_of_val(&jobs),
                null_mut(),
                null_mut(),
            )
        } == 0
        {
            return Err(("pre-start job assignment setup failed", true, 0));
        }

        let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = stdin.raw();
        startup.StartupInfo.hStdOutput = stdout_write.raw();
        startup.StartupInfo.hStdError = stderr_write.raw();
        startup.lpAttributeList = attributes.list;
        let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
        let flags = CREATE_SUSPENDED
            | CREATE_UNICODE_ENVIRONMENT
            | EXTENDED_STARTUPINFO_PRESENT
            | CREATE_NO_WINDOW;
        let created = unsafe {
            CreateProcessW(
                executable.as_ptr(),
                command_line.as_ptr() as *mut u16,
                null(),
                null(),
                1,
                flags,
                environment.as_ptr().cast(),
                cwd.as_ptr(),
                &startup.StartupInfo,
                &mut info,
            )
        };
        if created == 0 {
            return Err((
                "child creation or atomic Job Object assignment failed",
                true,
                0,
            ));
        }
        let process =
            Handle::new(info.hProcess).map_err(|_| ("child process handle invalid", false, 0))?;
        let thread_handle =
            Handle::new(info.hThread).map_err(|_| ("child thread handle invalid", false, 0))?;
        drop(stdout_write);
        drop(stderr_write);
        drop(stdin);

        let mut in_job = 0;
        if unsafe { IsProcessInJob(process.raw(), job.raw(), &mut in_job) } == 0 || in_job == 0 {
            let terminated = unsafe {
                windows_sys::Win32::System::Threading::TerminateProcess(process.raw(), 1)
            } != 0;
            let confirmed = terminated
                && unsafe {
                    WaitForSingleObject(process.raw(), TERMINATION_WAIT.as_millis() as u32)
                } == WAIT_OBJECT_0;
            return Err(("child was not confirmed in owned Job Object", confirmed, 0));
        }
        if unsafe { ResumeThread(thread_handle.raw()) } == u32::MAX {
            let confirmed = terminate_job(job.raw());
            return Err((
                "child initial thread could not be resumed",
                confirmed,
                active_processes(job.raw()).unwrap_or(0),
            ));
        }
        drop(thread_handle);

        let stdout_reader = drain_pipe(stdout_read.into_raw());
        let stderr_reader = drain_pipe(stderr_read.into_raw());
        let (control_tx, control_rx) = mpsc::channel();
        thread::spawn(move || {
            let stdin = io::stdin();
            let mut locked = stdin.lock();
            loop {
                let mut line = String::new();
                match locked.read_line(&mut line) {
                    Ok(0) | Err(_) => {
                        let _ = control_tx.send(String::from("cancel"));
                        return;
                    }
                    Ok(_) => {
                        let parsed =
                            serde_json::from_str::<ControlMessage>(&line).map(|msg| msg.kind);
                        if control_tx
                            .send(parsed.unwrap_or_else(|_| String::from("invalid")))
                            .is_err()
                        {
                            return;
                        }
                    }
                }
            }
        });

        let started_at = Instant::now();
        let deadline = request
            .timeout_ms
            .filter(|millis| *millis > 0)
            .map(Duration::from_millis)
            .map(|duration| started_at + duration);
        let mut peak = 0u32;
        let mut cancelled = false;
        let mut timed_out = false;
        let mut response_error = None;
        let mut orphaned = false;
        loop {
            match active_processes(job.raw()) {
                Ok(count) => peak = peak.max(count),
                Err(_) => {
                    response_error = Some("Job Object state query failed");
                    break;
                }
            }
            let wait =
                unsafe { WaitForSingleObject(process.raw(), POLL_INTERVAL.as_millis() as u32) };
            if wait == WAIT_OBJECT_0 {
                if wait_job_empty(job.raw(), DESCENDANT_DRAIN_GRACE) {
                    break;
                }
                orphaned = true;
                response_error = Some("owned descendants remained after root process exit");
                break;
            }
            if wait == WAIT_FAILED {
                response_error = Some("owned process wait failed");
                break;
            }
            match control_rx.try_recv() {
                Ok(kind) if kind == "cancel" => {
                    cancelled = true;
                    break;
                }
                Ok(_) => {
                    response_error = Some("invalid supervisor control message");
                    break;
                }
                Err(TryRecvError::Disconnected) => {
                    cancelled = true;
                    break;
                }
                Err(TryRecvError::Empty) => {}
            }
            if deadline.is_some_and(|value| Instant::now() >= value) {
                timed_out = true;
                break;
            }
        }

        let confirmed = if cancelled || timed_out || response_error.is_some() || orphaned {
            terminate_job(job.raw())
        } else {
            if wait_job_empty(job.raw(), TERMINATION_WAIT) {
                true
            } else {
                response_error = Some("complete Job Object exit could not be confirmed");
                terminate_job(job.raw())
            }
        };

        let mut exit_code = 1u32;
        if unsafe { GetExitCodeProcess(process.raw(), &mut exit_code) } == 0 {
            response_error = Some("owned process exit status query failed");
        }
        let (stdout, stderr) = if confirmed {
            (
                capture_text(stdout_reader)
                    .map_err(|_| ("stdout drain failed", confirmed, peak))?,
                capture_text(stderr_reader)
                    .map_err(|_| ("stderr drain failed", confirmed, peak))?,
            )
        } else {
            drop(stdout_reader);
            drop(stderr_reader);
            (
                Capture {
                    bytes: Vec::new(),
                    truncated: false,
                },
                Capture {
                    bytes: Vec::new(),
                    truncated: false,
                },
            )
        };
        Ok(RunResponse {
            started: true,
            exit_code: exit_code as i32,
            stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
            stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
            truncated: stdout.truncated || stderr.truncated,
            cancelled,
            timed_out,
            termination_confirmed: confirmed,
            peak_active_processes: peak,
            orphaned_descendants: orphaned,
            error: response_error,
            system_error: None,
        })
    }

    fn check_elevated() -> io::Result<bool> {
        let mut token = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(last_error());
        }
        let token = Handle::new(token)?;
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned_length = 0u32;
        let ok = unsafe {
            GetTokenInformation(
                token.raw(),
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast(),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut returned_length,
            )
        };
        if ok == 0 {
            Err(last_error())
        } else if returned_length < size_of::<TOKEN_ELEVATION>() as u32 {
            Err(io::Error::other("token elevation response was truncated"))
        } else {
            Ok(elevation.TokenIsElevated != 0)
        }
    }

    fn fs_failure(code: &'static str, system_error: Option<u32>) -> FsFailure {
        FsFailure { code, system_error }
    }

    fn fs_last_error(code: &'static str) -> FsFailure {
        fs_failure(code, Some(unsafe { GetLastError() }))
    }

    fn local_path_parts(value: &str) -> FsResult<(String, Vec<String>)> {
        if value.is_empty()
            || value.len() > 259
            || value.contains('\0')
            || value.starts_with("\\\\")
            || value.starts_with("\\\\?\\")
            || value.starts_with("\\\\.\\")
            || value
                .split(['\\', '/'])
                .any(|part| part == "." || part == "..")
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let mut components = Path::new(value).components();
        let drive = match components.next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::Disk(letter) => letter as char,
                _ => return Err(fs_failure("unsafe_path", None)),
            },
            _ => return Err(fs_failure("unsafe_path", None)),
        };
        if !matches!(components.next(), Some(Component::RootDir)) {
            return Err(fs_failure("unsafe_path", None));
        }
        let mut parts = Vec::new();
        for component in components {
            let Component::Normal(part) = component else {
                return Err(fs_failure("unsafe_path", None));
            };
            let part = part.to_string_lossy().into_owned();
            if part.is_empty()
                || part.contains(['\\', '/', ':', '\0'])
                || part.ends_with(['.', ' '])
            {
                return Err(fs_failure("unsafe_path", None));
            }
            parts.push(part);
        }
        Ok((format!("{drive}:\\"), parts))
    }

    fn open_path_chain(path: &str) -> FsResult<Vec<Handle>> {
        let (root_path, parts) = local_path_parts(path)?;
        let root_wide = wide(&root_path).map_err(|_| fs_failure("unsafe_path", None))?;
        let root_access = FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | if parts.is_empty() {
                FILE_ADD_SUBDIRECTORY
            } else {
                0
            };
        let root = Handle::new(unsafe {
            CreateFileW(
                root_wide.as_ptr(),
                root_access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            )
        })
        .map_err(|_| fs_last_error("unsafe_path"))?;
        let root_info = get_attributes(root.raw()).map_err(|_| fs_last_error("unsafe_path"))?;
        if root_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || root_info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let mut chain = vec![root];
        let mut volume = volume_serial(chain[0].raw()).map_err(|_| fs_last_error("unsafe_path"))?;
        let part_count = parts.len();
        for (index, part) in parts.into_iter().enumerate() {
            let parent = chain
                .last()
                .ok_or_else(|| fs_failure("unsafe_path", None))?;
            let access = FILE_READ_ATTRIBUTES
                | FILE_LIST_DIRECTORY
                | if index + 1 == part_count {
                    FILE_ADD_SUBDIRECTORY
                } else {
                    0
                };
            let handle = open_relative(
                parent.raw(),
                &part,
                access | SYNCHRONIZE,
                FILE_SHARE_READ,
                FILE_OPEN,
                FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                FILE_ATTRIBUTE_DIRECTORY,
            )?;
            let info = get_attributes(handle.raw()).map_err(|_| fs_last_error("unsafe_path"))?;
            let found_volume =
                volume_serial(handle.raw()).map_err(|_| fs_last_error("unsafe_path"))?;
            if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
                || found_volume != volume
            {
                return Err(fs_failure("unsafe_path", None));
            }
            volume = found_volume;
            chain.push(handle);
        }
        Ok(chain)
    }

    fn get_attributes(handle: HANDLE) -> io::Result<FILE_ATTRIBUTE_TAG_INFO> {
        let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
        let ok = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileAttributeTagInfo,
                (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        };
        if ok == 0 { Err(last_error()) } else { Ok(info) }
    }

    fn volume_serial(handle: HANDLE) -> io::Result<u32> {
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
            Err(last_error())
        } else {
            Ok(info.dwVolumeSerialNumber)
        }
    }

    fn delete_open_handle(handle: HANDLE) -> FsResult<()> {
        let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
        if unsafe {
            SetFileInformationByHandle(
                handle,
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        } == 0
        {
            Err(fs_last_error("native_fs_failed"))
        } else {
            Ok(())
        }
    }

    fn open_relative(
        parent: HANDLE,
        name: &str,
        access: u32,
        share: u32,
        disposition: u32,
        options: u32,
        attributes: u32,
    ) -> FsResult<Handle> {
        if name.is_empty() || name.contains(['\\', '/', ':', '\0']) || name == "." || name == ".." {
            return Err(fs_failure("unsafe_path", None));
        }
        let mut name: Vec<u16> = name.encode_utf16().collect();
        let byte_length = name
            .len()
            .checked_mul(size_of::<u16>())
            .filter(|length| *length <= u16::MAX as usize)
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let unicode = UNICODE_STRING {
            Length: byte_length as u16,
            MaximumLength: byte_length as u16,
            Buffer: name.as_mut_ptr(),
        };
        let object_attributes = OBJECT_ATTRIBUTES {
            Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: parent,
            ObjectName: &unicode,
            Attributes: OBJ_CASE_INSENSITIVE,
            ..Default::default()
        };
        let mut io_status = IO_STATUS_BLOCK::default();
        let mut raw = null_mut();
        let status = unsafe {
            NtCreateFile(
                &mut raw,
                access | SYNCHRONIZE,
                &object_attributes,
                &mut io_status,
                null(),
                attributes,
                share,
                disposition,
                options,
                null(),
                0,
            )
        };
        if status < 0 {
            let code = match status as u32 {
                0xC000_0034 | 0xC000_003A => "entry_missing",
                0xC000_0035 => "entry_exists",
                _ => "native_fs_failed",
            };
            Err(fs_failure(code, Some(status as u32)))
        } else {
            Handle::new(raw).map_err(|_| fs_failure("native_fs_failed", Some(status as u32)))
        }
    }

    fn create_stage(request: CreateStageRequest) -> FsResult<()> {
        if request.job_id.is_empty()
            || request.job_id.len() > 64
            || !request
                .job_id
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
            || request.project_name.is_empty()
            || request.project_name.contains(['\\', '/', ':', '\0'])
            || request.project_name == "."
            || request.project_name == ".."
            || request.project_name.ends_with(['.', ' '])
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let stage = Path::new(&request.stage_path);
        let stage_parent = stage
            .parent()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let stage_name = stage
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let target = Path::new(&request.target_path);
        if !stage_parent
            .to_string_lossy()
            .eq_ignore_ascii_case(&request.parent_path)
            || stage_name != format!(".project-generator-stage-{}", request.job_id)
            || !target.parent().is_some_and(|parent| {
                parent
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&request.parent_path)
            })
            || !target.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .eq_ignore_ascii_case(&request.project_name)
            })
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let parent_chain = open_path_chain(&request.parent_path)?;
        let parent = parent_chain
            .last()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let stage_handle = open_relative(
            parent.raw(),
            stage_name,
            DELETE | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY | FILE_ADD_SUBDIRECTORY,
            FILE_SHARE_READ,
            FILE_CREATE,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )?;
        let marker = open_relative(
            stage_handle.raw(),
            ".ownership.json",
            GENERIC_READ | GENERIC_WRITE | FILE_READ_ATTRIBUTES | DELETE,
            FILE_SHARE_READ,
            FILE_CREATE,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        )?;
        let marker_data = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1,
            "jobId": request.job_id,
            "stageName": stage_name,
        }))
        .map_err(|_| fs_failure("native_fs_failed", None))?;
        let mut marker_file =
            unsafe { std::fs::File::from_raw_handle(marker.into_raw() as RawHandle) };
        use std::io::Write;
        marker_file
            .write_all(&marker_data)
            .map_err(|_| fs_last_error("native_fs_failed"))?;
        Ok(())
    }

    fn enumerate_names(directory: HANDLE, count: &mut usize) -> FsResult<Vec<String>> {
        let mut names = Vec::new();
        let mut storage = vec![0usize; 16 * 1024];
        let mut info_class = FileIdBothDirectoryRestartInfo;
        loop {
            let buffer_length = size_of_val(&storage);
            if unsafe {
                GetFileInformationByHandleEx(
                    directory,
                    info_class,
                    storage.as_mut_ptr().cast(),
                    buffer_length as u32,
                )
            } == 0
            {
                let error = unsafe { GetLastError() };
                if error == windows_sys::Win32::Foundation::ERROR_NO_MORE_FILES {
                    break;
                }
                return Err(fs_failure("native_fs_failed", Some(error)));
            }

            info_class = FileIdBothDirectoryInfo;
            let base = storage.as_ptr().cast::<u8>();
            let mut offset = 0usize;
            loop {
                let header_length = offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
                if offset + header_length > buffer_length {
                    return Err(fs_failure("native_fs_failed", None));
                }
                let entry = unsafe {
                    std::ptr::read_unaligned(base.add(offset).cast::<FILE_ID_BOTH_DIR_INFO>())
                };
                let name_length = entry.FileNameLength as usize;
                let name_end = offset
                    .checked_add(header_length)
                    .and_then(|value| value.checked_add(name_length))
                    .filter(|value| name_length & 1 == 0 && *value <= buffer_length)
                    .ok_or_else(|| fs_failure("native_fs_failed", None))?;
                let name_units = unsafe {
                    std::slice::from_raw_parts(
                        base.add(offset + header_length).cast::<u16>(),
                        name_length / size_of::<u16>(),
                    )
                };
                let name = String::from_utf16(name_units)
                    .map_err(|_| fs_failure("native_fs_failed", None))?;
                if name != "." && name != ".." {
                    *count += 1;
                    if *count > MAX_DELETE_ENTRIES {
                        return Err(fs_failure("cleanup_limit", None));
                    }
                    names.push(name);
                }

                if entry.NextEntryOffset == 0 {
                    break;
                }
                let next = entry.NextEntryOffset as usize;
                if next < name_end - offset
                    || offset
                        .checked_add(next)
                        .is_none_or(|value| value > buffer_length)
                {
                    return Err(fs_failure("native_fs_failed", None));
                }
                offset += next;
            }
        }
        Ok(names)
    }

    fn remove_entry(
        parent: HANDLE,
        name: &str,
        depth: usize,
        count: &mut usize,
        allow_missing: bool,
    ) -> FsResult<bool> {
        if depth > MAX_DELETE_DEPTH {
            return Err(fs_failure("cleanup_limit", None));
        }
        let handle = match open_relative(
            parent,
            name,
            DELETE | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
            FILE_SHARE_READ,
            FILE_OPEN,
            FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        ) {
            Ok(handle) => handle,
            Err(error) if allow_missing && error.code == "entry_missing" => return Ok(false),
            Err(error) => return Err(error),
        };
        let attrs = get_attributes(handle.raw()).map_err(|_| fs_last_error("native_fs_failed"))?;
        if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT == 0
            && attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0
        {
            for child_name in enumerate_names(handle.raw(), count)? {
                remove_entry(handle.raw(), &child_name, depth + 1, count, false)?;
            }
        }
        delete_open_handle(handle.raw())?;
        Ok(true)
    }

    fn read_marker(stage_name: &str, handle: &Handle, job_id: &str) -> FsResult<()> {
        let attrs = get_attributes(handle.raw()).map_err(|_| fs_last_error("stage_ownership"))?;
        if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return Err(fs_failure("stage_ownership", None));
        }
        let marker = open_relative(
            handle.raw(),
            ".ownership.json",
            GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        )
        .map_err(|_| fs_failure("stage_ownership", None))?;
        let marker_attrs =
            get_attributes(marker.raw()).map_err(|_| fs_last_error("stage_ownership"))?;
        if marker_attrs.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)
            != 0
        {
            return Err(fs_failure("stage_ownership", None));
        }
        let file = unsafe { std::fs::File::from_raw_handle(marker.into_raw() as RawHandle) };
        let mut bytes = Vec::new();
        file.take((MAX_MARKER_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| fs_failure("stage_ownership", None))?;
        if bytes.len() > MAX_MARKER_BYTES {
            return Err(fs_failure("stage_ownership", None));
        }
        let marker: OwnershipMarker =
            serde_json::from_slice(&bytes).map_err(|_| fs_failure("stage_ownership", None))?;
        if marker.schema_version != 1 || marker.job_id != job_id || marker.stage_name != stage_name
        {
            return Err(fs_failure("stage_ownership", None));
        }
        Ok(())
    }

    fn validate_stage(request: &StageRequest) -> FsResult<ValidatedStage> {
        if request.job_id.is_empty()
            || request.job_id.len() > 64
            || !request
                .job_id
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        {
            return Err(fs_failure("stage_ownership", None));
        }
        let stage = Path::new(&request.stage_path);
        let stage_parent = stage
            .parent()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let stage_name = stage
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if !stage_parent
            .to_string_lossy()
            .eq_ignore_ascii_case(&request.parent_path)
            || stage_name != format!(".project-generator-stage-{}", request.job_id)
        {
            return Err(fs_failure("stage_ownership", None));
        }
        let parent_chain = open_path_chain(&request.parent_path)?;
        let parent_handle = parent_chain
            .last()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let parent_volume =
            volume_serial(parent_handle.raw()).map_err(|_| fs_last_error("unsafe_path"))?;
        let stage_handle = open_relative(
            parent_handle.raw(),
            stage_name,
            DELETE | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY | FILE_ADD_SUBDIRECTORY,
            FILE_SHARE_READ,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )
        .map_err(|_| fs_failure("stage_ownership", None))?;
        let stage_volume =
            volume_serial(stage_handle.raw()).map_err(|_| fs_last_error("stage_ownership"))?;
        if stage_volume != parent_volume {
            return Err(fs_failure("unsafe_path", None));
        }
        read_marker(stage_name, &stage_handle, &request.job_id)?;
        Ok(ValidatedStage {
            _parent_chain: parent_chain,
            stage_handle,
            volume: parent_volume,
        })
    }

    fn cleanup_support(request: StageRequest) -> FsResult<()> {
        let stage = validate_stage(&request)?;
        let mut count = 0usize;
        for name in [
            ".tools",
            ".home",
            ".tmp",
            ".npm-cache",
            ".npmrc-user",
            ".npmrc-global",
        ] {
            remove_entry(stage.stage_handle.raw(), name, 0, &mut count, true)?;
        }
        let _ = (&stage._parent_chain, &stage.stage_handle, stage.volume);
        Ok(())
    }

    fn cleanup_stage(request: StageRequest) -> FsResult<()> {
        let stage = validate_stage(&request)?;
        let mut count = 0usize;
        for name in enumerate_names(stage.stage_handle.raw(), &mut count)? {
            remove_entry(stage.stage_handle.raw(), &name, 1, &mut count, false)?;
        }
        delete_open_handle(stage.stage_handle.raw())?;
        let _ = (&stage._parent_chain, stage.volume);
        Ok(())
    }

    fn finalize_stage(request: StageRequest) -> FsResult<()> {
        let project_name = request
            .project_name
            .as_deref()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let target_path = request
            .target_path
            .as_deref()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        if project_name.is_empty()
            || project_name.contains(['\\', '/', ':', '\0'])
            || project_name == "."
            || project_name == ".."
            || project_name.ends_with(['.', ' '])
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let target = Path::new(target_path);
        if !target.parent().is_some_and(|parent| {
            parent
                .to_string_lossy()
                .eq_ignore_ascii_case(&request.parent_path)
        }) || !target
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(project_name))
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let stage = validate_stage(&request)?;
        let parent_handle = stage
            ._parent_chain
            .last()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let source = open_relative(
            stage.stage_handle.raw(),
            project_name,
            DELETE | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
            FILE_SHARE_READ,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )?;
        let source_attrs =
            get_attributes(source.raw()).map_err(|_| fs_last_error("unsafe_path"))?;
        if source_attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || source_attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
            || volume_serial(source.raw()).map_err(|_| fs_last_error("unsafe_path"))?
                != stage.volume
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let name: Vec<u16> = project_name.encode_utf16().collect();
        let bytes = offset_of!(FILE_RENAME_INFO, FileName) + name.len() * size_of::<u16>();
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        unsafe {
            (*info).Anonymous.ReplaceIfExists = false;
            (*info).RootDirectory = parent_handle.raw();
            (*info).FileNameLength = (name.len() * size_of::<u16>()) as u32;
            std::ptr::copy_nonoverlapping(name.as_ptr(), (*info).FileName.as_mut_ptr(), name.len());
        }
        let renamed = unsafe {
            SetFileInformationByHandle(source.raw(), FileRenameInfo, info.cast(), bytes as u32)
        };
        if renamed == 0 {
            let error = unsafe { GetLastError() };
            let code = if error == 80 || error == 183 {
                "target_exists"
            } else {
                "native_fs_failed"
            };
            return Err(fs_failure(code, Some(error)));
        }
        Ok(())
    }

    fn read_fs_request<T: for<'de> Deserialize<'de>>() -> Result<T, &'static str> {
        let mut line = String::new();
        io::stdin()
            .lock()
            .take((MAX_REQUEST_BYTES + 1) as u64)
            .read_line(&mut line)
            .map_err(|_| "invalid_request")?;
        if line.len() > MAX_REQUEST_BYTES {
            return Err("invalid_request");
        }
        serde_json::from_str(&line).map_err(|_| "invalid_request")
    }

    fn run_fs_operation(mode: &str) -> i32 {
        if check_elevated().unwrap_or(true) {
            let _ = write_json(&FsResponse {
                ok: false,
                code: Some("elevated_caller"),
                system_error: None,
            });
            return 1;
        }
        if mode == "--create-stage" {
            let request = match read_fs_request::<CreateStageRequest>() {
                Ok(request) => request,
                Err(_) => {
                    let _ = write_json(&FsResponse {
                        ok: false,
                        code: Some("invalid_request"),
                        system_error: None,
                    });
                    return 1;
                }
            };
            return match create_stage(request) {
                Ok(()) => {
                    if write_json(&FsResponse {
                        ok: true,
                        code: None,
                        system_error: None,
                    })
                    .is_ok()
                    {
                        0
                    } else {
                        1
                    }
                }
                Err(error) => {
                    let _ = write_json(&FsResponse {
                        ok: false,
                        code: Some(error.code),
                        system_error: error.system_error,
                    });
                    1
                }
            };
        }
        let request = match read_fs_request::<StageRequest>() {
            Ok(request) => request,
            Err(_) => {
                let _ = write_json(&FsResponse {
                    ok: false,
                    code: Some("invalid_request"),
                    system_error: None,
                });
                return 1;
            }
        };
        let result = match mode {
            "--cleanup-support" => cleanup_support(request),
            "--cleanup-stage" => cleanup_stage(request),
            "--finalize-stage" => finalize_stage(request),
            _ => Err(fs_failure("invalid_request", None)),
        };
        match result {
            Ok(()) => {
                if write_json(&FsResponse {
                    ok: true,
                    code: None,
                    system_error: None,
                })
                .is_ok()
                {
                    0
                } else {
                    1
                }
            }
            Err(error) => {
                let _ = write_json(&FsResponse {
                    ok: false,
                    code: Some(error.code),
                    system_error: error.system_error,
                });
                1
            }
        }
    }

    fn write_json<T: Serialize>(value: &T) -> io::Result<()> {
        serde_json::to_writer(io::stdout().lock(), value).map_err(io::Error::other)?;
        println!();
        Ok(())
    }

    pub fn dispatch() -> i32 {
        let mode = std::env::args().nth(1).unwrap_or_default();
        if mode == "--check-elevation" {
            return match check_elevated() {
                Ok(elevated) => {
                    if write_json(&serde_json::json!({ "elevated": elevated })).is_ok() {
                        0
                    } else {
                        1
                    }
                }
                Err(error) => {
                    let _ = write_json(
                        &serde_json::json!({ "error": "elevation query failed", "systemError": error.raw_os_error() }),
                    );
                    1
                }
            };
        }
        if matches!(
            mode.as_str(),
            "--create-stage" | "--cleanup-support" | "--cleanup-stage" | "--finalize-stage"
        ) {
            return run_fs_operation(&mode);
        }
        if mode != "--run" {
            let _ = write_json(&serde_json::json!({ "error": "invalid supervisor mode" }));
            return 2;
        }
        if check_elevated().unwrap_or(true) {
            let _ = write_json(&RunResponse::failed_before_start(
                "elevated caller is not allowed",
                None,
            ));
            return 1;
        }
        let mut first_line = String::new();
        if io::stdin()
            .lock()
            .take((MAX_REQUEST_BYTES + 1) as u64)
            .read_line(&mut first_line)
            .is_err()
            || first_line.len() > MAX_REQUEST_BYTES
        {
            let _ = write_json(&RunResponse::failed_before_start(
                "invalid supervisor request",
                None,
            ));
            return 2;
        }
        let request = match serde_json::from_str::<RunRequest>(&first_line) {
            Ok(request) => request,
            Err(_) => {
                let _ = write_json(&RunResponse::failed_before_start(
                    "invalid supervisor request",
                    None,
                ));
                return 2;
            }
        };
        let job = match Handle::new(unsafe { CreateJobObjectW(null(), null()) }) {
            Ok(job) => job,
            Err(error) => {
                let _ = write_json(&RunResponse::failed_before_start(
                    "Job Object creation failed",
                    error.raw_os_error().map(|code| code as u32),
                ));
                return 1;
            }
        };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            let error = unsafe { GetLastError() };
            let _ = write_json(&RunResponse::failed_before_start(
                "Job Object configuration failed",
                Some(error),
            ));
            return 1;
        }
        let mut verified_limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        let queried = unsafe {
            QueryInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                (&mut verified_limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                null_mut(),
            )
        };
        let breakaway_flags = windows_sys::Win32::System::JobObjects::JOB_OBJECT_LIMIT_BREAKAWAY_OK
            | windows_sys::Win32::System::JobObjects::JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        if queried == 0
            || verified_limits.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                == 0
            || verified_limits.BasicLimitInformation.LimitFlags & breakaway_flags != 0
        {
            let error = if queried == 0 {
                Some(unsafe { GetLastError() })
            } else {
                None
            };
            let _ = write_json(&RunResponse::failed_before_start(
                "Job Object limits could not be verified",
                error,
            ));
            return 1;
        }
        let response = response_after_process(request, &job);
        let exit_code = if response.error.is_some() || !response.termination_confirmed {
            1
        } else {
            0
        };
        if write_json(&response).is_err() {
            1
        } else {
            exit_code
        }
    }
}

#[cfg(windows)]
fn main() {
    std::process::exit(windows::dispatch());
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Windows supervisor is Windows-only.");
    std::process::exit(1);
}

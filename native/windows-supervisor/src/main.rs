#[cfg(windows)]
mod windows {
    use serde::{Deserialize, Serialize};
    use std::collections::BTreeMap;
    use std::ffi::c_void;
    use std::io::{self, BufRead, Read, Seek, SeekFrom, Write};
    use std::mem::{ManuallyDrop, offset_of, size_of, zeroed};
    use std::os::windows::io::{FromRawHandle, IntoRawHandle, RawHandle};
    use std::path::{Component, Path, Prefix};
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{self, TryRecvError};
    use std::thread;
    use std::time::{Duration, Instant};
    use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows_sys::Wdk::Storage::FileSystem::{
        FILE_CREATE, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
        FILE_OPEN_REPARSE_POINT, FILE_RENAME_INFORMATION, FILE_SYNCHRONOUS_IO_NONALERT,
        FileRenameInformation, NtCreateFile, NtSetInformationFile,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_READ, GENERIC_WRITE, GetLastError, HANDLE, HANDLE_FLAG_INHERIT,
        HLOCAL, INVALID_HANDLE_VALUE, LocalFree, SetHandleInformation, WAIT_FAILED, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::Foundation::{OBJ_CASE_INSENSITIVE, UNICODE_STRING};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        GetSecurityInfo, SDDL_REVISION_1, SE_FILE_OBJECT, SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACL_SIZE_INFORMATION, AclSizeInformation, CONTAINER_INHERIT_ACE,
        DACL_SECURITY_INFORMATION, EqualSid, GetAce, GetAclInformation,
        GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetTokenInformation, IsValidSid,
        OBJECT_INHERIT_ACE, PROTECTED_DACL_SECURITY_INFORMATION, SE_DACL_PROTECTED,
        SECURITY_ATTRIBUTES, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER, TokenElevation, TokenUser,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, CreateFileW, DELETE, FILE_ADD_SUBDIRECTORY,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_ATTRIBUTE_TAG_INFO, FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO, FILE_LIST_DIRECTORY,
        FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        FileAttributeTagInfo, FileDispositionInfo, FileIdBothDirectoryInfo,
        FileIdBothDirectoryRestartInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        OPEN_EXISTING, SYNCHRONIZE, SetFileInformationByHandle,
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
    const MAX_JOURNAL_BYTES: usize = 256 * 1024;
    const MAX_JOURNAL_RECORDS: usize = 32;
    const MAX_SCAFFOLD_MANIFEST_BYTES: usize = 1024 * 1024;
    const FILE_ADD_FILE_ACCESS: u32 = 0x0002;
    const FILE_READ_CONTROL_ACCESS: u32 = 0x0002_0000;
    const FILE_WRITE_DAC_ACCESS: u32 = 0x0004_0000;
    const FILE_OPEN_IF: u32 = 0x0003;

    static NEXT_STAGE_WRITE: AtomicU64 = AtomicU64::new(0);

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
        #[serde(default)]
        module_path: Option<String>,
        #[serde(default)]
        manifest_file: Option<String>,
        target_path: Option<String>,
        journal_root_path: String,
        transaction_nonce: String,
        #[serde(default)]
        test_crash_at: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CreateStageRequest {
        stage_path: String,
        parent_path: String,
        job_id: String,
        project_name: String,
        target_path: String,
        journal_root_path: String,
        transaction_nonce: String,
        #[serde(default)]
        test_crash_at: Option<String>,
    }

    #[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct FileIdentity {
        volume_serial: u32,
        file_index: u64,
    }

    #[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct OwnershipMarker {
        schema_version: u32,
        job_id: String,
        stage_name: String,
        transaction_nonce: String,
        stage_identity: FileIdentity,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project_identity: Option<FileIdentity>,
    }

    #[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct TransactionRecord {
        schema_version: u32,
        sequence: u32,
        job_id: String,
        transaction_nonce: String,
        phase: String,
        parent_path: String,
        parent_identity: FileIdentity,
        stage_path: String,
        stage_identity: Option<FileIdentity>,
        source_path: String,
        project_name: String,
        project_identity: Option<FileIdentity>,
        target_path: String,
        target_identity: Option<FileIdentity>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct JournalIntentRequest {
        journal_root_path: String,
        job_id: String,
        transaction_nonce: String,
        stage_path: String,
        source_path: String,
        parent_path: String,
        project_name: String,
        target_path: String,
        #[serde(default)]
        test_crash_at: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct JournalRequest {
        journal_root_path: String,
        job_id: String,
        transaction_nonce: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct JournalPhaseRequest {
        #[serde(flatten)]
        stage: StageRequest,
        phase: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RecoveryInspectRequest {
        journal_root_path: String,
        job_id: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RecoveryApplyRequest {
        journal_root_path: String,
        job_id: String,
        action: String,
        confirm_job_id: String,
        #[serde(default)]
        test_crash_at: Option<String>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecoveryResponse {
        ok: bool,
        code: Option<&'static str>,
        reports: Option<Vec<RecoveryReport>>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecoveryReport {
        job_id: String,
        phase: String,
        state: String,
        parent_path: String,
        stage_path: String,
        source_path: String,
        target_path: String,
        can_finalize: bool,
        can_cleanup_stage: bool,
        can_discard_journal: bool,
        detail: &'static str,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StageFile {
        path: String,
        content: String,
        replace: bool,
        skip_existing: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StageMutationRequest {
        #[serde(flatten)]
        stage: StageRequest,
        directories: Vec<String>,
        files: Vec<StageFile>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct FsResponse {
        ok: bool,
        code: Option<&'static str>,
        system_error: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        written_files: Option<Vec<String>>,
    }

    #[derive(Debug)]
    struct FsFailure {
        code: &'static str,
        system_error: Option<u32>,
    }

    type FsResult<T> = Result<T, FsFailure>;

    struct ValidatedStage {
        _parent_chain: Vec<Handle>,
        stage_handle: Handle,
        volume: u32,
        ownership: OwnershipMarker,
        transaction: TransactionRecord,
    }

    struct NativeSecurityDescriptor(*mut c_void);

    impl Drop for NativeSecurityDescriptor {
        fn drop(&mut self) {
            unsafe { LocalFree(self.0 as HLOCAL) };
        }
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

    fn open_path_chain_with_access(path: &str, final_write_access: bool) -> FsResult<Vec<Handle>> {
        let (root_path, parts) = local_path_parts(path)?;
        let root_wide = wide(&root_path).map_err(|_| fs_failure("unsafe_path", None))?;
        let root_access = FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | if parts.is_empty() {
                FILE_ADD_FILE_ACCESS | FILE_ADD_SUBDIRECTORY
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
                | if final_write_access && index + 1 == part_count {
                    FILE_ADD_FILE_ACCESS | FILE_ADD_SUBDIRECTORY
                } else {
                    0
                };
            let handle = open_relative(
                parent.raw(),
                &part,
                access | SYNCHRONIZE,
                if index + 1 == part_count {
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
                } else {
                    FILE_SHARE_READ
                },
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

    fn open_path_chain(path: &str) -> FsResult<Vec<Handle>> {
        open_path_chain_with_access(path, true)
    }

    fn open_path_chain_readonly(path: &str) -> FsResult<Vec<Handle>> {
        open_path_chain_with_access(path, false)
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

    fn file_identity(handle: HANDLE) -> io::Result<FileIdentity> {
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
            Err(last_error())
        } else {
            Ok(FileIdentity {
                volume_serial: info.dwVolumeSerialNumber,
                file_index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
            })
        }
    }

    fn current_user_sid_string() -> FsResult<String> {
        let mut raw_token = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw_token) } == 0 {
            return Err(fs_last_error("stage_acl_failed"));
        }
        let token = Handle::new(raw_token).map_err(|_| fs_last_error("stage_acl_failed"))?;
        let mut required = 0u32;
        unsafe {
            GetTokenInformation(token.raw(), TokenUser, null_mut(), 0, &mut required);
        }
        if required < size_of::<TOKEN_USER>() as u32 || required > 64 * 1024 {
            return Err(fs_failure("stage_acl_failed", None));
        }
        let mut buffer = vec![0usize; (required as usize).div_ceil(size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token.raw(),
                TokenUser,
                buffer.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        } == 0
        {
            return Err(fs_last_error("stage_acl_failed"));
        }
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let mut sid_string = null_mut();
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid_string) } == 0 {
            return Err(fs_last_error("stage_acl_failed"));
        }
        let mut length = 0usize;
        unsafe {
            while *sid_string.add(length) != 0 {
                length += 1;
            }
        }
        let result = String::from_utf16(unsafe { std::slice::from_raw_parts(sid_string, length) })
            .map_err(|_| fs_failure("stage_acl_failed", None));
        unsafe { LocalFree(sid_string as HLOCAL) };
        result
    }

    fn protected_stage_security_descriptor() -> FsResult<NativeSecurityDescriptor> {
        let user_sid = current_user_sid_string()?;
        let sddl = format!("O:{user_sid}D:P(A;OICI;FA;;;{user_sid})(A;OICI;FA;;;SY)");
        let sddl: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
        let mut descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(fs_last_error("stage_acl_failed"));
        }
        Ok(NativeSecurityDescriptor(descriptor))
    }

    fn verify_protected_dacl(handle: HANDLE) -> FsResult<()> {
        let mut descriptor = null_mut();
        let result = unsafe {
            GetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                &mut descriptor,
            )
        };
        if result != 0 {
            return Err(fs_failure("stage_acl_failed", Some(result)));
        }
        let native_descriptor = NativeSecurityDescriptor(descriptor);
        let mut control = 0u16;
        let mut revision = 0u32;
        let mut actual_dacl = null_mut();
        let mut dacl_present = 0;
        let mut dacl_defaulted = 0;
        let verified = if unsafe {
            GetSecurityDescriptorControl(descriptor, &mut control, &mut revision)
        } == 0
        {
            Err(fs_last_error("stage_acl_failed"))
        } else if control & SE_DACL_PROTECTED == 0 {
            Err(fs_failure("stage_acl_unprotected", None))
        } else if unsafe {
            GetSecurityDescriptorDacl(
                descriptor,
                &mut dacl_present,
                &mut actual_dacl,
                &mut dacl_defaulted,
            )
        } == 0
            || dacl_present == 0
            || actual_dacl.is_null()
        {
            Err(fs_failure("stage_acl_failed", None))
        } else {
            let expected = protected_stage_security_descriptor()?;
            let mut expected_dacl = null_mut();
            let mut expected_present = 0;
            let mut expected_defaulted = 0;
            if unsafe {
                GetSecurityDescriptorDacl(
                    expected.0,
                    &mut expected_present,
                    &mut expected_dacl,
                    &mut expected_defaulted,
                )
            } == 0
                || expected_present == 0
                || expected_dacl.is_null()
            {
                Err(fs_failure("stage_acl_failed", None))
            } else {
                let mut actual_info = ACL_SIZE_INFORMATION::default();
                let mut expected_info = ACL_SIZE_INFORMATION::default();
                let actual_ok = unsafe {
                    GetAclInformation(
                        actual_dacl,
                        (&mut actual_info as *mut ACL_SIZE_INFORMATION).cast(),
                        size_of::<ACL_SIZE_INFORMATION>() as u32,
                        AclSizeInformation,
                    )
                };
                let expected_ok = unsafe {
                    GetAclInformation(
                        expected_dacl,
                        (&mut expected_info as *mut ACL_SIZE_INFORMATION).cast(),
                        size_of::<ACL_SIZE_INFORMATION>() as u32,
                        AclSizeInformation,
                    )
                };
                let entries_match = actual_ok != 0
                    && expected_ok != 0
                    && actual_info.AceCount == 2
                    && expected_info.AceCount == 2
                    && (0..2).all(|index| unsafe {
                        let mut actual_ace = null_mut();
                        let mut expected_ace = null_mut();
                        if GetAce(actual_dacl, index, &mut actual_ace) == 0
                            || GetAce(expected_dacl, index, &mut expected_ace) == 0
                            || actual_ace.is_null()
                            || expected_ace.is_null()
                        {
                            return false;
                        }
                        let actual_ace = &*actual_ace.cast::<ACCESS_ALLOWED_ACE>();
                        let expected_ace = &*expected_ace.cast::<ACCESS_ALLOWED_ACE>();
                        let actual_sid = (&actual_ace.SidStart as *const u32).cast_mut().cast();
                        let expected_sid = (&expected_ace.SidStart as *const u32).cast_mut().cast();
                        actual_ace.Header.AceType == expected_ace.Header.AceType
                            && actual_ace.Header.AceType == 0
                            && actual_ace.Header.AceFlags
                                == (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8
                            && actual_ace.Mask == 0x001F_01FF
                            && actual_ace.Mask == expected_ace.Mask
                            && IsValidSid(actual_sid) != 0
                            && IsValidSid(expected_sid) != 0
                            && EqualSid(actual_sid, expected_sid) != 0
                    });
                if entries_match {
                    Ok(())
                } else {
                    Err(fs_failure("stage_acl_invalid", None))
                }
            }
        };
        drop(native_descriptor);
        verified
    }

    fn set_protected_dacl(handle: HANDLE) -> FsResult<()> {
        let descriptor = protected_stage_security_descriptor()?;
        let mut dacl_present = 0;
        let mut dacl = null_mut();
        let mut dacl_defaulted = 0;
        if unsafe {
            GetSecurityDescriptorDacl(
                descriptor.0,
                &mut dacl_present,
                &mut dacl,
                &mut dacl_defaulted,
            )
        } == 0
            || dacl_present == 0
            || dacl.is_null()
        {
            return Err(fs_failure("stage_acl_failed", None));
        }
        let result = unsafe {
            SetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                dacl,
                null_mut(),
            )
        };
        if result != 0 {
            return Err(fs_failure("stage_acl_failed", Some(result)));
        }
        verify_protected_dacl(handle)
    }

    fn valid_job_id(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 64
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
    }

    fn valid_transaction_nonce(value: &str) -> bool {
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }

    fn test_crash_at(point: Option<&str>, expected: &str) -> FsResult<()> {
        #[cfg(not(debug_assertions))]
        let _ = expected;
        #[cfg(debug_assertions)]
        if point == Some(expected) {
            std::process::exit(86);
        }
        #[cfg(not(debug_assertions))]
        if point.is_some() {
            return Err(fs_failure("invalid_request", None));
        }
        Ok(())
    }

    fn journal_file_name(job_id: &str) -> FsResult<String> {
        if !valid_job_id(job_id) {
            return Err(fs_failure("journal_invalid", None));
        }
        Ok(format!(".transaction-{job_id}.jsonl"))
    }

    fn open_journal_root(path: &str, create: bool) -> FsResult<Handle> {
        let directory = Path::new(path);
        let parent_path = directory
            .parent()
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        let name = directory
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        let chain = open_path_chain_readonly(&parent_path.to_string_lossy())
            .map_err(|error| fs_failure("journal_root_parent_invalid", error.system_error))?;
        let parent = chain
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        let read_access = FILE_READ_CONTROL_ACCESS | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY;
        let access = if create {
            read_access | FILE_ADD_FILE_ACCESS | FILE_ADD_SUBDIRECTORY
        } else {
            read_access
        };
        let root = if create {
            let descriptor = protected_stage_security_descriptor()?;
            match open_relative_with_security(
                parent.raw(),
                name,
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_CREATE,
                FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                FILE_ATTRIBUTE_DIRECTORY,
                descriptor.0,
            ) {
                Ok(handle) => handle,
                Err(error) if error.code == "entry_exists" => open_relative(
                    parent.raw(),
                    name,
                    access,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    FILE_OPEN,
                    FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                    FILE_ATTRIBUTE_DIRECTORY,
                )
                .map_err(|error| fs_failure("journal_root_open_failed", error.system_error))?,
                Err(error) => {
                    return Err(fs_failure("journal_root_create_failed", error.system_error));
                }
            }
        } else {
            open_relative(
                parent.raw(),
                name,
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                FILE_ATTRIBUTE_DIRECTORY,
            )
            .map_err(|error| fs_failure("journal_root_open_failed", error.system_error))?
        };
        let attrs = get_attributes(root.raw()).map_err(|_| fs_last_error("journal_invalid"))?;
        if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return Err(fs_failure("journal_invalid", None));
        }
        verify_protected_dacl(root.raw()).map_err(|_| fs_failure("journal_acl_invalid", None))?;
        Ok(root)
    }

    fn validate_transaction_paths(record: &TransactionRecord) -> FsResult<()> {
        if record.schema_version != 1
            || !valid_job_id(&record.job_id)
            || !valid_transaction_nonce(&record.transaction_nonce)
            || record.project_name.is_empty()
            || record.project_name.contains(['\\', '/', ':', '\0'])
            || record.project_name == "."
            || record.project_name == ".."
            || record.project_name.ends_with(['.', ' '])
        {
            return Err(fs_failure("journal_invalid", None));
        }
        let stage = Path::new(&record.stage_path);
        let target = Path::new(&record.target_path);
        let stage_name = stage
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !stage.parent().is_some_and(|parent| {
            parent
                .to_string_lossy()
                .eq_ignore_ascii_case(&record.parent_path)
        }) || stage_name != format!(".project-generator-stage-{}", record.job_id)
            || !stage
                .join(&record.project_name)
                .to_string_lossy()
                .eq_ignore_ascii_case(&record.source_path)
            || !target.parent().is_some_and(|parent| {
                parent
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&record.parent_path)
            })
            || !target.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .eq_ignore_ascii_case(&record.project_name)
            })
        {
            return Err(fs_failure("journal_invalid", None));
        }
        Ok(())
    }

    fn valid_journal_phase(phase: &str) -> bool {
        matches!(
            phase,
            "createIntent"
                | "stageCreated"
                | "generating"
                | "projectBound"
                | "cleanupSupport"
                | "readyToFinalize"
                | "finalizing"
                | "finalized"
                | "cleanupStage"
                | "stageRemoved"
        )
    }

    fn valid_phase_transition(previous: &str, next: &str) -> bool {
        previous == next
            || matches!(
                (previous, next),
                ("createIntent", "stageCreated")
                    | ("stageCreated", "generating")
                    | ("stageCreated", "projectBound")
                    | ("stageCreated", "cleanupStage")
                    | ("generating", "projectBound")
                    | ("generating", "cleanupStage")
                    | ("projectBound", "cleanupSupport")
                    | ("projectBound", "finalizing")
                    | ("projectBound", "cleanupStage")
                    | ("cleanupSupport", "readyToFinalize")
                    | ("cleanupSupport", "cleanupStage")
                    | ("readyToFinalize", "finalizing")
                    | ("readyToFinalize", "cleanupStage")
                    | ("finalizing", "finalized")
                    | ("finalizing", "cleanupStage")
                    | ("finalized", "cleanupStage")
                    | ("cleanupStage", "stageRemoved")
            )
    }

    fn parse_journal(bytes: &[u8]) -> FsResult<Vec<TransactionRecord>> {
        if bytes.is_empty() || bytes.len() > MAX_JOURNAL_BYTES {
            return Err(fs_failure("journal_invalid", None));
        }
        let complete_length = bytes
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |index| index + 1);
        if complete_length < bytes.len() {
            let tail = &bytes[complete_length..];
            if !tail.starts_with(b"{") {
                return Err(fs_failure("journal_invalid", None));
            }
            let mut deserializer = serde_json::Deserializer::from_slice(tail);
            match serde_json::Value::deserialize(&mut deserializer) {
                Err(error) if error.is_eof() => {}
                Err(_) => return Err(fs_failure("journal_invalid", None)),
                Ok(_) if deserializer.end().is_ok() => {}
                Ok(_) => return Err(fs_failure("journal_invalid", None)),
            }
        }
        if complete_length == 0 {
            return Err(fs_failure("journal_invalid", None));
        }
        let text = std::str::from_utf8(&bytes[..complete_length])
            .map_err(|_| fs_failure("journal_invalid", None))?;
        let mut records = Vec::new();
        for line in text.lines() {
            if records.len() >= MAX_JOURNAL_RECORDS {
                return Err(fs_failure("journal_invalid", None));
            }
            let record: TransactionRecord =
                serde_json::from_str(line).map_err(|_| fs_failure("journal_invalid", None))?;
            validate_transaction_paths(&record)?;
            if !valid_journal_phase(&record.phase) || record.sequence != records.len() as u32 {
                return Err(fs_failure("journal_invalid", None));
            }
            if let Some(previous) = records.last() {
                let previous: &TransactionRecord = previous;
                if previous.job_id != record.job_id
                    || previous.transaction_nonce != record.transaction_nonce
                    || !previous
                        .parent_path
                        .eq_ignore_ascii_case(&record.parent_path)
                    || previous.parent_identity != record.parent_identity
                    || !previous.stage_path.eq_ignore_ascii_case(&record.stage_path)
                    || !previous
                        .source_path
                        .eq_ignore_ascii_case(&record.source_path)
                    || !previous
                        .project_name
                        .eq_ignore_ascii_case(&record.project_name)
                    || !previous
                        .target_path
                        .eq_ignore_ascii_case(&record.target_path)
                    || !valid_phase_transition(&previous.phase, &record.phase)
                    || previous
                        .stage_identity
                        .is_some_and(|value| record.stage_identity != Some(value))
                    || previous
                        .project_identity
                        .is_some_and(|value| record.project_identity != Some(value))
                    || previous
                        .target_identity
                        .is_some_and(|value| record.target_identity != Some(value))
                {
                    return Err(fs_failure("journal_invalid", None));
                }
            }
            records.push(record);
        }
        if records
            .first()
            .is_none_or(|record| record.phase != "createIntent")
        {
            return Err(fs_failure("journal_invalid", None));
        }
        Ok(records)
    }

    fn open_journal_file(
        root: HANDLE,
        job_id: &str,
        access: u32,
        share: u32,
        disposition: u32,
    ) -> FsResult<Handle> {
        let name = journal_file_name(job_id)?;
        let file = open_relative(
            root,
            &name,
            access,
            share,
            disposition,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        )?;
        let attrs = get_attributes(file.raw()).map_err(|_| fs_last_error("journal_invalid"))?;
        if attrs.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY) != 0 {
            return Err(fs_failure("journal_invalid", None));
        }
        verify_protected_dacl(file.raw()).map_err(|_| fs_failure("journal_acl_invalid", None))?;
        Ok(file)
    }

    fn read_journal(root: HANDLE, job_id: &str) -> FsResult<Vec<TransactionRecord>> {
        let file = open_journal_file(
            root,
            job_id,
            GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            FILE_OPEN,
        )?;
        let file = unsafe { std::fs::File::from_raw_handle(file.into_raw() as RawHandle) };
        let mut bytes = Vec::new();
        file.take((MAX_JOURNAL_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| fs_failure("journal_invalid", None))?;
        parse_journal(&bytes)
    }

    fn create_journal(request: JournalIntentRequest) -> FsResult<()> {
        if !valid_job_id(&request.job_id) || !valid_transaction_nonce(&request.transaction_nonce) {
            return Err(fs_failure("journal_invalid", None));
        }
        let mut record = TransactionRecord {
            schema_version: 1,
            sequence: 0,
            job_id: request.job_id,
            transaction_nonce: request.transaction_nonce,
            phase: "createIntent".to_string(),
            parent_path: request.parent_path,
            parent_identity: FileIdentity {
                volume_serial: 0,
                file_index: 0,
            },
            stage_path: request.stage_path,
            stage_identity: None,
            source_path: request.source_path,
            project_name: request.project_name,
            project_identity: None,
            target_path: request.target_path,
            target_identity: None,
        };
        validate_transaction_paths(&record)?;
        let parent_chain = open_path_chain_readonly(&record.parent_path)
            .map_err(|error| fs_failure("journal_parent_invalid", error.system_error))?;
        let parent = parent_chain
            .last()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        record.parent_identity =
            file_identity(parent.raw()).map_err(|_| fs_last_error("journal_invalid"))?;
        let journal_root = open_journal_root(&request.journal_root_path, true)?;
        let descriptor = protected_stage_security_descriptor()?;
        let file = open_relative_with_security(
            journal_root.raw(),
            &journal_file_name(&record.job_id)?,
            GENERIC_READ | GENERIC_WRITE | FILE_READ_ATTRIBUTES | DELETE,
            FILE_SHARE_READ,
            FILE_CREATE,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
            descriptor.0,
        )
        .map_err(|error| fs_failure("journal_create_failed", error.system_error))?;
        verify_protected_dacl(file.raw()).map_err(|_| fs_failure("journal_acl_invalid", None))?;
        let mut file = unsafe { std::fs::File::from_raw_handle(file.into_raw() as RawHandle) };
        serde_json::to_writer(&mut file, &record)
            .map_err(|_| fs_failure("journal_failed", None))?;
        file.write_all(b"\n")
            .and_then(|()| file.sync_all())
            .map_err(|_| fs_failure("journal_unconfirmed", None))?;
        test_crash_at(request.test_crash_at.as_deref(), "afterJournalIntent")
    }

    fn append_journal_record(
        root: HANDLE,
        expected: &TransactionRecord,
        mut next: TransactionRecord,
        test_point: Option<&str>,
    ) -> FsResult<TransactionRecord> {
        let file = open_journal_file(
            root,
            &expected.job_id,
            GENERIC_READ | GENERIC_WRITE | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            FILE_OPEN,
        )
        .map_err(|error| fs_failure("journal_append_open_failed", error.system_error))?;
        let mut file = unsafe { std::fs::File::from_raw_handle(file.into_raw() as RawHandle) };
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take((MAX_JOURNAL_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| fs_failure("journal_read_failed", None))?;
        let records = parse_journal(&bytes)
            .map_err(|error| fs_failure("journal_parse_failed", error.system_error))?;
        let current = records
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        if current != expected
            || !valid_phase_transition(&current.phase, &next.phase)
            || current.sequence + 1 >= MAX_JOURNAL_RECORDS as u32
        {
            return Err(fs_failure("journal_conflict", None));
        }
        next.sequence = current.sequence + 1;
        if next.stage_identity.is_none() {
            next.stage_identity = current.stage_identity;
        }
        if next.project_identity.is_none() {
            next.project_identity = current.project_identity;
        }
        if next.target_identity.is_none() {
            next.target_identity = current.target_identity;
        }
        if next.stage_identity != current.stage_identity && current.stage_identity.is_some()
            || next.project_identity != current.project_identity
                && current.project_identity.is_some()
            || next.target_identity != current.target_identity && current.target_identity.is_some()
        {
            return Err(fs_failure("journal_conflict", None));
        }
        validate_transaction_paths(&next)?;
        let complete_length = bytes
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |index| index + 1) as u64;
        file.set_len(complete_length)
            .and_then(|()| file.sync_all())
            .and_then(|()| file.seek(SeekFrom::End(0)).map(|_| ()))
            .and_then(|_| serde_json::to_writer(&mut file, &next).map_err(io::Error::other))
            .and_then(|()| file.write_all(b"\n"))
            .and_then(|()| file.sync_all())
            .map_err(|_| fs_failure("journal_unconfirmed", None))?;
        test_crash_at(test_point, "afterJournalAppend")?;
        Ok(next)
    }

    fn checked_native_io_status(
        status: i32,
        io_status: &IO_STATUS_BLOCK,
    ) -> Result<i32, FsFailure> {
        const STATUS_PENDING: i32 = 0x0000_0103;
        if status == STATUS_PENDING {
            return Err(fs_failure("native_fs_unconfirmed", Some(status as u32)));
        }
        let completion = unsafe { io_status.Anonymous.Status };
        if completion == STATUS_PENDING {
            return Err(fs_failure("native_fs_unconfirmed", Some(completion as u32)));
        }
        let effective = if status < 0 {
            status
        } else if completion < 0 {
            completion
        } else {
            status
        };
        if effective < 0 {
            Err(fs_failure("native_fs_failed", Some(effective as u32)))
        } else {
            Ok(effective)
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
        open_relative_with_security(
            parent,
            name,
            access,
            share,
            disposition,
            options,
            attributes,
            null_mut(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn open_relative_with_security(
        parent: HANDLE,
        name: &str,
        access: u32,
        share: u32,
        disposition: u32,
        options: u32,
        attributes: u32,
        security_descriptor: *mut c_void,
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
            SecurityDescriptor: security_descriptor.cast(),
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
        let status = match checked_native_io_status(status, &io_status) {
            Ok(status) => status,
            Err(error) => {
                if !raw.is_null() && raw != INVALID_HANDLE_VALUE {
                    unsafe { CloseHandle(raw) };
                }
                let code = if error.code == "native_fs_unconfirmed" {
                    error.code
                } else {
                    match error.system_error {
                        Some(0xC000_0034 | 0xC000_003A) => "entry_missing",
                        Some(0xC000_0035) => "entry_exists",
                        _ => "native_fs_failed",
                    }
                };
                return Err(fs_failure(code, error.system_error));
            }
        };
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            Err(fs_failure("native_fs_failed", Some(status as u32)))
        } else {
            Ok(Handle(raw))
        }
    }

    fn create_stage(request: CreateStageRequest) -> FsResult<()> {
        if !valid_job_id(&request.job_id)
            || !valid_transaction_nonce(&request.transaction_nonce)
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
        let parent_identity =
            file_identity(parent.raw()).map_err(|_| fs_last_error("journal_invalid"))?;
        let journal_root = open_journal_root(&request.journal_root_path, false)?;
        let records = read_journal(journal_root.raw(), &request.job_id)?;
        let intent = records
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        if intent.phase != "createIntent"
            || intent.transaction_nonce != request.transaction_nonce
            || intent.parent_identity != parent_identity
            || !intent
                .parent_path
                .eq_ignore_ascii_case(&request.parent_path)
            || !intent.stage_path.eq_ignore_ascii_case(&request.stage_path)
            || !intent
                .target_path
                .eq_ignore_ascii_case(&request.target_path)
            || !intent
                .project_name
                .eq_ignore_ascii_case(&request.project_name)
        {
            return Err(fs_failure("journal_conflict", None));
        }
        let security = protected_stage_security_descriptor()?;
        let stage_handle = match open_relative_with_security(
            parent.raw(),
            stage_name,
            DELETE
                | FILE_READ_CONTROL_ACCESS
                | FILE_READ_ATTRIBUTES
                | FILE_LIST_DIRECTORY
                | FILE_ADD_SUBDIRECTORY,
            FILE_SHARE_READ,
            FILE_CREATE,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
            security.0,
        ) {
            Ok(handle) => handle,
            Err(error) if error.code == "native_fs_unconfirmed" => {
                return Err(fs_failure("stage_orphaned", error.system_error));
            }
            Err(error) => return Err(error),
        };
        if let Err(error) = verify_protected_dacl(stage_handle.raw()) {
            if rollback_new_stage(stage_handle.raw(), false) {
                return Err(error);
            }
            return Err(fs_failure("stage_orphaned", error.system_error));
        }
        test_crash_at(request.test_crash_at.as_deref(), "afterStageDirectory")?;
        let stage_identity = file_identity(stage_handle.raw())
            .map_err(|_| fs_last_error("stage_identity_unconfirmed"))?;
        let mut marker_created = false;
        let marker_result = (|| {
            let marker = open_relative(
                stage_handle.raw(),
                ".ownership.json",
                GENERIC_READ | GENERIC_WRITE | FILE_READ_ATTRIBUTES | DELETE,
                FILE_SHARE_READ,
                FILE_CREATE,
                FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                FILE_ATTRIBUTE_NORMAL,
            )?;
            marker_created = true;
            let marker_data = serde_json::to_vec(&OwnershipMarker {
                schema_version: 2,
                job_id: request.job_id.clone(),
                stage_name: stage_name.to_string(),
                transaction_nonce: request.transaction_nonce.clone(),
                stage_identity,
                project_identity: None,
            })
            .map_err(|_| fs_failure("native_fs_failed", None))?;
            let mut marker_file =
                unsafe { std::fs::File::from_raw_handle(marker.into_raw() as RawHandle) };
            marker_file
                .write_all(&marker_data)
                .and_then(|()| marker_file.sync_all())
                .map_err(|_| fs_failure("native_fs_failed", None))?;
            Ok(())
        })();
        if let Err(error) = marker_result {
            if rollback_new_stage(stage_handle.raw(), marker_created) {
                return Err(error);
            }
            return Err(fs_failure("stage_orphaned", error.system_error));
        }
        test_crash_at(request.test_crash_at.as_deref(), "afterStageMarker")?;
        let mut created = intent.clone();
        created.phase = "stageCreated".to_string();
        created.stage_identity = Some(stage_identity);
        append_journal_record(
            journal_root.raw(),
            intent,
            created,
            request.test_crash_at.as_deref(),
        )?;
        test_crash_at(request.test_crash_at.as_deref(), "afterStageCreate")?;
        Ok(())
    }

    fn enumerate_names(directory: HANDLE, count: &mut usize) -> FsResult<Vec<String>> {
        let mut names = Vec::new();
        let mut storage = vec![0usize; (16 * 1024) / size_of::<usize>()];
        let mut info_class = FileIdBothDirectoryRestartInfo;
        loop {
            let buffer_length = storage.len() * size_of::<usize>();
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

    fn rollback_new_stage(stage: HANDLE, marker_created: bool) -> bool {
        let mut count = 0usize;
        if marker_created && remove_entry(stage, ".ownership.json", 0, &mut count, true).is_err() {
            return false;
        }
        match enumerate_names(stage, &mut count) {
            Ok(names) if names.is_empty() => delete_open_handle(stage).is_ok(),
            _ => false,
        }
    }

    fn stage_path_parts(path: &str) -> FsResult<Vec<&str>> {
        if path.is_empty()
            || path.len() > 1024
            || path.starts_with('/')
            || path.contains(['\\', ':', '\0'])
        {
            return Err(fs_failure("unsafe_path", None));
        }
        let parts: Vec<_> = path.split('/').collect();
        if parts.len() > 64
            || parts.iter().any(|part| {
                part.is_empty()
                    || *part == "."
                    || *part == ".."
                    || part.ends_with(['.', ' '])
                    || part.contains(['\\', '/', ':', '\0'])
            })
        {
            return Err(fs_failure("unsafe_path", None));
        }
        Ok(parts)
    }

    fn open_stage_directory(parent: HANDLE, name: &str) -> FsResult<Handle> {
        let directory = open_relative(
            parent,
            name,
            FILE_READ_ATTRIBUTES
                | FILE_LIST_DIRECTORY
                | FILE_ADD_FILE_ACCESS
                | FILE_ADD_SUBDIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN_IF,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )?;
        let attrs = get_attributes(directory.raw()).map_err(|_| fs_last_error("unsafe_path"))?;
        if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return Err(fs_failure("unsafe_path", None));
        }
        Ok(directory)
    }

    fn create_stage_directories(stage: HANDLE, paths: &[String]) -> FsResult<()> {
        if paths.len() > 4096 {
            return Err(fs_failure("invalid_request", None));
        }
        for path in paths {
            let parts = stage_path_parts(path)?;
            let mut parent = stage;
            let mut opened = Vec::with_capacity(parts.len());
            for part in parts {
                let directory = open_stage_directory(parent, part)?;
                parent = directory.raw();
                opened.push(directory);
            }
        }
        Ok(())
    }

    fn rename_open_handle(
        source: HANDLE,
        parent: HANDLE,
        name: &str,
        replace: bool,
    ) -> FsResult<()> {
        if name.is_empty() || name.contains(['\\', '/', ':', '\0']) {
            return Err(fs_failure("unsafe_path", None));
        }
        let name: Vec<u16> = name.encode_utf16().collect();
        let bytes = offset_of!(FILE_RENAME_INFORMATION, FileName) + name.len() * size_of::<u16>();
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
        unsafe {
            (*info).Anonymous.ReplaceIfExists = replace;
            (*info).RootDirectory = parent;
            (*info).FileNameLength = (name.len() * size_of::<u16>()) as u32;
            std::ptr::copy_nonoverlapping(name.as_ptr(), (*info).FileName.as_mut_ptr(), name.len());
        }
        let mut io_status = IO_STATUS_BLOCK::default();
        let status = unsafe {
            NtSetInformationFile(
                source,
                &mut io_status,
                info.cast(),
                bytes as u32,
                FileRenameInformation,
            )
        };
        if let Err(error) = checked_native_io_status(status, &io_status) {
            let code = if error.code == "native_fs_unconfirmed" {
                error.code
            } else if error.system_error == Some(0xC000_0035) {
                "target_exists"
            } else {
                "native_fs_failed"
            };
            Err(fs_failure(code, error.system_error))
        } else {
            Ok(())
        }
    }

    fn rename_directory_open_handle(source: HANDLE, parent: HANDLE, name: &str) -> FsResult<()> {
        rename_open_handle(source, parent, name, false)
    }

    fn existing_regular_file(parent: HANDLE, name: &str) -> FsResult<bool> {
        let file = match open_relative(
            parent,
            name,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        ) {
            Ok(file) => file,
            Err(error) if error.code == "entry_missing" => return Ok(false),
            Err(error) => return Err(error),
        };
        let attrs = get_attributes(file.raw()).map_err(|_| fs_last_error("native_fs_failed"))?;
        if attrs.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY) != 0 {
            return Err(fs_failure("unsafe_path", None));
        }
        Ok(true)
    }

    fn write_stage_file(stage: HANDLE, job_id: &str, file: StageFile) -> FsResult<bool> {
        let parts = stage_path_parts(&file.path)?;
        let (name, parents) = parts
            .split_last()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let mut parent = stage;
        let mut opened = Vec::with_capacity(parents.len());
        for part in parents {
            let directory = open_stage_directory(parent, part)?;
            parent = directory.raw();
            opened.push(directory);
        }

        let exists = existing_regular_file(parent, name)?;
        if file.skip_existing && !file.replace && exists {
            return Ok(false);
        }
        if file.replace && exists {
            // Atomic replacement below changes only this directory entry; it never follows a link.
        } else if !file.replace && exists && !file.skip_existing {
            return Err(fs_failure("target_exists", None));
        }

        let sequence = NEXT_STAGE_WRITE.fetch_add(1, Ordering::Relaxed);
        let temporary = format!(".pg-write-{job_id}-{}-{sequence}", std::process::id());
        let temporary_handle = open_relative(
            parent,
            &temporary,
            DELETE | FILE_READ_ATTRIBUTES | GENERIC_WRITE,
            FILE_SHARE_READ,
            FILE_CREATE,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        )?;
        let raw = temporary_handle.into_raw();
        let mut temporary_file = unsafe { std::fs::File::from_raw_handle(raw as RawHandle) };
        let write_result = temporary_file
            .write_all(file.content.as_bytes())
            .and_then(|()| temporary_file.sync_all());
        let temporary_handle = Handle::new(temporary_file.into_raw_handle() as HANDLE)
            .map_err(|_| fs_failure("native_fs_failed", None))?;
        if write_result.is_err() {
            let _ = delete_open_handle(temporary_handle.raw());
            return Err(fs_failure("native_fs_failed", None));
        }
        if let Err(error) = rename_open_handle(temporary_handle.raw(), parent, name, file.replace) {
            if error.code != "native_fs_unconfirmed" {
                let _ = delete_open_handle(temporary_handle.raw());
            }
            return Err(error);
        }
        Ok(true)
    }

    fn prepare_stage(request: StageMutationRequest) -> FsResult<Vec<String>> {
        if request.files.len() > 4096 {
            return Err(fs_failure("invalid_request", None));
        }
        let stage = validate_stage(&request.stage)?;
        verify_bound_project_identity(&request.stage, &stage)?;
        create_stage_directories(stage.stage_handle.raw(), &request.directories)?;
        let mut written = Vec::new();
        for file in request.files {
            let path = file.path.clone();
            if write_stage_file(stage.stage_handle.raw(), &request.stage.job_id, file)? {
                written.push(path);
            }
        }
        verify_bound_project_identity(&request.stage, &stage)?;
        test_crash_at(request.stage.test_crash_at.as_deref(), "afterStageMutation")?;
        Ok(written)
    }

    fn read_marker(
        stage_name: &str,
        handle: &Handle,
        job_id: &str,
        transaction_nonce: &str,
    ) -> FsResult<OwnershipMarker> {
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
        if marker.schema_version != 2
            || marker.job_id != job_id
            || marker.stage_name != stage_name
            || marker.transaction_nonce != transaction_nonce
            || file_identity(handle.raw()).ok() != Some(marker.stage_identity)
        {
            return Err(fs_failure("stage_ownership", None));
        }
        Ok(marker)
    }

    fn append_stage_phase(
        request: &StageRequest,
        stage: &ValidatedStage,
        phase: &str,
        target_identity: Option<FileIdentity>,
        test_point: Option<&str>,
    ) -> FsResult<TransactionRecord> {
        let journal_root = open_journal_root(&request.journal_root_path, false)?;
        let mut next = stage.transaction.clone();
        next.phase = phase.to_string();
        if phase == "projectBound" {
            next.project_identity = read_marker(
                Path::new(&request.stage_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| fs_failure("stage_ownership", None))?,
                &stage.stage_handle,
                &request.job_id,
                &request.transaction_nonce,
            )?
            .project_identity;
        }
        if let Some(identity) = target_identity {
            next.target_identity = Some(identity);
        }
        append_journal_record(journal_root.raw(), &stage.transaction, next, test_point)
    }

    fn mark_generating(request: JournalPhaseRequest) -> FsResult<()> {
        if request.phase != "generating" {
            return Err(fs_failure("invalid_request", None));
        }
        let stage = validate_stage(&request.stage)?;
        match stage.transaction.phase.as_str() {
            "generating" => Ok(()),
            "stageCreated" => append_stage_phase(
                &request.stage,
                &stage,
                "generating",
                None,
                request.stage.test_crash_at.as_deref(),
            )
            .map(|_| ()),
            _ => Err(fs_failure("journal_conflict", None)),
        }
    }

    fn validate_project_target(request: &StageRequest) -> FsResult<(&str, &str)> {
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
        Ok((project_name, target_path))
    }

    fn verify_project_identity(
        parent: HANDLE,
        project_name: &str,
        expected: FileIdentity,
    ) -> FsResult<()> {
        open_verified_project(parent, project_name, expected).map(|_| ())
    }

    fn open_verified_project(
        parent: HANDLE,
        project_name: &str,
        expected: FileIdentity,
    ) -> FsResult<Handle> {
        let project = open_relative(
            parent,
            project_name,
            FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )
        .map_err(|error| {
            if error.code == "native_fs_unconfirmed" {
                fs_failure("stage_identity_unconfirmed", error.system_error)
            } else if error.code == "entry_missing" {
                fs_failure("stage_identity_missing", error.system_error)
            } else {
                fs_failure("stage_identity_mismatch", error.system_error)
            }
        })?;
        let attrs = get_attributes(project.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?;
        let identity = file_identity(project.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?;
        if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
            || identity != expected
        {
            return Err(fs_failure("stage_identity_mismatch", None));
        }
        Ok(project)
    }

    fn verify_bound_project_identity(
        request: &StageRequest,
        stage: &ValidatedStage,
    ) -> FsResult<()> {
        let Some(expected) = stage.ownership.project_identity else {
            return Ok(());
        };
        let (project_name, _) = validate_project_target(request)?;
        verify_project_identity(stage.stage_handle.raw(), project_name, expected)
    }

    fn verify_cleanup_project_identity(
        request: &StageRequest,
        stage: &ValidatedStage,
    ) -> FsResult<()> {
        let Some(expected) = stage.ownership.project_identity else {
            return Ok(());
        };
        let (project_name, _) = validate_project_target(request)?;
        match verify_project_identity(stage.stage_handle.raw(), project_name, expected) {
            Err(error) if error.code == "stage_identity_missing" => {
                let parent = stage
                    ._parent_chain
                    .last()
                    .ok_or_else(|| fs_failure("stage_identity_unconfirmed", None))?;
                verify_project_identity(parent.raw(), project_name, expected).map_err(|error| {
                    if error.code == "stage_identity_unconfirmed" {
                        error
                    } else {
                        fs_failure("stage_identity_mismatch", error.system_error)
                    }
                })?;
                let output = open_relative(
                    parent.raw(),
                    project_name,
                    FILE_READ_CONTROL_ACCESS | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    FILE_OPEN,
                    FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                    FILE_ATTRIBUTE_DIRECTORY,
                )
                .map_err(|error| {
                    if error.code == "native_fs_unconfirmed" {
                        fs_failure("stage_identity_unconfirmed", error.system_error)
                    } else {
                        fs_failure("stage_identity_mismatch", error.system_error)
                    }
                })?;
                verify_protected_dacl(output.raw())
                    .map_err(|error| fs_failure("stage_identity_unconfirmed", error.system_error))
            }
            result => result,
        }
    }

    fn bind_project_identity(request: StageRequest) -> FsResult<()> {
        let (project_name, _) = validate_project_target(&request)?;
        let stage = validate_stage(&request)?;
        if let Some(expected) = stage.ownership.project_identity {
            return verify_project_identity(stage.stage_handle.raw(), project_name, expected);
        }
        let project = open_relative(
            stage.stage_handle.raw(),
            project_name,
            FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )
        .map_err(|error| fs_failure("stage_identity_unconfirmed", error.system_error))?;
        let attrs = get_attributes(project.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?;
        let identity = file_identity(project.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?;
        if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
            || identity.volume_serial != stage.volume
        {
            return Err(fs_failure("stage_identity_mismatch", None));
        }
        let mut ownership = stage.ownership.clone();
        ownership.project_identity = Some(identity);
        let content =
            serde_json::to_string(&ownership).map_err(|_| fs_failure("native_fs_failed", None))?;
        write_stage_file(
            stage.stage_handle.raw(),
            &request.job_id,
            StageFile {
                path: ".ownership.json".to_string(),
                content,
                replace: true,
                skip_existing: false,
            },
        )?;
        test_crash_at(request.test_crash_at.as_deref(), "afterProjectMarker")?;
        append_stage_phase(
            &request,
            &stage,
            "projectBound",
            None,
            request.test_crash_at.as_deref(),
        )?;
        Ok(())
    }

    fn verify_scaffold_identity(request: StageRequest) -> FsResult<()> {
        let (project_name, _) = validate_project_target(&request)?;
        let stage = validate_stage(&request)?;
        let expected = stage
            .ownership
            .project_identity
            .ok_or_else(|| fs_failure("stage_identity_unconfirmed", None))?;
        let project = open_verified_project(stage.stage_handle.raw(), project_name, expected)?;
        let (manifest_name, go_module_path, python_project_name, composer_project_name) = match (
            request.module_path.as_deref(),
            request.manifest_file.as_deref(),
        ) {
            (Some(module_path), None) if !module_path.is_empty() && module_path.len() <= 512 => {
                ("go.mod", Some(module_path), None, None)
            }
            (Some(_), _) => return Err(fs_failure("scaffold_invalid", None)),
            (None, Some("pyproject.toml")) => ("pyproject.toml", None, Some(project_name), None),
            (None, Some("composer.json")) => (
                "composer.json",
                None,
                None,
                Some(format!("forma/{project_name}")),
            ),
            (None, Some(_)) => return Err(fs_failure("scaffold_invalid", None)),
            (None, None) => ("package.json", None, None, None),
        };
        let manifest = open_relative(
            project.raw(),
            manifest_name,
            GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        )
        .map_err(|error| {
            if error.code == "native_fs_unconfirmed" {
                fs_failure("stage_identity_unconfirmed", error.system_error)
            } else {
                fs_failure("scaffold_invalid", error.system_error)
            }
        })?;
        let attrs = get_attributes(manifest.raw()).map_err(|error| {
            fs_failure(
                "stage_identity_unconfirmed",
                error.raw_os_error().map(|code| code as u32),
            )
        })?;
        if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0
        {
            return Err(fs_failure("scaffold_invalid", None));
        }
        let mut content = Vec::new();
        let file = unsafe { std::fs::File::from_raw_handle(manifest.into_raw() as RawHandle) };
        file.take((MAX_SCAFFOLD_MANIFEST_BYTES + 1) as u64)
            .read_to_end(&mut content)
            .map_err(|error| {
                fs_failure(
                    "stage_identity_unconfirmed",
                    error.raw_os_error().map(|code| code as u32),
                )
            })?;
        if content.len() > MAX_SCAFFOLD_MANIFEST_BYTES {
            return Err(fs_failure("scaffold_invalid", None));
        }
        if let Some(module_path) = go_module_path {
            let expected = format!("module {module_path}");
            let first_line = content
                .split(|byte| *byte == b'\n')
                .next()
                .unwrap_or_default();
            if first_line.strip_suffix(b"\r").unwrap_or(first_line) != expected.as_bytes() {
                return Err(fs_failure("scaffold_invalid", None));
            }
        } else if let Some(project_name) = python_project_name {
            let text =
                std::str::from_utf8(&content).map_err(|_| fs_failure("scaffold_invalid", None))?;
            let mut in_project = false;
            let mut name_matches = false;
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('[') {
                    in_project = trimmed == "[project]";
                } else if in_project && trimmed == format!("name = \"{project_name}\"") {
                    name_matches = true;
                    break;
                }
            }
            if !name_matches {
                return Err(fs_failure("scaffold_invalid", None));
            }
        } else if let Some(package_name) = composer_project_name {
            let manifest: serde_json::Value = serde_json::from_slice(&content)
                .map_err(|_| fs_failure("scaffold_invalid", None))?;
            if manifest.get("name").and_then(serde_json::Value::as_str)
                != Some(package_name.as_str())
            {
                return Err(fs_failure("scaffold_invalid", None));
            }
        } else {
            let manifest: serde_json::Value = serde_json::from_slice(&content)
                .map_err(|_| fs_failure("scaffold_invalid", None))?;
            if manifest.get("name").and_then(serde_json::Value::as_str) != Some(project_name) {
                return Err(fs_failure("scaffold_invalid", None));
            }
        }
        Ok(())
    }

    fn validate_stage(request: &StageRequest) -> FsResult<ValidatedStage> {
        if !valid_job_id(&request.job_id) || !valid_transaction_nonce(&request.transaction_nonce) {
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
            DELETE
                | FILE_READ_CONTROL_ACCESS
                | FILE_READ_ATTRIBUTES
                | FILE_LIST_DIRECTORY
                | FILE_ADD_FILE_ACCESS
                | FILE_ADD_SUBDIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
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
        verify_protected_dacl(stage_handle.raw())
            .map_err(|_| fs_failure("stage_ownership", None))?;
        let ownership = read_marker(
            stage_name,
            &stage_handle,
            &request.job_id,
            &request.transaction_nonce,
        )?;
        let journal_root = open_journal_root(&request.journal_root_path, false)?;
        let records = read_journal(journal_root.raw(), &request.job_id)?;
        let transaction = records
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?
            .clone();
        let parent_identity =
            file_identity(parent_handle.raw()).map_err(|_| fs_failure("journal_invalid", None))?;
        let stage_identity = file_identity(stage_handle.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?;
        if transaction.transaction_nonce != request.transaction_nonce
            || transaction.parent_identity != parent_identity
            || transaction.stage_identity != Some(stage_identity)
            || transaction.stage_identity != Some(ownership.stage_identity)
            || transaction.project_identity != ownership.project_identity
            || !transaction
                .parent_path
                .eq_ignore_ascii_case(&request.parent_path)
            || !transaction
                .stage_path
                .eq_ignore_ascii_case(&request.stage_path)
            || !transaction.target_path.eq_ignore_ascii_case(
                request
                    .target_path
                    .as_deref()
                    .ok_or_else(|| fs_failure("unsafe_path", None))?,
            )
            || !transaction.project_name.eq_ignore_ascii_case(
                request
                    .project_name
                    .as_deref()
                    .ok_or_else(|| fs_failure("unsafe_path", None))?,
            )
        {
            return Err(fs_failure("journal_conflict", None));
        }
        Ok(ValidatedStage {
            _parent_chain: parent_chain,
            stage_handle,
            volume: parent_volume,
            ownership,
            transaction,
        })
    }

    fn cleanup_support(request: StageRequest) -> FsResult<()> {
        let mut stage = validate_stage(&request)?;
        verify_bound_project_identity(&request, &stage)?;
        stage.transaction = append_stage_phase(
            &request,
            &stage,
            "cleanupSupport",
            None,
            request.test_crash_at.as_deref(),
        )?;
        let mut count = 0usize;
        for name in [
            ".tools",
            ".home",
            ".tmp",
            ".npm-cache",
            ".uv-cache",
            ".composer-cache",
            ".npmrc-user",
            ".npmrc-global",
        ] {
            remove_entry(stage.stage_handle.raw(), name, 0, &mut count, true)?;
        }
        verify_bound_project_identity(&request, &stage)?;
        test_crash_at(request.test_crash_at.as_deref(), "afterSupportCleanup")?;
        append_stage_phase(
            &request,
            &stage,
            "readyToFinalize",
            None,
            request.test_crash_at.as_deref(),
        )?;
        let _ = (&stage._parent_chain, &stage.stage_handle, stage.volume);
        Ok(())
    }

    fn restore_marker(
        stage_name: &str,
        stage: &Handle,
        ownership: &OwnershipMarker,
    ) -> FsResult<()> {
        let content =
            serde_json::to_vec(ownership).map_err(|_| fs_failure("stage_orphaned", None))?;
        let marker = match open_relative(
            stage.raw(),
            ".ownership.json",
            GENERIC_READ | GENERIC_WRITE | FILE_READ_ATTRIBUTES | DELETE,
            FILE_SHARE_READ,
            FILE_CREATE,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_NORMAL,
        ) {
            Ok(marker) => marker,
            Err(error) if error.code == "entry_exists" => {
                return if read_marker(
                    stage_name,
                    stage,
                    &ownership.job_id,
                    &ownership.transaction_nonce,
                )
                .is_ok_and(|found| &found == ownership)
                {
                    Ok(())
                } else {
                    Err(fs_failure("stage_orphaned", error.system_error))
                };
            }
            Err(error) => return Err(fs_failure("stage_orphaned", error.system_error)),
        };
        let mut file = unsafe { std::fs::File::from_raw_handle(marker.into_raw() as RawHandle) };
        file.write_all(&content)
            .and_then(|()| file.sync_all())
            .map_err(|_| fs_failure("stage_orphaned", None))
    }

    fn cleanup_stage(request: StageRequest) -> FsResult<()> {
        let stage = validate_stage(&request)?;
        verify_cleanup_project_identity(&request, &stage)?;
        let cleaning = append_stage_phase(
            &request,
            &stage,
            "cleanupStage",
            None,
            request.test_crash_at.as_deref(),
        )?;
        test_crash_at(request.test_crash_at.as_deref(), "beforeStageCleanup")?;
        let stage_name = Path::new(&request.stage_path)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| fs_failure("stage_ownership", None))?;
        let mut count = 0usize;
        let names = enumerate_names(stage.stage_handle.raw(), &mut count)?;
        for name in names
            .iter()
            .filter(|name| !name.eq_ignore_ascii_case(".ownership.json"))
        {
            remove_entry(stage.stage_handle.raw(), name, 1, &mut count, false)?;
        }
        let remaining = enumerate_names(stage.stage_handle.raw(), &mut count)?;
        if remaining
            .iter()
            .any(|name| !name.eq_ignore_ascii_case(".ownership.json"))
        {
            return Err(fs_failure("cleanup_incomplete", None));
        }
        if let Err(error) = remove_entry(
            stage.stage_handle.raw(),
            ".ownership.json",
            0,
            &mut count,
            false,
        ) {
            return match restore_marker(stage_name, &stage.stage_handle, &stage.ownership) {
                Ok(()) => Err(error),
                Err(restore_error) => Err(fs_failure(
                    "stage_orphaned",
                    restore_error.system_error.or(error.system_error),
                )),
            };
        }
        test_crash_at(
            request.test_crash_at.as_deref(),
            "afterOwnershipMarkerRemoval",
        )?;
        if let Err(error) = delete_open_handle(stage.stage_handle.raw()) {
            return match restore_marker(stage_name, &stage.stage_handle, &stage.ownership) {
                Ok(()) => Err(fs_failure("cleanup_incomplete", error.system_error)),
                Err(restore_error) => Err(fs_failure(
                    "stage_orphaned",
                    restore_error.system_error.or(error.system_error),
                )),
            };
        }
        test_crash_at(request.test_crash_at.as_deref(), "afterStageRootRemoval")?;
        let journal_root = open_journal_root(&request.journal_root_path, false)?;
        let mut removed = cleaning.clone();
        removed.phase = "stageRemoved".to_string();
        append_journal_record(
            journal_root.raw(),
            &cleaning,
            removed,
            request.test_crash_at.as_deref(),
        )?;
        drop(stage.stage_handle);
        let _ = (&stage._parent_chain, stage.volume);
        let test_point = request.test_crash_at.clone();
        remove_live_journal(
            JournalRequest {
                journal_root_path: request.journal_root_path.clone(),
                job_id: request.job_id.clone(),
                transaction_nonce: request.transaction_nonce.clone(),
            },
            test_point.as_deref(),
        )
    }

    fn finalize_stage(request: StageRequest) -> FsResult<()> {
        let (project_name, _) = validate_project_target(&request)?;
        let stage = validate_stage(&request)?;
        let expected_identity = stage
            .ownership
            .project_identity
            .ok_or_else(|| fs_failure("stage_identity_unconfirmed", None))?;
        let parent_handle = stage
            ._parent_chain
            .last()
            .ok_or_else(|| fs_failure("unsafe_path", None))?;
        let source = open_relative(
            stage.stage_handle.raw(),
            project_name,
            DELETE | FILE_READ_CONTROL_ACCESS | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
            FILE_SHARE_READ,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )
        .map_err(|error| {
            if error.code == "native_fs_unconfirmed" {
                fs_failure("stage_identity_unconfirmed", error.system_error)
            } else {
                fs_failure("stage_identity_mismatch", error.system_error)
            }
        })?;
        let source_attrs = get_attributes(source.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?;
        if source_attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || source_attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return Err(fs_failure("stage_identity_mismatch", None));
        }
        if volume_serial(source.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?
            != stage.volume
        {
            return Err(fs_failure("stage_identity_mismatch", None));
        }
        let source_identity = file_identity(source.raw())
            .map_err(|_| fs_failure("stage_identity_unconfirmed", None))?;
        if source_identity != expected_identity {
            return Err(fs_failure("stage_identity_mismatch", None));
        }
        let finalizing = append_stage_phase(
            &request,
            &stage,
            "finalizing",
            None,
            request.test_crash_at.as_deref(),
        )?;
        test_crash_at(request.test_crash_at.as_deref(), "beforeFinalizeRename")?;
        rename_directory_open_handle(source.raw(), parent_handle.raw(), project_name)?;
        test_crash_at(
            request.test_crash_at.as_deref(),
            "afterFinalizeRenameBeforeAcl",
        )?;
        let target = open_relative(
            parent_handle.raw(),
            project_name,
            FILE_READ_CONTROL_ACCESS
                | FILE_READ_ATTRIBUTES
                | FILE_LIST_DIRECTORY
                | FILE_WRITE_DAC_ACCESS,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )
        .map_err(|error| fs_failure("finalize_unconfirmed", error.system_error))?;
        let target_attrs =
            get_attributes(target.raw()).map_err(|_| fs_failure("finalize_unconfirmed", None))?;
        if target_attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || target_attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
            || file_identity(target.raw()).ok() != Some(source_identity)
            || source_identity != expected_identity
        {
            return Err(fs_failure("finalize_unconfirmed", None));
        }
        set_protected_dacl(target.raw()).map_err(|_| fs_failure("finalize_unconfirmed", None))?;
        verify_protected_dacl(target.raw())
            .map_err(|_| fs_failure("finalize_unconfirmed", None))?;
        test_crash_at(request.test_crash_at.as_deref(), "afterFinalizeRename")?;
        let journal_root = open_journal_root(&request.journal_root_path, false)?;
        let mut finalized = finalizing.clone();
        finalized.phase = "finalized".to_string();
        finalized.target_identity = Some(source_identity);
        append_journal_record(
            journal_root.raw(),
            &finalizing,
            finalized,
            request.test_crash_at.as_deref(),
        )?;
        Ok(())
    }

    fn open_optional_directory(parent: HANDLE, name: &str) -> FsResult<Option<Handle>> {
        match open_relative(
            parent,
            name,
            FILE_READ_CONTROL_ACCESS | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        ) {
            Ok(handle) => {
                let attrs = get_attributes(handle.raw())
                    .map_err(|_| fs_last_error("recovery_unconfirmed"))?;
                if attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                    || attrs.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
                {
                    return Err(fs_failure("recovery_unconfirmed", None));
                }
                Ok(Some(handle))
            }
            Err(error) if error.code == "entry_missing" => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn inspect_transaction(journal_root: HANDLE, job_id: &str) -> FsResult<RecoveryReport> {
        let records = read_journal(journal_root, job_id)?;
        let record = records
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        let mut report = RecoveryReport {
            job_id: record.job_id.clone(),
            phase: record.phase.clone(),
            state: "uncertain".to_string(),
            parent_path: record.parent_path.clone(),
            stage_path: record.stage_path.clone(),
            source_path: record.source_path.clone(),
            target_path: record.target_path.clone(),
            can_finalize: false,
            can_cleanup_stage: false,
            can_discard_journal: false,
            detail: "Filesystem identities did not establish a safe recovery action.",
        };
        let parent_chain = match open_path_chain_readonly(&record.parent_path) {
            Ok(chain) => chain,
            Err(_) => {
                report.state = "parentUnverifiable".to_string();
                report.detail =
                    "Parent directory could not be opened without following reparse points.";
                return Ok(report);
            }
        };
        let parent = parent_chain
            .last()
            .ok_or_else(|| fs_failure("recovery_unconfirmed", None))?;
        if file_identity(parent.raw()).ok() != Some(record.parent_identity) {
            report.state = "parentIdentityMismatch".to_string();
            report.detail = "Recorded parent directory identity changed; no mutation is allowed.";
            return Ok(report);
        }
        let stage_name = Path::new(&record.stage_path)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        let stage = open_optional_directory(parent.raw(), stage_name)?;
        let target = open_optional_directory(parent.raw(), &record.project_name)?;
        let target_identity = target
            .as_ref()
            .and_then(|handle| file_identity(handle.raw()).ok());
        let target_matches_project = record
            .project_identity
            .is_some_and(|expected| target_identity == Some(expected));
        if target_matches_project
            && target
                .as_ref()
                .is_none_or(|handle| verify_protected_dacl(handle.raw()).is_err())
        {
            report.state = "targetAclUnverified".to_string();
            report.detail = "Target identity matches the journal, but its protected ACL did not verify; preserve target, stage, and journal.";
            return Ok(report);
        }
        let target_matches = target_matches_project
            && record
                .target_identity
                .is_none_or(|recorded| target_identity == Some(recorded));

        let Some(stage) = stage else {
            if target_matches {
                report.state = "committedNeedsJournalCleanup".to_string();
                report.can_discard_journal = true;
                report.detail = "Target identity matches recorded project; stage is absent. Explicitly remove stale journal.";
            } else if record.phase == "createIntent" || record.phase == "stageRemoved" {
                report.state = "noOwnedStage".to_string();
                report.can_discard_journal = true;
                report.detail = "No owned stage remains; explicit journal removal is safe.";
            } else if record.phase == "cleanupStage" && target.is_none() {
                report.state = "cleanupFinishedJournalPending".to_string();
                report.can_discard_journal = true;
                report.detail = "Stage root is absent after recorded cleanup; explicit journal removal is safe.";
            } else if target.is_some() {
                report.state = "targetIdentityMismatch".to_string();
                report.detail = "Target exists but does not match recorded source identity; preserve target and journal.";
            } else {
                report.state = "stageMissingUnconfirmed".to_string();
                report.detail = "Stage is absent outside a verified completion state; preserve journal for manual review.";
            }
            return Ok(report);
        };

        if record
            .target_identity
            .is_some_and(|expected| target_identity != Some(expected))
        {
            report.state = "targetIdentityMismatch".to_string();
            report.detail = "Recorded destination identity is absent or changed while staging remains; preserve all objects.";
            return Ok(report);
        }

        let stage_identity = file_identity(stage.raw()).ok();
        let marker = read_marker(
            stage_name,
            &stage,
            &record.job_id,
            &record.transaction_nonce,
        );
        let marker_valid = marker.as_ref().is_ok_and(|value| {
            stage_identity == Some(value.stage_identity)
                && record
                    .stage_identity
                    .is_none_or(|expected| Some(expected) == stage_identity)
                && record
                    .project_identity
                    .is_none_or(|expected| value.project_identity == Some(expected))
        });
        let marker_missing_during_cleanup = marker
            .as_ref()
            .is_err_and(|error| error.code == "stage_ownership")
            && record.phase == "cleanupStage"
            && record.stage_identity == stage_identity;
        if !marker_valid && !marker_missing_during_cleanup {
            report.state = "unverifiedStage".to_string();
            report.detail =
                "Stage marker, nonce, ACL, or file identity did not verify; no cleanup is allowed.";
            return Ok(report);
        }
        if record
            .stage_identity
            .is_some_and(|expected| Some(expected) != stage_identity)
        {
            report.state = "stageIdentityMismatch".to_string();
            report.detail = "Stage root identity differs from journal; no cleanup is allowed.";
            return Ok(report);
        }

        let source = open_optional_directory(stage.raw(), &record.project_name)?;
        let source_identity = source
            .as_ref()
            .and_then(|handle| file_identity(handle.raw()).ok());
        let expected_project = record.project_identity.or_else(|| {
            marker
                .as_ref()
                .ok()
                .and_then(|value| value.project_identity)
        });
        let source_matches =
            expected_project.is_some_and(|expected| source_identity == Some(expected));
        let source_missing = source.is_none();
        let committed = expected_project
            .is_some_and(|expected| target_identity == Some(expected) && source_missing);
        if let (Some(expected), Ok(marker)) = (record.project_identity, marker.as_ref())
            && marker.project_identity != Some(expected)
        {
            report.state = "projectIdentityMismatch".to_string();
            report.detail = "Marker and journal disagree about validated project identity.";
            return Ok(report);
        }
        if record.stage_identity.is_none()
            || (marker.as_ref().is_ok_and(|value| {
                value.project_identity.is_some() && record.project_identity.is_none()
            }))
        {
            report.state = "journalReconcileRequired".to_string();
            report.can_cleanup_stage = marker_valid;
            report.detail = "Protected marker and live identities are verifiable; explicit recovery must bind missing journal identities first.";
            return Ok(report);
        }
        if expected_project.is_none()
            && matches!(record.phase.as_str(), "stageCreated" | "generating")
        {
            report.state = if record.phase == "stageCreated" {
                "stageCreated".to_string()
            } else {
                "generationInterrupted".to_string()
            };
            report.can_cleanup_stage = marker_valid;
            report.detail = "Parent, stage, marker, nonce, and ACL verify; explicit cleanup may remove this transaction-owned stage.";
            return Ok(report);
        }
        if committed {
            report.state = "committedWrapperNeedsCleanup".to_string();
            report.can_cleanup_stage = true;
            report.detail = "Destination matches recorded source identity; explicit cleanup can remove verified staging wrapper only.";
            return Ok(report);
        }
        if source_matches {
            if target_matches {
                report.state = "duplicateSourceAndTarget".to_string();
                report.detail = "Source and destination both match transaction identity; preserve both for manual review.";
                return Ok(report);
            }
            report.state = if target.is_some() {
                "stagedTargetOccupied".to_string()
            } else {
                "stagingPresent".to_string()
            };
            report.can_cleanup_stage = marker_valid;
            report.can_finalize = marker_valid
                && target.is_none()
                && expected_project.is_some()
                && matches!(record.phase.as_str(), "readyToFinalize" | "finalizing");
            if report.can_finalize {
                report.state = "readyToFinalize".to_string();
                report.detail = "Source identity verifies and target is absent; explicit no-replace finalization is available.";
            } else {
                report.detail = if target.is_some() {
                    "Staged source is verified; unrelated target remains untouched. Explicit cleanup may remove owned staging only."
                } else {
                    "Staged source is verified and target is absent. Explicit cleanup may remove owned staging only."
                };
            }
            return Ok(report);
        }
        if marker_missing_during_cleanup && target.is_none() {
            report.state = "cleanupInterrupted".to_string();
            report.can_cleanup_stage = true;
            report.detail = "Journal and stage-root identities verify interrupted cleanup; explicit retry may finish owned-stage removal.";
            return Ok(report);
        }
        report.state = "sourceIdentityMismatch".to_string();
        report.detail =
            "Staged project identity is absent or mismatched; preserve staging and destination.";
        Ok(report)
    }

    fn inspect_recovery(request: RecoveryInspectRequest) -> FsResult<Vec<RecoveryReport>> {
        if request
            .job_id
            .as_deref()
            .is_some_and(|job_id| !valid_job_id(job_id))
        {
            return Err(fs_failure("journal_invalid", None));
        }
        let root = match open_journal_root(&request.journal_root_path, false) {
            Ok(root) => root,
            Err(error) if error.code == "entry_missing" => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut count = 0usize;
        let names = enumerate_names(root.raw(), &mut count)?;
        let mut reports = Vec::new();
        for name in names {
            let Some(job_id) = name
                .strip_prefix(".transaction-")
                .and_then(|value| value.strip_suffix(".jsonl"))
            else {
                continue;
            };
            if request
                .job_id
                .as_deref()
                .is_some_and(|filter| filter != job_id)
            {
                continue;
            }
            match inspect_transaction(root.raw(), job_id) {
                Ok(report) => reports.push(report),
                Err(_) => reports.push(RecoveryReport {
                    job_id: job_id.to_string(),
                    phase: "unknown".to_string(),
                    state: "invalidJournal".to_string(),
                    parent_path: String::new(),
                    stage_path: String::new(),
                    source_path: String::new(),
                    target_path: String::new(),
                    can_finalize: false,
                    can_cleanup_stage: false,
                    can_discard_journal: false,
                    detail: "Journal could not be verified; preserve all paths and inspect manually.",
                }),
            }
        }
        Ok(reports)
    }

    fn remove_journal_file(
        root: HANDLE,
        record: &TransactionRecord,
        test_point: Option<&str>,
    ) -> FsResult<()> {
        let file = open_journal_file(
            root,
            &record.job_id,
            DELETE | GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
        )
        .map_err(|error| fs_failure("journal_delete_open_failed", error.system_error))?;
        let mut file = unsafe { std::fs::File::from_raw_handle(file.into_raw() as RawHandle) };
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take((MAX_JOURNAL_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| fs_failure("journal_delete_read_failed", None))?;
        let records = parse_journal(&bytes)
            .map_err(|error| fs_failure("journal_delete_parse_failed", error.system_error))?;
        if records.last() != Some(record) {
            return Err(fs_failure("journal_conflict", None));
        }
        test_crash_at(test_point, "beforeJournalRemoval")?;
        let file = Handle(file.into_raw_handle() as HANDLE);
        delete_open_handle(file.raw())
            .map_err(|error| fs_failure("journal_delete_failed", error.system_error))?;
        test_crash_at(test_point, "afterJournalRemoval")
    }

    fn cleanup_recovery_stage(
        root: HANDLE,
        initial: &TransactionRecord,
        test_point: Option<&str>,
    ) -> FsResult<()> {
        let parent_chain = open_path_chain(&initial.parent_path)?;
        let parent = parent_chain
            .last()
            .ok_or_else(|| fs_failure("recovery_unconfirmed", None))?;
        if file_identity(parent.raw()).ok() != Some(initial.parent_identity) {
            return Err(fs_failure("recovery_unconfirmed", None));
        }
        let stage_name = Path::new(&initial.stage_path)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        let stage = open_relative(
            parent.raw(),
            stage_name,
            DELETE
                | FILE_READ_CONTROL_ACCESS
                | FILE_READ_ATTRIBUTES
                | FILE_LIST_DIRECTORY
                | FILE_ADD_FILE_ACCESS
                | FILE_ADD_SUBDIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            FILE_ATTRIBUTE_DIRECTORY,
        )?;
        let stage_identity =
            file_identity(stage.raw()).map_err(|_| fs_failure("recovery_unconfirmed", None))?;
        if initial
            .stage_identity
            .is_some_and(|expected| expected != stage_identity)
        {
            return Err(fs_failure("recovery_unconfirmed", None));
        }
        verify_protected_dacl(stage.raw()).map_err(|_| fs_failure("journal_acl_invalid", None))?;
        let records = read_journal(root, &initial.job_id)?;
        let current = records
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?
            .clone();
        if current.transaction_nonce != initial.transaction_nonce {
            return Err(fs_failure("journal_conflict", None));
        }
        let marker = read_marker(
            stage_name,
            &stage,
            &current.job_id,
            &current.transaction_nonce,
        );
        let marker_valid = marker.as_ref().is_ok_and(|value| {
            value.stage_identity == stage_identity
                && (current.project_identity.is_none()
                    || value.project_identity == current.project_identity)
        });
        let marker_missing = marker
            .as_ref()
            .is_err_and(|error| error.code == "stage_ownership");
        if !marker_valid && !(marker_missing && current.phase == "cleanupStage") {
            return Err(fs_failure("recovery_unconfirmed", None));
        }
        let project_identity = current.project_identity.or_else(|| {
            marker
                .as_ref()
                .ok()
                .and_then(|value| value.project_identity)
        });
        if current.project_identity.is_some()
            && marker
                .as_ref()
                .is_ok_and(|value| value.project_identity != current.project_identity)
        {
            return Err(fs_failure("recovery_unconfirmed", None));
        }

        let mut current = current;
        if current
            .stage_identity
            .is_some_and(|expected| expected != stage_identity)
        {
            return Err(fs_failure("recovery_unconfirmed", None));
        }
        if current.stage_identity.is_none() {
            if !marker_valid || current.phase != "createIntent" {
                return Err(fs_failure("recovery_unconfirmed", None));
            }
            let mut stage_created = current.clone();
            stage_created.phase = "stageCreated".to_string();
            stage_created.stage_identity = Some(stage_identity);
            current = append_journal_record(root, &current, stage_created, test_point)?;
        }
        if current.project_identity.is_none()
            && let Some(identity) = project_identity
        {
            if current.phase == "stageCreated" {
                let mut generating = current.clone();
                generating.phase = "generating".to_string();
                current = append_journal_record(root, &current, generating, test_point)?;
            }
            if current.phase == "generating" {
                let mut bound = current.clone();
                bound.phase = "projectBound".to_string();
                bound.project_identity = Some(identity);
                current = append_journal_record(root, &current, bound, test_point)?;
                test_crash_at(test_point, "afterProjectIdentityRebind")?;
            }
        }

        let source = open_optional_directory(stage.raw(), &current.project_name)?;
        let target = open_optional_directory(parent.raw(), &current.project_name)?;
        if let (Some(expected), Some(target)) = (current.project_identity, target.as_ref())
            && file_identity(target.raw()).ok() == Some(expected)
        {
            verify_protected_dacl(target.raw())
                .map_err(|_| fs_failure("recovery_unconfirmed", None))?;
        }
        match current.project_identity {
            Some(expected) => match source.as_ref() {
                Some(source) if file_identity(source.raw()).ok() == Some(expected) => {
                    if target
                        .as_ref()
                        .is_some_and(|target| file_identity(target.raw()).ok() == Some(expected))
                    {
                        return Err(fs_failure("recovery_unconfirmed", None));
                    }
                }
                None if target
                    .as_ref()
                    .is_some_and(|target| file_identity(target.raw()).ok() == Some(expected)) =>
                {
                    if !matches!(current.phase.as_str(), "finalized" | "cleanupStage") {
                        if current.phase != "finalizing" {
                            return Err(fs_failure("recovery_unconfirmed", None));
                        }
                        let mut finalized = current.clone();
                        finalized.phase = "finalized".to_string();
                        finalized.target_identity = Some(expected);
                        current = append_journal_record(root, &current, finalized, test_point)?;
                    }
                }
                None if marker_missing && current.phase == "cleanupStage" && target.is_none() => {}
                _ => return Err(fs_failure("recovery_unconfirmed", None)),
            },
            None if current.phase != "finalizing" && current.phase != "finalized" => {}
            None => return Err(fs_failure("recovery_unconfirmed", None)),
        }

        drop(source);
        drop(target);
        if current.phase != "cleanupStage" {
            let mut cleaning = current.clone();
            cleaning.phase = "cleanupStage".to_string();
            current = append_journal_record(root, &current, cleaning, test_point)?;
        }
        let mut count = 0usize;
        let names = enumerate_names(stage.raw(), &mut count)?;
        for name in names
            .iter()
            .filter(|name| !name.eq_ignore_ascii_case(".ownership.json"))
        {
            remove_entry(stage.raw(), name, 1, &mut count, false)?;
        }
        let remaining = enumerate_names(stage.raw(), &mut count)?;
        if remaining
            .iter()
            .any(|name| !name.eq_ignore_ascii_case(".ownership.json"))
        {
            return Err(fs_failure("cleanup_incomplete", None));
        }
        if !marker_missing {
            remove_entry(stage.raw(), ".ownership.json", 0, &mut count, false)?;
        }
        test_crash_at(test_point, "afterOwnershipMarkerRemoval")?;
        delete_open_handle(stage.raw())?;
        test_crash_at(test_point, "afterStageRootRemoval")?;
        let mut removed = current.clone();
        removed.phase = "stageRemoved".to_string();
        let removed = append_journal_record(root, &current, removed, test_point)?;
        remove_journal_file(root, &removed, test_point)
    }

    fn apply_recovery(request: RecoveryApplyRequest) -> FsResult<()> {
        if !valid_job_id(&request.job_id)
            || request.confirm_job_id != request.job_id
            || !matches!(request.action.as_str(), "cleanup" | "finalize")
        {
            return Err(fs_failure("recovery_confirmation_required", None));
        }
        let root = open_journal_root(&request.journal_root_path, false)
            .map_err(|error| fs_failure("live_journal_root_failed", error.system_error))?;
        let records = read_journal(root.raw(), &request.job_id)
            .map_err(|error| fs_failure("live_journal_read_failed", error.system_error))?;
        let record = records
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        let report = inspect_transaction(root.raw(), &request.job_id)
            .map_err(|error| fs_failure("live_journal_inspect_failed", error.system_error))?;
        if request.action == "finalize" {
            if !report.can_finalize {
                return Err(fs_failure("recovery_unconfirmed", None));
            }
            let stage_request = StageRequest {
                stage_path: record.stage_path.clone(),
                parent_path: record.parent_path.clone(),
                job_id: record.job_id.clone(),
                project_name: Some(record.project_name.clone()),
                module_path: None,
                manifest_file: None,
                target_path: Some(record.target_path.clone()),
                journal_root_path: request.journal_root_path.clone(),
                transaction_nonce: record.transaction_nonce.clone(),
                test_crash_at: request.test_crash_at.clone(),
            };
            finalize_stage(stage_request)?;
            let records = read_journal(root.raw(), &request.job_id)?;
            let finalized = records
                .last()
                .ok_or_else(|| fs_failure("journal_invalid", None))?;
            return cleanup_recovery_stage(root.raw(), finalized, request.test_crash_at.as_deref());
        }
        if report.can_cleanup_stage {
            return cleanup_recovery_stage(root.raw(), record, request.test_crash_at.as_deref());
        }
        if report.can_discard_journal {
            return remove_journal_file(root.raw(), record, request.test_crash_at.as_deref());
        }
        Err(fs_failure("recovery_unconfirmed", None))
    }

    fn remove_live_journal(request: JournalRequest, test_point: Option<&str>) -> FsResult<()> {
        if !valid_job_id(&request.job_id) || !valid_transaction_nonce(&request.transaction_nonce) {
            return Err(fs_failure("journal_invalid", None));
        }
        let root = open_journal_root(&request.journal_root_path, false)
            .map_err(|error| fs_failure("live_journal_root_failed", error.system_error))?;
        let records = read_journal(root.raw(), &request.job_id)
            .map_err(|error| fs_failure("live_journal_read_failed", error.system_error))?;
        let record = records
            .last()
            .ok_or_else(|| fs_failure("journal_invalid", None))?;
        if record.transaction_nonce != request.transaction_nonce || record.phase != "stageRemoved" {
            return Err(fs_failure("journal_conflict", None));
        }
        let report = inspect_transaction(root.raw(), &request.job_id)
            .map_err(|error| fs_failure("live_journal_inspect_failed", error.system_error))?;
        if !report.can_discard_journal {
            return Err(fs_failure("recovery_unconfirmed", None));
        }
        remove_journal_file(root.raw(), record, test_point)
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
                written_files: None,
            });
            return 1;
        }
        if mode == "--create-journal" {
            let request = match read_fs_request::<JournalIntentRequest>() {
                Ok(request) => request,
                Err(_) => {
                    let _ = write_json(&FsResponse {
                        ok: false,
                        code: Some("invalid_request"),
                        system_error: None,
                        written_files: None,
                    });
                    return 1;
                }
            };
            return match create_journal(request) {
                Ok(()) => {
                    if write_json(&FsResponse {
                        ok: true,
                        code: None,
                        system_error: None,
                        written_files: None,
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
                        written_files: None,
                    });
                    1
                }
            };
        }
        if mode == "--recovery-inspect" {
            let request = match read_fs_request::<RecoveryInspectRequest>() {
                Ok(request) => request,
                Err(_) => {
                    let _ = write_json(&RecoveryResponse {
                        ok: false,
                        code: Some("invalid_request"),
                        reports: None,
                    });
                    return 1;
                }
            };
            return match inspect_recovery(request) {
                Ok(reports) => {
                    if write_json(&RecoveryResponse {
                        ok: true,
                        code: None,
                        reports: Some(reports),
                    })
                    .is_ok()
                    {
                        0
                    } else {
                        1
                    }
                }
                Err(error) => {
                    let _ = write_json(&RecoveryResponse {
                        ok: false,
                        code: Some(error.code),
                        reports: None,
                    });
                    1
                }
            };
        }
        if mode == "--recovery-apply" {
            let request = match read_fs_request::<RecoveryApplyRequest>() {
                Ok(request) => request,
                Err(_) => {
                    let _ = write_json(&FsResponse {
                        ok: false,
                        code: Some("invalid_request"),
                        system_error: None,
                        written_files: None,
                    });
                    return 1;
                }
            };
            return match apply_recovery(request) {
                Ok(()) => {
                    if write_json(&FsResponse {
                        ok: true,
                        code: None,
                        system_error: None,
                        written_files: None,
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
                        written_files: None,
                    });
                    1
                }
            };
        }
        if mode == "--journal-phase" {
            let request = match read_fs_request::<JournalPhaseRequest>() {
                Ok(request) => request,
                Err(_) => {
                    let _ = write_json(&FsResponse {
                        ok: false,
                        code: Some("invalid_request"),
                        system_error: None,
                        written_files: None,
                    });
                    return 1;
                }
            };
            return match mark_generating(request) {
                Ok(()) => {
                    if write_json(&FsResponse {
                        ok: true,
                        code: None,
                        system_error: None,
                        written_files: None,
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
                        written_files: None,
                    });
                    1
                }
            };
        }
        if mode == "--create-stage" {
            let request = match read_fs_request::<CreateStageRequest>() {
                Ok(request) => request,
                Err(_) => {
                    let _ = write_json(&FsResponse {
                        ok: false,
                        code: Some("invalid_request"),
                        system_error: None,
                        written_files: None,
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
                        written_files: None,
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
                        written_files: None,
                    });
                    1
                }
            };
        }
        if mode == "--prepare-stage" {
            let request = match read_fs_request::<StageMutationRequest>() {
                Ok(request) => request,
                Err(_) => {
                    let _ = write_json(&FsResponse {
                        ok: false,
                        code: Some("invalid_request"),
                        system_error: None,
                        written_files: None,
                    });
                    return 1;
                }
            };
            return match prepare_stage(request) {
                Ok(written_files) => {
                    if write_json(&FsResponse {
                        ok: true,
                        code: None,
                        system_error: None,
                        written_files: Some(written_files),
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
                        written_files: None,
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
                    written_files: None,
                });
                return 1;
            }
        };
        let result = match mode {
            "--bind-stage-identity" => bind_project_identity(request),
            "--verify-scaffold-identity" => verify_scaffold_identity(request),
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
                    written_files: None,
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
                    written_files: None,
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
            "--create-stage"
                | "--create-journal"
                | "--journal-phase"
                | "--recovery-inspect"
                | "--recovery-apply"
                | "--prepare-stage"
                | "--bind-stage-identity"
                | "--verify-scaffold-identity"
                | "--cleanup-support"
                | "--cleanup-stage"
                | "--finalize-stage"
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

    #[cfg(test)]
    mod tests {
        use super::*;

        fn io_status(status: i32) -> IO_STATUS_BLOCK {
            let mut block = IO_STATUS_BLOCK::default();
            block.Anonymous.Status = status;
            block
        }

        #[test]
        fn native_create_requires_successful_completion_status() {
            assert_eq!(checked_native_io_status(0, &io_status(0)).unwrap(), 0);
            let failure =
                checked_native_io_status(0, &io_status(0xC000_0022u32 as i32)).unwrap_err();
            assert_eq!(failure.code, "native_fs_failed");
            assert_eq!(failure.system_error, Some(0xC000_0022));
        }

        #[test]
        fn native_pending_status_is_never_treated_as_success() {
            let failure = checked_native_io_status(0x103, &io_status(0)).unwrap_err();
            assert_eq!(failure.code, "native_fs_unconfirmed");
            assert_eq!(failure.system_error, Some(0x103));

            let completion = checked_native_io_status(0, &io_status(0x103)).unwrap_err();
            assert_eq!(completion.code, "native_fs_unconfirmed");
            assert_eq!(completion.system_error, Some(0x103));
        }

        fn record(phase: &str, sequence: u32) -> TransactionRecord {
            TransactionRecord {
                schema_version: 1,
                sequence,
                job_id: "job-1".to_string(),
                transaction_nonce: "a".repeat(64),
                phase: phase.to_string(),
                parent_path: "C:\\Temp".to_string(),
                parent_identity: FileIdentity {
                    volume_serial: 1,
                    file_index: 10,
                },
                stage_path: "C:\\Temp\\.project-generator-stage-job-1".to_string(),
                stage_identity: None,
                source_path: "C:\\Temp\\.project-generator-stage-job-1\\demo".to_string(),
                project_name: "demo".to_string(),
                project_identity: None,
                target_path: "C:\\Temp\\demo".to_string(),
                target_identity: None,
            }
        }

        #[test]
        fn journal_reader_ignores_only_incomplete_final_append() {
            let first = record("createIntent", 0);
            let mut bytes = serde_json::to_vec(&first).unwrap();
            bytes.push(b'\n');
            bytes.extend_from_slice(b"{\"sequence\":1,\"phase\":");
            let parsed = parse_journal(&bytes).unwrap();
            assert_eq!(parsed.len(), 1);
            assert_eq!(parsed[0].phase, first.phase);

            let mut invalid = serde_json::to_vec(&record("finalizing", 0)).unwrap();
            invalid.push(b'\n');
            assert_eq!(
                parse_journal(&invalid).err().unwrap().code,
                "journal_invalid"
            );
        }

        #[test]
        fn journal_history_rejects_identity_changes() {
            let first = record("createIntent", 0);
            let mut second = record("stageCreated", 1);
            second.stage_identity = Some(FileIdentity {
                volume_serial: 1,
                file_index: 20,
            });
            let mut third = second.clone();
            third.sequence = 2;
            third.phase = "generating".to_string();
            let mut bytes = Vec::new();
            for record in [&first, &second, &third] {
                serde_json::to_writer(&mut bytes, record).unwrap();
                bytes.push(b'\n');
            }
            assert_eq!(parse_journal(&bytes).unwrap().len(), 3);

            third.stage_identity = Some(FileIdentity {
                volume_serial: 1,
                file_index: 21,
            });
            let mut invalid = Vec::new();
            for record in [&first, &second, &third] {
                serde_json::to_writer(&mut invalid, record).unwrap();
                invalid.push(b'\n');
            }
            assert_eq!(
                parse_journal(&invalid).err().unwrap().code,
                "journal_invalid"
            );
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

#[cfg(windows)]
fn main() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null;
    use std::thread;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
    use windows_sys::Win32::System::Threading::{
        CREATE_BREAKAWAY_FROM_JOB, CREATE_NO_WINDOW, CreateProcessW, PROCESS_INFORMATION,
        STARTUPINFOW,
    };

    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--child") {
        loop {
            if args
                .get(2)
                .is_some_and(|stop| std::path::Path::new(stop).exists())
            {
                break;
            }
            thread::sleep(Duration::from_secs(1));
        }
        return;
    }
    let (Some(marker), Some(stop_file)) = (args.get(1), args.get(2)) else {
        std::process::exit(2);
    };
    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => std::process::exit(3),
    };
    let executable = executable.to_string_lossy();
    let command = format!("\"{executable}\" --child \"{stop_file}\"");
    let mut command: Vec<u16> = OsStr::new(&command).encode_wide().chain(Some(0)).collect();
    let executable: Vec<u16> = OsStr::new(executable.as_ref())
        .encode_wide()
        .chain(Some(0))
        .collect();
    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut info = PROCESS_INFORMATION::default();
    let created = unsafe {
        CreateProcessW(
            executable.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW,
            null(),
            null(),
            &startup,
            &mut info,
        )
    };
    if created == 0 {
        let _ = std::fs::write(marker, format!("blocked:{}", unsafe { GetLastError() }));
    } else {
        let _ = std::fs::write(marker, format!("escaped:{}", info.dwProcessId));
        unsafe {
            CloseHandle(info.hThread);
            CloseHandle(info.hProcess);
        }
    }
    loop {
        thread::sleep(Duration::from_secs(1));
    }
}

#[cfg(not(windows))]
fn main() {
    std::process::exit(1);
}

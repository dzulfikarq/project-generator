#![cfg_attr(not(windows), allow(dead_code))]

#[cfg(windows)]
mod windows {
    use serde::{Deserialize, Serialize};
    use std::io::{self, Read, Write};
    use std::mem::size_of;
    use std::ptr::{null, null_mut};
    use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows_sys::Wdk::Storage::FileSystem::{
        FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_REPARSE_POINT,
        FILE_SYNCHRONOUS_IO_NONALERT, NtCreateFile,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, HANDLE, INVALID_HANDLE_VALUE, OBJ_CASE_INSENSITIVE, UNICODE_STRING,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_ATTRIBUTE_TAG_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, FileAttributeTagInfo, GetFileInformationByHandleEx, OPEN_EXISTING,
        SYNCHRONIZE,
    };
    use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

    const MAX_INPUT_BYTES: usize = 256 * 1024;
    const MAX_PATH_UTF16: usize = 32_767;
    const STATUS_PENDING: i32 = 0x0000_0103;
    const STATUS_OBJECT_NAME_NOT_FOUND: i32 = 0xC000_0034_u32 as i32;
    const STATUS_OBJECT_PATH_NOT_FOUND: i32 = 0xC000_003A_u32 as i32;

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct Request {
        protocol_version: u8,
        project_root: String,
        database_path: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Response {
        protocol_version: u8,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<&'static str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<&'static str>,
    }

    struct Handle(HANDLE);

    impl Handle {
        fn new(raw: HANDLE) -> Result<Self, &'static str> {
            if raw.is_null() || raw == INVALID_HANDLE_VALUE {
                Err("filesystem_error")
            } else {
                Ok(Self(raw))
            }
        }

        fn raw(&self) -> HANDLE {
            self.0
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    struct AbsolutePath {
        root: String,
        components: Vec<String>,
    }

    fn reserved_component(value: &str) -> bool {
        let stem = value
            .split('.')
            .next()
            .unwrap_or_default()
            .trim_end_matches([' ', '.'])
            .to_ascii_uppercase();
        matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" | "CLOCK$"
        ) || matches!(
            stem.as_str(),
            "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        ) || matches!(
            stem.as_str(),
            "COM¹" | "COM²" | "COM³" | "LPT¹" | "LPT²" | "LPT³"
        )
    }

    fn parse_absolute(value: &str) -> Result<AbsolutePath, &'static str> {
        if value.contains('\0')
            || value.contains('/')
            || value.encode_utf16().count() > MAX_PATH_UTF16
            || value.len() < 3
            || !value.as_bytes()[0].is_ascii_alphabetic()
            || value.as_bytes().get(1..3) != Some(&b":\\"[..])
        {
            return Err("unsafe_path");
        }
        let root = format!("{}:\\", &value[..1]);
        let tail = &value[3..];
        let components = if tail.is_empty() {
            Vec::new()
        } else {
            tail.split('\\')
                .map(|component| {
                    if component.is_empty()
                        || component == "."
                        || component == ".."
                        || component.contains(':')
                        || component.ends_with([' ', '.'])
                        || reserved_component(component)
                    {
                        Err("unsafe_path")
                    } else {
                        Ok(component.to_string())
                    }
                })
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(AbsolutePath { root, components })
    }

    fn same_component(left: &str, right: &str) -> bool {
        left == right
    }

    fn attributes(handle: HANDLE) -> Result<FILE_ATTRIBUTE_TAG_INFO, &'static str> {
        let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
        let success = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileAttributeTagInfo,
                (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        };
        if success == 0 {
            Err("filesystem_error")
        } else {
            Ok(info)
        }
    }

    fn check_attributes(handle: HANDLE, directory: bool) -> Result<(), &'static str> {
        let info = attributes(handle)?;
        if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("reparse_point");
        }
        if (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory {
            return Err("unsafe_path");
        }
        Ok(())
    }

    fn open_volume_root(path: &str) -> Result<Handle, &'static str> {
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let handle = Handle::new(unsafe {
            CreateFileW(
                wide.as_ptr(),
                FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            )
        })?;
        check_attributes(handle.raw(), true)?;
        Ok(handle)
    }

    fn open_relative(
        parent: HANDLE,
        component: &str,
        directory: bool,
    ) -> Result<Option<Handle>, &'static str> {
        if component.is_empty()
            || component.contains(['\\', '/', ':', '\0'])
            || component == "."
            || component == ".."
        {
            return Err("unsafe_path");
        }
        let mut name: Vec<u16> = component.encode_utf16().collect();
        let byte_length = name
            .len()
            .checked_mul(size_of::<u16>())
            .filter(|length| *length <= u16::MAX as usize)
            .ok_or("unsafe_path")?;
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
                FILE_READ_ATTRIBUTES
                    | (if directory { FILE_LIST_DIRECTORY } else { 0 })
                    | SYNCHRONIZE,
                &object_attributes,
                &mut io_status,
                null(),
                if directory {
                    FILE_ATTRIBUTE_DIRECTORY
                } else {
                    FILE_ATTRIBUTE_NORMAL
                },
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                (if directory {
                    FILE_DIRECTORY_FILE
                } else {
                    FILE_NON_DIRECTORY_FILE
                }) | FILE_OPEN_REPARSE_POINT
                    | FILE_SYNCHRONOUS_IO_NONALERT,
                null(),
                0,
            )
        };
        let completion = unsafe { io_status.Anonymous.Status };
        if status == STATUS_PENDING || completion == STATUS_PENDING {
            if !raw.is_null() && raw != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(raw) };
            }
            return Err("filesystem_error");
        }
        let effective = if status < 0 {
            status
        } else if completion < 0 {
            completion
        } else {
            status
        };
        if effective == STATUS_OBJECT_NAME_NOT_FOUND || effective == STATUS_OBJECT_PATH_NOT_FOUND {
            if !raw.is_null() && raw != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(raw) };
            }
            return Ok(None);
        }
        if effective < 0 || raw.is_null() || raw == INVALID_HANDLE_VALUE {
            if !raw.is_null() && raw != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(raw) };
            }
            return Err("filesystem_error");
        }
        let handle = Handle::new(raw)?;
        check_attributes(handle.raw(), directory)?;
        Ok(Some(handle))
    }

    fn verify(request: Request) -> Result<(), &'static str> {
        if request.protocol_version != 1 {
            return Err("protocol_mismatch");
        }
        let project = parse_absolute(&request.project_root)?;
        let database = parse_absolute(&request.database_path)?;
        if !same_component(&project.root, &database.root)
            || database.components.len() <= project.components.len()
            || !project
                .components
                .iter()
                .zip(&database.components)
                .all(|(left, right)| same_component(left, right))
        {
            return Err("unsafe_path");
        }

        let mut handles = vec![open_volume_root(&project.root)?];
        for component in &project.components {
            let parent = handles.last().ok_or("filesystem_error")?;
            let handle = open_relative(parent.raw(), component, true)?.ok_or("filesystem_error")?;
            handles.push(handle);
        }

        let suffix = &database.components[project.components.len()..];
        for (index, component) in suffix.iter().enumerate() {
            let is_directory = index + 1 < suffix.len();
            let parent = handles.last().ok_or("filesystem_error")?;
            let Some(handle) = open_relative(parent.raw(), component, is_directory)? else {
                // Missing DB file or parent is valid; later components cannot exist below it.
                return Ok(());
            };
            handles.push(handle);
        }
        Ok(())
    }

    fn write_response(response: &Response) -> io::Result<()> {
        let mut stdout = io::stdout().lock();
        serde_json::to_writer(&mut stdout, response).map_err(io::Error::other)?;
        stdout.write_all(b"\n")
    }

    fn read_request() -> Result<Request, &'static str> {
        let mut bytes = Vec::new();
        io::stdin()
            .lock()
            .take((MAX_INPUT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "invalid_request")?;
        if bytes.len() > MAX_INPUT_BYTES {
            return Err("invalid_request");
        }
        serde_json::from_slice(&bytes).map_err(|_| "invalid_request")
    }

    pub fn run() -> i32 {
        let mut args = std::env::args_os();
        let _exe = args.next();
        if args.next().as_deref() != Some(std::ffi::OsStr::new("--verify")) || args.next().is_some()
        {
            let _ = write_response(&Response {
                protocol_version: 1,
                ok: false,
                result: None,
                code: Some("invalid_request"),
            });
            return 2;
        }
        let result = read_request().and_then(verify);
        match result {
            Ok(()) => {
                if write_response(&Response {
                    protocol_version: 1,
                    ok: true,
                    result: Some("clear"),
                    code: None,
                })
                .is_ok()
                {
                    0
                } else {
                    1
                }
            }
            Err(code) => {
                let _ = write_response(&Response {
                    protocol_version: 1,
                    ok: false,
                    result: None,
                    code: Some(code),
                });
                1
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{parse_absolute, reserved_component};

        #[test]
        fn absolute_path_parser_rejects_non_local_and_unsafe_components() {
            for path in [
                "\\\\server\\share\\db.sqlite",
                "\\\\?\\C:\\db.sqlite",
                "C:\\root\\..\\db.sqlite",
                "C:\\root\\NUL.txt",
                "C:\\root\\CLOCK$",
                "C:\\root\\folder. ",
            ] {
                assert!(parse_absolute(path).is_err(), "{path}");
            }
            assert!(parse_absolute("C:\\root\\folder\\notes.sqlite").is_ok());
        }

        #[test]
        fn reserved_device_names_cover_common_windows_aliases() {
            assert!(reserved_component("NUL"));
            assert!(reserved_component("CON.txt"));
            assert!(reserved_component("CLOCK$"));
            assert!(reserved_component("LPT9.log"));
            assert!(!reserved_component("notes.sqlite"));
        }

        #[test]
        fn malformed_unicode_drive_prefix_returns_path_error_without_panicking() {
            assert!(matches!(
                parse_absolute("C€\\root\\db.sqlite"),
                Err("unsafe_path")
            ));
        }
    }
}

#[cfg(windows)]
fn main() {
    std::process::exit(windows::run());
}

#[cfg(not(windows))]
fn main() {
    eprintln!("pg-db-path-verifier is Windows-only.");
    std::process::exit(1);
}

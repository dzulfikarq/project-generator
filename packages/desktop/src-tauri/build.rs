fn main() {
    let mode = std::env::var("PG_RUNTIME_MODE").unwrap_or_else(|_| "system".to_owned());
    if mode != "system" && mode != "bundled" {
        panic!("PG_RUNTIME_MODE must be system or bundled");
    }
    println!("cargo:rustc-env=PG_RUNTIME_MODE={mode}");
    println!("cargo:rerun-if-env-changed=PG_RUNTIME_MODE");
    tauri_build::build()
}

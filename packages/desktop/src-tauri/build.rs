fn main() {
    let mode = std::env::var("PG_RUNTIME_MODE").unwrap_or_else(|_| "system".to_owned());
    if mode != "system" && mode != "bundled" {
        panic!("PG_RUNTIME_MODE must be system or bundled");
    }
    if std::env::var("PROFILE").unwrap_or_default() == "release" {
        let policy = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/pg-runtime/cli/node_modules/@project-generator/core/dist/src/build-policy.js");
        println!("cargo:rerun-if-changed={}", policy.display());
        let source = std::fs::read_to_string(&policy)
            .expect("release desktop builds require staged release-profile CLI resources");
        if !source.contains("BUILD_PROFILE = 'release';")
            || !source.contains("ALLOW_PLANNED_RECIPE_GENERATION = false;")
        {
            panic!("release desktop builds reject non-release CLI resources");
        }
    }
    println!("cargo:rustc-env=PG_RUNTIME_MODE={mode}");
    println!("cargo:rerun-if-env-changed=PG_RUNTIME_MODE");
    tauri_build::build()
}

fn main() {
    println!("cargo:rerun-if-changed=protocols/hyprland-global-shortcuts-v1.xml");
    tauri_build::build()
}

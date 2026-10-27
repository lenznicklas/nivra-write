#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod assets;
mod documents;
mod format;
mod migrations;
mod package;
mod webview_policy;
use tauri::Manager;
mod export;
mod filesystem;
mod recent;
mod recovery;
mod settings;
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let registry =
                assets::AssetRegistry::new(&app.path().app_cache_dir()?.join("asset-sessions"))?;
            app.manage(registry);
            webview_policy::install(app.handle())?;
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("nwr-asset", |context, request, responder| {
            let registry = context
                .app_handle()
                .state::<assets::AssetRegistry>()
                .inner()
                .clone();
            let path = request.uri().path().trim_start_matches('/').to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                let result = path
                    .split_once('/')
                    .ok_or("Invalid asset URI.".to_string())
                    .and_then(|(token, id)| registry.resolve(token, id));
                let response = match result {
                    Ok((bytes, mime)) => tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("X-Content-Type-Options", "nosniff")
                        .header("Cache-Control", "no-store")
                        .body(bytes),
                    Err(_) => tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new()),
                };
                if let Ok(response) = response {
                    responder.respond(response);
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            documents::read_document,
            documents::write_document,
            settings::read_state,
            settings::write_state,
            recovery::save_recovery,
            recovery::list_recovery,
            recovery::delete_recovery,
            export::export_file,
            export::export_html,
            assets::create_asset_session,
            assets::close_asset_session,
            assets::import_image,
            recovery::restore_recovery,
            recent::check_recent_paths
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start Nivra Writer");
}
#[cfg(test)]
mod storage_tests;

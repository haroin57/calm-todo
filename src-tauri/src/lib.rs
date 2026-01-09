// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};

#[cfg(windows)]
use tauri_winrt_notification::Toast;

#[cfg(windows)]
const APP_USER_MODEL_ID: &str = "com.calmtodo.app";


#[cfg(windows)]
fn ensure_start_menu_shortcut() -> Result<(), String> {
    use std::ffi::OsString;
    use std::fs;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, PCWSTR, PWSTR};
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER, IPersistFile,
    };
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::UI::Shell::{
        FOLDERID_StartMenu, IShellLinkW, ShellLink, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    fn to_wide(value: &Path) -> Vec<u16> {
        value.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn pwstr_to_path(ptr: PWSTR) -> Result<PathBuf, String> {
        if ptr.is_null() {
            return Err("Start menu path is null".to_string());
        }
        let mut len = 0usize;
        unsafe {
            while *ptr.0.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr.0, len);
            Ok(PathBuf::from(OsString::from_wide(slice)))
        }
    }

    let start_menu: PWSTR = unsafe {
        SHGetKnownFolderPath(&FOLDERID_StartMenu, KNOWN_FOLDER_FLAG(0), None)
            .map_err(|e: windows::core::Error| e.to_string())?
    };
    let start_menu_path = pwstr_to_path(start_menu)?;
    unsafe { CoTaskMemFree(Some(start_menu.0 as *const _)) };

    let programs_dir = start_menu_path.join("Programs");
    fs::create_dir_all(&programs_dir).map_err(|e| e.to_string())?;

    let shortcut_path = programs_dir.join("Calm Todo.lnk");
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;

    let shell_link: IShellLinkW =
        unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e: windows::core::Error| e.to_string())?;

    let exe_wide = to_wide(&exe_path);
    unsafe {
        shell_link
            .SetPath(PCWSTR(exe_wide.as_ptr()))
            .map_err(|e: windows::core::Error| e.to_string())?;
    }

    if let Some(working_dir) = exe_path.parent() {
        let work_wide = to_wide(working_dir);
        unsafe {
            shell_link
                .SetWorkingDirectory(PCWSTR(work_wide.as_ptr()))
                .map_err(|e: windows::core::Error| e.to_string())?;
        }
    }

    let desc_wide: Vec<u16> = "Calm Todo".encode_utf16().chain(Some(0)).collect();
    unsafe {
        shell_link
            .SetDescription(PCWSTR(desc_wide.as_ptr()))
            .map_err(|e: windows::core::Error| e.to_string())?;
    }

    let store: IPropertyStore = shell_link.cast().map_err(|e: windows::core::Error| e.to_string())?;
    let prop: PROPVARIANT = APP_USER_MODEL_ID.into();
    unsafe {
        store
            .SetValue(&PKEY_AppUserModel_ID, &prop)
            .map_err(|e: windows::core::Error| e.to_string())?;
        store.Commit().map_err(|e: windows::core::Error| e.to_string())?;
    }

    let persist: IPersistFile = shell_link.cast().map_err(|e: windows::core::Error| e.to_string())?;
    let shortcut_wide = to_wide(&shortcut_path);
    unsafe {
        persist
            .Save(PCWSTR(shortcut_wide.as_ptr()), true)
            .map_err(|e: windows::core::Error| e.to_string())?;
    }

    Ok(())
}

#[cfg(windows)]
fn set_current_process_app_user_model_id() -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let mut wide: Vec<u16> = APP_USER_MODEL_ID.encode_utf16().collect();
    wide.push(0);

    unsafe { SetCurrentProcessExplicitAppUserModelID(PCWSTR(wide.as_ptr())) }
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Calm Todo.", name)
}

#[tauri::command]
fn show_notification(title: String, body: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let aumid_result = set_current_process_app_user_model_id();

        let send = |app_id: &str| {
            Toast::new(app_id)
                .title(&title)
                .text1(&body)
                .show()
        };

        // Try with custom app ID first
        match send(APP_USER_MODEL_ID) {
            Ok(_) => {
                return Ok(format!("通知成功 (AppID: {})", APP_USER_MODEL_ID));
            }
            Err(primary_err) => {
                // Try with PowerShell fallback
                match send(Toast::POWERSHELL_APP_ID) {
                    Ok(_) => {
                        return Ok(format!(
                            "通知成功 (フォールバック: PowerShell)\n元のエラー: {:?}",
                            primary_err
                        ));
                    }
                    Err(fallback_err) => {
                        return Err(format!(
                            "通知失敗\n\nAppUserModelID設定: {:?}\n\n1回目 ({}): {:?}\n\n2回目 (PowerShell): {:?}",
                            aumid_result,
                            APP_USER_MODEL_ID,
                            primary_err,
                            fallback_err
                        ));
                    }
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        Ok("非Windows環境".to_string())
    }
}

#[tauri::command]
async fn save_export_file(app: tauri::AppHandle, filename: String, content: String) -> Result<String, String> {
    use std::fs;
    use tauri_plugin_dialog::DialogExt;

    // Get default path (Documents folder)
    let default_path = dirs::document_dir()
        .map(|p| p.join(&filename));

    // Show save file dialog
    let mut builder = app.dialog().file().set_file_name(&filename);
    builder = builder.add_filter("JSON", &["json"]);

    if let Some(path) = default_path {
        builder = builder.set_directory(path.parent().unwrap_or(&path));
    }

    let file_path = builder.blocking_save_file();

    match file_path {
        Some(file_path) => {
            // Convert FilePath to PathBuf
            let path = file_path.into_path()
                .map_err(|e| format!("パス変換エラー: {:?}", e))?;
            // Write file
            fs::write(&path, &content)
                .map_err(|e| format!("ファイル保存エラー: {}", e))?;
            Ok(path.to_string_lossy().to_string())
        }
        None => {
            Err("キャンセルされました".to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        let _ = set_current_process_app_user_model_id();
        let _ = ensure_start_menu_shortcut();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, show and focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![greet, show_notification, save_export_file])
        .setup(|app| {
            // Create tray menu
            let add_item = MenuItem::with_id(app, "add", "+ 新規タスク", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "表示", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&add_item, &show_item, &quit_item])?;

            // Build tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Calm Todo")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "add" => {
                            // Check if quick-add window already exists
                            if let Some(window) = app.get_webview_window("quick-add") {
                                let _ = window.set_focus();
                            } else {
                                // Create a new small quick-add window
                                let _ = WebviewWindowBuilder::new(
                                    app,
                                    "quick-add",
                                    WebviewUrl::App("quick-add.html".into())
                                )
                                .title("タスク追加")
                                .inner_size(400.0, 140.0)
                                .resizable(false)
                                .maximizable(false)
                                .minimizable(false)
                                .decorations(true)
                                .always_on_top(true)
                                .center()
                                .build();
                            }
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Handle window close event - hide instead of close
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });

                let _ = window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

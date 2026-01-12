// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        FOLDERID_StartMenu, IShellLinkW, SHGetKnownFolderPath, ShellLink, KNOWN_FOLDER_FLAG,
    };

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

    let store: IPropertyStore = shell_link
        .cast()
        .map_err(|e: windows::core::Error| e.to_string())?;
    let prop: PROPVARIANT = APP_USER_MODEL_ID.into();
    unsafe {
        store
            .SetValue(&PKEY_AppUserModel_ID, &prop)
            .map_err(|e: windows::core::Error| e.to_string())?;
        store
            .Commit()
            .map_err(|e: windows::core::Error| e.to_string())?;
    }

    let persist: IPersistFile = shell_link
        .cast()
        .map_err(|e: windows::core::Error| e.to_string())?;
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
fn read_file(path: String) -> Result<String, String> {
    use std::fs;
    fs::read_to_string(&path).map_err(|e| format!("ファイル読み込みエラー: {}", e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    // ディレクトリが存在しない場合は作成
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;
    }

    fs::write(&path, &content).map_err(|e| format!("ファイル書き込みエラー: {}", e))?;
    Ok(format!("保存完了: {}", path))
}

// 自動バックアップ（デフォルト場所に保存）
#[tauri::command]
fn save_backup(content: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    // C:/CalmTodoBackup ディレクトリにバックアップを保存
    let backup_dir = PathBuf::from("C:/CalmTodoBackup");
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("バックアップディレクトリ作成エラー: {}", e))?;

    let backup_path = backup_dir.join("backup.json");
    fs::write(&backup_path, &content).map_err(|e| format!("バックアップ保存エラー: {}", e))?;

    Ok(backup_path.to_string_lossy().to_string())
}

// デフォルト場所からバックアップを読み込み
#[tauri::command]
fn load_backup() -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let backup_path = PathBuf::from("C:/CalmTodoBackup/backup.json");
    fs::read_to_string(&backup_path).map_err(|e| format!("バックアップ読み込みエラー: {}", e))
}

// ダイアログで場所を選んで手動バックアップ保存
#[tauri::command]
async fn save_backup_with_dialog(app: tauri::AppHandle, content: String) -> Result<String, String> {
    use std::fs;
    use tauri_plugin_dialog::DialogExt;

    let filename = format!(
        "calm-todo-backup-{}.json",
        chrono::Local::now().format("%Y-%m-%d-%H%M%S")
    );
    let default_dir = std::path::PathBuf::from("C:/CalmTodoBackup");

    // ディレクトリがなければ作成
    let _ = fs::create_dir_all(&default_dir);

    let mut builder = app.dialog().file().set_file_name(&filename);
    builder = builder.add_filter("JSON", &["json"]);
    builder = builder.set_directory(&default_dir);

    let file_path = builder.blocking_save_file();

    match file_path {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|e| format!("パス変換エラー: {:?}", e))?;
            fs::write(&path, &content).map_err(|e| format!("バックアップ保存エラー: {}", e))?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Err("キャンセルされました".to_string()),
    }
}

// ダイアログで場所を選んでバックアップから復元
#[tauri::command]
async fn load_backup_with_dialog(app: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    use tauri_plugin_dialog::DialogExt;

    let default_dir = std::path::PathBuf::from("C:/CalmTodoBackup");

    let mut builder = app.dialog().file();
    builder = builder.add_filter("JSON", &["json"]);
    if default_dir.exists() {
        builder = builder.set_directory(&default_dir);
    }

    let file_path = builder.blocking_pick_file();

    match file_path {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|e| format!("パス変換エラー: {:?}", e))?;
            fs::read_to_string(&path).map_err(|e| format!("バックアップ読み込みエラー: {}", e))
        }
        None => Err("キャンセルされました".to_string()),
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Calm Todo.", name)
}

// Tavily Web Search API - 詳細検索モード
#[derive(serde::Serialize)]
struct TavilySearchRequest {
    api_key: String,
    query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    search_method: Option<String>,
    search_depth: String,
    max_results: u32,
    include_answer: bool,
    include_raw_content: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    topic: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct TavilySearchResult {
    pub title: String,
    pub url: String,
    pub content: String,
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub raw_content: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct TavilySearchResponse {
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub results: Vec<TavilySearchResult>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum CharClass {
    Latin,
    Hiragana,
    Katakana,
    Kanji,
}

fn optimize_search_query(raw_query: &str) -> (String, String) {
    let trimmed = raw_query.trim();
    if trimmed.is_empty() {
        return (trimmed.to_string(), "original".to_string());
    }

    let base_tokens = split_query_tokens(trimmed);

    let mut seen = Vec::new();
    for token in base_tokens {
        let normalized = token.trim();
        if normalized.is_empty() {
            continue;
        }
        if seen.iter().any(|existing| existing == normalized) {
            continue;
        }
        seen.push(normalized.to_string());
    }

    if seen.is_empty() {
        return (trimmed.to_string(), "original".to_string());
    }

    let method = match seen.len() {
        1 => "focused",
        2 | 3 => "balanced",
        _ => "broad",
    }
    .to_string();

    (seen.join(" "), method)
}

fn split_query_tokens(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut current_class: Option<CharClass> = None;
    let mut chars = query.chars().peekable();

    while let Some(c) = chars.next() {
        if c.is_whitespace() {
            flush_token(&mut tokens, &mut current, &mut current_class);
            continue;
        }

        if let Some(class) = char_class(c) {
            if current_class == Some(class) {
                current.push(c);
            } else {
                flush_token(&mut tokens, &mut current, &mut current_class);
                current.push(c);
                current_class = Some(class);
            }
            continue;
        }

        if current_class == Some(CharClass::Latin) && is_ascii_connector(c) {
            if matches!(c, '+' | '#') {
                current.push(c);
                continue;
            }
            if chars
                .peek()
                .map(|next| is_ascii_or_fullwidth_alnum(*next))
                .unwrap_or(false)
            {
                current.push(c);
                continue;
            }
        }

        flush_token(&mut tokens, &mut current, &mut current_class);
    }

    flush_token(&mut tokens, &mut current, &mut current_class);
    tokens
}

fn flush_token(
    tokens: &mut Vec<String>,
    current: &mut String,
    current_class: &mut Option<CharClass>,
) {
    if !current.is_empty() {
        tokens.push(current.clone());
        current.clear();
    }
    *current_class = None;
}

fn char_class(c: char) -> Option<CharClass> {
    if is_ascii_or_fullwidth_alnum(c) {
        return Some(CharClass::Latin);
    }
    if is_hiragana(c) {
        return Some(CharClass::Hiragana);
    }
    if is_katakana(c) {
        return Some(CharClass::Katakana);
    }
    if is_kanji(c) {
        return Some(CharClass::Kanji);
    }
    None
}

fn is_ascii_or_fullwidth_alnum(c: char) -> bool {
    c.is_ascii_alphanumeric()
        || matches!(c, '\u{FF10}'..='\u{FF19}' | '\u{FF21}'..='\u{FF3A}' | '\u{FF41}'..='\u{FF5A}')
}

fn is_ascii_connector(c: char) -> bool {
    matches!(c, '+' | '#' | '-' | '_' | '.' | ':' | '/' | '@')
}

fn is_hiragana(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{309F}')
}

fn is_katakana(c: char) -> bool {
    matches!(c, '\u{30A0}'..='\u{30FF}' | '\u{31F0}'..='\u{31FF}')
}

fn is_kanji(c: char) -> bool {
    matches!(
        c,
        '\u{3005}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
    )
}

#[tauri::command]
async fn tavily_search(api_key: String, query: String) -> Result<TavilySearchResponse, String> {
    let client = reqwest::Client::new();

    let (optimized_query, search_method) = optimize_search_query(&query);
    println!(
        "[Tavily Backend] Optimized query: '{}' (method: {})",
        optimized_query, search_method
    );

    // 詳細検索モード: advanced + より多くの結果 + raw_content取得
    let request = TavilySearchRequest {
        api_key,
        query: optimized_query,
        search_method: Some(search_method),
        search_depth: "advanced".to_string(), // 深い検索
        max_results: 15,                      // 15件取得
        include_answer: true,                 // AI要約を含む
        include_raw_content: true,            // ページの生コンテンツも取得
        topic: Some("general".to_string()),
    };

    println!("[Tavily Backend] 検索リクエスト送信: {:?}", request.query);

    let response = client
        .post("https://api.tavily.com/search")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Tavilyリクエストエラー: {}", e))?;

    println!(
        "[Tavily Backend] レスポンスステータス: {}",
        response.status()
    );

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        println!("[Tavily Backend] エラー: {}", error_text);
        return Err(format!("Tavily APIエラー: {}", error_text));
    }

    let result: TavilySearchResponse = response
        .json()
        .await
        .map_err(|e| format!("レスポンス解析エラー: {}", e))?;

    println!(
        "[Tavily Backend] 検索成功: {} 件の結果, answer: {}",
        result.results.len(),
        result.answer.as_ref().map(|a| a.len()).unwrap_or(0)
    );

    Ok(result)
}

#[tauri::command]
fn show_notification(title: String, body: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let aumid_result = set_current_process_app_user_model_id();

        let send = |app_id: &str| Toast::new(app_id).title(&title).text1(&body).show();

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
async fn save_export_file(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    use std::fs;
    use tauri_plugin_dialog::DialogExt;

    // Get default path (Documents folder)
    let default_path = dirs::document_dir().map(|p| p.join(&filename));

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
            let path = file_path
                .into_path()
                .map_err(|e| format!("パス変換エラー: {:?}", e))?;
            // Write file
            fs::write(&path, &content).map_err(|e| format!("ファイル保存エラー: {}", e))?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Err("キャンセルされました".to_string()),
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, show and focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            greet,
            read_file,
            write_file,
            save_backup,
            load_backup,
            save_backup_with_dialog,
            load_backup_with_dialog,
            show_notification,
            save_export_file,
            tavily_search
        ])
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
                                    WebviewUrl::App("quick-add.html".into()),
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

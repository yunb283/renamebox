use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind};

fn file_path_to_string(fp: FilePath) -> String {
    match fp {
        FilePath::Path(p) => p.to_string_lossy().into_owned(),
        FilePath::Url(u) => u
            .to_file_path()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| u.to_string()),
    }
}

#[derive(Serialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub mtime: u64,
    pub is_dir: bool,
}

fn to_file_info(path: &Path) -> Option<FileInfo> {
    let md = fs::metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Some(FileInfo {
        path: path.to_string_lossy().into_owned(),
        name,
        ext,
        size: md.len(),
        mtime,
        is_dir: md.is_dir(),
    })
}

/// 拖拽导入时前端直接给出路径列表，这里补齐元数据（不存在的项跳过）
#[tauri::command]
async fn stat_paths(paths: Vec<String>) -> Result<Vec<FileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(paths
            .iter()
            .map(PathBuf::from)
            .filter_map(|p| to_file_info(&p))
            .collect())
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

#[tauri::command]
async fn pick_files(app: tauri::AppHandle) -> Option<Vec<String>> {
    let (tx, rx) = mpsc::channel();
    app.dialog()
        .file()
        .set_title("选择文件")
        .add_filter("所有文件", &["*"])
        .pick_files(move |paths| {
            let _ =
                tx.send(paths.map(|v| v.into_iter().map(file_path_to_string).collect()));
        });
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    app.dialog()
        .file()
        .set_title("选择文件夹")
        .pick_folder(move |path| {
            let _ = tx.send(path.map(file_path_to_string));
        });
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()
}

/// 列出一个目录下的直接子项（文件；recursive 时连同子目录内容一并展开）
#[tauri::command]
async fn list_dir(dir: String, recursive: bool) -> Result<Vec<FileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut stack = vec![PathBuf::from(&dir)];
        let mut visited = 0usize;
        while let Some(d) = stack.pop() {
            let Ok(entries) = fs::read_dir(&d) else { continue };
            for entry in entries.flatten() {
                let p = entry.path();
                let Ok(md) = entry.metadata() else { continue };
                visited += 1;
                if visited > 200_000 {
                    return Err("目录条目过多，已中止枚举".to_string());
                }
                if md.is_dir() {
                    if recursive {
                        stack.push(p);
                    }
                } else if let Some(info) = to_file_info(&p) {
                    out.push(info);
                }
            }
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RenameOp {
    pub old: String,
    pub new: String,
}

/// 一批改名（或撤销）要么全部成功，要么退回原样。
/// 源名与目标名互相占用（a↔b 互换）时走两阶段：先全部挪进临时名，再落最终名。
fn apply_ops(ops: &[RenameOp]) -> Result<(), String> {
    use std::collections::HashSet;

    let moves: Vec<&RenameOp> = ops.iter().filter(|o| o.old != o.new).collect();
    if moves.is_empty() {
        return Ok(());
    }
    let sources: HashSet<String> = moves.iter().map(|o| o.old.to_lowercase()).collect();
    let mut targets: HashSet<String> = HashSet::new();
    for o in &moves {
        if !Path::new(&o.old).exists() {
            return Err(format!("源文件已不存在：{}", o.old));
        }
        let key = o.new.to_lowercase();
        if !targets.insert(key.clone()) {
            return Err(format!("目标名重复：{}", o.new));
        }
        // 目标位被一个「本次不动」的文件占着，怎么排顺序都成功不了
        if Path::new(&o.new).exists() && !sources.contains(&key) {
            return Err(format!("目标已存在：{}", o.new));
        }
    }
    // 自己的目标位是自己的源名（纯改大小写）不算占用，只有撞上别的行才需要两阶段
    let chained = moves.iter().any(|o| {
        let key = o.new.to_lowercase();
        moves.iter().any(|p| !std::ptr::eq(*p, *o) && p.old.to_lowercase() == key)
    });

    // 文件夹支持：父子目录同时改名时，先动子项再动父目录，避免父目录先改名后子项的 old 路径消失
    let mut moves_sorted: Vec<&RenameOp> = moves.clone();
    moves_sorted.sort_by(|a, b| {
        let ad = a.old.matches('/').count() + a.old.matches('\\').count();
        let bd = b.old.matches('/').count() + b.old.matches('\\').count();
        bd.cmp(&ad)
    });
    let moves = moves_sorted;

    // (当前位置, 原始位置)，出错时按这张表往回退
    let mut at: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(moves.len());

    if !chained {
        for o in &moves {
            match fs::rename(&o.old, &o.new) {
                Ok(()) => at.push((PathBuf::from(&o.new), PathBuf::from(&o.old))),
                Err(e) => return Err(abort(at, format!("改名失败 {}：{e}", o.old))),
            }
        }
        return Ok(());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    for (i, o) in moves.iter().enumerate() {
        let src = Path::new(&o.old);
        let parent = src.parent().ok_or_else(|| format!("无法定位目录：{}", o.old))?;
        let temp = parent.join(format!(".rbtmp-{}-{}", stamp, i));
        match fs::rename(src, &temp) {
            Ok(()) => at.push((temp, PathBuf::from(&o.old))),
            Err(e) => return Err(abort(at, format!("改名失败 {}：{e}", o.old))),
        }
    }
    for (i, o) in moves.iter().enumerate() {
        let target = PathBuf::from(&o.new);
        match fs::rename(&at[i].0, &target) {
            Ok(()) => at[i].0 = target,
            Err(e) => return Err(abort(at, format!("改名失败 {}：{e}", o.new))),
        }
    }
    Ok(())
}

/// 回退一批已动的文件，并把退不掉的（多半是外部程序占用了原位）拼进错误信息
fn abort(mut at: Vec<(PathBuf, PathBuf)>, err: String) -> String {
    let mut stuck: Vec<PathBuf> = Vec::new();
    while !at.is_empty() {
        let mut progress = false;
        let mut next = Vec::with_capacity(at.len());
        for (now, origin) in at.drain(..) {
            if fs::rename(&now, &origin).is_ok() {
                progress = true;
            } else {
                next.push((now, origin));
            }
        }
        at = next;
        if !progress {
            stuck = at.into_iter().map(|(now, _)| now).collect();
            break;
        }
    }
    if stuck.is_empty() {
        format!("{err}（本次改动已全部退回）")
    } else {
        let names: Vec<String> = stuck.iter().map(|p| p.display().to_string()).collect();
        format!("{err}（已退回其余改动，以下中间文件需手动处理：{}）", names.join("、"))
    }
}

/// 批量改名，返回可用于撤销的逆操作列表
#[tauri::command]
async fn rename_batch(ops: Vec<RenameOp>) -> Result<Vec<RenameOp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_ops(&ops)?;
        Ok(ops
            .iter()
            .filter(|o| o.old != o.new)
            .map(|o| RenameOp {
                old: o.new.clone(),
                new: o.old.clone(),
            })
            .collect())
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

/// 撤销一批改名（传入 rename_batch 返回的逆操作列表）
#[tauri::command]
async fn restore_batch(ops: Vec<RenameOp>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apply_ops(&ops))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

/// 原生确认对话框：执行改名前的最后一道闸
#[tauri::command]
async fn ask_confirm(app: tauri::AppHandle, message: String) -> Result<bool, String> {
    let (tx, rx) = mpsc::channel();
    app.dialog()
        .message(&message)
        .title("确认执行改名")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |ok| {
            let _ = tx.send(ok);
        });
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败：{e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

/// 去掉系统标题栏后，Win11 不再自动加圆角，这里显式打开 DWM 圆角
#[cfg(windows)]
fn enable_round_corners(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWCP_ROUND, DWMWA_WINDOW_CORNER_PREFERENCE,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let preference: u32 = DWMWCP_ROUND as u32;
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0 as isize,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &preference as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("renamebox-test-{tag}-{nanos}"));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn touch(&self, name: &str) -> PathBuf {
            let p = self.0.join(name);
            fs::write(&p, name).unwrap();
            p
        }
        fn names(&self) -> Vec<String> {
            let mut v: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            v.sort();
            v
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn mv(old: &PathBuf, new: &PathBuf) -> RenameOp {
        RenameOp {
            old: old.to_string_lossy().into_owned(),
            new: new.to_string_lossy().into_owned(),
        }
    }

    fn apply(ops: Vec<RenameOp>) -> Result<Vec<RenameOp>, String> {
        tauri::async_runtime::block_on(rename_batch(ops))
    }

    fn undo(ops: Vec<RenameOp>) -> Result<(), String> {
        tauri::async_runtime::block_on(restore_batch(ops))
    }

    #[test]
    fn json_shape_matches_frontend() {
        // 前端 send 的是 { old, new } 数组，字段名一改就静默失效
        let ops: Vec<RenameOp> =
            serde_json::from_str(r#"[{"old":"C:\\a\\x.txt","new":"C:\\a\\y.txt"}]"#).unwrap();
        assert_eq!(ops[0].old, "C:\\a\\x.txt");
        assert_eq!(ops[0].new, "C:\\a\\y.txt");
        // 撤销时前端把返回的列表原样传回来，序列化出去的键名必须还是 old/new
        let back = serde_json::to_string(&ops).unwrap();
        assert_eq!(back, r#"[{"old":"C:\\a\\x.txt","new":"C:\\a\\y.txt"}]"#);
        let info = serde_json::to_value(FileInfo {
            path: "p".into(),
            name: "n".into(),
            ext: "png".into(),
            size: 1,
            mtime: 2,
            is_dir: false,
        })
        .unwrap();
        assert!(info.get("is_dir").is_some(), "前端按 is_dir 读目录标记");
    }

    #[test]
    fn renames_and_undoes() {
        let s = Sandbox::new("basic");
        let a = s.touch("a.txt");
        let b = s.touch("b.txt");
        let rev = apply(vec![
            mv(&a, &s.0.join("1_a.txt")),
            mv(&b, &s.0.join("1_b.txt")),
        ])
        .unwrap();
        assert_eq!(s.names(), ["1_a.txt", "1_b.txt"]);
        assert_eq!(rev.len(), 2);
        undo(rev).unwrap();
        assert_eq!(s.names(), ["a.txt", "b.txt"]);
    }

    #[test]
    fn swap_round_trip() {
        let s = Sandbox::new("swap");
        let a = s.touch("a.txt");
        let b = s.touch("b.txt");
        let rev = apply(vec![mv(&a, &b.clone()), mv(&b, &a.clone())]).unwrap();
        assert_eq!(fs::read_to_string(&a).unwrap(), "b.txt");
        assert_eq!(fs::read_to_string(&b).unwrap(), "a.txt");
        assert_eq!(s.names(), ["a.txt", "b.txt"]);
        undo(rev).unwrap();
        assert_eq!(fs::read_to_string(&a).unwrap(), "a.txt");
        assert_eq!(fs::read_to_string(&b).unwrap(), "b.txt");
    }

    #[test]
    fn three_way_rotation() {
        let s = Sandbox::new("rotate");
        let a = s.touch("a");
        let b = s.touch("b");
        let c = s.touch("c");
        apply(vec![mv(&a, &b.clone()), mv(&b, &c.clone()), mv(&c, &a.clone())]).unwrap();
        assert_eq!(fs::read_to_string(&a).unwrap(), "c");
        assert_eq!(fs::read_to_string(&b).unwrap(), "a");
        assert_eq!(fs::read_to_string(&c).unwrap(), "b");
        assert_eq!(s.names(), ["a", "b", "c"]);
    }

    #[test]
    fn rejects_duplicate_target() {
        let s = Sandbox::new("dup");
        let a = s.touch("a.txt");
        let b = s.touch("b.txt");
        let to = s.0.join("same.txt");
        let err = apply(vec![mv(&a, &to), mv(&b, &to)]).unwrap_err();
        assert!(err.contains("目标名重复"), "{err}");
        assert_eq!(s.names(), ["a.txt", "b.txt"]);
    }

    #[test]
    fn rejects_target_held_by_untouched_file() {
        let s = Sandbox::new("held");
        let a = s.touch("a.txt");
        s.touch("taken.txt");
        let err = apply(vec![mv(&a, &s.0.join("taken.txt"))]).unwrap_err();
        assert!(err.contains("目标已存在"), "{err}");
        assert_eq!(s.names(), ["a.txt", "taken.txt"]);
    }

    #[test]
    fn rejects_missing_source_without_touching_others() {
        let s = Sandbox::new("missing");
        let a = s.touch("a.txt");
        let gone = s.0.join("gone.txt");
        let err = apply(vec![mv(&a, &s.0.join("x.txt")), mv(&gone, &s.0.join("y.txt"))]).unwrap_err();
        assert!(err.contains("源文件已不存在"), "{err}");
        // 预检在动手之前，所以一个都不该被改
        assert_eq!(s.names(), ["a.txt"]);
    }

    #[test]
    fn case_only_rename() {
        let s = Sandbox::new("case");
        let a = s.touch("Readme.TXT");
        apply(vec![mv(&a, &s.0.join("readme.txt"))]).unwrap();
        assert_eq!(s.names(), ["readme.txt"]);
    }

    #[test]
    fn leaves_no_temp_files_behind() {
        let s = Sandbox::new("temps");
        let a = s.touch("a");
        let b = s.touch("b");
        apply(vec![mv(&a, &b.clone()), mv(&b, &a.clone())]).unwrap();
        assert!(!s.names().iter().any(|n| n.starts_with(".rbtmp-")));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(windows)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    enable_round_corners(&window);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            stat_paths,
            pick_files,
            pick_folder,
            list_dir,
            rename_batch,
            restore_batch,
            ask_confirm,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

//! downloads.rs
//! yt-dlp-backed download queue for the personal YTM Light client.

use crate::{platform, settings};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Url;

const MAX_HISTORY: usize = 200;
const MAX_ERROR_CHARS: usize = 800;
const MAX_URL_CHARS: usize = 2048;
const MAX_TITLE_CHARS: usize = 256;
const MAX_PATH_CHARS: usize = 1024;
const STATUS_QUEUED: &str = "queued";
const STATUS_RUNNING: &str = "running";
const STATUS_COMPLETED: &str = "completed";
const STATUS_FAILED: &str = "failed";
const STATUS_CANCELED: &str = "canceled";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone)]
pub struct DownloadManager {
    inner: Arc<Inner>,
}

struct Inner {
    settings: settings::SharedSettings,
    state: Mutex<DownloadState>,
    active_workers: AtomicUsize,
    shutdown: AtomicBool,
}

struct DownloadState {
    jobs: Vec<DownloadJob>,
    queue: VecDeque<u64>,
    next_id: u64,
    running: HashMap<u64, u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct DownloadJob {
    pub id: u64,
    pub url: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub thumbnail: String,
    pub format: String,
    pub bitrate: String,
    pub sponsorblock: String,
    pub sponsorblock_categories: String,
    pub playlist: bool,
    pub status: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub filepath: String,
    pub error: String,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Default for DownloadJob {
    fn default() -> Self {
        Self {
            id: 0,
            url: String::new(),
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            thumbnail: String::new(),
            format: "best".to_string(),
            bitrate: "320".to_string(),
            sponsorblock: "off".to_string(),
            sponsorblock_categories: settings::DEFAULT_SPONSORBLOCK_CATEGORIES.to_string(),
            playlist: false,
            status: STATUS_QUEUED.to_string(),
            progress: 0.0,
            speed: String::new(),
            eta: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            filepath: String::new(),
            error: String::new(),
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct DownloadOptions {
    title: String,
    artist: String,
    album: String,
    thumbnail: String,
    format: Option<String>,
    bitrate: Option<String>,
    sponsorblock: Option<String>,
    sponsorblock_categories: Option<String>,
    playlist: bool,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default)]
struct DownloadStore {
    jobs: Vec<DownloadJob>,
}

impl DownloadManager {
    pub fn new(settings: settings::SharedSettings) -> Self {
        let mut state = DownloadState {
            jobs: Vec::new(),
            queue: VecDeque::new(),
            next_id: 1,
            running: HashMap::new(),
        };
        if let Some(store) = load_store() {
            state.next_id = store.jobs.iter().map(|job| job.id).max().unwrap_or(0) + 1;
            state.jobs = store
                .jobs
                .into_iter()
                .map(|mut job| {
                    if matches!(job.status.as_str(), STATUS_QUEUED | STATUS_RUNNING) {
                        job.status = STATUS_FAILED.to_string();
                        job.error = "Прервано перезапуском приложения".to_string();
                        job.speed.clear();
                        job.eta.clear();
                        job.updated_at = now();
                    }
                    job
                })
                .collect();
        }
        Self {
            inner: Arc::new(Inner {
                settings,
                state: Mutex::new(state),
                active_workers: AtomicUsize::new(0),
                shutdown: AtomicBool::new(false),
            }),
        }
    }

    pub fn start(&self, url: &str, body: Option<&str>) -> Result<DownloadJob, String> {
        let url = validate_download_url(url)?;
        let options = parse_options(body)?;
        let snapshot = settings::snapshot(&self.inner.settings);
        let format = normalize_choice(
            options
                .format
                .as_deref()
                .unwrap_or(&snapshot.download_format),
            &["best", "m4a", "mp3", "opus", "flac"],
            "best",
        );
        let bitrate = normalize_choice(
            options
                .bitrate
                .as_deref()
                .unwrap_or(&snapshot.download_bitrate),
            &["128", "192", "256", "320"],
            "320",
        );
        let sponsorblock = normalize_choice(
            options
                .sponsorblock
                .as_deref()
                .unwrap_or(&snapshot.download_sponsorblock),
            &["off", "mark", "remove"],
            "off",
        );
        let categories = options
            .sponsorblock_categories
            .as_deref()
            .unwrap_or(&snapshot.download_sponsorblock_categories);
        let categories = sanitize_categories(categories);
        let title = bounded(options.title, MAX_TITLE_CHARS);
        let artist = bounded(options.artist, MAX_TITLE_CHARS);
        let album = bounded(options.album, MAX_TITLE_CHARS);
        let thumbnail = bounded(options.thumbnail, MAX_URL_CHARS);
        let now = now();

        let job = {
            let mut state = self.lock_state()?;
            // Clicking download twice (or starting the same track from the
            // player bar and the queue) used to spawn several yt-dlp processes
            // writing the same .part/.webp/.temp files. Windows then reports
            // "Invalid argument" (Errno 22) for the losing process.
            if let Some(existing) = state.jobs.iter().find(|job| {
                job.url == url && matches!(job.status.as_str(), STATUS_QUEUED | STATUS_RUNNING)
            }) {
                return Ok(existing.clone());
            }
            let id = state.next_id;
            state.next_id += 1;
            let job = DownloadJob {
                id,
                url,
                title,
                artist,
                album,
                thumbnail,
                format,
                bitrate,
                sponsorblock,
                sponsorblock_categories: categories,
                playlist: options.playlist,
                status: STATUS_QUEUED.to_string(),
                created_at: now,
                updated_at: now,
                ..DownloadJob::default()
            };
            state.jobs.push(job.clone());
            state.queue.push_back(id);
            trim_history(&mut state.jobs);
            job
        };
        self.save();
        self.ensure_workers();
        Ok(job)
    }

    pub fn list(&self) -> Result<Vec<DownloadJob>, String> {
        let state = self.lock_state()?;
        Ok(state.jobs.clone())
    }

    pub fn cancel(&self, id: u64) -> Result<(), String> {
        let pid = {
            let mut state = self.lock_state()?;
            let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) else {
                return Err("Загрузка не найдена".to_string());
            };
            if !matches!(job.status.as_str(), STATUS_QUEUED | STATUS_RUNNING) {
                return Ok(());
            }
            job.status = STATUS_CANCELED.to_string();
            job.error = "Отменено".to_string();
            job.speed.clear();
            job.eta.clear();
            job.updated_at = now();
            state.queue.retain(|queued| *queued != id);
            state.running.get(&id).copied()
        };
        if let Some(pid) = pid {
            kill_process_tree(pid);
            // Wait briefly for the worker to observe the kill and release the
            // job. Without this, an immediate retry can race with the old
            // process exit and have its status overwritten.
            for _ in 0..60 {
                let still_running = self
                    .inner
                    .state
                    .lock()
                    .map(|state| state.running.contains_key(&id))
                    .unwrap_or(false);
                if !still_running {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
        self.save();
        Ok(())
    }

    pub fn retry(&self, id: u64) -> Result<DownloadJob, String> {
        let job = {
            let mut state = self.lock_state()?;
            if state.running.contains_key(&id) {
                return Err(
                    "Предыдущая попытка ещё останавливается; повторите через мгновение".to_string(),
                );
            }
            let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) else {
                return Err("Загрузка не найдена".to_string());
            };
            if !matches!(job.status.as_str(), STATUS_FAILED | STATUS_CANCELED) {
                return Err("Повторить можно только неудачные или отменённые загрузки".to_string());
            }
            job.status = STATUS_QUEUED.to_string();
            job.progress = 0.0;
            job.speed.clear();
            job.eta.clear();
            job.downloaded_bytes = 0;
            job.total_bytes = 0;
            job.filepath.clear();
            job.error.clear();
            job.updated_at = now();
            let job = job.clone();
            state.queue.push_back(id);
            job
        };
        self.save();
        self.ensure_workers();
        Ok(job)
    }

    pub fn remove(&self, id: u64) -> Result<(), String> {
        let mut state = self.lock_state()?;
        let Some(job) = state.jobs.iter().find(|job| job.id == id) else {
            return Err("Загрузка не найдена".to_string());
        };
        if matches!(job.status.as_str(), STATUS_QUEUED | STATUS_RUNNING) {
            return Err("Сначала отмените загрузку, затем удалите её".to_string());
        }
        state.jobs.retain(|job| job.id != id);
        state.queue.retain(|queued| *queued != id);
        drop(state);
        self.save();
        Ok(())
    }

    pub fn clear_completed(&self) -> Result<(), String> {
        let mut state = self.lock_state()?;
        state
            .jobs
            .retain(|job| matches!(job.status.as_str(), STATUS_QUEUED | STATUS_RUNNING));
        drop(state);
        self.save();
        Ok(())
    }

    pub fn open_folder(&self, id: Option<u64>) -> Result<(), String> {
        let fallback = default_download_dir(&settings::snapshot(&self.inner.settings));
        let path = if let Some(id) = id {
            let state = self.lock_state()?;
            let Some(job) = state.jobs.iter().find(|job| job.id == id) else {
                return Err("Загрузка не найдена".to_string());
            };
            if job.filepath.is_empty() {
                fallback
            } else {
                PathBuf::from(&job.filepath)
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or(fallback)
            }
        } else {
            fallback
        };
        if path.as_os_str().len() > MAX_PATH_CHARS {
            return Err("Слишком длинный путь к папке загрузок".to_string());
        }
        let _ = fs::create_dir_all(&path);
        if platform::open_path(&path) {
            Ok(())
        } else {
            Err("Не удалось открыть папку загрузок".to_string())
        }
    }

    pub fn shutdown(&self) {
        self.inner.shutdown.store(true, Ordering::SeqCst);
        let pids = self
            .inner
            .state
            .lock()
            .map(|state| state.running.values().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        for pid in pids {
            kill_process_tree(pid);
        }
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, DownloadState>, String> {
        self.inner
            .state
            .lock()
            .map_err(|_| "Состояние загрузок недоступно".to_string())
    }

    #[cfg(not(test))]
    fn save(&self) {
        let jobs = match self.inner.state.lock() {
            Ok(state) => state.jobs.clone(),
            Err(_) => return,
        };
        let Some(dir) = settings::data_dir() else {
            return;
        };
        let Ok(json) = serde_json::to_string_pretty(&DownloadStore { jobs }) else {
            return;
        };
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("downloads.json"), json);
    }

    #[cfg(test)]
    fn save(&self) {}

    fn ensure_workers(&self) {
        let concurrency = settings::snapshot(&self.inner.settings)
            .download_concurrency
            .clamp(1, 3) as usize;
        loop {
            let active = self.inner.active_workers.load(Ordering::SeqCst);
            if active >= concurrency {
                return;
            }
            let pending = self
                .inner
                .state
                .lock()
                .map(|state| state.queue.len())
                .unwrap_or(0);
            if pending <= active {
                return;
            }
            if self
                .inner
                .active_workers
                .compare_exchange(active, active + 1, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                let manager = self.clone();
                thread::spawn(move || manager.worker_loop());
            }
        }
    }

    fn worker_loop(&self) {
        loop {
            if self.inner.shutdown.load(Ordering::SeqCst) {
                break;
            }
            let id = {
                let Ok(mut state) = self.inner.state.lock() else {
                    break;
                };
                match state.queue.pop_front() {
                    Some(id) => id,
                    None => {
                        self.inner.active_workers.fetch_sub(1, Ordering::SeqCst);
                        return;
                    }
                }
            };
            self.run_job(id);
            self.ensure_workers();
        }
        self.inner.active_workers.fetch_sub(1, Ordering::SeqCst);
    }

    fn run_job(&self, id: u64) {
        let snapshot = settings::snapshot(&self.inner.settings);
        let job = {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) else {
                return;
            };
            if job.status != STATUS_QUEUED {
                return;
            }
            job.status = STATUS_RUNNING.to_string();
            job.progress = 0.0;
            job.speed.clear();
            job.eta.clear();
            job.error.clear();
            job.updated_at = now();
            job.clone()
        };
        self.save();

        let needs_ffmpeg = job.format != "best"
            || job.sponsorblock != "off"
            || snapshot.download_embed_metadata
            || snapshot.download_embed_thumbnail;
        if needs_ffmpeg && !ffmpeg_available() {
            self.finish_job(
                id,
                STATUS_FAILED,
                "ffmpeg или ffprobe не найден. Переустановите YTM Light или положите ffmpeg.exe и ffprobe.exe рядом с приложением.",
            );
            return;
        }

        let Some(ytdlp) = ytdlp_path() else {
            self.finish_job(
                id,
                STATUS_FAILED,
                "yt-dlp не найден. Переустановите YTM Light или положите yt-dlp.exe рядом с приложением.",
            );
            return;
        };

        let args = build_args(&job, &snapshot);
        let download_dir = default_download_dir(&snapshot);
        debug_log(&format!(
            "RUN job={id} cwd={} args={args:?}",
            download_dir.display()
        ));
        if let Err(error) = fs::create_dir_all(&download_dir) {
            self.finish_job(
                id,
                STATUS_FAILED,
                &format!("Не удалось создать папку загрузок: {error}"),
            );
            return;
        }

        let mut command = Command::new(&ytdlp);
        command
            .args(&args)
            .current_dir(&download_dir)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.finish_job(
                    id,
                    STATUS_FAILED,
                    &format!("Не удалось запустить yt-dlp: {error}"),
                );
                return;
            }
        };
        let pid = child.id();
        if let Ok(mut state) = self.inner.state.lock() {
            state.running.insert(id, pid);
        }

        if let Some(stdout) = child.stdout.take() {
            let manager = self.clone();
            thread::spawn(move || {
                pump_lines(stdout, |line| manager.handle_line(id, line));
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let manager = self.clone();
            thread::spawn(move || {
                pump_lines(stderr, |line| manager.handle_line(id, line));
            });
        }

        let status = child.wait();
        if let Ok(mut state) = self.inner.state.lock() {
            state.running.remove(&id);
        }

        let canceled = self
            .inner
            .state
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .jobs
                    .iter()
                    .find(|job| job.id == id)
                    .map(|job| job.status == STATUS_CANCELED)
            })
            .unwrap_or(false);
        if canceled {
            return;
        }

        match status {
            Ok(status) if status.success() => {
                self.finish_job(id, STATUS_COMPLETED, "");
            }
            Ok(status) => {
                let message = self
                    .inner
                    .state
                    .lock()
                    .ok()
                    .and_then(|state| {
                        state
                            .jobs
                            .iter()
                            .find(|job| job.id == id)
                            .map(|job| job.error.clone())
                    })
                    .filter(|error| !error.is_empty())
                    .unwrap_or_else(|| format!("yt-dlp завершился с кодом {status}"));
                self.finish_job(id, STATUS_FAILED, &message);
            }
            Err(error) => {
                self.finish_job(id, STATUS_FAILED, &format!("Сбой yt-dlp: {error}"));
            }
        }
    }

    fn handle_line(&self, id: u64, line: &str) {
        debug_log(&format!("LINE job={id} {line}"));
        if let Some(payload) = line.strip_prefix("YTM_PROGRESS:") {
            let mut parts = payload.split('|');
            let percent = parts
                .next()
                .unwrap_or("")
                .trim()
                .trim_end_matches('%')
                .parse::<f64>()
                .unwrap_or(0.0)
                .clamp(0.0, 100.0);
            let speed = bounded(parts.next().unwrap_or("").to_string(), 32);
            let eta = bounded(parts.next().unwrap_or("").to_string(), 32);
            let downloaded = parts
                .next()
                .unwrap_or("")
                .trim()
                .parse::<u64>()
                .unwrap_or(0);
            let total = parts
                .next()
                .unwrap_or("")
                .trim()
                .parse::<u64>()
                .unwrap_or(0);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    if job.status == STATUS_RUNNING {
                        job.progress = percent;
                        job.speed = speed;
                        job.eta = eta;
                        job.downloaded_bytes = downloaded;
                        job.total_bytes = total;
                        job.updated_at = now();
                    }
                }
            }
            return;
        }

        if let Some(payload) = line.strip_prefix("YTM_FILE:") {
            let filepath = bounded(payload.trim().to_string(), MAX_PATH_CHARS);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    job.filepath = filepath;
                    job.updated_at = now();
                }
            }
            return;
        }

        let meta_value = |payload: &str| {
            let value = payload.trim();
            if value == "NA" {
                String::new()
            } else {
                value.to_string()
            }
        };

        if let Some(payload) = line.strip_prefix("YTM_META_TITLE:") {
            let title = bounded(meta_value(payload), MAX_TITLE_CHARS);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    if !job.playlist && !title.is_empty() {
                        job.title = title;
                    }
                    job.updated_at = now();
                }
            }
            return;
        }

        if let Some(payload) = line.strip_prefix("YTM_META_ARTIST:") {
            let artist = bounded(meta_value(payload), MAX_TITLE_CHARS);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    if !job.playlist && !artist.is_empty() {
                        job.artist = artist;
                    }
                    job.updated_at = now();
                }
            }
            return;
        }

        if let Some(payload) = line.strip_prefix("YTM_META_ALBUM:") {
            let album = bounded(meta_value(payload), MAX_TITLE_CHARS);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    if !job.playlist && !album.is_empty() {
                        job.album = album;
                    }
                    job.updated_at = now();
                }
            }
            return;
        }

        if let Some(payload) = line.strip_prefix("YTM_META_THUMB:") {
            let thumbnail = bounded(meta_value(payload), MAX_URL_CHARS);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    if !job.playlist && !thumbnail.is_empty() {
                        job.thumbnail = thumbnail;
                    }
                    job.updated_at = now();
                }
            }
            return;
        }

        if let Some(payload) = line.strip_prefix("YTM_META_PLAYLIST:") {
            let playlist_title = bounded(meta_value(payload), MAX_TITLE_CHARS);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    if job.playlist && !playlist_title.is_empty() {
                        job.title = playlist_title;
                    }
                    job.updated_at = now();
                }
            }
            return;
        }

        let filepath = line
            .strip_prefix("[download] Destination: ")
            .or_else(|| line.strip_prefix("[ExtractAudio] Destination: "))
            .or_else(|| {
                line.strip_prefix("[download] ")
                    .and_then(|value| value.split(" has already been downloaded").next())
                    .filter(|value| value.contains('.'))
            });
        if let Some(filepath) = filepath {
            let filepath = bounded(filepath.trim().to_string(), MAX_PATH_CHARS);
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    job.filepath = filepath;
                    job.updated_at = now();
                }
            }
            return;
        }

        if line.starts_with("ERROR:") || line.contains("ERROR:") {
            if let Ok(mut state) = self.inner.state.lock() {
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                    if !job.error.is_empty() {
                        job.error.push('\n');
                    }
                    job.error.push_str(line.trim());
                    if job.error.len() > MAX_ERROR_CHARS {
                        let mut end = MAX_ERROR_CHARS;
                        while end > 0 && !job.error.is_char_boundary(end) {
                            end -= 1;
                        }
                        job.error.truncate(end);
                    }
                    job.updated_at = now();
                }
            }
        }
    }

    fn finish_job(&self, id: u64, status: &str, error: &str) {
        if let Ok(mut state) = self.inner.state.lock() {
            if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                if job.status == STATUS_CANCELED {
                    return;
                }
                job.status = status.to_string();
                job.progress = if status == STATUS_COMPLETED {
                    100.0
                } else {
                    job.progress
                };
                job.speed.clear();
                job.eta.clear();
                if status == STATUS_COMPLETED {
                    job.error.clear();
                } else if !error.is_empty() {
                    job.error = bounded(error.to_string(), MAX_ERROR_CHARS);
                }
                job.updated_at = now();
            }
        }
        self.save();
    }
}

#[cfg(not(test))]
fn load_store() -> Option<DownloadStore> {
    let path = settings::data_dir()?.join("downloads.json");
    let value = fs::read_to_string(path).ok()?;
    serde_json::from_str(&value).ok()
}

#[cfg(test)]
fn load_store() -> Option<DownloadStore> {
    None
}

fn parse_options(body: Option<&str>) -> Result<DownloadOptions, String> {
    let Some(body) = body.filter(|body| !body.trim().is_empty()) else {
        return Ok(DownloadOptions::default());
    };
    serde_json::from_str(body).map_err(|error| format!("Некорректные параметры загрузки: {error}"))
}

fn validate_download_url(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > MAX_URL_CHARS {
        return Err("Некорректная ссылка для загрузки".to_string());
    }
    let url = Url::parse(raw).map_err(|_| "Некорректная ссылка для загрузки".to_string())?;
    if url.scheme() != "https" {
        return Err("Для загрузки нужна HTTPS-ссылка YouTube".to_string());
    }
    let host = url.host_str().unwrap_or_default();
    if !matches!(
        host,
        "music.youtube.com" | "www.youtube.com" | "youtube.com" | "m.youtube.com" | "youtu.be"
    ) {
        return Err("Можно скачивать только ссылки YouTube".to_string());
    }
    let path = url.path();
    let supported = if host == "youtu.be" {
        path.len() > 1
    } else if path == "/watch" {
        url.query_pairs().any(|(key, _)| key == "v")
    } else if path == "/playlist" {
        url.query_pairs().any(|(key, _)| key == "list")
    } else {
        path.starts_with("/shorts/")
    };
    if !supported {
        return Err("Неподдерживаемая ссылка YouTube".to_string());
    }
    Ok(url.to_string())
}

fn normalize_choice(value: &str, allowed: &[&str], fallback: &str) -> String {
    let value = value.trim();
    if allowed.contains(&value) {
        value.to_string()
    } else {
        fallback.to_string()
    }
}

fn sanitize_categories(value: &str) -> String {
    let mut categories = Vec::new();
    for item in value.split(',') {
        let item = item.trim();
        if !settings::DEFAULT_SPONSORBLOCK_CATEGORIES
            .split(',')
            .any(|allowed| allowed == item)
            && !matches!(item, "preview" | "filler")
        {
            continue;
        }
        if !categories.contains(&item) {
            categories.push(item);
        }
    }
    if categories.is_empty() {
        settings::DEFAULT_SPONSORBLOCK_CATEGORIES.to_string()
    } else {
        categories.join(",")
    }
}

fn bounded(mut value: String, max: usize) -> String {
    value = value.replace(['\r', '\n'], " ").trim().to_string();
    if value.len() > max {
        let mut end = max;
        while end > 0 && !value.is_char_boundary(end) {
            end -= 1;
        }
        value.truncate(end);
    }
    value
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn trim_history(jobs: &mut Vec<DownloadJob>) {
    if jobs.len() <= MAX_HISTORY {
        return;
    }
    let mut removable = jobs
        .iter()
        .filter(|job| !matches!(job.status.as_str(), STATUS_QUEUED | STATUS_RUNNING))
        .map(|job| job.id)
        .collect::<Vec<_>>();
    let excess = jobs.len().saturating_sub(MAX_HISTORY);
    removable.truncate(excess);
    if removable.is_empty() {
        return;
    }
    jobs.retain(|job| !removable.contains(&job.id));
}

fn default_download_dir(settings: &settings::Settings) -> PathBuf {
    if !settings.download_dir.trim().is_empty() {
        return PathBuf::from(settings.download_dir.trim());
    }
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join("Music").join("YTM Light"))
        .unwrap_or_else(|| std::env::temp_dir().join("YTM Light"))
}

fn pump_lines<R: Read>(reader: R, mut on_line: impl FnMut(&str)) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => break,
            Ok(_) => {
                // yt-dlp may print metadata in the Windows console code page.
                // Decoding lossily keeps the pipe open; the previous
                // BufRead::lines() loop stopped at the first invalid byte,
                // closed stdout and made yt-dlp fail with Errno 22.
                let line = String::from_utf8_lossy(&buffer);
                on_line(line.trim_end_matches(['\r', '\n']));
            }
            Err(_) => break,
        }
    }
}

fn debug_log(message: &str) {
    if std::env::var_os("YTM_LIGHT_DOWNLOAD_DEBUG").is_none() {
        return;
    }
    let path = std::env::temp_dir().join("ytm-light-download-debug.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

fn ytdlp_path() -> Option<PathBuf> {
    find_sidecar("yt-dlp")
}

fn ffmpeg_path() -> Option<PathBuf> {
    find_sidecar("ffmpeg")
}

fn ffprobe_path() -> Option<PathBuf> {
    find_sidecar("ffprobe")
}

fn ffmpeg_available() -> bool {
    if ffmpeg_path().is_some() && ffprobe_path().is_some() {
        return true;
    }
    let mut command = Command::new("ffmpeg");
    command
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut probe = Command::new("ffprobe");
    probe
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
        probe.creation_flags(CREATE_NO_WINDOW);
    }
    command.status().is_ok() && probe.status().is_ok()
}

fn find_sidecar(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidates = [
        dir.join(format!("{name}-x86_64-pc-windows-msvc.exe")),
        dir.join(format!("{name}.exe")),
        dir.join("binaries")
            .join(format!("{name}-x86_64-pc-windows-msvc.exe")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("{name}-x86_64-pc-windows-msvc.exe")),
        std::env::current_dir()
            .ok()?
            .join("src-tauri")
            .join("binaries")
            .join(format!("{name}-x86_64-pc-windows-msvc.exe")),
    ];
    candidates
        .into_iter()
        .find(|path| path.is_file() && sidecar_size_ok(path))
}

fn sidecar_size_ok(path: &Path) -> bool {
    // Reject zero-byte placeholders and truncated downloads. Real yt-dlp and
    // ffmpeg builds are tens of megabytes.
    path.metadata()
        .map(|metadata| metadata.len() > 1024 * 1024)
        .unwrap_or(false)
}

fn build_args(job: &DownloadJob, settings: &settings::Settings) -> Vec<String> {
    let mut args = vec![
        "--ignore-config".to_string(),
        "--newline".to_string(),
        "--no-warnings".to_string(),
        "--encoding".to_string(),
        "utf-8".to_string(),
        "--color".to_string(),
        "never".to_string(),
        "--no-simulate".to_string(),
        "--progress".to_string(),
        "--progress-template".to_string(),
        "download:YTM_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s".to_string(),
        "--print".to_string(),
        "before_dl:YTM_META_TITLE:%(title)s".to_string(),
        "--print".to_string(),
        "before_dl:YTM_META_ARTIST:%(artist)s".to_string(),
        "--print".to_string(),
        "before_dl:YTM_META_ALBUM:%(album)s".to_string(),
        "--print".to_string(),
        "before_dl:YTM_META_THUMB:%(thumbnail)s".to_string(),
        "--print".to_string(),
        "before_dl:YTM_META_PLAYLIST:%(playlist_title)s".to_string(),
        "--print".to_string(),
        "after_move:YTM_FILE:%(filepath)s".to_string(),
        "--windows-filenames".to_string(),
        "--trim-filenames".to_string(),
        "120".to_string(),
        "--no-overwrites".to_string(),
    ];

    if job.playlist {
        args.push("--yes-playlist".to_string());
        args.push("--ignore-errors".to_string());
    } else {
        args.push("--no-playlist".to_string());
    }

    let download_dir = default_download_dir(settings);
    args.push("--paths".to_string());
    args.push(download_dir.to_string_lossy().to_string());

    let template = if job.playlist {
        "%(playlist_title)s/%(playlist_index)02d - %(title)s.%(ext)s"
    } else {
        settings.download_filename_template.as_str()
    };
    args.push("-o".to_string());
    args.push(template.to_string());

    match job.format.as_str() {
        "m4a" => {
            args.extend(
                [
                    "-f",
                    "bestaudio[ext=m4a]/bestaudio/best",
                    "-x",
                    "--audio-format",
                    "m4a",
                    "--audio-quality",
                    "0",
                ]
                .iter()
                .map(|value| value.to_string()),
            );
        }
        "mp3" => {
            args.extend(
                [
                    "-f",
                    "bestaudio/best",
                    "-x",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                ]
                .iter()
                .map(|value| value.to_string()),
            );
            args.push(format!("{}K", job.bitrate));
        }
        "opus" => {
            args.extend(
                [
                    "-f",
                    "bestaudio/best",
                    "-x",
                    "--audio-format",
                    "opus",
                    "--audio-quality",
                ]
                .iter()
                .map(|value| value.to_string()),
            );
            args.push(format!("{}K", job.bitrate));
        }
        "flac" => {
            args.extend(
                [
                    "-f",
                    "bestaudio/best",
                    "-x",
                    "--audio-format",
                    "flac",
                    "--audio-quality",
                    "0",
                ]
                .iter()
                .map(|value| value.to_string()),
            );
        }
        _ => {
            args.extend(
                ["-f", "bestaudio/best"]
                    .iter()
                    .map(|value| value.to_string()),
            );
        }
    }

    match job.sponsorblock.as_str() {
        "remove" => {
            args.push("--sponsorblock-remove".to_string());
            args.push(job.sponsorblock_categories.clone());
        }
        "mark" => {
            args.push("--sponsorblock-mark".to_string());
            args.push(job.sponsorblock_categories.clone());
        }
        _ => {}
    }

    if settings.download_embed_metadata {
        args.push("--embed-metadata".to_string());
    }
    if settings.download_embed_thumbnail && job.format != "best" {
        args.push("--embed-thumbnail".to_string());
    }
    if settings.download_cookies_browser != "none" {
        args.push("--cookies-from-browser".to_string());
        args.push(settings.download_cookies_browser.clone());
    }
    if let Some(ffmpeg) = ffmpeg_path() {
        // yt-dlp looks for ffprobe next to ffmpeg. Pass the directory so both
        // sidecars are found even when the app was started from another cwd.
        let location = ffmpeg.parent().map(Path::to_path_buf).unwrap_or(ffmpeg);
        args.push("--ffmpeg-location".to_string());
        args.push(location.to_string_lossy().to_string());
    }

    args.push("--".to_string());
    args.push(job.url.clone());
    args
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_youtube_music_tracks_and_rejects_foreign_urls() {
        assert!(validate_download_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ").is_ok());
        assert!(validate_download_url("https://youtu.be/dQw4w9WgXcQ").is_ok());
        assert!(validate_download_url("https://www.youtube.com/playlist?list=PL123").is_ok());
        assert!(validate_download_url("https://example.com/watch?v=dQw4w9WgXcQ").is_err());
        assert!(validate_download_url("http://music.youtube.com/watch?v=dQw4w9WgXcQ").is_err());
        assert!(validate_download_url("https://music.youtube.com/").is_err());
    }

    #[test]
    fn progress_lines_update_the_job() {
        let manager = test_manager();
        let job = manager
            .start(
                "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
                Some(r#"{"title":"Test","format":"best"}"#),
            )
            .expect("job");
        {
            let mut state = manager.inner.state.lock().expect("state");
            let stored = state
                .jobs
                .iter_mut()
                .find(|item| item.id == job.id)
                .expect("job");
            stored.status = STATUS_RUNNING.to_string();
        }
        manager.handle_line(job.id, "YTM_PROGRESS: 42.5%|1.2MiB/s|00:12|123|456");
        manager.handle_line(job.id, "YTM_FILE:C:\\Music\\Test.opus");
        manager.handle_line(job.id, "YTM_META_TITLE:Title");
        manager.handle_line(job.id, "YTM_META_ARTIST:Artist");
        manager.handle_line(job.id, "YTM_META_ALBUM:Album");
        manager.handle_line(job.id, "YTM_META_THUMB:https://img");
        let state = manager.inner.state.lock().expect("state");
        let stored = state
            .jobs
            .iter()
            .find(|item| item.id == job.id)
            .expect("job");
        assert_eq!(stored.progress, 42.5);
        assert_eq!(stored.speed, "1.2MiB/s");
        assert_eq!(stored.eta, "00:12");
        assert_eq!(stored.downloaded_bytes, 123);
        assert_eq!(stored.total_bytes, 456);
        assert_eq!(stored.filepath, "C:\\Music\\Test.opus");
        assert_eq!(stored.title, "Title");
        assert_eq!(stored.artist, "Artist");
    }

    #[test]
    fn format_arguments_cover_mp3_and_sponsorblock() {
        let settings = settings::Settings::default();
        let job = DownloadJob {
            format: "mp3".to_string(),
            bitrate: "192".to_string(),
            sponsorblock: "remove".to_string(),
            sponsorblock_categories: "sponsor,intro".to_string(),
            url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
            ..DownloadJob::default()
        };
        let args = build_args(&job, &settings);
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--audio-format", "mp3"]));
        assert!(args.iter().any(|arg| arg == "192K"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sponsorblock-remove", "sponsor,intro"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--no-playlist", "--paths"]));
        assert!(args.iter().any(|arg| arg == "--no-simulate"));
        assert!(args.iter().any(|arg| arg == "--ignore-config"));
        assert!(args.windows(2).any(|pair| pair == ["--color", "never"]));
        assert!(args.windows(2).any(|pair| pair == ["--encoding", "utf-8"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--trim-filenames", "120"]));
        assert_eq!(args.last().map(String::as_str), Some(job.url.as_str()));
    }

    #[test]
    fn invalid_utf8_output_does_not_stop_the_reader() {
        let mut lines = Vec::new();
        pump_lines(&b"first \xff line\nsecond line\r\n"[..], |line| {
            lines.push(line.to_string());
        });
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("first "));
        assert!(lines[0].ends_with(" line"));
        assert_eq!(lines[1], "second line");
    }

    #[test]
    fn missing_metadata_is_treated_as_empty() {
        let manager = test_manager();
        let job = manager
            .start(
                "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
                Some(r#"{"title":"Test","format":"best"}"#),
            )
            .expect("job");
        manager.handle_line(job.id, "YTM_META_TITLE:NA");
        manager.handle_line(job.id, "YTM_META_ARTIST:NA");
        manager.handle_line(job.id, "YTM_META_ALBUM:NA");
        manager.handle_line(job.id, "YTM_META_THUMB:NA");
        let state = manager.inner.state.lock().expect("state");
        let stored = state
            .jobs
            .iter()
            .find(|item| item.id == job.id)
            .expect("job");
        assert_eq!(stored.title, "Test");
        assert!(stored.artist.is_empty());
        assert!(stored.album.is_empty());
        assert!(stored.thumbnail.is_empty());
    }

    #[test]
    fn playlist_metadata_uses_the_playlist_title() {
        let manager = test_manager();
        let job = manager
            .start(
                "https://music.youtube.com/playlist?list=PL123",
                Some(r#"{"title":"","playlist":true}"#),
            )
            .expect("job");
        manager.handle_line(job.id, "YTM_META_TITLE:Track One");
        manager.handle_line(job.id, "YTM_META_ARTIST:Artist");
        manager.handle_line(job.id, "YTM_META_ALBUM:Album");
        manager.handle_line(job.id, "YTM_META_THUMB:Thumb");
        manager.handle_line(job.id, "YTM_META_PLAYLIST:My Playlist");
        let state = manager.inner.state.lock().expect("state");
        let stored = state
            .jobs
            .iter()
            .find(|item| item.id == job.id)
            .expect("job");
        assert_eq!(stored.title, "My Playlist");
        assert!(stored.artist.is_empty());
        assert!(stored.album.is_empty());
    }

    #[test]
    fn metadata_values_keep_pipe_characters() {
        let manager = test_manager();
        let job = manager
            .start(
                "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
                Some(r#"{"title":"Test","format":"best"}"#),
            )
            .expect("job");
        manager.handle_line(job.id, "YTM_META_TITLE:Umamusume | Gold Triumph");
        manager.handle_line(job.id, "YTM_META_ARTIST:higanbanban | TRISHA");
        let state = manager.inner.state.lock().expect("state");
        let stored = state
            .jobs
            .iter()
            .find(|item| item.id == job.id)
            .expect("job");
        assert_eq!(stored.title, "Umamusume | Gold Triumph");
        assert_eq!(stored.artist, "higanbanban | TRISHA");
    }

    #[test]
    fn duplicate_active_downloads_reuse_the_same_job() {
        let manager = test_manager();
        let url = "https://music.youtube.com/watch?v=dQw4w9WgXcQ";
        let first = manager
            .start(url, Some(r#"{"title":"Test","format":"best"}"#))
            .expect("job");
        let second = manager
            .start(url, Some(r#"{"title":"Test","format":"mp3"}"#))
            .expect("job");
        assert_eq!(first.id, second.id);
        assert_eq!(manager.list().expect("list").len(), 1);
    }

    #[test]
    fn retry_waits_for_a_stopping_process() {
        let manager = test_manager();
        let job = manager
            .start(
                "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
                Some(r#"{"title":"Test","format":"best"}"#),
            )
            .expect("job");
        {
            let mut state = manager.inner.state.lock().expect("state");
            let stored = state
                .jobs
                .iter_mut()
                .find(|item| item.id == job.id)
                .expect("job");
            stored.status = STATUS_CANCELED.to_string();
            state.running.insert(job.id, 1234);
        }
        let error = manager.retry(job.id).expect_err("retry must be rejected");
        assert!(error.contains("останавливается"));
    }

    #[test]
    fn history_is_trimmed_without_dropping_active_jobs() {
        let mut jobs = (0..MAX_HISTORY + 5)
            .map(|id| DownloadJob {
                id: id as u64,
                status: STATUS_COMPLETED.to_string(),
                ..DownloadJob::default()
            })
            .collect::<Vec<_>>();
        jobs.push(DownloadJob {
            id: 999,
            status: STATUS_RUNNING.to_string(),
            ..DownloadJob::default()
        });
        trim_history(&mut jobs);
        assert_eq!(jobs.len(), MAX_HISTORY);
        assert!(jobs.iter().any(|job| job.id == 999));
    }

    fn test_manager() -> DownloadManager {
        let settings = Arc::new(Mutex::new(settings::Settings::default()));
        let manager = DownloadManager::new(settings);
        manager.inner.shutdown.store(true, Ordering::SeqCst);
        manager
    }
}

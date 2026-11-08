use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub const MAX_CUSTOM_CSS_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct Settings {
    pub discord_rpc: bool,
    pub ad_block: bool,
    pub close_to_tray: bool,
    pub launch_at_startup: bool,
    pub start_minimized: bool,
    pub zoom: f64,
    pub synced_lyrics: bool,
    pub lyrics_precise_timing: bool,
    pub lyrics_show_inexact: bool,
    pub lyrics_show_timecodes: bool,
    pub lyrics_romanization: bool,
    pub lyrics_auto_sync: bool,
    pub lyrics_line_effect: String,
    pub lastfm_scrobbling: bool,
    #[serde(skip)]
    pub lastfm_session_key: Option<String>,
    pub listenbrainz_scrobbling: bool,
    #[serde(skip)]
    pub listenbrainz_token: Option<String>,
    pub notifications: bool,
    pub windows_media_controls: bool,
    pub custom_output_device: bool,
    pub output_device: String,
    pub equalizer: bool,
    pub equalizer_preset: String,
    pub equalizer_custom_gains: String,
    pub precise_volume: bool,
    pub exponential_volume: bool,
    pub volume_step: f64,
    pub navigation_controls: bool,
    pub playback_speed: bool,
    pub playback_rate: f64,
    pub skip_disliked: bool,
    pub auto_confirm: bool,
    pub sponsorblock: bool,
    pub blur_nav_bar: bool,
    pub disable_autoplay: bool,
    pub video_quick_toggle: bool,
    pub ambient_mode: bool,
    pub theme: String,
    pub custom_css: String,
    pub crossfade: bool,
    pub crossfade_seconds: f64,
    pub crossfade_curve: String,
    pub spotify_spoof: bool,
    pub downloads_enabled: bool,
    pub download_dir: String,
    pub download_format: String,
    pub download_bitrate: String,
    pub download_sponsorblock: String,
    pub download_sponsorblock_categories: String,
    pub download_filename_template: String,
    pub download_cookies_browser: String,
    pub download_embed_metadata: bool,
    pub download_embed_thumbnail: bool,
    pub download_concurrency: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            discord_rpc: false,
            ad_block: true,
            close_to_tray: false,
            launch_at_startup: false,
            start_minimized: false,
            zoom: 1.0,
            synced_lyrics: true,
            lyrics_precise_timing: true,
            lyrics_show_inexact: true,
            lyrics_show_timecodes: false,
            lyrics_romanization: false,
            lyrics_auto_sync: true,
            lyrics_line_effect: "fancy".to_string(),
            lastfm_scrobbling: false,
            lastfm_session_key: None,
            listenbrainz_scrobbling: false,
            listenbrainz_token: None,
            notifications: false,
            windows_media_controls: false,
            custom_output_device: false,
            output_device: "default".to_string(),
            equalizer: false,
            equalizer_preset: "bass-booster".to_string(),
            equalizer_custom_gains: "0,0,0,0,0,0,0,0,0,0".to_string(),
            precise_volume: false,
            exponential_volume: false,
            volume_step: 1.0,
            navigation_controls: false,
            playback_speed: false,
            playback_rate: 1.0,
            skip_disliked: false,
            auto_confirm: true,
            sponsorblock: true,
            blur_nav_bar: true,
            disable_autoplay: false,
            video_quick_toggle: true,
            ambient_mode: true,
            theme: "default".to_string(),
            custom_css: String::new(),
            crossfade: false,
            crossfade_seconds: 4.0,
            crossfade_curve: "equal-power".to_string(),
            spotify_spoof: false,
            downloads_enabled: true,
            download_dir: String::new(),
            download_format: "best".to_string(),
            download_bitrate: "320".to_string(),
            download_sponsorblock: "off".to_string(),
            download_sponsorblock_categories:
                "sponsor,intro,outro,selfpromo,interaction,music_offtopic".to_string(),
            download_filename_template: DEFAULT_FILENAME_TEMPLATE.to_string(),
            download_cookies_browser: "none".to_string(),
            download_embed_metadata: true,
            download_embed_thumbnail: true,
            download_concurrency: 1,
        }
    }
}

impl Settings {
    fn normalize(&mut self) {
        self.zoom = finite_clamp(self.zoom, 0.5, 2.0, 1.0);
        self.volume_step = finite_clamp(self.volume_step, 0.1, 10.0, 1.0);
        self.playback_rate = finite_clamp(self.playback_rate, 0.25, 3.0, 1.0);
        if !matches!(
            self.lyrics_line_effect.as_str(),
            "fancy" | "scale" | "offset" | "focus" | "cinematic" | "studio" | "luminescent"
        ) {
            self.lyrics_line_effect = "fancy".to_string();
        }
        if !matches!(
            self.equalizer_preset.as_str(),
            "flat"
                | "bass-booster"
                | "bass-reducer"
                | "treble-booster"
                | "treble-reducer"
                | "vocal-booster"
                | "rock"
                | "pop"
                | "electronic"
                | "hip-hop"
                | "acoustic"
                | "classical"
                | "deep"
                | "custom"
        ) {
            self.equalizer_preset = "bass-booster".to_string();
        }
        if self.equalizer_custom_gains.is_empty() || self.equalizer_custom_gains.len() > 256 {
            self.equalizer_custom_gains = "0,0,0,0,0,0,0,0,0,0".to_string();
        }
        if !matches!(
            self.theme.as_str(),
            "default" | "amoled" | "midnight" | "custom"
        ) {
            self.theme = "default".to_string();
        }
        if self.custom_css.len() > MAX_CUSTOM_CSS_BYTES {
            let mut end = MAX_CUSTOM_CSS_BYTES;
            while end > 0 && !self.custom_css.is_char_boundary(end) {
                end -= 1;
            }
            self.custom_css.truncate(end);
        }
        self.crossfade_seconds = finite_clamp(self.crossfade_seconds, 1.0, 15.0, 4.0);
        if !matches!(
            self.crossfade_curve.as_str(),
            "equal-power" | "logarithmic" | "linear"
        ) {
            self.crossfade_curve = "equal-power".to_string();
        }
        if self.output_device.len() > 512 {
            self.output_device = "default".to_string();
        }
        self.normalize_downloads();
    }

    fn normalize_downloads(&mut self) {
        self.download_dir = self.download_dir.trim().to_string();
        if self.download_dir.len() > 1024
            || self.download_dir.contains('\0')
            || (!self.download_dir.is_empty() && !Path::new(&self.download_dir).is_absolute())
        {
            self.download_dir.clear();
        }
        sanitize_choice(
            &mut self.download_format,
            &["best", "m4a", "mp3", "opus", "flac"],
            "best",
        );
        sanitize_choice(
            &mut self.download_bitrate,
            &["128", "192", "256", "320"],
            "320",
        );
        sanitize_choice(
            &mut self.download_sponsorblock,
            &["off", "mark", "remove"],
            "off",
        );
        sanitize_choice(
            &mut self.download_cookies_browser,
            &[
                "none", "edge", "chrome", "firefox", "brave", "opera", "vivaldi",
            ],
            "none",
        );
        let categories = sanitize_sponsorblock_categories(&self.download_sponsorblock_categories);
        self.download_sponsorblock_categories = categories;
        if !valid_filename_template(&self.download_filename_template)
            || self.download_filename_template == LEGACY_FILENAME_TEMPLATE
        {
            self.download_filename_template = DEFAULT_FILENAME_TEMPLATE.to_string();
        }
        self.download_concurrency = self.download_concurrency.clamp(1, 3);
    }
}

pub const DEFAULT_FILENAME_TEMPLATE: &str = "%(artist,uploader)s - %(title)s.%(ext)s";
const LEGACY_FILENAME_TEMPLATE: &str = "%(artist)s - %(title)s.%(ext)s";
pub const DEFAULT_SPONSORBLOCK_CATEGORIES: &str =
    "sponsor,intro,outro,selfpromo,interaction,music_offtopic";
const SPONSORBLOCK_CATEGORIES: &[&str] = &[
    "sponsor",
    "intro",
    "outro",
    "selfpromo",
    "interaction",
    "music_offtopic",
    "preview",
    "filler",
];

fn sanitize_choice(value: &mut String, allowed: &[&str], fallback: &str) {
    if !allowed.contains(&value.as_str()) {
        *value = fallback.to_string();
    }
}

fn sanitize_sponsorblock_categories(value: &str) -> String {
    let mut categories = Vec::new();
    for item in value.split(',') {
        let item = item.trim();
        if !SPONSORBLOCK_CATEGORIES.contains(&item) || categories.contains(&item) {
            continue;
        }
        categories.push(item);
    }
    if categories.is_empty() {
        DEFAULT_SPONSORBLOCK_CATEGORIES.to_string()
    } else {
        categories.join(",")
    }
}

fn valid_filename_template(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 256
        || value.contains('\0')
        || value.contains("..")
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.chars().any(|ch| ch.is_control())
    {
        return false;
    }
    let bytes = value.as_bytes();
    !(bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
}

fn finite_clamp(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

pub type SharedSettings = Arc<Mutex<Settings>>;

pub fn load() -> SharedSettings {
    let mut settings: Settings = settings_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();
    settings.normalize();

    Arc::new(Mutex::new(settings))
}

pub fn snapshot(settings: &SharedSettings) -> Settings {
    settings
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}

pub fn update(settings: &SharedSettings, change: impl FnOnce(&mut Settings)) {
    let _ = update_if(settings, |value| {
        change(value);
        true
    });
}

pub fn update_if(settings: &SharedSettings, change: impl FnOnce(&mut Settings) -> bool) -> bool {
    let Ok(mut value) = settings.lock() else {
        return false;
    };

    if !change(&mut value) {
        return false;
    }
    value.normalize();

    let Some(path) = settings_path() else {
        return true;
    };
    let Some(parent) = path.parent() else {
        return true;
    };
    let Ok(json) = serde_json::to_string_pretty(&*value) else {
        return true;
    };

    let _ = fs::create_dir_all(parent);
    let _ = fs::write(path, json);
    true
}

fn settings_path() -> Option<PathBuf> {
    data_dir().map(|dir| dir.join("settings.json"))
}

pub fn data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|dir| dir.join("app.ytmlight.desktop"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|dir| dir.join(".config").join("app.ytmlight.desktop"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_use_defaults() {
        let settings: Settings =
            serde_json::from_str(r#"{"discord_rpc":false}"#).expect("settings");

        assert!(!settings.discord_rpc);
        assert!(settings.ad_block);
        assert!(settings.auto_confirm);
        assert_eq!(settings.zoom, 1.0);
        assert!(settings.synced_lyrics);
        assert!(settings.lyrics_precise_timing);
        assert!(settings.lyrics_show_inexact);
        assert_eq!(settings.lyrics_line_effect, "fancy");
        assert_eq!(settings.output_device, "default");
        assert_eq!(settings.equalizer_preset, "bass-booster");
        assert_eq!(settings.equalizer_custom_gains, "0,0,0,0,0,0,0,0,0,0");
        assert_eq!(settings.crossfade_seconds, 4.0);
        assert_eq!(settings.crossfade_curve, "equal-power");
        assert_eq!(settings.playback_rate, 1.0);
        assert!(settings.downloads_enabled);
        assert_eq!(settings.download_format, "best");
        assert_eq!(settings.download_bitrate, "320");
        assert_eq!(settings.download_sponsorblock, "off");
        assert_eq!(settings.download_cookies_browser, "none");
        assert_eq!(
            settings.download_filename_template,
            DEFAULT_FILENAME_TEMPLATE
        );
        assert_eq!(settings.download_concurrency, 1);
        assert!(settings.video_quick_toggle);
    }

    #[test]
    fn download_normalization_rejects_unsafe_values() {
        let mut settings = Settings {
            download_format: "exe".to_string(),
            download_bitrate: "999".to_string(),
            download_sponsorblock: "delete".to_string(),
            download_sponsorblock_categories: "sponsor,unknown,sponsor,intro".to_string(),
            download_filename_template: "../escape.%(ext)s".to_string(),
            download_cookies_browser: "netscape".to_string(),
            download_concurrency: 9,
            download_dir: "  C:\\Music\\YTM Light  ".to_string(),
            ..Settings::default()
        };

        settings.normalize();

        assert_eq!(settings.download_format, "best");
        assert_eq!(settings.download_bitrate, "320");
        assert_eq!(settings.download_sponsorblock, "off");
        assert_eq!(settings.download_sponsorblock_categories, "sponsor,intro");
        assert_eq!(
            settings.download_filename_template,
            DEFAULT_FILENAME_TEMPLATE
        );
        assert_eq!(settings.download_cookies_browser, "none");
        assert_eq!(settings.download_concurrency, 3);
        assert_eq!(settings.download_dir, "C:\\Music\\YTM Light");
    }

    #[test]
    fn legacy_filename_template_is_migrated() {
        let mut settings = Settings {
            download_filename_template: LEGACY_FILENAME_TEMPLATE.to_string(),
            ..Settings::default()
        };

        settings.normalize();

        assert_eq!(
            settings.download_filename_template,
            DEFAULT_FILENAME_TEMPLATE
        );
    }

    #[test]
    fn relative_download_directories_are_rejected() {
        let mut settings = Settings {
            download_dir: "Music\\YTM Light".to_string(),
            ..Settings::default()
        };
        settings.normalize();
        assert!(settings.download_dir.is_empty());
    }

    #[test]
    fn empty_sponsorblock_categories_fall_back_to_defaults() {
        let mut settings = Settings {
            download_sponsorblock_categories: " , ".to_string(),
            ..Settings::default()
        };
        settings.normalize();
        assert_eq!(
            settings.download_sponsorblock_categories,
            DEFAULT_SPONSORBLOCK_CATEGORIES
        );
    }

    #[test]
    fn normalization_bounds_corrupt_or_unsupported_values() {
        let mut settings = Settings {
            zoom: -4.0,
            volume_step: 100.0,
            playback_rate: 0.01,
            lyrics_line_effect: "unknown".to_string(),
            equalizer_preset: "unknown".to_string(),
            equalizer_custom_gains: "".to_string(),
            crossfade_seconds: 99.0,
            crossfade_curve: "unknown".to_string(),
            ..Settings::default()
        };

        settings.normalize();

        assert_eq!(settings.zoom, 0.5);
        assert_eq!(settings.volume_step, 10.0);
        assert_eq!(settings.playback_rate, 0.25);
        assert_eq!(settings.lyrics_line_effect, "fancy");
        assert_eq!(settings.equalizer_preset, "bass-booster");
        assert_eq!(settings.equalizer_custom_gains, "0,0,0,0,0,0,0,0,0,0");
        assert_eq!(settings.crossfade_seconds, 15.0);
        assert_eq!(settings.crossfade_curve, "equal-power");
    }

    #[test]
    fn theme_normalization_accepts_known_presets_and_caps_custom_css() {
        for theme in ["default", "amoled", "midnight", "custom"] {
            let mut settings = Settings {
                theme: theme.to_string(),
                ..Settings::default()
            };
            settings.normalize();
            assert_eq!(settings.theme, theme);
        }

        let mut settings = Settings {
            theme: "unknown".to_string(),
            custom_css: "x".repeat(MAX_CUSTOM_CSS_BYTES + 10),
            ..Settings::default()
        };
        settings.normalize();

        assert_eq!(settings.theme, "default");
        assert_eq!(settings.custom_css.len(), MAX_CUSTOM_CSS_BYTES);
    }

    #[test]
    fn normalization_preserves_new_lyrics_effects() {
        for effect in ["cinematic", "studio", "luminescent"] {
            let mut settings = Settings {
                lyrics_line_effect: effect.to_string(),
                ..Settings::default()
            };
            settings.normalize();
            assert_eq!(settings.lyrics_line_effect, effect);
        }
    }

    #[test]
    fn scrobble_secrets_never_serialize_into_settings() {
        let settings = Settings {
            lastfm_session_key: Some("lastfm-secret".to_string()),
            listenbrainz_token: Some("listenbrainz-secret".to_string()),
            ..Settings::default()
        };
        let json = serde_json::to_string(&settings).expect("settings json");
        assert!(!json.contains("lastfm-secret"));
        assert!(!json.contains("listenbrainz-secret"));
    }
}

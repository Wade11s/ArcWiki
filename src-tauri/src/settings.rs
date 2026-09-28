use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

// Keep in sync with `shared/agentContract.ts`.
pub const DEFAULT_OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
pub const DEFAULT_OPENROUTER_MODEL: &str = "stealth/space-bunny-alpha";

const SETTINGS_FILE: &str = "settings.json";
const MAX_API_KEY_CHARS: usize = 512;
const MAX_MODEL_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadingWidth {
    Comfortable,
    Wide,
}

impl Default for ReadingWidth {
    fn default() -> Self {
        Self::Comfortable
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApiKeySource {
    None,
    Saved,
    Environment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSettings {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub agent: StoredAgent,
    #[serde(default)]
    pub reading: StoredReading,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            version: 1,
            agent: StoredAgent::default(),
            reading: StoredReading::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAgent {
    /// `None` falls back to the launch environment. `Some("")` clears that fallback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredReading {
    #[serde(default)]
    pub width: ReadingWidth,
}

impl Default for StoredReading {
    fn default() -> Self {
        Self {
            width: ReadingWidth::Comfortable,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsInput {
    pub api_key: Option<String>,
    pub clear_api_key: Option<bool>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub reading_width: Option<ReadingWidth>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub agent: PublicAgent,
    pub reading: PublicReading,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicAgent {
    pub api_key_source: ApiKeySource,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicReading {
    pub width: ReadingWidth,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChanged {
    pub reading_width: ReadingWidth,
    pub agent_changed: bool,
    pub agent_configured: bool,
}

#[derive(Clone)]
pub struct ResolvedSettings {
    pub api_key: Option<String>,
    pub api_key_source: ApiKeySource,
    pub base_url: String,
    pub model: String,
    pub reading_width: ReadingWidth,
}

impl std::fmt::Debug for ResolvedSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResolvedSettings")
            .field("api_key", &self.api_key.as_ref().map(|_| "[redacted]"))
            .field("api_key_source", &self.api_key_source)
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("reading_width", &self.reading_width)
            .finish()
    }
}

#[derive(Debug, Clone, Default)]
pub struct EnvSnapshot {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

impl EnvSnapshot {
    pub fn from_process() -> Self {
        Self {
            api_key: read_trimmed_env("OPENROUTER_API_KEY"),
            base_url: read_trimmed_env("OPENROUTER_BASE_URL"),
            model: read_trimmed_env("OPENROUTER_MODEL"),
        }
    }
}

fn read_trimmed_env(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join(SETTINGS_FILE)
}

pub fn load_stored_settings(config_dir: &Path) -> StoredSettings {
    let path = settings_path(config_dir);
    let Ok(raw) = fs::read_to_string(path) else {
        return StoredSettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn write_stored_settings(
    config_dir: &Path,
    settings: &StoredSettings,
) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    let path = settings_path(config_dir);
    let body = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(&path, body).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn normalize_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_OPENROUTER_BASE_URL.to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    let https = lower.starts_with("https://");
    let http = lower.starts_with("http://");
    if !https && !http {
        return Err("Enter an http(s) API base URL.".into());
    }
    if trimmed.chars().any(|c| {
        c.is_whitespace()
            || c.is_control()
            || matches!(c, '<' | '>' | '"' | '\\' | '{' | '}' | '|' | '^' | '`')
    }) {
        return Err("Enter an http(s) API base URL.".into());
    }
    let rest = if https { &trimmed[8..] } else { &trimmed[7..] };
    if rest.is_empty() || rest.starts_with('/') || rest.contains("://") {
        return Err("Enter an http(s) API base URL.".into());
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

pub fn normalize_model(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_OPENROUTER_MODEL.to_string());
    }
    if trimmed.len() > MAX_MODEL_CHARS {
        return Err("Model id is too long.".into());
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Enter a single model id.".into());
    }
    Ok(trimmed.to_string())
}

fn normalize_api_key(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() > MAX_API_KEY_CHARS {
        return Err("API key is too long.".into());
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Enter the API key as a single value.".into());
    }
    Ok(trimmed.to_string())
}

fn first_valid_url(candidates: [Option<&str>; 2]) -> String {
    for candidate in candidates.into_iter().flatten() {
        if candidate.trim().is_empty() {
            continue;
        }
        if let Ok(url) = normalize_base_url(candidate) {
            return url;
        }
    }
    DEFAULT_OPENROUTER_BASE_URL.to_string()
}

fn first_valid_model(candidates: [Option<&str>; 2]) -> String {
    for candidate in candidates.into_iter().flatten() {
        if candidate.trim().is_empty() {
            continue;
        }
        if let Ok(model) = normalize_model(candidate) {
            return model;
        }
    }
    DEFAULT_OPENROUTER_MODEL.to_string()
}

pub fn resolve_settings(stored: &StoredSettings, env: &EnvSnapshot) -> ResolvedSettings {
    let (api_key, api_key_source) = match stored.agent.api_key.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                (None, ApiKeySource::None)
            } else {
                (Some(trimmed.to_string()), ApiKeySource::Saved)
            }
        }
        None => match env.api_key.clone() {
            Some(value) => (Some(value), ApiKeySource::Environment),
            None => (None, ApiKeySource::None),
        },
    };

    ResolvedSettings {
        api_key,
        api_key_source,
        base_url: first_valid_url([
            stored.agent.base_url.as_deref(),
            env.base_url.as_deref(),
        ]),
        model: first_valid_model([stored.agent.model.as_deref(), env.model.as_deref()]),
        reading_width: stored.reading.width,
    }
}

pub fn public_settings(resolved: &ResolvedSettings) -> PublicSettings {
    PublicSettings {
        agent: PublicAgent {
            api_key_source: resolved.api_key_source,
            base_url: resolved.base_url.clone(),
            model: resolved.model.clone(),
        },
        reading: PublicReading {
            width: resolved.reading_width,
        },
    }
}

pub fn apply_save(
    stored: &mut StoredSettings,
    input: &SaveSettingsInput,
) -> Result<(), String> {
    stored.version = 1;
    if input.clear_api_key == Some(true) {
        stored.agent.api_key = Some(String::new());
    } else if let Some(api_key) = &input.api_key {
        let normalized = normalize_api_key(api_key)?;
        if !normalized.is_empty() {
            stored.agent.api_key = Some(normalized);
        }
    }
    if let Some(base_url) = &input.base_url {
        stored.agent.base_url = Some(normalize_base_url(base_url)?);
    }
    if let Some(model) = &input.model {
        stored.agent.model = Some(normalize_model(model)?);
    }
    if let Some(width) = input.reading_width {
        stored.reading.width = width;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn env(api_key: &str, base_url: &str, model: &str) -> EnvSnapshot {
        EnvSnapshot {
            api_key: Some(api_key.into()),
            base_url: Some(base_url.into()),
            model: Some(model.into()),
        }
    }

    fn temp_config_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arcwiki-settings-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn launch_env_fills_missing_settings() {
        let resolved = resolve_settings(
            &StoredSettings::default(),
            &env(
                "sk-from-env",
                "https://example.test/v1",
                "vendor/from-env",
            ),
        );
        assert_eq!(resolved.api_key.as_deref(), Some("sk-from-env"));
        assert_eq!(resolved.api_key_source, ApiKeySource::Environment);
        assert_eq!(resolved.base_url, "https://example.test/v1");
        assert_eq!(resolved.model, "vendor/from-env");
        assert_eq!(resolved.reading_width, ReadingWidth::Comfortable);
    }

    #[test]
    fn saved_key_wins_over_environment() {
        let stored = StoredSettings {
            agent: StoredAgent {
                api_key: Some("sk-saved".into()),
                ..StoredAgent::default()
            },
            ..StoredSettings::default()
        };
        let resolved = resolve_settings(&stored, &env("sk-from-env", "", ""));
        assert_eq!(resolved.api_key.as_deref(), Some("sk-saved"));
        assert_eq!(resolved.api_key_source, ApiKeySource::Saved);
    }

    #[test]
    fn empty_saved_key_blocks_environment_fallback() {
        let stored = StoredSettings {
            agent: StoredAgent {
                api_key: Some(String::new()),
                ..StoredAgent::default()
            },
            ..StoredSettings::default()
        };
        let resolved = resolve_settings(&stored, &env("sk-from-env", "", ""));
        assert_eq!(resolved.api_key, None);
        assert_eq!(resolved.api_key_source, ApiKeySource::None);
    }

    #[test]
    fn public_settings_never_include_the_secret() {
        let resolved = resolve_settings(
            &StoredSettings {
                agent: StoredAgent {
                    api_key: Some("sk-secret-value".into()),
                    base_url: Some("https://openrouter.ai/api/v1".into()),
                    model: Some("stealth/space-bunny-alpha".into()),
                },
                ..StoredSettings::default()
            },
            &EnvSnapshot::default(),
        );
        let public = public_settings(&resolved);
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("sk-secret-value"));
        assert!(!json.contains("\"apiKey\":"));
        assert!(json.contains("\"apiKeySource\":\"saved\""));
    }

    #[test]
    fn apply_save_keeps_existing_key_when_blank() {
        let mut stored = StoredSettings {
            agent: StoredAgent {
                api_key: Some("sk-keep".into()),
                ..StoredAgent::default()
            },
            ..StoredSettings::default()
        };
        apply_save(
            &mut stored,
            &SaveSettingsInput {
                api_key: Some(String::new()),
                base_url: Some("https://example.test/v1/".into()),
                model: Some(" vendor/model ".into()),
                reading_width: Some(ReadingWidth::Wide),
                ..SaveSettingsInput::default()
            },
        )
        .unwrap();
        assert_eq!(stored.agent.api_key.as_deref(), Some("sk-keep"));
        assert_eq!(stored.agent.base_url.as_deref(), Some("https://example.test/v1"));
        assert_eq!(stored.agent.model.as_deref(), Some("vendor/model"));
        assert_eq!(stored.reading.width, ReadingWidth::Wide);
    }

    #[test]
    fn apply_save_rejects_non_http_base_urls() {
        let mut stored = StoredSettings::default();
        let error = apply_save(
            &mut stored,
            &SaveSettingsInput {
                base_url: Some("javascript:alert(1)".into()),
                ..SaveSettingsInput::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("http(s)"));
    }

    #[test]
    fn round_trips_settings_without_leaking_a_cleared_key_to_env() {
        let dir = temp_config_dir();
        let mut stored = StoredSettings::default();
        apply_save(
            &mut stored,
            &SaveSettingsInput {
                api_key: Some("sk-file".into()),
                ..SaveSettingsInput::default()
            },
        )
        .unwrap();
        write_stored_settings(&dir, &stored).unwrap();
        apply_save(
            &mut stored,
            &SaveSettingsInput {
                clear_api_key: Some(true),
                ..SaveSettingsInput::default()
            },
        )
        .unwrap();
        write_stored_settings(&dir, &stored).unwrap();
        let loaded = load_stored_settings(&dir);
        let resolved = resolve_settings(&loaded, &env("sk-from-env", "", ""));
        assert_eq!(loaded.agent.api_key.as_deref(), Some(""));
        assert_eq!(resolved.api_key, None);
        let _ = fs::remove_dir_all(dir);
    }
}

import { useEffect, useState } from 'react';

import { getAppSettings, updateAppSettings } from '../api/settings';
import type { AppSettings } from '../types/settings';
import styles from '../pages/HomePage.module.css';

const PROVIDER_LABELS: Record<string, string> = {
  auto: 'Automático (Gemini si hay clave)',
  gemini: 'Gemini',
  mock: 'Local estructural',
};

const WHISPER_LABELS: Record<string, string> = {
  tiny: 'tiny (más rápido)',
  base: 'base',
  small: 'small (recomendado)',
  medium: 'medium',
  'large-v3': 'large-v3 (máxima calidad)',
};

export function SettingsForm({ onSaved }: { onSaved?: () => void }) {
  const [data, setData] = useState<AppSettings | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('');
  const [aiProvider, setAiProvider] = useState('auto');
  const [whisperModel, setWhisperModel] = useState('small');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppSettings()
      .then((settings) => {
        if (cancelled) return;
        applySettings(settings);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applySettings(settings: AppSettings) {
    setData(settings);
    setGeminiModel(settings.gemini_model);
    setAiProvider(settings.ai_provider);
    setWhisperModel(settings.whisper_model);
    setGeminiKey('');
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Parameters<typeof updateAppSettings>[0] = {
        ai_provider: aiProvider,
        whisper_model: whisperModel,
        gemini_model: geminiModel.trim() || undefined,
      };
      if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim();
      const saved = await updateAppSettings(payload);
      applySettings(saved);
      setNotice('Configuración guardada.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  async function handleClearKey() {
    setBusy(true);
    setError(null);
    try {
      const saved = await updateAppSettings({ clear_gemini_api_key: true });
      applySettings(saved);
      setNotice('Clave de Gemini eliminada.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la clave');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <p className="muted">{error ?? 'Cargando configuración…'}</p>;
  }

  return (
    <div className={styles.settings}>
      <div className={styles.about}>
        {[
          { key: 'ffmpeg', label: 'FFmpeg', tool: data.ffmpeg },
          { key: 'whisper', label: 'Whisper', tool: data.whisper },
          { key: 'gemini', label: 'Gemini', tool: data.gemini },
        ].map((row) => (
          <div key={row.key} className={styles.aboutRow}>
            <span className={styles.aboutKey}>{row.label}</span>
            <span className={styles.aboutValue}>
              {row.tool.available ? row.tool.version ?? 'Disponible' : 'No disponible'}
            </span>
          </div>
        ))}
      </div>

      <label className="field">
        <span>Modelo de transcripción</span>
        <select value={whisperModel} disabled={busy} onChange={(e) => setWhisperModel(e.target.value)}>
          {data.whisper_models.map((model) => (
            <option key={model} value={model}>
              {WHISPER_LABELS[model] ?? model}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Motor de análisis</span>
        <select value={aiProvider} disabled={busy} onChange={(e) => setAiProvider(e.target.value)}>
          {data.ai_providers.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_LABELS[provider] ?? provider}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Modelo Gemini</span>
        <input
          type="text"
          value={geminiModel}
          disabled={busy}
          onChange={(e) => setGeminiModel(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Clave de Gemini</span>
        <input
          type="password"
          autoComplete="off"
          placeholder={data.gemini_api_key_masked ?? 'Pega aquí la clave'}
          value={geminiKey}
          disabled={busy}
          onChange={(e) => setGeminiKey(e.target.value)}
        />
      </label>
      {data.gemini_api_key_masked ? (
        <p className={styles.note}>Clave guardada: {data.gemini_api_key_masked}</p>
      ) : (
        <p className={styles.note}>Sin clave: el análisis usará el motor local.</p>
      )}

      <div className="button-stack">
        <button type="button" onClick={() => void handleSave()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        {data.gemini_configured ? (
          <button type="button" className="button--ghost" onClick={() => void handleClearKey()} disabled={busy}>
            Quitar clave
          </button>
        ) : null}
      </div>
      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';

import { listExportProfiles, updateExportProfile } from '../api/exportProfiles';
import type { ExportProfile } from '../types/exportProfile';
import { notifyExportProfilesChanged } from '../utils/appPanels';
import styles from '../pages/HomePage.module.css';

export function ExportProfilesSettings() {
  const [profiles, setProfiles] = useState<ExportProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(
    () => profiles.find((item) => item.id === profileId) ?? profiles[0] ?? null,
    [profiles, profileId],
  );

  useEffect(() => {
    let cancelled = false;
    listExportProfiles()
      .then((data) => {
        if (cancelled) return;
        setProfiles(data.items);
        setProfileId((current) =>
          data.items.some((item) => item.id === current) ? current : (data.items[0]?.id ?? ''),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudieron cargar los perfiles');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchSelected = (patch: Partial<ExportProfile>) => {
    if (!selected) return;
    setProfiles((items) =>
      items.map((item) => (item.id === selected.id ? { ...item, ...patch } : item)),
    );
  };

  const handleSave = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateExportProfile(selected.id, {
        max_duration_seconds: selected.max_duration_seconds,
        fps_mode: selected.fps_mode,
        safe_top: selected.safe_top,
        safe_bottom: selected.safe_bottom,
        crf_draft: selected.crf_draft,
        crf_standard: selected.crf_standard,
        crf_high: selected.crf_high,
        fragmentation_enabled: selected.fragmentation_enabled,
        fragment_max_seconds: selected.fragment_max_seconds,
        prefer_small_file: selected.prefer_small_file,
      });
      setProfiles((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`Guardado: ${updated.name}.`);
      notifyExportProfilesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el perfil');
    } finally {
      setBusy(false);
    }
  };

  if (!selected) {
    return <p className="muted">{error ?? 'Cargando perfiles…'}</p>;
  }

  return (
    <div className={styles.profileEditor}>
      <label className="field">
        <span>Perfil</span>
        <select
          value={selected.id}
          disabled={busy}
          onChange={(event) => setProfileId(event.target.value)}
        >
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.aspect_ratio})
            </option>
          ))}
        </select>
      </label>

      <div className={styles.profileGrid}>
        <label className="field">
          <span>Duración máxima (s)</span>
          <input
            type="number"
            min={5}
            max={1800}
            value={selected.max_duration_seconds}
            disabled={busy}
            onChange={(event) =>
              patchSelected({ max_duration_seconds: Number(event.target.value) || 60 })
            }
          />
        </label>
        <label className="field">
          <span>Fotogramas</span>
          <select
            value={selected.fps_mode}
            disabled={busy}
            onChange={(event) =>
              patchSelected({ fps_mode: event.target.value as ExportProfile['fps_mode'] })
            }
          >
            <option value="original">Igual al original</option>
            <option value="fixed_30">Fijo 30</option>
          </select>
        </label>
        <label className="field">
          <span>Margen superior</span>
          <input
            type="number"
            min={0}
            max={0.4}
            step={0.01}
            value={selected.safe_top}
            disabled={busy}
            onChange={(event) => patchSelected({ safe_top: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>Margen inferior</span>
          <input
            type="number"
            min={0}
            max={0.4}
            step={0.01}
            value={selected.safe_bottom}
            disabled={busy}
            onChange={(event) => patchSelected({ safe_bottom: Number(event.target.value) })}
          />
        </label>
        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={selected.fragmentation_enabled}
            disabled={busy}
            onChange={(event) => patchSelected({ fragmentation_enabled: event.target.checked })}
          />
          <span>Trocear para WhatsApp</span>
        </label>
      </div>

      <button type="button" disabled={busy} onClick={() => void handleSave()}>
        {busy ? 'Guardando…' : 'Guardar perfil'}
      </button>
      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

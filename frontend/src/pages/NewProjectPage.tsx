import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { createProject, uploadProjectCover, uploadProjectVideo } from '../api/projects';
import {
  cancelYouTubeImport,
  getYouTubeImportJob,
  previewYouTube,
  startYouTubeImport,
} from '../api/youtube';
import { ProgressBar } from '../components/ProgressBar';
import type { YouTubeImportJob, YouTubePreview, YouTubeQuality } from '../types/youtube';
import { DEFAULT_CHURCH_NAME, DEFAULT_YOUTUBE_CHANNEL } from '../utils/projectDefaults';

const VIDEO_ACCEPT = '.mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/webm,video/x-matroska';
const COVER_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

const RIGHTS_NOTICE =
  'Importa únicamente videos propios o para los que tengas autorización. El usuario es ' +
  'responsable de respetar los derechos de autor y las condiciones de la plataforma.';

type VideoSource = 'local' | 'youtube';
type ContentMode = 'shorts' | 'highlights' | 'both';
type SourceKind = 'full_service' | 'sermon_only';
type Step = 'idle' | 'creating' | 'video' | 'importing' | 'cover' | 'done';

const ACTIVE_IMPORT_STATUSES = new Set([
  'queued',
  'validating',
  'fetching_metadata',
  'downloading_video',
  'downloading_audio',
  'merging',
  'probing',
  'cancelling',
]);

const IMPORT_STAGE_LABELS: Record<string, string> = {
  queued: 'En cola…',
  validating: 'Validando enlace…',
  fetching_metadata: 'Obteniendo información del video…',
  downloading_video: 'Descargando video…',
  downloading_audio: 'Descargando audio…',
  merging: 'Combinando video y audio…',
  probing: 'Validando el archivo descargado…',
  completed: 'Importación completada',
  cancelling: 'Cancelando…',
  cancelled: 'Importación cancelada',
  failed: 'La importación falló',
};

function formatDuration(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function importDetail(job: YouTubeImportJob): string {
  const parts: string[] = [];
  if (job.downloaded_bytes && job.total_bytes) {
    parts.push(`${formatBytes(job.downloaded_bytes)} / ${formatBytes(job.total_bytes)}`);
  } else if (job.downloaded_bytes) {
    parts.push(formatBytes(job.downloaded_bytes));
  }
  if (job.speed_bps) parts.push(`${formatBytes(job.speed_bps)}/s`);
  if (job.eta_seconds != null && job.eta_seconds > 0) {
    parts.push(`faltan ${formatDuration(job.eta_seconds)}`);
  }
  return parts.join(' · ');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function NewProjectPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [preacherName, setPreacherName] = useState('');
  const [bibleReference, setBibleReference] = useState('');
  const [churchName, setChurchName] = useState(DEFAULT_CHURCH_NAME);
  const [youtubeChannel, setYoutubeChannel] = useState(DEFAULT_YOUTUBE_CHANNEL);
  const [fullSermonUrl, setFullSermonUrl] = useState('');
  const [contentMode, setContentMode] = useState<ContentMode>('shorts');
  const [sourceKind, setSourceKind] = useState<SourceKind>('full_service');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [videoProgress, setVideoProgress] = useState(0);
  const [coverProgress, setCoverProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // YouTube source state.
  const [videoSource, setVideoSource] = useState<VideoSource>('local');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [quality, setQuality] = useState<YouTubeQuality>('1080p');
  const [preview, setPreview] = useState<YouTubePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [importJob, setImportJob] = useState<YouTubeImportJob | null>(null);
  const cancelRef = useRef(false);

  const busy = step !== 'idle' && step !== 'done';

  const handleCheckVideo = useCallback(async () => {
    setPreviewError(null);
    setPreview(null);
    const url = youtubeUrl.trim();
    if (!url) {
      setPreviewError('Pega el enlace de un video de YouTube.');
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await previewYouTube(url);
      setPreview(result);
    } catch (err) {
      if (err instanceof ApiError) setPreviewError(err.message);
      else setPreviewError(err instanceof Error ? err.message : 'No se pudo comprobar el video');
    } finally {
      setPreviewLoading(false);
    }
  }, [youtubeUrl]);

  const pollImport = useCallback(async (jobId: string): Promise<YouTubeImportJob> => {
    let job = await getYouTubeImportJob(jobId);
    setImportJob(job);
    while (ACTIVE_IMPORT_STATUSES.has(job.status) && !cancelRef.current) {
      await sleep(1200);
      job = await getYouTubeImportJob(jobId);
      setImportJob(job);
    }
    return job;
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    cancelRef.current = false;

    if (videoSource === 'local' && !videoFile) {
      setError('Selecciona el video de la predicación.');
      return;
    }
    if (videoSource === 'youtube') {
      if (!preview) {
        setError('Comprueba el video de YouTube antes de importarlo.');
        return;
      }
      if (!rightsAccepted) {
        setError('Debes aceptar el aviso de derechos antes de importar.');
        return;
      }
    }

    try {
      setStep('creating');
      const mediaUrl = videoSource === 'youtube' ? youtubeUrl.trim() : fullSermonUrl.trim();
      const project = await createProject({
        title: title.trim(),
        preacher_name: preacherName.trim() || null,
        bible_reference: bibleReference.trim() || null,
        church_name: churchName.trim(),
        youtube_channel: youtubeChannel.trim(),
        full_sermon_url: mediaUrl || null,
        content_mode: contentMode,
        source_kind: sourceKind,
      });

      if (videoSource === 'local') {
        setStep('video');
        setVideoProgress(0);
        await uploadProjectVideo(project.id, videoFile as File, setVideoProgress);
      } else {
        setStep('importing');
        const started = await startYouTubeImport(project.id, youtubeUrl.trim(), quality);
        setImportJob(started);
        const finished = await pollImport(started.id);
        if (finished.status !== 'completed') {
          setStep('idle');
          if (finished.status === 'cancelled') {
            setError('Importación cancelada. Puedes intentarlo de nuevo o subir un archivo.');
          } else {
            setError(
              finished.error_message ??
                'No se pudo importar el video de YouTube. Revisa la URL e inténtalo de nuevo.',
            );
          }
          return;
        }
      }

      if (coverFile) {
        setStep('cover');
        setCoverProgress(0);
        await uploadProjectCover(project.id, coverFile, setCoverProgress);
      }

      setStep('done');
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setStep('idle');
      if (err instanceof ApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : 'No se pudo crear el proyecto');
    }
  }

  async function handleCancelImport() {
    if (!importJob) return;
    cancelRef.current = true;
    try {
      const cancelled = await cancelYouTubeImport(importJob.id);
      setImportJob(cancelled);
    } catch {
      // The poll loop will still stop; surface nothing extra here.
    }
  }

  const importPercent = importJob ? Math.round(importJob.progress * 100) : 0;
  const importLabel = importJob
    ? (IMPORT_STAGE_LABELS[importJob.status] ?? 'Importando…')
    : 'Importando…';

  return (
    <main className="page">
      <header className="page__header">
        <p className="eyebrow">
          <Link to="/projects">← Proyectos</Link>
        </p>
        <h1>Nueva predicación</h1>
        <p>
          Indique si es el culto o solo el sermón, complete los datos y elija el origen del video.
        </p>
      </header>

      <form className="card form" onSubmit={(event) => void handleSubmit(event)}>
        <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
          <span>¿Qué contiene el video? *</span>
          <div className="source-toggle" role="radiogroup" aria-label="Tipo de grabación">
            <label className="source-toggle__option">
              <input
                type="radio"
                name="source-kind"
                value="full_service"
                checked={sourceKind === 'full_service'}
                onChange={() => setSourceKind('full_service')}
                disabled={busy}
              />
              <span>
                Culto completo
                <small>Luego marcará inicio y final de la predicación</small>
              </span>
            </label>
            <label className="source-toggle__option">
              <input
                type="radio"
                name="source-kind"
                value="sermon_only"
                checked={sourceKind === 'sermon_only'}
                onChange={() => setSourceKind('sermon_only')}
                disabled={busy}
              />
              <span>
                Solo el sermón
                <small>El archivo ya es la predicación</small>
              </span>
            </label>
          </div>
        </fieldset>

        <label className="field">
          <span>Título *</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            maxLength={300}
          />
        </label>

        <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
          <span>Tipo de contenido *</span>
          <div className="source-toggle" role="radiogroup" aria-label="Tipo de contenido">
            {[
              ['shorts', 'Crear Shorts'],
              ['highlights', 'Crear Video Highlights'],
              ['both', 'Crear ambos'],
            ].map(([value, label]) => (
              <label className="source-toggle__option" key={value}>
                <input
                  type="radio"
                  name="content-mode"
                  value={value}
                  checked={contentMode === value}
                  onChange={() => setContentMode(value as ContentMode)}
                  disabled={busy}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Predicador</span>
          <input
            value={preacherName}
            onChange={(e) => setPreacherName(e.target.value)}
            disabled={busy}
            maxLength={200}
          />
        </label>

        <label className="field">
          <span>Referencia bíblica</span>
          <input
            value={bibleReference}
            onChange={(e) => setBibleReference(e.target.value)}
            disabled={busy}
            placeholder="Ej. Juan 3:16"
            maxLength={200}
          />
        </label>

        <label className="field">
          <span>Iglesia *</span>
          <input
            required
            value={churchName}
            onChange={(e) => setChurchName(e.target.value)}
            disabled={busy}
            maxLength={200}
          />
        </label>

        <label className="field">
          <span>Canal de YouTube *</span>
          <input
            required
            value={youtubeChannel}
            onChange={(e) => setYoutubeChannel(e.target.value)}
            disabled={busy}
            placeholder="@iprm.gethsemani"
            maxLength={200}
          />
        </label>

        <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
          <span>Origen del video *</span>
          <div className="source-toggle" role="radiogroup" aria-label="Origen del video">
            <label className="source-toggle__option">
              <input
                type="radio"
                name="video-source"
                value="local"
                checked={videoSource === 'local'}
                onChange={() => setVideoSource('local')}
                disabled={busy}
              />
              <span>Archivo local</span>
            </label>
            <label className="source-toggle__option">
              <input
                type="radio"
                name="video-source"
                value="youtube"
                checked={videoSource === 'youtube'}
                onChange={() => {
                  setVideoSource('youtube');
                  if (!youtubeUrl.trim() && fullSermonUrl.trim()) {
                    setYoutubeUrl(fullSermonUrl);
                  }
                }}
                disabled={busy}
              />
              <span>URL de YouTube</span>
            </label>
          </div>
        </fieldset>

        {videoSource === 'local' && (
          <label className="field">
            <span>Video (MP4, MOV, MKV, WebM) *</span>
            <input
              type="file"
              accept={VIDEO_ACCEPT}
              disabled={busy}
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}

        {videoSource === 'local' && (
          <label className="field">
            <span>Enlace del sermón completo</span>
            <input
              type="url"
              value={fullSermonUrl}
              onChange={(e) => setFullSermonUrl(e.target.value)}
              disabled={busy}
              placeholder="https://..."
            />
          </label>
        )}

        {videoSource === 'youtube' && (
          <div className="youtube-import">
            <label className="field">
              <span>URL de YouTube (también queda como enlace del sermón completo)</span>
              <div className="youtube-import__row">
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => {
                    const value = e.target.value;
                    setYoutubeUrl(value);
                    setFullSermonUrl(value);
                    setPreview(null);
                  }}
                  disabled={busy}
                  placeholder="https://www.youtube.com/watch?v=…"
                />
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void handleCheckVideo()}
                  disabled={busy || previewLoading || !youtubeUrl.trim()}
                >
                  {previewLoading ? 'Comprobando…' : 'Comprobar video'}
                </button>
              </div>
            </label>

            {previewError && <p className="error">{previewError}</p>}

            {preview && (
              <div className="youtube-preview">
                {preview.thumbnail_url && (
                  <img
                    className="youtube-preview__thumb"
                    src={preview.thumbnail_url}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="youtube-preview__meta">
                  <strong>{preview.title ?? 'Video de YouTube'}</strong>
                  {preview.channel && <span className="muted">{preview.channel}</span>}
                  <span className="muted">
                    {[
                      formatDuration(preview.duration_seconds),
                      preview.resolution_label,
                      preview.upload_date,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              </div>
            )}

            <label className="field">
              <span>Calidad</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as YouTubeQuality)}
                disabled={busy}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p (recomendado)</option>
                <option value="best">Mejor disponible</option>
              </select>
            </label>

            <p className="notice notice--warning">{RIGHTS_NOTICE}</p>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rightsAccepted}
                onChange={(e) => setRightsAccepted(e.target.checked)}
                disabled={busy}
              />
              <span>He leído y acepto el aviso de derechos.</span>
            </label>
          </div>
        )}

        <label className="field">
          <span>Portada (JPG, PNG, WebP)</span>
          <input
            type="file"
            accept={COVER_ACCEPT}
            disabled={busy}
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {step === 'creating' && <p className="muted">Creando proyecto…</p>}
        {step === 'video' && <ProgressBar label="Subiendo video" percent={videoProgress} />}
        {(step === 'importing' || step === 'cover') && importJob && (
          <div className="youtube-import__progress">
            <ProgressBar label={importLabel} percent={importPercent} />
            {importDetail(importJob) && <p className="muted">{importDetail(importJob)}</p>}
            {ACTIVE_IMPORT_STATUSES.has(importJob.status) && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void handleCancelImport()}
                disabled={importJob.status === 'cancelling'}
              >
                {importJob.status === 'cancelling' ? 'Cancelando…' : 'Cancelar importación'}
              </button>
            )}
          </div>
        )}
        {step === 'cover' && <ProgressBar label="Subiendo portada" percent={coverProgress} />}

        {error && <p className="error">{error}</p>}

        <button
          type="submit"
          className="button"
          disabled={busy || (videoSource === 'youtube' && (!preview || !rightsAccepted))}
        >
          {busy ? 'Procesando…' : 'Crear proyecto'}
        </button>
      </form>
    </main>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { createProject, uploadProjectCover, uploadProjectVideo } from '../api/projects';
import { ProgressBar } from '../components/ProgressBar';

const VIDEO_ACCEPT = '.mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/webm,video/x-matroska';
const COVER_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

type Step = 'idle' | 'creating' | 'video' | 'cover' | 'done';

export function NewProjectPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [preacherName, setPreacherName] = useState('');
  const [bibleReference, setBibleReference] = useState('');
  const [churchName, setChurchName] = useState('');
  const [youtubeChannel, setYoutubeChannel] = useState('');
  const [fullSermonUrl, setFullSermonUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [videoProgress, setVideoProgress] = useState(0);
  const [coverProgress, setCoverProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = step !== 'idle' && step !== 'done';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!videoFile) {
      setError('Selecciona el video de la predicación.');
      return;
    }

    try {
      setStep('creating');
      const project = await createProject({
        title: title.trim(),
        preacher_name: preacherName.trim() || null,
        bible_reference: bibleReference.trim() || null,
        church_name: churchName.trim(),
        youtube_channel: youtubeChannel.trim(),
        full_sermon_url: fullSermonUrl.trim() || null,
      });

      setStep('video');
      setVideoProgress(0);
      await uploadProjectVideo(project.id, videoFile, setVideoProgress);

      if (coverFile) {
        setStep('cover');
        setCoverProgress(0);
        await uploadProjectCover(project.id, coverFile, setCoverProgress);
      }

      setStep('done');
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setStep('idle');
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo crear el proyecto');
      }
    }
  }

  return (
    <main className="page">
      <header className="page__header">
        <p className="eyebrow">
          <Link to="/projects">← Proyectos</Link>
        </p>
        <h1>Nueva predicación</h1>
        <p>Completa los datos y sube el video (y opcionalmente la portada).</p>
      </header>

      <form className="card form" onSubmit={(event) => void handleSubmit(event)}>
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
            placeholder="@micategoria o nombre del canal"
            maxLength={200}
          />
        </label>

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

        <label className="field">
          <span>Video (MP4, MOV, MKV, WebM) *</span>
          <input
            required
            type="file"
            accept={VIDEO_ACCEPT}
            disabled={busy}
            onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
          />
        </label>

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
        {(step === 'video' || videoProgress > 0) && (
          <ProgressBar label="Subiendo video" percent={videoProgress} />
        )}
        {(step === 'cover' || coverProgress > 0) && (
          <ProgressBar label="Subiendo portada" percent={coverProgress} />
        )}

        {error && <p className="error">{error}</p>}

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Subiendo…' : 'Crear proyecto'}
        </button>
      </form>
    </main>
  );
}

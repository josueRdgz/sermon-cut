import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  cancelHighlightAnalysis,
  detectSermon,
  getHighlightAnalysisJob,
  getHighlightPlan,
  highlightPreviewUrl,
  highlightSrtUrl,
  prepareHighlightPreview,
  renderHighlight,
  saveHighlightMetadata,
  saveHighlightReview,
  startHighlightAnalysis,
  updateSermonRange,
} from '../api/highlights';
import { ApiError } from '../api/client';
import { cancelRenderJob, getRenderJob, renderOutputUrl, revealRenderOutput } from '../api/renders';
import type {
  EditorialStyle,
  HighlightAnalysisJob,
  HighlightPlan,
  HighlightSegment,
  StrategicTitles,
  SubtitleDelivery,
} from '../types/highlight';
import type { Project } from '../types/project';
import type { RenderJob } from '../types/render';
import {
  CHURCH_REELS_CONTEXT,
  EDITORIAL_PRESETS,
  extraEditorialInstructions,
  type EditorialPresetId,
} from '../utils/editorialPresets';
import { formatDuration } from '../utils/format';
import { nativeVideoControlProps } from '../utils/nativeMediaControls';
import { pinWorkspaceNav } from '../utils/workspaceScroll';
import { highlightPullQuote } from '../utils/highlightQuote';
import {
  highlightAssembledDuration,
  highlightPreviewIdentity,
  resolveHighlightPreviewSeek,
} from '../utils/highlightPreview';
import { ProgressBar } from './ProgressBar';
import { BackgroundMusicPanel } from './BackgroundMusicPanel';
import { EndCardPanel } from './EndCardPanel';

interface Props {
  projectId: string;
  hasVideo: boolean;
  hasCover: boolean;
  videoDuration: number | null;
  transcriptRevision: number;
  churchName?: string | null;
  onCoverUpdated?: (project: Project) => void;
}

const HIGHLIGHT_TOOLS = [
  { id: 'detect', label: 'Detección', description: 'Intervalo de la predicación' },
  { id: 'analysis', label: 'Análisis', description: 'Estilo y selección IA' },
  { id: 'review', label: 'Revisión', description: 'Fragmentos y preview' },
  { id: 'metadata', label: 'Título', description: 'Metadatos de YouTube' },
  { id: 'end-card', label: 'Pantalla final', description: 'Imagen y llamado' },
  { id: 'audio', label: 'Audio', description: 'Música de fondo' },
  { id: 'export', label: 'Exportar', description: 'Subtítulos y MP4' },
] as const;

type HighlightTool = (typeof HIGHLIGHT_TOOLS)[number]['id'];

const ACTIVE_ANALYSIS = new Set(['queued', 'running', 'cancelling']);
const ACTIVE_RENDER = new Set(['queued', 'running', 'cancelling']);
const TITLE_LABELS: Record<keyof StrategicTitles, string> = {
  recommended: 'Recomendado',
  direct: 'Más directo',
  emotional: 'Más emocional',
  biblical: 'Más bíblico',
  search_focused: 'Más orientado a búsquedas',
};
const STYLE_LABELS: Record<EditorialStyle, string> = {
  balanced: 'Equilibrado',
  doctrinal: 'Más doctrinal',
  emotional: 'Más emocional',
  evangelistic: 'Más evangelístico',
  educational: 'Más educativo',
  brief: 'Más breve',
};
const STYLE_HELP: Record<EditorialStyle, string> = {
  balanced: 'Gancho, mejor frase, pulso bíblico, aplicación concreta y cierre.',
  doctrinal: 'Texto y argumento fieles, más la aplicación pastoral de esa doctrina.',
  emotional: 'Frases que tocan conciencia o esperanza, convertidas en aplicación.',
  evangelistic: 'Problema humano, frase clara del evangelio e invitación.',
  educational: 'Una idea enseñable y una práctica para esta semana.',
  brief: 'Solo la mejor frase, la mejor aplicación y un cierre.',
};
const CATEGORY_LABELS: Record<string, string> = {
  hook: 'Gancho',
  theme: 'Tema',
  biblical: 'Desarrollo bíblico',
  application: 'Aplicación',
  illustration: 'Ilustración',
  conclusion: 'Conclusión',
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function setMediaTime(media: HTMLMediaElement, seconds: number): boolean {
  if (media.readyState < HTMLMediaElement.HAVE_METADATA) return false;
  const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
  const target = Math.max(0, duration == null ? seconds : Math.min(seconds, duration));
  try {
    media.currentTime = target;
    return true;
  } catch {
    return false;
  }
}

export function VideoHighlightsPanel({
  projectId,
  hasVideo,
  hasCover,
  videoDuration,
  transcriptRevision,
  churchName,
  onCoverUpdated,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewingRef = useRef(false);
  const previewIndexRef = useRef(0);
  const mounted = useRef(true);
  const openedReview = useRef(false);
  const [plan, setPlan] = useState<HighlightPlan | null>(null);
  const [segments, setSegments] = useState<HighlightSegment[]>([]);
  const [analysisJob, setAnalysisJob] = useState<HighlightAnalysisJob | null>(null);
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(videoDuration ?? 0);
  const [durationPreset, setDurationPreset] = useState('300');
  const [customDuration, setCustomDuration] = useState(300);
  const [style, setStyle] = useState<EditorialStyle>('balanced');
  const [preset, setPreset] = useState<EditorialPresetId>('church');
  const [editorialContext, setEditorialContext] = useState(CHURCH_REELS_CONTEXT);
  const [activeTool, setActiveTool] = useState<HighlightTool>('detect');
  const [subtitleDelivery, setSubtitleDelivery] = useState<SubtitleDelivery>('burned');
  const [chosenTitle, setChosenTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailText, setThumbnailText] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [keywords, setKeywords] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewOutputTime, setPreviewOutputTime] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewPreparing, setPreviewPreparing] = useState(false);

  function chooseTool(tool: HighlightTool) {
    setActiveTool(tool);
    window.requestAnimationFrame(pinWorkspaceNav);
  }

  const applyPlan = useCallback((next: HighlightPlan) => {
    setPlan(next);
    setSegments(next.segments);
    setStart(next.sermon_start ?? 0);
    setEnd(next.sermon_end ?? 0);
    setStyle(next.editorial_style);
    setSubtitleDelivery(next.subtitle_delivery);
    const metadata = next.metadata;
    setChosenTitle(metadata?.chosen_title ?? metadata?.suggested_titles?.recommended ?? '');
    setDescription(metadata?.description ?? '');
    setThumbnailText(metadata?.thumbnail_text ?? '');
    setHashtags(metadata?.hashtags.join(' ') ?? '');
    setKeywords(metadata?.keywords.join(', ') ?? '');
  }, []);

  useEffect(() => {
    mounted.current = true;
    setError(null);
    getHighlightPlan(projectId)
      .then((next) => mounted.current && applyPlan(next))
      .catch((reason: unknown) => {
        if (mounted.current) setError(errorText(reason));
      });
    return () => {
      mounted.current = false;
    };
  }, [applyPlan, projectId, transcriptRevision]);

  async function handleDetect() {
    setBusy('detect');
    setError(null);
    setMessage(null);
    try {
      const next = await detectSermon(projectId);
      applyPlan(next);
      setMessage(
        next.requires_manual_range
          ? 'La confianza es limitada. Confirme manualmente los tiempos antes del análisis.'
          : 'Intervalo detectado. Revise los tiempos y confirme si es necesario.',
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveRange() {
    setBusy('range');
    setError(null);
    try {
      applyPlan(await updateSermonRange(projectId, start, end));
      setMessage('Intervalo de predicación confirmado.');
      chooseTool('analysis');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }

  async function handleAnalyze() {
    const target = durationPreset === 'custom' ? customDuration : Number(durationPreset);
    setBusy('analysis');
    setError(null);
    setMessage(null);
    try {
      let job = await startHighlightAnalysis(
        projectId,
        target,
        style,
        extraEditorialInstructions(preset, editorialContext),
      );
      setAnalysisJob(job);
      while (mounted.current && ACTIVE_ANALYSIS.has(job.status)) {
        await wait(1200);
        job = await getHighlightAnalysisJob(job.id);
        setAnalysisJob(job);
      }
      if (job.status === 'completed' && job.plan) {
        applyPlan(job.plan);
        chooseTool('review');
        const applications = job.plan.segments.filter(
          (item) => item.category === 'application',
        ).length;
        setMessage(
          applications
            ? `Selección lista: ${job.plan.segments.length} fragmentos, ${applications} aplicación${applications === 1 ? '' : 'es'}. Revise las frases destacadas.`
            : 'Selección generada. Revise cada fragmento y agregue una aplicación si falta.',
        );
      } else if (job.status === 'failed') {
        setError(job.error_message ?? 'El análisis no se pudo completar.');
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function handleCancelAnalysis() {
    if (!analysisJob) return;
    try {
      setAnalysisJob(await cancelHighlightAnalysis(analysisJob.id));
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  function updateSegment(index: number, patch: Partial<HighlightSegment>) {
    setSegments((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }

  function moveSegment(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= segments.length) return;
    setSegments((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next.map((item, order) => ({ ...item, order }));
    });
  }

  function stopPreview() {
    previewingRef.current = false;
    setPreviewing(false);
    videoRef.current?.pause();
  }

  const markActiveSegment = useCallback(
    (outputSeconds: number) => {
      const target = resolveHighlightPreviewSeek(segments, outputSeconds);
      if (!target) return;
      if (previewIndexRef.current !== target.segmentIndex) {
        previewIndexRef.current = target.segmentIndex;
        setPreviewIndex(target.segmentIndex);
      }
      setPreviewOutputTime(target.outputTime);
    },
    [segments],
  );

  function seekPreview(outputSeconds: number) {
    const target = resolveHighlightPreviewSeek(segments, outputSeconds);
    if (!target) return;
    markActiveSegment(target.outputTime);
    const video = videoRef.current;
    if (video) setMediaTime(video, target.outputTime);
  }

  function startPreview(fromOutput = previewOutputTime) {
    const video = videoRef.current;
    if (!video || !previewSrc || segments.length === 0) return;
    const total = highlightAssembledDuration(segments);
    const startAt = fromOutput >= total - 0.05 ? 0 : fromOutput;
    const begin = () => {
      seekPreview(startAt);
      previewingRef.current = true;
      setPreviewing(true);
      void video.play().catch((reason: unknown) => {
        stopPreview();
        setError(reason instanceof Error ? reason.message : 'El navegador bloqueó la reproducción');
      });
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) begin();
    else video.addEventListener('loadedmetadata', begin, { once: true });
  }

  function playFromSegment(index: number) {
    const output = segments
      .slice(0, index)
      .reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0);
    startPreview(output);
  }

  useEffect(() => {
    if (!openedReview.current && segments.length > 0) {
      openedReview.current = true;
      setActiveTool('review');
    }
  }, [segments.length]);

  const assembledDuration = useMemo(() => highlightAssembledDuration(segments), [segments]);
  const previewIdentity = useMemo(() => highlightPreviewIdentity(segments), [segments]);
  const applicationCount = useMemo(
    () => segments.filter((item) => item.category === 'application').length,
    [segments],
  );

  useEffect(() => {
    if (segments.length === 0) {
      setPreviewSrc(null);
      setPreviewPreparing(false);
      return;
    }
    const controller = new AbortController();
    setPreviewPreparing(true);
    setPreviewSrc(null);
    previewingRef.current = false;
    setPreviewing(false);
    previewIndexRef.current = 0;
    setPreviewIndex(0);
    setPreviewOutputTime(0);
    const clips = segments.map((item) => ({ start: item.start, end: item.end }));
    prepareHighlightPreview(projectId, clips, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPreviewSrc(highlightPreviewUrl(projectId, result.identity));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.code === 'request_cancelled') return;
        setPreviewSrc(null);
        setError(errorText(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewPreparing(false);
      });
    return () => controller.abort();
  }, [previewIdentity, projectId]); // eslint-disable-line react-hooks/exhaustive-deps -- clip times/order only

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const player = video;

    function onTimeUpdate() {
      markActiveSegment(player.currentTime);
    }

    function onPlay() {
      previewingRef.current = true;
      setPreviewing(true);
    }

    function onPause() {
      previewingRef.current = false;
      setPreviewing(false);
    }

    player.addEventListener('timeupdate', onTimeUpdate);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('ended', onPause);
    return () => {
      player.removeEventListener('timeupdate', onTimeUpdate);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('ended', onPause);
    };
  }, [markActiveSegment, previewSrc]);

  async function handleSaveReview() {
    setBusy('review');
    setError(null);
    try {
      applyPlan(await saveHighlightReview(projectId, segments));
      setMessage('Revisión guardada.');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveMetadata() {
    setBusy('metadata');
    setError(null);
    try {
      applyPlan(
        await saveHighlightMetadata(projectId, {
          chosen_title: chosenTitle,
          description,
          thumbnail_text: thumbnailText,
          hashtags: hashtags.split(/\s+/).filter(Boolean),
          keywords: keywords
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      );
      setMessage('Título y metadatos guardados.');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }

  async function handleRender() {
    setBusy('render');
    setError(null);
    setMessage(null);
    try {
      const started = await renderHighlight(projectId, {
        subtitle_delivery: subtitleDelivery,
        normalize_loudness: true,
        quality: 'standard',
      });
      let job = await getRenderJob(started.render_job_id);
      setRenderJob(job);
      while (mounted.current && ACTIVE_RENDER.has(job.status)) {
        await wait(1000);
        job = await getRenderJob(job.id);
        setRenderJob(job);
      }
      if (job.status === 'completed') {
        setMessage('Video Highlights renderizado y verificado.');
      } else if (job.status === 'failed') {
        setError(job.error_message ?? 'El renderizado no se pudo completar.');
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  if (!hasVideo) {
    return (
      <section className="card">
        <p className="muted">Importe un video para crear Video Highlights.</p>
      </section>
    );
  }

  const targetDuration = durationPreset === 'custom' ? customDuration : Number(durationPreset);
  const titles = plan?.metadata?.suggested_titles;

  return (
    <div className="stack highlights-editor">
      <div className="highlights-editor__sticky-header">
        <nav className="editor-tool-nav" aria-label="Herramientas de Highlights">
          <div className="editor-tool-nav__track" role="tablist">
            {HIGHLIGHT_TOOLS.map((tool, index) => (
              <button
                key={tool.id}
                id={`highlight-tool-tab-${tool.id}`}
                type="button"
                role="tab"
                aria-selected={activeTool === tool.id}
                aria-controls={`highlight-tool-panel-${tool.id}`}
                className={`editor-tool-nav__tab${
                  activeTool === tool.id ? ' editor-tool-nav__tab--active' : ''
                }`}
                onClick={() => chooseTool(tool.id)}
              >
                <span className="editor-tool-nav__number">{index + 1}</span>
                <span>
                  <strong>{tool.label}</strong>
                  <small>{tool.description}</small>
                </span>
              </button>
            ))}
          </div>
        </nav>
        {message && <p className="success editor-sticky-notice">{message}</p>}
        {error && <p className="error editor-sticky-notice">{error}</p>}
      </div>

      <section
        id="highlight-tool-panel-detect"
        role="tabpanel"
        aria-labelledby="highlight-tool-tab-detect"
        className="card"
        hidden={activeTool !== 'detect'}
      >
        <p className="eyebrow">Detección</p>
        <h2>Intervalo de la predicación</h2>
        <p className="muted">
          La detección combina continuidad de voz, pausas, densidad temática y señales de apertura o
          cierre. Los tiempos siempre quedan disponibles para confirmación manual.
        </p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void handleDetect()}
          disabled={busy !== null}
        >
          {busy === 'detect' ? 'Detectando…' : 'Detectar predicación'}
        </button>
        <div className="form-grid">
          <label className="field">
            <span>Inicio (segundos)</span>
            <input
              type="number"
              min={0}
              max={videoDuration ?? undefined}
              step="0.1"
              value={start}
              onChange={(event) => setStart(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Final (segundos)</span>
            <input
              type="number"
              min={0}
              max={videoDuration ?? undefined}
              step="0.1"
              value={end}
              onChange={(event) => setEnd(Number(event.target.value))}
            />
          </label>
        </div>
        {plan?.sermon_confidence != null && (
          <p className={plan.requires_manual_range ? 'warning' : 'muted'}>
            Confianza: {Math.round(plan.sermon_confidence * 100)}% · {plan.detection_notes}
          </p>
        )}
        <button
          className="button"
          type="button"
          onClick={() => void handleSaveRange()}
          disabled={busy !== null || end <= start}
        >
          Confirmar intervalo
        </button>
      </section>

      <section
        id="highlight-tool-panel-analysis"
        role="tabpanel"
        aria-labelledby="highlight-tool-tab-analysis"
        className="card"
        hidden={activeTool !== 'analysis'}
      >
        <p className="eyebrow">Análisis y selección</p>
        <h2>Configurar Video Highlights</h2>
        {churchName ? <p className="muted">Iglesia: {churchName}</p> : null}
        <div className="form-grid">
          <label className="field">
            <span>Duración objetivo</span>
            <select
              value={durationPreset}
              onChange={(event) => setDurationPreset(event.target.value)}
            >
              <option value="180">3 minutos</option>
              <option value="300">5 minutos</option>
              <option value="480">8 minutos</option>
              <option value="600">10 minutos</option>
              <option value="custom">Personalizada</option>
            </select>
          </label>
          {durationPreset === 'custom' && (
            <label className="field">
              <span>Segundos (60–900)</span>
              <input
                type="number"
                min={60}
                max={900}
                value={customDuration}
                onChange={(event) => setCustomDuration(Number(event.target.value))}
              />
            </label>
          )}
          <label className="field">
            <span>Orientación editorial</span>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value as EditorialStyle)}
            >
              {Object.entries(STYLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">{STYLE_HELP[style]}</p>
        <label className="field">
          <span>Estilo de clip</span>
          <select
            value={preset}
            onChange={(event) => {
              const next = event.target.value as EditorialPresetId;
              setPreset(next);
              const match = EDITORIAL_PRESETS.find((item) => item.id === next);
              if (match && match.text) setEditorialContext(match.text);
            }}
          >
            {EDITORIAL_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Contexto para la IA</span>
          <textarea
            rows={4}
            value={editorialContext}
            placeholder="Cómo deben sentirse los Highlights: frases, aplicaciones, tono de la iglesia…"
            onChange={(event) => {
              setPreset('custom');
              setEditorialContext(event.target.value);
            }}
          />
        </label>
        <button
          className="button"
          type="button"
          onClick={() => void handleAnalyze()}
          disabled={
            busy !== null ||
            plan?.sermon_start == null ||
            plan?.sermon_end == null ||
            plan.requires_manual_range ||
            targetDuration < 60 ||
            targetDuration > 900
          }
        >
          {busy === 'analysis'
            ? 'Analizando…'
            : segments.length
              ? 'Regenerar selección con IA'
              : 'Analizar y seleccionar Highlights'}
        </button>
        {analysisJob && ACTIVE_ANALYSIS.has(analysisJob.status) && (
          <>
            <ProgressBar
              label="Progreso del análisis"
              percent={Math.round(analysisJob.progress * 100)}
            />
            <p className="muted">{analysisStage(analysisJob.stage)}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void handleCancelAnalysis()}
            >
              Cancelar análisis
            </button>
          </>
        )}
      </section>

      <section
        id="highlight-tool-panel-review"
        role="tabpanel"
        aria-labelledby="highlight-tool-tab-review"
        className="card"
        hidden={activeTool !== 'review'}
      >
        {segments.length === 0 ? (
          <p className="muted">Analice primero para revisar fragmentos y escuchar el preview.</p>
        ) : (
          <>
            <p className="eyebrow">Revisión editorial</p>
            <h2>Fragmentos seleccionados</h2>
            <p>
              {segments.length} fragmentos · {applicationCount} aplicación
              {applicationCount === 1 ? '' : 'es'} · duración estimada{' '}
              <strong>{formatDuration(assembledDuration)}</strong>
            </p>
            <div className="reel-preview">
              {previewSrc ? (
                <video
                  key={previewSrc}
                  ref={videoRef}
                  className="media-player"
                  {...nativeVideoControlProps}
                  preload="metadata"
                  src={previewSrc}
                />
              ) : (
                <div
                  className="media-player media-player--placeholder"
                  aria-busy={previewPreparing}
                >
                  {previewPreparing
                    ? 'Preparando el preview con imagen y audio…'
                    : 'El preview de Highlights no está listo.'}
                </div>
              )}
              <div className="reel-preview__controls">
                <button
                  type="button"
                  className="button button--secondary button--inline"
                  disabled={!previewSrc || previewPreparing}
                  onClick={() => (previewing ? stopPreview() : startPreview())}
                >
                  {previewPreparing
                    ? 'Preparando…'
                    : previewing
                      ? 'Pausar'
                      : 'Reproducir Highlights'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(assembledDuration, 0.01)}
                  step={0.05}
                  value={Math.min(previewOutputTime, assembledDuration)}
                  aria-label="Posición en el video de Highlights"
                  disabled={!previewSrc}
                  onChange={(event) => seekPreview(Number(event.target.value))}
                />
                <span className="reel-preview__time">
                  {formatDuration(previewOutputTime)} / {formatDuration(assembledDuration)}
                </span>
              </div>
              <p className="muted">
                {previewPreparing
                  ? 'La primera vez puede tardar uno o dos minutos: se arma un MP4 corto solo con los fragmentos, con audio y seek.'
                  : 'Vista ensamblada: solo los fragmentos, en orden, con imagen y audio.'}
                {segments[previewIndex]
                  ? ` Fragmento ${previewIndex + 1}: ${CATEGORY_LABELS[segments[previewIndex].category] ?? segments[previewIndex].category}.`
                  : ''}
              </p>
            </div>
            <div className="stack">
              {segments.map((segment, index) => (
                <article
                  className={`card card--nested${previewIndex === index ? ' card--active' : ''}${segment.category === 'application' ? ' card--application' : ''}`}
                  key={segment.id || `segment-${index}`}
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">
                        {index + 1} · {CATEGORY_LABELS[segment.category] ?? segment.category}
                        {segment.category === 'application' ? (
                          <span className="badge badge--application">Aplicación</span>
                        ) : null}
                        {segment.score >= 0.85 ? (
                          <span className="badge badge--quote">Frase fuerte</span>
                        ) : null}
                      </p>
                      <strong>
                        {formatDuration(segment.end - segment.start)} · puntuación{' '}
                        {Math.round(segment.score * 100)}%
                      </strong>
                      {segment.transcript.trim() ? (
                        <p className="highlight-quote">
                          “{highlightPullQuote(segment.transcript)}”
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <button
                        type="button"
                        className="button button--secondary button--inline"
                        disabled={!previewSrc || previewPreparing}
                        onClick={() => playFromSegment(index)}
                      >
                        Reproducir
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--inline"
                        disabled={index === 0}
                        onClick={() => moveSegment(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--inline"
                        disabled={index === segments.length - 1}
                        onClick={() => moveSegment(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="button button--danger button--inline"
                        onClick={() =>
                          setSegments((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      <span>Inicio</span>
                      <input
                        type="number"
                        step="0.1"
                        value={segment.start}
                        onChange={(event) =>
                          updateSegment(index, { start: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Final</span>
                      <input
                        type="number"
                        step="0.1"
                        value={segment.end}
                        onChange={(event) =>
                          updateSegment(index, { end: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Categoría narrativa</span>
                      <select
                        value={segment.category}
                        onChange={(event) => updateSegment(index, { category: event.target.value })}
                      >
                        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Transición al siguiente fragmento</span>
                      <select
                        value={segment.transition_type}
                        onChange={(event) =>
                          updateSegment(index, {
                            transition_type: event.target
                              .value as HighlightSegment['transition_type'],
                            transition_duration_ms: event.target.value === 'hard_cut' ? 0 : 250,
                          })
                        }
                      >
                        <option value="hard_cut">Corte directo</option>
                        <option value="short_crossfade">Fundido breve</option>
                        <option value="dip_to_black">Fundido breve a negro</option>
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    <span>Transcripción corregida</span>
                    <textarea
                      rows={4}
                      value={segment.transcript}
                      placeholder="Escriba o pegue el texto real del intervalo seleccionado."
                      onChange={(event) => updateSegment(index, { transcript: event.target.value })}
                    />
                  </label>
                  <p className="muted">{segment.reason}</p>
                </article>
              ))}
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setSegments((current) => [...current, emptySegment(current, plan)])}
            >
              Agregar fragmento manual
            </button>{' '}
            <button
              type="button"
              className="button"
              onClick={() => void handleSaveReview()}
              disabled={
                busy !== null ||
                segments.some((item) => item.end <= item.start || !item.transcript.trim())
              }
            >
              {busy === 'review' ? 'Guardando…' : 'Guardar revisión'}
            </button>
          </>
        )}
      </section>

      <section
        id="highlight-tool-panel-metadata"
        role="tabpanel"
        aria-labelledby="highlight-tool-tab-metadata"
        className="card"
        hidden={activeTool !== 'metadata'}
      >
        {!titles ? (
          <p className="muted">Los títulos aparecen cuando la IA genera la selección.</p>
        ) : (
          <>
            <p className="eyebrow">Título y metadatos</p>
            <h2>Opciones estratégicas para YouTube</h2>
            <div className="stack">
              {(Object.keys(TITLE_LABELS) as (keyof StrategicTitles)[]).map((key) => (
                <label className="choice-row" key={key}>
                  <input
                    type="radio"
                    name="highlight-title"
                    checked={chosenTitle === titles[key]}
                    onChange={() => setChosenTitle(titles[key])}
                  />
                  <span>
                    <strong>{TITLE_LABELS[key]}</strong>
                    <br />
                    {titles[key]}
                  </span>
                </label>
              ))}
            </div>
            <label className="field">
              <span>Título elegido</span>
              <input value={chosenTitle} onChange={(event) => setChosenTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>Descripción breve</span>
              <textarea
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Texto para miniatura</span>
              <input
                value={thumbnailText}
                onChange={(event) => setThumbnailText(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Hashtags</span>
              <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} />
            </label>
            <label className="field">
              <span>Palabras clave (separadas por comas)</span>
              <input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
            </label>
            <button
              className="button"
              type="button"
              onClick={() => void handleSaveMetadata()}
              disabled={busy !== null}
            >
              Guardar metadatos
            </button>
          </>
        )}
      </section>

      <section
        id="highlight-tool-panel-end-card"
        role="tabpanel"
        aria-labelledby="highlight-tool-tab-end-card"
        className="card"
        hidden={activeTool !== 'end-card'}
      >
        <p className="eyebrow">Pantalla final</p>
        {segments.length === 0 ? (
          <p className="muted">Primero seleccione fragmentos para configurar la pantalla final.</p>
        ) : (
          <EndCardPanel
            projectId={projectId}
            aspectRatio="16:9"
            hasCover={hasCover}
            onCoverUpdated={onCoverUpdated}
          />
        )}
      </section>

      <section
        id="highlight-tool-panel-audio"
        role="tabpanel"
        aria-labelledby="highlight-tool-tab-audio"
        className="card"
        hidden={activeTool !== 'audio'}
      >
        <p className="eyebrow">Audio</p>
        {segments.length === 0 ? (
          <p className="muted">Primero seleccione fragmentos para añadir música de fondo.</p>
        ) : (
          <BackgroundMusicPanel projectId={projectId} />
        )}
      </section>

      <section
        id="highlight-tool-panel-export"
        role="tabpanel"
        aria-labelledby="highlight-tool-tab-export"
        className="card"
        hidden={activeTool !== 'export'}
      >
        <p className="eyebrow">Exportar</p>
        <h2>Render horizontal</h2>
        {segments.length === 0 ? (
          <p className="muted">Primero revise y confirme los fragmentos.</p>
        ) : (
          <>
            <label className="field">
              <span>Entrega de subtítulos</span>
              <select
                value={subtitleDelivery}
                onChange={(event) => setSubtitleDelivery(event.target.value as SubtitleDelivery)}
              >
                <option value="none">Video sin subtítulos</option>
                <option value="burned">Subtítulos quemados</option>
                <option value="srt">Archivo SRT separado</option>
                <option value="both">Video subtitulado y SRT</option>
              </select>
            </label>
            <p className="muted">
              Se conserva la resolución horizontal, el encuadre y el FPS de la fuente; el audio se
              normaliza para voz.
            </p>
            <button
              className="button"
              type="button"
              onClick={() => void handleRender()}
              disabled={busy !== null}
            >
              {busy === 'render' ? 'Renderizando…' : 'Renderizar Video Highlights'}
            </button>
            {renderJob && ACTIVE_RENDER.has(renderJob.status) && (
              <>
                <ProgressBar
                  label="Progreso del renderizado"
                  percent={Math.round(renderJob.progress * 100)}
                />
                <p className="muted">
                  {renderJob.stage ?? 'Procesando'} ·{' '}
                  {renderJob.speed ? `${renderJob.speed.toFixed(2)}×` : ''}
                </p>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => void cancelRenderJob(renderJob.id).then(setRenderJob)}
                >
                  Cancelar renderizado
                </button>
              </>
            )}
            {renderJob?.status === 'completed' && (
              <div className="stack">
                <video className="media-player" {...nativeVideoControlProps} src={renderOutputUrl(renderJob.id)} />
                <p>
                  <a className="button" href={renderOutputUrl(renderJob.id, true)}>
                    Descargar MP4
                  </a>{' '}
                  {(subtitleDelivery === 'srt' || subtitleDelivery === 'both') && (
                    <a className="button button--secondary" href={highlightSrtUrl(projectId)}>
                      Descargar SRT
                    </a>
                  )}
                </p>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() =>
                    void revealRenderOutput(renderJob.id).catch((reason) =>
                      setError(errorText(reason)),
                    )
                  }
                >
                  Abrir ubicación del archivo
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function emptySegment(current: HighlightSegment[], plan: HighlightPlan | null): HighlightSegment {
  const start = current[current.length - 1]?.end ?? plan?.sermon_start ?? 0;
  return {
    id: `manual-${Date.now()}`,
    order: current.length,
    start,
    end: Math.min(start + 30, plan?.sermon_end ?? start + 30),
    duration: 30,
    transcript: '',
    reason: 'Fragmento agregado manualmente.',
    score: 1,
    category: 'theme',
    transition_type: 'hard_cut',
    transition_duration_ms: 0,
  };
}

function analysisStage(stage: string | null): string {
  const labels: Record<string, string> = {
    queued: 'Análisis en cola',
    preparing_transcript: 'Preparando transcripción corregida',
    semantic_analysis: 'Evaluando estructura, relevancia y coherencia',
    validating_and_saving: 'Validando evidencia y guardando selección',
    cancelling: 'Cancelando análisis',
  };
  return labels[stage ?? ''] ?? 'Procesando análisis';
}

function errorText(reason: unknown): string {
  if (reason instanceof ApiError || reason instanceof Error) return reason.message;
  return 'No se pudo completar la operación.';
}

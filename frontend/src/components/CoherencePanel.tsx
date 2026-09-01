import { useCallback, useEffect, useState } from 'react';

import {
  autoFixReelCoherence,
  dismissCoherenceWarning,
  expandCoherenceContext,
  validateReelCoherence,
} from '../api/coherence';
import { ApiError } from '../api/client';
import { removeReelSegment, updateReelSegment } from '../api/reels';
import type { CoherenceIssue, CoherenceReport } from '../types/coherence';
import type { Reel, ReelSegment } from '../types/reel';

interface CoherencePanelProps {
  projectId: string;
  reelId: string;
  segments: ReelSegment[];
  onReelChange: (reel: Reel) => void;
  onReportChange?: (report: CoherenceReport | null) => void;
}

const SEVERITY_LABEL: Record<string, string> = {
  valid: 'Válido',
  warning: 'Advertencia',
  blocked: 'Bloqueado',
};

export function CoherencePanel({
  projectId,
  reelId,
  segments,
  onReelChange,
  onReportChange,
}: CoherencePanelProps) {
  const [report, setReport] = useState<CoherenceReport | null>(null);
  const [includeAi, setIncludeAi] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<string | null>(null);
  const [editingIssue, setEditingIssue] = useState<CoherenceIssue | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  const segmentCount = segments.length;
  const segmentsSignature = segments
    .map((s) => `${s.id}:${s.source_start_seconds}:${s.source_end_seconds}`)
    .join('|');

  const publish = useCallback(
    (next: CoherenceReport | null) => {
      setReport(next);
      onReportChange?.(next);
    },
    [onReportChange],
  );

  const runValidate = useCallback(async () => {
    if (segmentCount === 0) {
      publish(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await validateReelCoherence(projectId, reelId, {
        include_ai_review: includeAi,
        include_media_probes: includeMedia,
      });
      publish(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'request_cancelled') return;
      setError(err instanceof Error ? err.message : 'No se pudo validar la unión');
      publish(null);
    } finally {
      setBusy(false);
    }
  }, [projectId, reelId, segmentCount, includeAi, includeMedia, publish]);

  useEffect(() => {
    if (segmentCount === 0) {
      publish(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError(null);
      void validateReelCoherence(
        projectId,
        reelId,
        {
          include_ai_review: includeAi,
          include_media_probes: includeMedia,
        },
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) publish(next);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof ApiError && err.code === 'request_cancelled') return;
          setError(err instanceof Error ? err.message : 'No se pudo validar la unión');
          publish(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, reelId, segmentCount, includeAi, includeMedia, segmentsSignature, publish]);

  const handleDismiss = async (issue: CoherenceIssue) => {
    setBusy(true);
    setError(null);
    try {
      const next = await dismissCoherenceWarning(projectId, reelId, {
        code: issue.code,
        segment_id: issue.segment_id,
      });
      publish(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ignorar la advertencia');
    } finally {
      setBusy(false);
    }
  };

  const handleAutoFix = async () => {
    setBusy(true);
    setError(null);
    setFixResult(null);
    try {
      const result = await autoFixReelCoherence(projectId, reelId, {
        include_media_probes: true,
      });
      onReelChange(result.reel);
      publish(result.report);
      if (result.fixes.length === 0) {
        setFixResult('No se encontró una corrección automática segura para aplicar.');
      } else if (result.remaining_issues === 0) {
        setFixResult(
          `Corrección completada: ${result.fixes.length} ajuste(s) aplicado(s).`,
        );
      } else {
        setFixResult(
          `Se aplicaron ${result.fixes.length} ajuste(s). Quedan ${result.remaining_issues} asunto(s) que requieren revisión editorial.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo corregir la unión');
    } finally {
      setBusy(false);
    }
  };

  const handleExpand = async (issue: CoherenceIssue) => {
    setBusy(true);
    setError(null);
    try {
      const reel = await expandCoherenceContext(projectId, reelId, {
        segment_id: issue.segment_id,
        before_seconds: 1.5,
        after_seconds: 1.5,
      });
      onReelChange(reel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir contexto');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (issue: CoherenceIssue) => {
    if (!issue.segment_uuid) {
      setError('No se pudo identificar el fragmento a eliminar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reel = await removeReelSegment(projectId, reelId, issue.segment_uuid);
      onReelChange(reel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el fragmento');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (issue: CoherenceIssue) => {
    const segment =
      (issue.segment_uuid
        ? segments.find((item) => item.id === issue.segment_uuid)
        : null) ?? segments[issue.segment_id - 1];
    if (!segment) {
      setError('No se encontró el fragmento para editar tiempos.');
      return;
    }
    setEditingIssue(issue);
    setEditStart(String(segment.source_start_seconds));
    setEditEnd(String(segment.source_end_seconds));
  };

  const submitEdit = async () => {
    if (!editingIssue?.segment_uuid) return;
    const start = Number(editStart);
    const end = Number(editEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setError('Tiempos inválidos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reel = await updateReelSegment(projectId, reelId, editingIssue.segment_uuid, {
        source_start_seconds: start,
        source_end_seconds: end,
      });
      onReelChange(reel);
      setEditingIssue(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los tiempos');
    } finally {
      setBusy(false);
    }
  };

  if (segmentCount === 0) {
    return null;
  }

  const activeIssues = report?.issues.filter((issue) => !issue.dismissed) ?? [];
  const dismissedIssues = report?.issues.filter((issue) => issue.dismissed) ?? [];

  return (
    <div className="coherence-panel">
      <div className="reel-editor__section-header">
        <h4>Validación de unión</h4>
        {report && (
          <span className={`badge badge--coherence-${report.severity}`}>
            {SEVERITY_LABEL[report.severity] ?? report.severity}
          </span>
        )}
      </div>

      <p className="muted">
        Antes del render se revisa si los empalmes pueden resultar incoherentes o engañosos
        (conectores sueltos, frases cortadas, referencias sin contexto, saltos de audio/plano).
      </p>

      <div className="transcript-toolbar">
        <label className="field field--inline field--checkbox">
          <input
            type="checkbox"
            checked={includeMedia}
            onChange={(e) => setIncludeMedia(e.target.checked)}
            disabled={busy}
          />
          <span>Sondas de audio/plano (lentas; no bloquean el export)</span>
        </label>
        <label className="field field--inline field--checkbox">
          <input
            type="checkbox"
            checked={includeAi}
            onChange={(e) => setIncludeAi(e.target.checked)}
            disabled={busy}
          />
          <span>
            Revisión opcional con Gemini (envía texto del sermón a Google; ver docs/PRIVACY.md)
          </span>
        </label>
        <button type="button" className="button--ghost" onClick={() => void runValidate()} disabled={busy}>
          {busy ? 'Validando…' : 'Revalidar'}
        </button>
        {activeIssues.length > 0 && (
          <button type="button" onClick={() => void handleAutoFix()} disabled={busy}>
            {busy ? 'Corrigiendo…' : 'Corregir automáticamente'}
          </button>
        )}
      </div>

      {report && (
        <p className={report.severity === 'blocked' ? 'error' : 'muted'}>{report.summary}</p>
      )}
      {fixResult && <p className="success">{fixResult}</p>}

      {activeIssues.length > 0 && (
        <ul className="coherence-list">
          {activeIssues.map((issue) => (
            <li
              key={`${issue.code}-${issue.segment_id}-${issue.message}`}
              className={`coherence-item coherence-item--${issue.severity}`}
            >
              <div className="coherence-item__head">
                <code>{issue.code}</code>
                <span className={`badge badge--coherence-${issue.severity}`}>
                  {SEVERITY_LABEL[issue.severity]}
                </span>
                <span className="muted">Fragmento {issue.segment_id}</span>
              </div>
              <p>{issue.message}</p>
              {issue.recommendation && <p className="muted">{issue.recommendation}</p>}
              <div className="button-stack">
                {issue.severity === 'warning' && (
                  <button type="button" onClick={() => void handleDismiss(issue)} disabled={busy}>
                    Ignorar
                  </button>
                )}
                <button
                  type="button"
                  className="button--ghost"
                  onClick={() => openEdit(issue)}
                  disabled={busy || !issue.segment_uuid}
                >
                  Editar tiempos
                </button>
                <button
                  type="button"
                  className="button--ghost"
                  onClick={() => void handleExpand(issue)}
                  disabled={busy}
                >
                  Añadir contexto
                </button>
                <button
                  type="button"
                  className="button--danger"
                  onClick={() => void handleRemove(issue)}
                  disabled={busy || !issue.segment_uuid}
                >
                  Eliminar fragmento
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dismissedIssues.length > 0 && (
        <details className="coherence-dismissed">
          <summary>Advertencias ignoradas ({dismissedIssues.length})</summary>
          <ul className="coherence-list">
            {dismissedIssues.map((issue) => (
              <li key={`d-${issue.code}-${issue.segment_id}`} className="coherence-item muted">
                <code>{issue.code}</code> · Fragmento {issue.segment_id}: {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {editingIssue && (
        <div className="coherence-edit">
          <h5>Editar tiempos · fragmento {editingIssue.segment_id}</h5>
          <div className="transcript-toolbar">
            <label className="field field--inline">
              <span>Inicio (s)</span>
              <input value={editStart} onChange={(e) => setEditStart(e.target.value)} />
            </label>
            <label className="field field--inline">
              <span>Fin (s)</span>
              <input value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
            </label>
            <button type="button" onClick={() => void submitEdit()} disabled={busy}>
              Guardar
            </button>
            <button
              type="button"
              className="button--ghost"
              onClick={() => setEditingIssue(null)}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}

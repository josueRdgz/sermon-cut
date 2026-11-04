import type { AnalysisCandidate } from '../types/analysis';
import { formatDuration, formatTimecode } from '../utils/format';

export function candidateDuration(candidate: AnalysisCandidate): number {
  return candidate.segments.reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start), 0);
}

export function visibleAnalysisCandidates(candidates: AnalysisCandidate[]): AnalysisCandidate[] {
  return [...candidates]
    .filter((item) => item.status !== 'rejected')
    .sort((a, b) => a.rank - b.rank);
}

interface AnalysisProposalListProps {
  candidates: AnalysisCandidate[];
  busy?: boolean;
  compact?: boolean;
  canAddToReel?: boolean;
  addedCandidateIds?: string[];
  currentReelTitle?: string | null;
  onEdit?: (candidate: AnalysisCandidate) => void;
  onAddToReel?: (candidate: AnalysisCandidate) => void;
}

export function AnalysisProposalList({
  candidates,
  busy = false,
  compact = false,
  canAddToReel = false,
  addedCandidateIds = [],
  currentReelTitle = null,
  onEdit,
  onAddToReel,
}: AnalysisProposalListProps) {
  const items = visibleAnalysisCandidates(candidates);
  if (items.length === 0) return null;

  const showActions = Boolean(onEdit || (canAddToReel && onAddToReel));

  return (
    <ol className={`analysis-candidates__list${compact ? ' analysis-candidates__list--compact' : ''}`}>
      {items.map((candidate) => {
        const added = addedCandidateIds.includes(candidate.id);
        const opened = Boolean(candidate.accepted_reel_id);
        return (
          <li key={candidate.id} className="analysis-candidate">
            <div className="analysis-candidate__header">
              <strong>
                {candidate.rank + 1}. {candidate.title}
              </strong>
            </div>
            <p className="muted">
              {formatDuration(candidateDuration(candidate))} · {candidate.segments.length}{' '}
              fragmento(s)
              {candidate.segments[0] ? ` · ${formatTimecode(candidate.segments[0].start)}` : ''}
              {!compact ? ` · score ${candidate.editorial_score.toFixed(1)}` : ''}
            </p>
            {!compact && candidate.hook && <p>{candidate.hook}</p>}
            {!compact && candidate.summary && <p className="muted">{candidate.summary}</p>}
            {!compact && candidate.segments.length > 0 && (
              <ul className="analysis-candidate__segments">
                {candidate.segments.map((segment, index) => (
                  <li key={`${candidate.id}-${index}`}>
                    <span className="reel-timeline__range">
                      {formatTimecode(segment.start)} – {formatTimecode(segment.end)}
                    </span>
                    <span>{segment.exact_text}</span>
                  </li>
                ))}
              </ul>
            )}
            {showActions && (
              <div className="analysis-candidate__actions">
                {onEdit && (
                  <button
                    type="button"
                    className="button button--inline"
                    disabled={busy}
                    onClick={() => onEdit(candidate)}
                  >
                    {opened ? 'Abrir en el editor' : 'Editar esta propuesta'}
                  </button>
                )}
                {canAddToReel && onAddToReel && (
                  <button
                    type="button"
                    className="button button--inline button--secondary"
                    disabled={busy || added}
                    onClick={() => onAddToReel(candidate)}
                  >
                    {added
                      ? 'Ya añadida a este short'
                      : currentReelTitle
                        ? `Añadir a «${currentReelTitle}»`
                        : 'Añadir al short actual'}
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

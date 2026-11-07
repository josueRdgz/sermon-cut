import type { AnalysisCandidate } from '../types/analysis';
import type { ReelSegment } from '../types/reel';
import { formatDuration, formatTimecode } from '../utils/format';
import { protectedChosenSegmentIds, type SourceWindow } from '../utils/reelTrim';

export function candidateDuration(candidate: AnalysisCandidate): number {
  return candidate.segments.reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start), 0);
}

export function visibleAnalysisCandidates(candidates: AnalysisCandidate[]): AnalysisCandidate[] {
  return [...candidates]
    .filter((item) => item.status !== 'rejected')
    .sort((a, b) => a.rank - b.rank);
}

/** Source windows of the analysis proposal this Reel was opened from. */
export function originWindowsForReel(
  candidates: AnalysisCandidate[],
  reelId: string | null | undefined,
): SourceWindow[] {
  if (!reelId) return [];
  const origin = candidates.find((item) => item.accepted_reel_id === reelId);
  return (origin?.segments ?? []).map((segment) => ({
    start: segment.start,
    end: segment.end,
  }));
}

function candidateCoveredByClips(
  candidate: AnalysisCandidate,
  leftover: ReelSegment[],
): boolean {
  if (candidate.segments.length === 0 || leftover.length === 0) return false;
  return candidate.segments.every((window) =>
    leftover.some(
      (clip) =>
        clip.source_start_seconds >= window.start - 0.05 &&
        clip.source_end_seconds <= window.end + 0.05,
    ),
  );
}

/** Proposals whose extra fragments are still on this Reel and can be re-added after deleting them. */
export function addedCandidateIdsOnReel(
  candidates: AnalysisCandidate[],
  reelId: string | null | undefined,
  segments: ReelSegment[],
): string[] {
  if (!reelId) return [];
  const originWindows = originWindowsForReel(candidates, reelId);
  const protectedIds = protectedChosenSegmentIds(segments, originWindows);
  const leftover = segments.filter((segment) => !protectedIds.has(segment.id));
  return visibleAnalysisCandidates(candidates)
    .filter((item) => {
      if (item.accepted_reel_id === reelId) return false;
      return candidateCoveredByClips(item, leftover);
    })
    .map((item) => item.id);
}

/** Proposals that can still be added to the open Reel (not the one already in the editor). */
export function addableAnalysisCandidates(
  candidates: AnalysisCandidate[],
  currentReelId: string | null | undefined,
  addedCandidateIds: string[] = [],
): AnalysisCandidate[] {
  const added = new Set(addedCandidateIds);
  return visibleAnalysisCandidates(candidates).filter((item) => {
    if (currentReelId && item.accepted_reel_id === currentReelId) return false;
    if (added.has(item.id)) return false;
    return true;
  });
}

interface AnalysisProposalListProps {
  candidates: AnalysisCandidate[];
  busy?: boolean;
  compact?: boolean;
  addOnly?: boolean;
  canAddToReel?: boolean;
  addedCandidateIds?: string[];
  currentReelId?: string | null;
  currentReelTitle?: string | null;
  onEdit?: (candidate: AnalysisCandidate) => void;
  onAddToReel?: (candidate: AnalysisCandidate) => void;
}

export function AnalysisProposalList({
  candidates,
  busy = false,
  compact = false,
  addOnly = false,
  canAddToReel = false,
  addedCandidateIds = [],
  currentReelId = null,
  currentReelTitle = null,
  onEdit,
  onAddToReel,
}: AnalysisProposalListProps) {
  const items = addableAnalysisCandidates(candidates, currentReelId, addedCandidateIds);
  if (items.length === 0) return null;

  const showEdit = Boolean(onEdit) && !addOnly;
  const showAdd = Boolean(canAddToReel && onAddToReel);
  const showActions = showEdit || showAdd;

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
                {showEdit && onEdit && (
                  <button
                    type="button"
                    className="button button--inline"
                    disabled={busy}
                    onClick={() => onEdit(candidate)}
                  >
                    {opened ? 'Abrir en el editor' : 'Editar esta propuesta'}
                  </button>
                )}
                {showAdd && onAddToReel && (
                  <button
                    type="button"
                    className="button button--inline button--secondary"
                    disabled={busy || added}
                    onClick={() => onAddToReel(candidate)}
                  >
                    {added ? 'Ya añadida' : addOnly ? 'Añadir fragmento' : currentReelTitle
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

import type { ReelSegment } from '../../types/reel';
import { formatDuration, formatTimecode } from '../../utils/format';

interface CutsFilmstripProps {
  segments: ReelSegment[];
  selectedId: string | null;
  onSelect: (segmentId: string, index: number) => void;
}

export function CutsFilmstrip({ segments, selectedId, onSelect }: CutsFilmstripProps) {
  return (
    <div className="reel-nle__filmstrip" aria-label="Fragmentos del Reel">
      {segments.map((segment, index) => {
        const selected = selectedId === segment.id;
        return (
          <button
            key={segment.id}
            type="button"
            className={`reel-nle__filmstrip-item${
              selected ? ' reel-nle__filmstrip-item--selected' : ''
            }`}
            onClick={() => onSelect(segment.id, index)}
          >
            <strong>{index + 1}</strong>
            <span>{formatDuration(segment.duration_seconds)}</span>
            <small>
              {formatTimecode(segment.source_start_seconds)}–
              {formatTimecode(segment.source_end_seconds)}
            </small>
          </button>
        );
      })}
      {segments.length === 0 && (
        <p className="muted">Aún no hay fragmentos. Añade uno para editarlo.</p>
      )}
    </div>
  );
}

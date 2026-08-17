import type { SourceGapSpan } from '../../utils/reelTimelineStrip';
import { formatDuration } from '../../utils/format';

interface OmittedGapInspectorProps {
  gap: SourceGapSpan;
  onRestoreBefore: () => void;
  onRestoreAfter: () => void;
}

export function OmittedGapInspector({
  gap,
  onRestoreBefore,
  onRestoreAfter,
}: OmittedGapInspectorProps) {
  return (
    <div className="reel-nle__omitted-inspector">
      <h4>Material omitido</h4>
      <p>
        {formatDuration(gap.sourceSeconds)} del sermón no están en el Reel (entre los fragmentos{' '}
        {gap.afterIndex} y {gap.afterIndex + 1}).
      </p>
      <div className="button-stack">
        <button type="button" className="button button--secondary" onClick={onRestoreBefore}>
          Incluir al clip anterior
        </button>
        <button type="button" className="button button--secondary" onClick={onRestoreAfter}>
          Incluir al clip siguiente
        </button>
      </div>
    </div>
  );
}

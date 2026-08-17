import { formatDuration } from '../../utils/format';

interface AddFragmentFormProps {
  start: number;
  end: number;
  sourceTime: number | null;
  videoDuration: number | null;
  busy: boolean;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
  onUseCurrentStart: () => void;
  onUseCurrentEnd: () => void;
  onAdd: () => void;
  onCancel: () => void;
}

export function AddFragmentForm({
  start,
  end,
  sourceTime,
  videoDuration,
  busy,
  onStartChange,
  onEndChange,
  onUseCurrentStart,
  onUseCurrentEnd,
  onAdd,
  onCancel,
}: AddFragmentFormProps) {
  return (
    <div className="reel-add-fragment">
      <p className="reel-add-fragment__title">Nuevo fragmento</p>
      <p className="muted reel-add-fragment__hint">
        Duración: {formatDuration(Math.max(0, end - start))}
        {videoDuration != null ? ` · Video ${formatDuration(videoDuration)}` : ''}
      </p>
      <div className="reel-add-fragment__row">
        <label className="field field--inline">
          <span>Inicio (s)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={start}
            disabled={busy}
            onChange={(event) => onStartChange(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="button button--inline"
          disabled={busy || sourceTime == null}
          onClick={onUseCurrentStart}
        >
          Tiempo actual
        </button>
      </div>
      <div className="reel-add-fragment__row">
        <label className="field field--inline">
          <span>Fin (s)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={end}
            disabled={busy}
            onChange={(event) => onEndChange(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="button button--inline"
          disabled={busy || sourceTime == null}
          onClick={onUseCurrentEnd}
        >
          Tiempo actual
        </button>
      </div>
      <div className="reel-add-fragment__actions">
        <button type="button" className="button" disabled={busy} onClick={onAdd}>
          Añadir
        </button>
        <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

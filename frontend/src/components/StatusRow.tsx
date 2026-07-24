interface StatusRowProps {
  label: string;
  value: string;
  ok?: boolean;
}

export function StatusRow({ label, value, ok }: StatusRowProps) {
  const state = ok === undefined ? 'idle' : ok ? 'ok' : 'error';

  return (
    <div className="status-row">
      <span className="status-row__label">{label}</span>
      <span className="status-row__value">
        <span className={`status-row__dot status-row__dot--${state}`} aria-hidden />
        {value}
      </span>
    </div>
  );
}

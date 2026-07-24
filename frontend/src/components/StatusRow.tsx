interface StatusRowProps {
  label: string;
  value: string;
  ok?: boolean;
}

export function StatusRow({ label, value, ok }: StatusRowProps) {
  const dotColor = ok === undefined ? '#9ca3af' : ok ? '#16a34a' : '#dc2626';

  return (
    <div className="status-row">
      <span className="status-row__label">{label}</span>
      <span className="status-row__value">
        <span className="status-row__dot" style={{ backgroundColor: dotColor }} aria-hidden />
        {value}
      </span>
    </div>
  );
}

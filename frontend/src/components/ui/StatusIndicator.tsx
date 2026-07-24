import styles from './StatusIndicator.module.css';

export type StatusTone = 'ok' | 'warn' | 'error' | 'idle';

interface StatusIndicatorProps {
  label: string;
  tone: StatusTone;
  detail?: string;
  compact?: boolean;
}

export function StatusIndicator({ label, tone, detail, compact }: StatusIndicatorProps) {
  const title = detail ? `${label}: ${detail}` : label;
  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ''}`}
      title={title}
      role="status"
      aria-label={title}
    >
      <span className={`${styles.dot} ${styles[tone]}`} aria-hidden />
      <span className={styles.label}>{label}</span>
    </span>
  );
}

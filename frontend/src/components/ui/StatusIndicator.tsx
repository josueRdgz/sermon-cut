import styles from './StatusIndicator.module.css';

export type StatusTone = 'ok' | 'warn' | 'error' | 'idle';

interface StatusIndicatorProps {
  label: string;
  tone: StatusTone;
  detail?: string;
  compact?: boolean;
  onClick?: () => void;
}

export function StatusIndicator({ label, tone, detail, compact, onClick }: StatusIndicatorProps) {
  const title = detail ? `${label}: ${detail}` : label;
  const className = `${styles.root} ${compact ? styles.compact : ''} ${onClick ? styles.button : ''}`;
  const content = (
    <>
      <span className={`${styles.dot} ${styles[tone]}`} aria-hidden />
      <span className={styles.label}>{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={className} title={title} aria-label={title} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <span className={className} title={title} role="status" aria-label={title}>
      {content}
    </span>
  );
}

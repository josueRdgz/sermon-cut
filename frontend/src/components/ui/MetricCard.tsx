import type { LucideIcon } from 'lucide-react';

import styles from './MetricCard.module.css';

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}

export function MetricCard({ icon: Icon, label, value, hint }: MetricCardProps) {
  return (
    <div className={styles.root}>
      <span className={styles.icon} aria-hidden>
        <Icon size={15} strokeWidth={2} />
      </span>
      <span className={styles.body}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>
          {value}
          {hint ? <span className={styles.hint}>{hint}</span> : null}
        </span>
      </span>
    </div>
  );
}

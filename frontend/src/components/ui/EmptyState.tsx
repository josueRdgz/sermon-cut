import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.root}>
      <span className={styles.icon} aria-hidden>
        <Icon size={26} strokeWidth={1.75} />
      </span>
      <h3 className={styles.title}>{title}</h3>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

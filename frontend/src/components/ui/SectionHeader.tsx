import type { ReactNode } from 'react';

import styles from './SectionHeader.module.css';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className={styles.root}>
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

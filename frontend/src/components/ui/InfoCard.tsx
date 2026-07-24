import type { LucideIcon } from 'lucide-react';

import styles from './InfoCard.module.css';

interface InfoCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function InfoCard({ icon: Icon, title, description }: InfoCardProps) {
  return (
    <div className={styles.root}>
      <span className={styles.icon} aria-hidden>
        <Icon size={17} strokeWidth={2} />
      </span>
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.description}>{description}</span>
      </div>
    </div>
  );
}

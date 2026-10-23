import { FolderKanban, HardDrive, Tag } from 'lucide-react';

import { MetricCard } from '../ui/MetricCard';
import { StatusIndicator, type StatusTone } from '../ui/StatusIndicator';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  projectCount: number;
  storageUsed: string;
  version: string;
  overall: StatusTone;
  overallLabel: string;
  onStatusClick?: () => void;
}

export function StatusBar({
  projectCount,
  storageUsed,
  version,
  overall,
  overallLabel,
  onStatusClick,
}: StatusBarProps) {
  return (
    <div className={styles.root}>
      <div className={styles.metrics}>
        <MetricCard icon={FolderKanban} label="Proyectos" value={String(projectCount)} />
        <span className={styles.divider} aria-hidden />
        <MetricCard icon={HardDrive} label="Almacenamiento" value={storageUsed} />
        <span className={`${styles.divider} ${styles.hideWhenNarrow}`} aria-hidden />
        <span className={styles.hideWhenNarrow}>
          <MetricCard icon={Tag} label="Versión" value={version} />
        </span>
      </div>
      <p className={`${styles.credit} ${styles.hideWhenNarrow}`}>
        Creado por Josué Rodríguez Ramírez
      </p>
      <StatusIndicator
        label={overallLabel}
        tone={overall}
        detail="Estado del sistema"
        onClick={onStatusClick}
      />
    </div>
  );
}

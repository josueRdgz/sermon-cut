import { Scissors } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { StatusIndicator } from '../ui/StatusIndicator';
import type { SystemIndicator } from '../../hooks/useSystemStatus';
import styles from './TopBar.module.css';

interface TopBarProps {
  indicators: SystemIndicator[];
  actions?: ReactNode;
}

export function TopBar({ indicators, actions }: TopBarProps) {
  return (
    <div className={styles.root}>
      <Link to="/" className={styles.brand} aria-label="SermonCut — Inicio">
        <span className={styles.mark} aria-hidden>
          <Scissors size={16} strokeWidth={2.25} />
        </span>
        <span className={styles.wordmark}>SermonCut</span>
      </Link>

      <div className={styles.status} role="group" aria-label="Estado del sistema">
        {indicators.map((indicator) => (
          <StatusIndicator
            key={indicator.key}
            label={indicator.label}
            tone={indicator.tone}
            detail={indicator.detail}
          />
        ))}
      </div>

      {actions ? <div className={styles.actions}>{actions}</div> : <div />}
    </div>
  );
}

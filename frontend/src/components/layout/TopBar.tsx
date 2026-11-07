import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import styles from './TopBar.module.css';

export const TOPBAR_CONTEXT_ID = 'app-topbar-context';

interface TopBarProps {
  context?: ReactNode;
}

export function TopBar({ context }: TopBarProps) {
  return (
    <div className={styles.root}>
      <Link to="/" className={styles.brand} aria-label="SermonCut — Inicio">
        <span className={styles.mark} aria-hidden>
          <img src="/sermon-cut-icon.png" alt="" />
        </span>
        <span className={styles.wordmark}>SermonCut</span>
      </Link>
      <div id={TOPBAR_CONTEXT_ID} className={styles.context}>
        {context}
      </div>
    </div>
  );
}

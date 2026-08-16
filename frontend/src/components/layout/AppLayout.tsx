import type { ReactNode } from 'react';

import styles from './AppLayout.module.css';

interface AppLayoutProps {
  header: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Full-bleed content (NLE editor). */
  flush?: boolean;
  /** Wider rail for project workspace labels. */
  wideSidebar?: boolean;
}

export function AppLayout({
  header,
  sidebar,
  footer,
  children,
  flush = false,
  wideSidebar = false,
}: AppLayoutProps) {
  return (
    <div
      className={`${styles.root} ${sidebar ? styles.withSidebar : ''} ${
        wideSidebar ? styles.wideSidebar : ''
      } ${flush ? styles.flush : ''}`}
    >
      <header className={styles.header}>{header}</header>
      {sidebar ? <aside className={styles.sidebar}>{sidebar}</aside> : null}
      <main className={styles.main}>
        <div className={flush ? styles.contentFlush : styles.content}>{children}</div>
      </main>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </div>
  );
}

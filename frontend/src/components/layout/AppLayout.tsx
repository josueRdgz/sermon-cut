import type { ReactNode } from 'react';

import styles from './AppLayout.module.css';

interface AppLayoutProps {
  header: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}

export function AppLayout({ header, sidebar, footer, children, flush = false }: AppLayoutProps) {
  const rootClass = [
    styles.root,
    sidebar ? styles.withSidebar : '',
    footer ? '' : styles.noFooter,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass}>
      <header className={styles.header}>{header}</header>
      {sidebar ? <aside className={styles.sidebar}>{sidebar}</aside> : null}
      <main className={`${styles.main}${flush ? ` ${styles.mainFlush}` : ''}`}>
        <div className={flush ? styles.contentFlush : styles.content}>{children}</div>
      </main>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </div>
  );
}

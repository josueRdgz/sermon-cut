import type { ReactNode } from 'react';

import styles from './AppLayout.module.css';

interface AppLayoutProps {
  header: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function AppLayout({ header, sidebar, footer, children }: AppLayoutProps) {
  return (
    <div className={`${styles.root} ${sidebar ? styles.withSidebar : ''}`}>
      <header className={styles.header}>{header}</header>
      {sidebar ? <aside className={styles.sidebar}>{sidebar}</aside> : null}
      <main className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </div>
  );
}

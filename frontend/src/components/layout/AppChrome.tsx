import type { LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { useSystemStatus } from '../../hooks/useSystemStatus';
import { AppModals, type AppPanel } from '../AppModals';
import { AppLayout } from './AppLayout';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import styles from './AppChrome.module.css';

export interface WorkspaceNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface AppChromeProps {
  children: ReactNode;
  projectCount: number;
  context?: ReactNode;
  workspace?: {
    items: WorkspaceNavItem[];
    activeId: string;
    onSelect: (id: string) => void;
  };
  flush?: boolean;
  hideFooter?: boolean;
}

export function AppChrome({
  children,
  projectCount,
  context,
  workspace,
  flush = false,
  hideFooter = false,
}: AppChromeProps) {
  const system = useSystemStatus();
  const [panel, setPanel] = useState<AppPanel | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        setPanel('help');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <AppLayout
        flush={flush}
        header={<TopBar context={context} />}
        sidebar={
          <div className={styles.sidebarStack}>
            <Sidebar activePanel={panel} onOpenPanel={setPanel} />
            {workspace && workspace.items.length > 0 ? (
              <nav className={styles.workspaceNav} aria-label="Secciones del proyecto">
                {workspace.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === workspace.activeId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.workspaceTab}${active ? ` ${styles.workspaceTabActive}` : ''}`}
                      title={item.label}
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => workspace.onSelect(item.id)}
                    >
                      <Icon size={18} strokeWidth={2} aria-hidden />
                    </button>
                  );
                })}
              </nav>
            ) : null}
          </div>
        }
        footer={
          hideFooter ? undefined : (
            <StatusBar
              projectCount={projectCount}
              storageUsed={system.storageUsed}
              version={system.version}
              overall={system.overall}
              overallLabel={system.overallLabel}
              onStatusClick={() => setPanel('about')}
            />
          )
        }
      >
        {children}
      </AppLayout>
      <AppModals panel={panel} system={system} onClose={() => setPanel(null)} />
    </>
  );
}

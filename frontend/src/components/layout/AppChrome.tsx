import type { ReactNode } from 'react';

import { useSystemStatus } from '../../hooks/useSystemStatus';
import { AppLayout } from './AppLayout';
import { Sidebar, type WorkspaceNavItem } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

interface AppChromeProps {
  children: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  hideFooter?: boolean;
  projectCount?: number;
  workspace?: {
    items: WorkspaceNavItem[];
    activeId: string;
    onSelect: (id: string) => void;
  };
}

export function AppChrome({
  children,
  actions,
  flush = false,
  hideFooter = false,
  projectCount = 0,
  workspace,
}: AppChromeProps) {
  const system = useSystemStatus();
  return (
    <AppLayout
      flush={flush}
      wideSidebar={Boolean(workspace)}
      header={<TopBar indicators={system.indicators} actions={actions} />}
      sidebar={<Sidebar workspace={workspace} />}
      footer={
        hideFooter ? undefined : (
          <StatusBar
            projectCount={projectCount}
            storageUsed={system.storageUsed}
            version={system.version}
            overall={system.overall}
            overallLabel={system.overallLabel}
          />
        )
      }
    >
      {children}
    </AppLayout>
  );
}

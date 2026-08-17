import { FolderOpen, Home, Plus, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import styles from './Sidebar.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/projects', label: 'Proyectos', icon: FolderOpen },
  { to: '/projects/new', label: 'Nuevo proyecto', icon: Plus },
];

export interface WorkspaceNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SidebarProps {
  workspace?: {
    items: WorkspaceNavItem[];
    activeId: string;
    onSelect: (id: string) => void;
  };
}

export function Sidebar({ workspace }: SidebarProps) {
  return (
    <nav className={styles.root} aria-label="Navegación principal">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={label}
          aria-label={label}
          className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}
        >
          <Icon size={18} strokeWidth={2} aria-hidden />
          <span className={styles.label}>{label}</span>
        </NavLink>
      ))}
      {workspace && workspace.items.length > 0 && (
        <>
          <div className={styles.divider} role="presentation" />
          <div className={styles.workspace} role="tablist" aria-label="Flujo del proyecto">
            {workspace.items.map((section) => {
              const Icon = section.icon;
              const selected = section.id === workspace.activeId;
              return (
                <button
                  key={section.id}
                  id={`workspace-tab-${section.id}`}
                  type="button"
                  role="tab"
                  title={section.label}
                  aria-label={section.label}
                  aria-selected={selected}
                  aria-controls={`workspace-panel-${section.id}`}
                  className={`${styles.item} ${styles.workspaceItem} ${
                    selected ? styles.active : ''
                  }`}
                  onClick={() => workspace.onSelect(section.id)}
                >
                  <Icon size={18} strokeWidth={2} aria-hidden />
                  <span className={styles.label}>{section.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </nav>
  );
}

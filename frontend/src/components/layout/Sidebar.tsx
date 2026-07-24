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

export function Sidebar() {
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
          <Icon size={19} strokeWidth={2} aria-hidden />
        </NavLink>
      ))}
    </nav>
  );
}

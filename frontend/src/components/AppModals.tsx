import { HelpCircle, Info, Settings } from 'lucide-react';

import type { SystemStatus } from '../hooks/useSystemStatus';
import { BibleReader } from './BibleReader';
import { SettingsForm } from './SettingsForm';
import { Modal } from './ui/Modal';
import { StatusIndicator } from './ui/StatusIndicator';
import styles from './AppModals.module.css';

export type AppPanel = 'settings' | 'help' | 'about';

interface AppModalsProps {
  panel: AppPanel | null;
  system: SystemStatus;
  onClose: () => void;
}

export function AppModals({ panel, system, onClose }: AppModalsProps) {
  if (panel === 'about') {
    return (
      <Modal title="Acerca de SermonCut" icon={Info} onClose={onClose}>
        <div className={styles.about}>
          <div className={styles.aboutRow}>
            <span className={styles.aboutKey}>Versión</span>
            <span className={styles.aboutValue}>{system.version}</span>
          </div>
          <div className={styles.aboutRow}>
            <span className={styles.aboutKey}>Estado</span>
            <span className={styles.aboutValue}>{system.overallLabel}</span>
          </div>
          <div className={styles.tools} role="list" aria-label="Herramientas del sistema">
            {system.indicators.map((indicator) => (
              <div key={indicator.key} className={styles.tool} role="listitem">
                <StatusIndicator label={indicator.label} tone={indicator.tone} detail={indicator.detail} />
                <span className={styles.aboutKey}>{indicator.detail}</span>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            SermonCut convierte predicaciones en Shorts y Reels verticales de forma local:
            transcripción, análisis de momentos y exportación en 9:16.
          </p>
          <p className={styles.credit}>Creado por Josué Rodríguez Ramírez</p>
        </div>
      </Modal>
    );
  }

  if (panel === 'settings') {
    return (
      <Modal title="Configuración" icon={Settings} onClose={onClose}>
        <SettingsForm onSaved={() => system.refresh?.()} />
      </Modal>
    );
  }

  if (panel === 'help') {
    return (
      <Modal title="Ayuda y atajos" icon={HelpCircle} size="lg" onClose={onClose}>
        <div className={styles.help}>
          <div className={styles.shortcuts}>
            <div className={styles.shortcut}>
              <span>Nuevo proyecto</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>N</kbd>
              </span>
            </div>
            <div className={styles.shortcut}>
              <span>Ver proyectos</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>P</kbd>
              </span>
            </div>
            <div className={styles.shortcut}>
              <span>Abrir esta ayuda</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>?</kbd>
              </span>
            </div>
            <div className={styles.shortcut}>
              <span>Reproducir o pausar</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>Espacio</kbd>
                <kbd className={styles.key}>K</kbd>
              </span>
            </div>
            <div className={styles.shortcut}>
              <span>Retroceder / avanzar</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>J</kbd>
                <kbd className={styles.key}>L</kbd>
              </span>
            </div>
            <div className={styles.shortcut}>
              <span>Marcar inicio / fin</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>I</kbd>
                <kbd className={styles.key}>O</kbd>
              </span>
            </div>
            <div className={styles.shortcut}>
              <span>Partir en el cursor</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>C</kbd>
              </span>
            </div>
            <div className={styles.shortcut}>
              <span>Unir el corte que partiste</span>
              <span className={styles.keys}>
                <kbd className={styles.key}>U</kbd>
              </span>
            </div>
          </div>
          <h3 className={styles.bibleTitle}>Reina Valera 1960</h3>
          <BibleReader />
        </div>
      </Modal>
    );
  }

  return null;
}

import {
  Clapperboard,
  FolderOpen,
  HelpCircle,
  Info,
  Mic,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLayout } from '../components/layout/AppLayout';
import { Sidebar } from '../components/layout/Sidebar';
import { StatusBar } from '../components/layout/StatusBar';
import { TopBar } from '../components/layout/TopBar';
import { ProjectGrid } from '../components/ProjectGrid';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { GlassPanel } from '../components/ui/GlassPanel';
import { InfoCard } from '../components/ui/InfoCard';
import { Modal } from '../components/ui/Modal';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { SecondaryButton } from '../components/ui/SecondaryButton';
import { SectionHeader } from '../components/ui/SectionHeader';
import { useProjects } from '../hooks/useProjects';
import { useSystemStatus } from '../hooks/useSystemStatus';
import styles from './HomePage.module.css';

type Panel = 'settings' | 'help' | 'about';

const RECENT_LIMIT = 8;

export function HomePage() {
  const navigate = useNavigate();
  const system = useSystemStatus();
  const { projects, loading, error } = useProjects();
  const [panel, setPanel] = useState<Panel | null>(null);

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, RECENT_LIMIT),
    [projects],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'n') {
        event.preventDefault();
        navigate('/projects/new');
      } else if (event.key === 'p') {
        event.preventDefault();
        navigate('/projects');
      } else if (event.key === '?') {
        event.preventDefault();
        setPanel('help');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const topActions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={Settings}
        aria-label="Configuración"
        title="Configuración"
        onClick={() => setPanel('settings')}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={HelpCircle}
        aria-label="Ayuda"
        title="Ayuda"
        onClick={() => setPanel('help')}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={Info}
        aria-label="Acerca de"
        title="Acerca de"
        onClick={() => setPanel('about')}
      />
    </>
  );

  return (
    <>
      <AppLayout
        header={<TopBar indicators={system.indicators} actions={topActions} />}
        sidebar={<Sidebar />}
        footer={
          <StatusBar
            projectCount={projects.length}
            storageUsed={system.storageUsed}
            version={system.version}
            overall={system.overall}
            overallLabel={system.overallLabel}
          />
        }
      >
        <GlassPanel hero className={styles.hero}>
          <div className={styles.heroMain}>
            <span className={styles.kicker}>
              <Clapperboard size={13} strokeWidth={2.5} aria-hidden />
              Estudio de Shorts y Reels
            </span>
            <h1 className={styles.title}>SermonCut</h1>
            <p className={styles.subtitle}>
              Convierte predicaciones en Shorts y Reels profesionales.
            </p>
            <div className={styles.actions}>
              <PrimaryButton to="/projects/new" icon={Plus}>
                Nuevo proyecto
              </PrimaryButton>
              <SecondaryButton to="/projects" icon={FolderOpen}>
                Abrir proyecto
              </SecondaryButton>
            </div>
          </div>

          <div className={styles.heroAside}>
            <InfoCard
              icon={Mic}
              title="Transcripción local"
              description="Whisper genera subtítulos precisos sin salir de tu equipo."
            />
            <InfoCard
              icon={Sparkles}
              title="Momentos con IA"
              description="Detecta los fragmentos con mayor impacto de cada sermón."
            />
            <InfoCard
              icon={Clapperboard}
              title="Exporta en 9:16"
              description="Reels verticales listos para publicar en segundos."
            />
          </div>
        </GlassPanel>

        <div className={styles.divider} role="separator" />

        <section className={styles.recent}>
          <SectionHeader
            title="Proyectos recientes"
            subtitle="Continúa donde lo dejaste."
            action={
              projects.length > RECENT_LIMIT ? (
                <SecondaryButton to="/projects" size="sm">
                  Ver todos
                </SecondaryButton>
              ) : undefined
            }
          />

          {loading ? <p className="muted">Cargando proyectos…</p> : null}
          {error ? <p className="error">{error}</p> : null}

          {!loading && !error && recentProjects.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              title="Aún no hay proyectos"
              description="Crea tu primer proyecto a partir de un video local o una URL de YouTube."
              action={
                <PrimaryButton to="/projects/new" icon={Plus}>
                  Nuevo proyecto
                </PrimaryButton>
              }
            />
          ) : null}

          {recentProjects.length > 0 ? <ProjectGrid projects={recentProjects} /> : null}
        </section>
      </AppLayout>

      {panel === 'about' ? (
        <Modal title="Acerca de SermonCut" icon={Info} onClose={() => setPanel(null)}>
          <div className={styles.about}>
            <div className={styles.aboutRow}>
              <span className={styles.aboutKey}>Versión</span>
              <span className={styles.aboutValue}>{system.version}</span>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutKey}>Estado</span>
              <span className={styles.aboutValue}>{system.overallLabel}</span>
            </div>
            <p className={styles.note}>
              SermonCut convierte predicaciones en Shorts y Reels verticales de forma local:
              transcripción, análisis de momentos y exportación en 9:16.
            </p>
          </div>
        </Modal>
      ) : null}

      {panel === 'settings' ? (
        <Modal title="Configuración" icon={Settings} onClose={() => setPanel(null)}>
          <div className={styles.about}>
            {system.indicators.map((indicator) => (
              <div key={indicator.key} className={styles.aboutRow}>
                <span className={styles.aboutKey}>{indicator.label}</span>
                <span className={styles.aboutValue}>{indicator.detail}</span>
              </div>
            ))}
            <p className={styles.note}>
              La configuración de proveedores y rutas se gestiona mediante variables de entorno
              (archivo <code>.env</code>). Reinicia el backend tras cambiarlas.
            </p>
          </div>
        </Modal>
      ) : null}

      {panel === 'help' ? (
        <Modal title="Ayuda y atajos" icon={HelpCircle} onClose={() => setPanel(null)}>
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
          </div>
        </Modal>
      ) : null}
    </>
  );
}

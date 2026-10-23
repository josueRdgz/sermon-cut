import { Clapperboard, FolderOpen, Mic, Plus, Sparkles } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppChrome } from '../components/layout/AppChrome';
import { ProjectGrid } from '../components/ProjectGrid';
import { EmptyState } from '../components/ui/EmptyState';
import { GlassPanel } from '../components/ui/GlassPanel';
import { InfoCard } from '../components/ui/InfoCard';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { SecondaryButton } from '../components/ui/SecondaryButton';
import { SectionHeader } from '../components/ui/SectionHeader';
import { useProjects } from '../hooks/useProjects';
import styles from './HomePage.module.css';

const RECENT_LIMIT = 8;

export function HomePage() {
  const navigate = useNavigate();
  const { projects, loading, error } = useProjects();

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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <AppChrome projectCount={projects.length}>
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
    </AppChrome>
  );
}

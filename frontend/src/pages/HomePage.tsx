import { StatusRow } from '../components/StatusRow';
import { useHealth } from '../hooks/useHealth';

export function HomePage() {
  const { status, data, error } = useHealth();

  const backendOk = status === 'ok';
  const ffmpegOk = data?.ffmpeg.available ?? false;

  const backendValue =
    status === 'loading' ? 'Comprobando…' : backendOk ? 'Conectado' : `Error: ${error ?? ''}`;

  const ffmpegAvailableValue =
    status === 'loading' ? 'Comprobando…' : ffmpegOk ? 'Disponible' : 'No disponible';

  const ffmpegVersionValue =
    status === 'loading' ? 'Comprobando…' : (data?.ffmpeg.version ?? 'Desconocida');

  return (
    <main className="page">
      <header className="page__header">
        <h1>Sermon Cut</h1>
        <p>Convierte predicaciones en Shorts y Reels verticales.</p>
      </header>

      <section className="card">
        <h2>Estado del sistema</h2>
        <StatusRow label="Backend" value={backendValue} ok={backendOk} />
        <StatusRow label="FFmpeg" value={ffmpegAvailableValue} ok={ffmpegOk} />
        <StatusRow label="Versión de FFmpeg" value={ffmpegVersionValue} ok={ffmpegOk} />
      </section>

      <button type="button" className="button" disabled title="Disponible próximamente">
        Crear proyecto
      </button>
    </main>
  );
}

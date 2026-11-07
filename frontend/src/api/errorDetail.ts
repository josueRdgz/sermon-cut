/** FastAPI may return `detail` as a string or as a list of validation objects. */
export function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item && typeof item === 'object' && 'msg' in item) {
          const msg = (item as { msg: unknown }).msg;
          if (typeof msg === 'string' && msg.trim()) return msg.trim();
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' · ');
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    const msg = (detail as { msg: unknown }).msg;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return fallback;
}

/** Pin the workspace tab bar to the top so inner tool tabs stack under it. */
export function pinWorkspaceNav(): void {
  const nav = document.querySelector<HTMLElement>('.workspace-nav');
  if (!nav || typeof window.scrollTo !== 'function') return;
  const top = nav.getBoundingClientRect().top + window.scrollY;
  try {
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  } catch {
    // jsdom and some webviews implement scrollTo as a stub.
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { pinWorkspaceNav } from './workspaceScroll';

describe('pinWorkspaceNav', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('scrolls the workspace nav to the top of the window', () => {
    const nav = document.createElement('nav');
    nav.className = 'workspace-nav';
    document.body.append(nav);
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({
      top: 120,
      bottom: 180,
      left: 0,
      right: 400,
      width: 400,
      height: 60,
      x: 0,
      y: 120,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 40 });
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollTo });

    pinWorkspaceNav();

    expect(scrollTo).toHaveBeenCalledWith({ top: 160, behavior: 'smooth' });
  });
});

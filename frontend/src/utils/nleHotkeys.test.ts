import { afterEach, describe, expect, it } from 'vitest';

import { isNleHotkeyTarget, isReelEditorHotkeysActive } from './nleHotkeys';

describe('nleHotkeys', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores typing in form fields', () => {
    const input = document.createElement('input');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(input, select, editable);
    expect(isNleHotkeyTarget(input)).toBe(false);
    expect(isNleHotkeyTarget(select)).toBe(false);
    expect(isNleHotkeyTarget(editable)).toBe(false);
    expect(isNleHotkeyTarget(document.body)).toBe(true);
  });

  it('stays quiet when the editor workspace tab is hidden', () => {
    const panel = document.createElement('div');
    panel.id = 'workspace-panel-editor';
    panel.hidden = true;
    document.body.appendChild(panel);
    expect(isReelEditorHotkeysActive()).toBe(false);
    panel.hidden = false;
    expect(isReelEditorHotkeysActive()).toBe(true);
  });

  it('stays quiet while a dialog is open', () => {
    const panel = document.createElement('div');
    panel.id = 'workspace-panel-editor';
    document.body.appendChild(panel);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    expect(isReelEditorHotkeysActive()).toBe(false);
  });
});

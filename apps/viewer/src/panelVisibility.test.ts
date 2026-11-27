// panelVisibility: on screen = the document visible and the window not 0 x 0
// (a frame its host hides with display: none), read fresh on every call.

import { describe, expect, it, vi } from 'vitest';
import { isPanelShown, onPanelShown } from './panelVisibility.js';
import type { PanelDocument, PanelWindow } from './panelVisibility.js';

function fakePage(width = 800, height = 600, visibility: DocumentVisibilityState = 'visible') {
  const listeners = { resize: new Set<() => void>(), visibilitychange: new Set<() => void>() };
  const state = { width, height, visibility };
  const win: PanelWindow = {
    get innerWidth() {
      return state.width;
    },
    get innerHeight() {
      return state.height;
    },
    addEventListener: (_type, listener) => void listeners.resize.add(listener),
    removeEventListener: (_type, listener) => void listeners.resize.delete(listener),
  };
  const doc: PanelDocument = {
    get visibilityState() {
      return state.visibility;
    },
    addEventListener: (_type, listener) => void listeners.visibilitychange.add(listener),
    removeEventListener: (_type, listener) => void listeners.visibilitychange.delete(listener),
  };
  return {
    win,
    doc,
    listeners,
    resize(w: number, h: number) {
      state.width = w;
      state.height = h;
      for (const listener of [...listeners.resize]) listener();
    },
    setVisibility(next: DocumentVisibilityState) {
      state.visibility = next;
      for (const listener of [...listeners.visibilitychange]) listener();
    },
  };
}

describe('isPanelShown', () => {
  it('is true for a visible document in a window with a size', () => {
    const { win, doc } = fakePage();
    expect(isPanelShown(win, doc)).toBe(true);
  });

  it('is false for a hidden document', () => {
    const { win, doc } = fakePage(800, 600, 'hidden');
    expect(isPanelShown(win, doc)).toBe(false);
  });

  it('is false in a 0 x 0 window although the document reads visible', () => {
    const { win, doc } = fakePage(0, 0, 'visible');
    expect(isPanelShown(win, doc)).toBe(false);
  });
});

describe('onPanelShown', () => {
  it('fires when the window gets a size again, once per return', () => {
    const page = fakePage(0, 0);
    const shown = vi.fn();
    onPanelShown(shown, page.win, page.doc);
    page.resize(800, 600);
    expect(shown).toHaveBeenCalledTimes(1);
    page.resize(900, 600);
    expect(shown).toHaveBeenCalledTimes(1);
    page.resize(0, 0);
    page.resize(800, 600);
    expect(shown).toHaveBeenCalledTimes(2);
  });

  it('fires when the document becomes visible, but not into a 0 x 0 window', () => {
    const page = fakePage(0, 0, 'hidden');
    const shown = vi.fn();
    onPanelShown(shown, page.win, page.doc);
    page.setVisibility('visible');
    expect(shown).not.toHaveBeenCalled();
    page.resize(800, 600);
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it('stops listening after the unsubscribe', () => {
    const page = fakePage(0, 0);
    const shown = vi.fn();
    const off = onPanelShown(shown, page.win, page.doc);
    off();
    expect(page.listeners.resize.size).toBe(0);
    expect(page.listeners.visibilitychange.size).toBe(0);
    page.resize(800, 600);
    expect(shown).not.toHaveBeenCalled();
  });
});

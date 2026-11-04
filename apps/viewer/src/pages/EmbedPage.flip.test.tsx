// EmbedPage is a mode-store writer: it seeds the runtime's mode store before
// the first screen below it mounts.

import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getMode, setMode } from '@slaclab/canopy-screen-runtime';
import { EmbedPage } from './EmbedPage.js';

// Node >= 25 ships a global `localStorage` that is undefined without
// --localstorage-file and shadows jsdom's; install an in-memory one before
// canopy-shell reads it at import time.
vi.hoisted(() => {
  let usable = false;
  try {
    usable = typeof globalThis.localStorage?.getItem === 'function';
  } catch {
    // Reading the Node global can throw; treat that as unusable.
  }
  if (usable) return;
  const store = new Map<string, string>();
  const memory = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  for (const target of [globalThis, globalThis.window]) {
    if (target)
      Object.defineProperty(target, 'localStorage', { configurable: true, value: memory });
  }
});

afterEach(() => {
  cleanup();
  setMode('light');
  delete document.documentElement.dataset.theme;
});

describe('EmbedPage mode-store writer', () => {
  it("the store is set before a child's first layout effect, as a screen root reads it", () => {
    setMode('dark');
    const seen: string[] = [];
    function Child() {
      useLayoutEffect(() => {
        seen.push(getMode());
      }, []);
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/embed/x?theme=light']}>
        <Routes>
          <Route path="/embed" element={<EmbedPage themes={{}} />}>
            <Route path="*" element={<Child />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(seen).toEqual(['light']);
  });
});

// A press on a Browse row asks for that screen's document at once, before the
// click opens it; a screen already open is not asked for again. ScreenPage is
// a stand-in here: that the page takes the started request is
// ScreenPage.shared.test.tsx's.

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Manifest } from '../api.js';
import { EmbedThemeContext } from '../pages/EmbedPage.js';
import { resetScreenDocuments } from '../screenDocuments.js';
import { ZoomProvider } from '../ZoomContext.js';
import { WorkspacePage } from './WorkspacePage.js';

vi.hoisted(() => {
  // Node 26's unusable global localStorage shadows jsdom's (see WorkspacePage.test.tsx).
  const g = globalThis as { localStorage?: Storage };
  if (typeof g.localStorage?.getItem !== 'function') {
    const data = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => void data.delete(key),
      setItem: (key, value) => void data.set(key, String(value)),
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  }
});

vi.mock('../pages/ScreenPage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pages/ScreenPage.js')>();
  return { ...actual, ScreenPage: () => createElement('div', { 'data-testid': 'screen-probe' }) };
});

const BASE = 'https://host/screens';
const MANIFEST: Manifest = {
  screens: [
    {
      id: 'knob',
      kind: 'ir',
      title: 'Knob',
      category: 'bts',
      path: 'screens/bts/knob.screen.json',
      rev: 'k1',
    },
    {
      id: 'magnet',
      kind: 'ir',
      title: 'Magnet',
      category: 'bts',
      path: 'screens/bts/magnet.screen.json',
      rev: 'm1',
    },
  ],
};

let requests: string[];

beforeEach(() => {
  resetScreenDocuments();
  requests = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return new Response(JSON.stringify(url.endsWith('manifest.json') ? MANIFEST : {}), {
        status: 200,
        headers: { ETag: '"m1"' },
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const store of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      store?.clear();
    } catch {
      // Storage unavailable.
    }
  }
});

function row(title: string): HTMLElement {
  const label = screen
    .getAllByText(title)
    .find((el) => el.closest('.screen-tree') !== null && el.closest('.nav-tree__row') !== null);
  if (!label) throw new Error(`no tree row for ${title}`);
  return label.closest('.nav-tree__row') as HTMLElement;
}

describe('WorkspacePage: a pressed tree row', () => {
  it('asks for the document of the pressed screen, once, and not for one already open', async () => {
    render(
      <MemoryRouter initialEntries={['/embed/bts/knob']}>
        <ZoomProvider>
          <EmbedThemeContext.Provider
            value={{ mode: 'dark', id: 'dark', anchorRef: { current: null } }}
          >
            <WorkspacePage screensBaseUrl={BASE} config={{}} />
          </EmbedThemeContext.Provider>
        </ZoomProvider>
      </MemoryRouter>
    );
    await act(async () => {});
    await screen.findAllByText('Magnet');
    const documents = () => requests.filter((url) => url.endsWith('.screen.json'));
    expect(documents()).toEqual([]);

    fireEvent.mouseDown(row('Magnet'), { button: 0 });
    expect(documents()).toEqual([`${BASE}/screens/bts/magnet.screen.json`]);
    fireEvent.mouseDown(row('Magnet'), { button: 0 });
    expect(documents()).toHaveLength(1);

    // bts/knob is the open tab: its row focuses it, nothing to fetch.
    fireEvent.mouseDown(row('Knob'), { button: 0 });
    expect(documents()).toHaveLength(1);
  });
});

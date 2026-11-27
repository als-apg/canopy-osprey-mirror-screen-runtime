// The workspace page against a hub that pushes: once the stream's hello
// announces manifest-events the page's three-second manifest poll stands down
// and a manifest event fetches; a hub that announces nothing is polled as
// before. ScreenPage is a stand-in; the hub is a scripted claim and stream.

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Manifest } from '../api.js';
import { EmbedThemeContext } from '../pages/EmbedPage.js';
import { MANIFEST_POLL_MS } from '../useManifestPoll.js';
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
const MANIFEST_URL = `${BASE}/manifest.json`;

function manifest(title: string): Manifest {
  return {
    screens: [
      { id: 'knob', kind: 'ir', title, category: 'bts', path: 'screens/bts/knob.screen.json' },
    ],
  };
}

class Stream {
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    streams.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  close(): void {}
}

let streams: Stream[];
let served: { body: Manifest; etag: string };
let manifestGets: number;

beforeEach(() => {
  streams = [];
  served = { body: manifest('Knob'), etag: '"m1"' };
  manifestGets = 0;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== MANIFEST_URL) return new Response('{}', { status: 200 });
      manifestGets += 1;
      if (new Headers(init?.headers).get('If-None-Match') === served.etag) {
        return new Response(null, { status: 304, headers: { ETag: served.etag } });
      }
      return new Response(JSON.stringify(served.body), {
        status: 200,
        headers: { ETag: served.etag },
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

/** Lets what is in flight land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Lets `ticks` poll periods pass, each one settled before the next. */
async function pass(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(MANIFEST_POLL_MS);
    });
    await settle();
  }
}

/** Renders the page and waits for its claim to open the stream. */
async function renderWorkspace(): Promise<Stream> {
  render(
    <MemoryRouter initialEntries={['/embed/bts/knob']}>
      <ZoomProvider>
        <EmbedThemeContext.Provider
          value={{ mode: 'dark', id: 'dark', anchorRef: { current: null } }}
        >
          <WorkspacePage
            screensBaseUrl={BASE}
            config={{ workspace: { path: 'api/workspace', protocol: 1 } }}
          />
        </EmbedThemeContext.Provider>
      </ZoomProvider>
    </MemoryRouter>
  );
  await settle();
  expect(streams).toHaveLength(1);
  expect(manifestGets).toBe(1);
  return streams[0]!;
}

function treeTitles(): string[] {
  return [...document.querySelectorAll('.screen-tree__leaf .nav-tree__label')].map(
    (el) => el.textContent ?? ''
  );
}

describe('WorkspacePage with a pushing hub', () => {
  it('polls the manifest every three seconds when the hello announces nothing', async () => {
    const stream = await renderWorkspace();
    const windowId = new URL(stream.url).searchParams.get('window');
    await act(async () => stream.emit('hello', { epoch: 'e1', activeWindow: windowId, seq: 1 }));
    await settle();
    await pass(3);
    expect(manifestGets).toBe(4);
  });

  it('stops the interval once the hello announces manifest-events, and fetches for an event', async () => {
    const stream = await renderWorkspace();
    const windowId = new URL(stream.url).searchParams.get('window');
    await act(async () =>
      stream.emit('hello', {
        epoch: 'e1',
        activeWindow: windowId,
        seq: 1,
        capabilities: ['manifest-events', 'collections-events', 'manifest-tree-view'],
      })
    );
    await settle();
    // One conditional fetch for the new stream, then silence.
    expect(manifestGets).toBe(2);
    await pass(5);
    expect(manifestGets).toBe(2);
    expect(treeTitles()).toContain('Knob');

    served = { body: manifest('Knob, renamed'), etag: '"m2"' };
    await act(async () => stream.emit('manifest', { type: 'manifest', etag: '"m2"' }));
    await settle();
    expect(manifestGets).toBe(3);
    expect(treeTitles()).toContain('Knob, renamed');
  });
});

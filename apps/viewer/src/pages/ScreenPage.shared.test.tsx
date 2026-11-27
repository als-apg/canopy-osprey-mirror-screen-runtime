// ScreenPage inside a workspace opens from the manifest the workspace keeps:
// the document is requested at once and manifest.json is not fetched again. A
// page of its own, and a screen the kept manifest does not list, read the
// manifest as before; a rev change in the kept manifest still reloads.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocalPVService, MockPVService } from '@slaclab/canopy-client';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { Manifest } from '../api.js';
import { prefetchScreenDocument, resetScreenDocuments } from '../screenDocuments.js';
import { ServicesContext } from '../services.js';
import type { ViewerServices } from '../services.js';
import { SharedManifestContext } from '../useManifestPoll.js';
import type { SharedManifest } from '../useManifestPoll.js';
import { ScreenPage } from './ScreenPage.js';

// Node >= 25 ships an experimental global `localStorage` that is undefined
// unless --localstorage-file is given, and it shadows jsdom's; install an
// in-memory one before canopy-shell reads it at import time.
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

const BASE = 'http://host/drafts';
const PATH = 'screens/panel.screen.json';

function manifest(rev: string, ids: string[] = ['panel']): Manifest {
  return {
    screens: ids.map((id) => ({
      id,
      kind: 'ir',
      title: id,
      category: 'drafts',
      path: `screens/${id}.screen.json`,
      rev,
    })),
  };
}

function doc(text: string) {
  return {
    schemaVersion: '1.1',
    kind: 'screen',
    id: 'panel',
    metadata: {
      title: 'Panel',
      source: { type: 'hand-authored' },
      size: { width: 200, height: 50 },
    },
    macros: [],
    root: {
      id: 'root',
      type: 'text-label',
      props: { text },
      geometry: { x: 0, y: 0, width: 200, height: 20 },
    },
  };
}

/** What the server holds: the manifest, and the text of each document. */
let served: { manifest: Manifest; text: Record<string, string> };
/** Every request, in order, as its path under the base. */
let requests: string[];
/** Set to hold manifest.json unanswered. */
let holdManifest: Promise<void> | null;

let services: ViewerServices;

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  resetScreenDocuments();
  served = { manifest: manifest('r1'), text: { [PATH]: 'first' } };
  requests = [];
  holdManifest = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).slice(BASE.length + 1);
      requests.push(path);
      if (path === 'manifest.json') {
        if (holdManifest) await holdManifest;
        return new Response(JSON.stringify(served.manifest), { status: 200 });
      }
      const text = served.text[path];
      if (text === undefined) return new Response('{}', { status: 404, statusText: 'Not Found' });
      return new Response(JSON.stringify(doc(text)), { status: 200 });
    })
  );
  const pv = new MockPVService();
  pv.connect();
  const locals = new LocalPVService();
  locals.connect();
  services = { pv, formulas: null, locals, screenScope: () => ({ pv, formulas: null, locals }) };
});

afterEach(() => {
  cleanup();
  services.pv.disconnect();
  vi.unstubAllGlobals();
});

function page(shared: SharedManifest | null, id = 'panel') {
  const tree = (
    <ServicesContext.Provider value={services}>
      <MemoryRouter>
        <ScreenPage screensBaseUrl={BASE} chrome={false} category="drafts" id={id} />
      </MemoryRouter>
    </ServicesContext.Provider>
  );
  return shared === null ? (
    tree
  ) : (
    <SharedManifestContext.Provider value={shared}>{tree}</SharedManifestContext.Provider>
  );
}

describe('ScreenPage with the workspace manifest', () => {
  it('requests the document at once and never fetches manifest.json', async () => {
    // A manifest request would never be answered: the page must not wait for one.
    holdManifest = new Promise(() => {});
    render(page({ base: BASE, manifest: manifest('r1') }));
    expect(await screen.findByText('first')).toBeTruthy();
    expect(requests).toEqual([PATH]);
  });

  it('reads the manifest itself on a page of its own', async () => {
    render(page(null));
    expect(await screen.findByText('first')).toBeTruthy();
    expect(requests).toEqual(['manifest.json', PATH]);
  });

  it('reads the manifest itself while the workspace has none yet, once for every screen', async () => {
    served.text['screens/other.screen.json'] = 'second';
    served.manifest = manifest('r1', ['panel', 'other']);
    render(
      <>
        {page({ base: BASE, manifest: null })}
        {page({ base: BASE, manifest: null }, 'other')}
      </>
    );
    expect(await screen.findByText('first')).toBeTruthy();
    expect(await screen.findByText('second')).toBeTruthy();
    expect(requests.filter((path) => path === 'manifest.json')).toHaveLength(1);
  });

  it('reads the manifest itself for a screen the kept manifest does not list', async () => {
    render(page({ base: BASE, manifest: manifest('r1', ['elsewhere']) }));
    expect(await screen.findByText('first')).toBeTruthy();
    expect(requests).toEqual(['manifest.json', PATH]);
  });

  it('ignores a kept manifest of another base', async () => {
    render(page({ base: 'http://other/drafts', manifest: manifest('r1') }));
    expect(await screen.findByText('first')).toBeTruthy();
    expect(requests).toEqual(['manifest.json', PATH]);
  });

  it('does not refetch for a new manifest with the same rev, and reloads when the rev changes', async () => {
    const view = render(page({ base: BASE, manifest: manifest('r1') }));
    expect(await screen.findByText('first')).toBeTruthy();

    view.rerender(page({ base: BASE, manifest: manifest('r1') }));
    await act(async () => {});
    expect(requests).toEqual([PATH]);

    served.text[PATH] = 'second';
    view.rerender(page({ base: BASE, manifest: manifest('r2') }));
    expect(await screen.findByText('second')).toBeTruthy();
    expect(requests).toEqual([PATH, PATH]);
  });

  it('takes the document a pointer-down already started instead of fetching again', async () => {
    prefetchScreenDocument(BASE, PATH, 'r1');
    render(page({ base: BASE, manifest: manifest('r1') }));
    expect(await screen.findByText('first')).toBeTruthy();
    expect(requests).toEqual([PATH]);
  });
});

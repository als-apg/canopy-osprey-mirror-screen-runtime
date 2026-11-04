// Viewer acceptance: the route table (/ and /embed/<category> redirect to the
// workspace, @trace needs config.trace, every workspace URL write replaces),
// deep-link rendering of the real vacuum-system screen with mock PV data and
// query macros, the explicit schemaVersion error page, and the workspace on
// the embed route (screen tree, tabs, the focused screen's tile bar, widget
// actions under a router basename).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocalPVService, MockPVService } from '@slaclab/canopy-client';
import { getMode, setMode } from '@slaclab/canopy-screen-runtime';
import { __setWidgetRenderProbe } from '@slaclab/canopy-screen-runtime/testing';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import { App } from './App.js';
import { ServicesContext } from './services.js';
import type { ViewerServices } from './services.js';

import vacuumScreen from './test/vacuum-system.screen.json' with { type: 'json' };

// Node >= 25 ships an experimental global `localStorage` that is undefined
// unless --localstorage-file is given, and it shadows jsdom's. canopy-shell's
// themeStore reads localStorage at import time, so install an in-memory one
// before the imports above are evaluated (vi.hoisted runs first).
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

const MANIFEST = {
  screens: [
    {
      id: 'vacuum-system',
      kind: 'ir',
      title: 'Vacuum System',
      category: 'examples',
      path: 'screens/examples/vacuum-system.screen.json',
      macros: [
        { name: 'PREFIX', default: 'DEMO:VAC1' },
        { name: 'DEVICE', default: 'Q1' },
      ],
      tags: [],
      schemaVersion: '1.0',
    },
    {
      id: 'pump-panel',
      kind: 'wrapper',
      title: 'Pump Panel (code)',
      category: 'cryo',
      path: 'screens/cryo/pump-panel',
    },
    {
      // A nested id (slash) — must be reachable under the /s/:category/* splat.
      id: 'CBXFEL/Landing',
      kind: 'ir',
      title: 'CBXFEL Landing',
      category: 'examples',
      path: 'screens/examples/CBXFEL/Landing.screen.json',
      macros: [],
      tags: [],
      schemaVersion: '1.0',
    },
  ],
};

const MOTOR_SCREEN = {
  schemaVersion: '1.0',
  kind: 'template',
  id: 'motor-control',
  metadata: {
    title: 'Motor',
    source: { type: 'hand-authored' },
    size: { width: 400, height: 200 },
  },
  macros: [{ name: 'MOTOR' }],
  root: {
    id: 'm-root',
    type: 'text-label',
    props: { text: 'Motor ${MOTOR}' },
    geometry: { x: 0, y: 0, width: 200, height: 20 },
  },
};

/** URL-suffix-matched fetch stub. */
function stubFetch(routes: Record<string, unknown>) {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [suffix, data] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return new Response(JSON.stringify(data), { status: 200 });
    }
    return new Response('{}', { status: 404, statusText: 'Not Found' });
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

let services: ViewerServices;

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  const pv = new MockPVService();
  pv.connect();
  const locals = new LocalPVService();
  locals.connect();
  // One shared scope: these tests open one screen at a time.
  services = { pv, formulas: null, locals, screenScope: () => ({ pv, formulas: null, locals }) };
});

afterEach(() => {
  cleanup();
  services.pv.disconnect();
  vi.unstubAllGlobals();
  // Zoom state and the sub-screen choice persist by design; not across tests.
  for (const store of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      store?.clear();
    } catch {
      // Unusable storage: nothing persisted.
    }
  }
});

function renderAt(path: string) {
  return render(
    <ServicesContext.Provider value={services}>
      <MemoryRouter initialEntries={[path]}>
        <App screensBaseUrl={window.location.origin} />
      </MemoryRouter>
    </ServicesContext.Provider>
  );
}

describe('browse page', () => {
  it('lists manifest screens as cards, links ir screens, disables code screens', async () => {
    stubFetch({ '/manifest.json': MANIFEST });
    renderAt('/');

    const irCard = (await screen.findByText('Vacuum System')).closest('a');
    expect(irCard).not.toBeNull();
    expect(irCard!.getAttribute('href')).toBe('/s/examples/vacuum-system');

    const codeCard = screen.getByText('Pump Panel (code)').closest('div');
    expect(codeCard!.className).toContain('screen-card--disabled');
    expect(screen.getByText('code screen — not yet viewable')).toBeTruthy();
  });

  it('filters cards by title, category, and id', async () => {
    stubFetch({ '/manifest.json': MANIFEST });
    renderAt('/');
    await screen.findByText('Vacuum System');

    const input = screen.getByPlaceholderText<HTMLInputElement>('Filter by title, category, or id');

    // Category filter hides the non-matching card.
    fireEvent.change(input, { target: { value: 'cryo' } });
    expect(screen.queryByText('Vacuum System')).toBeNull();
    expect(screen.getByText('Pump Panel (code)')).toBeTruthy();

    // Id filter.
    fireEvent.change(input, { target: { value: 'vacuum-sys' } });
    expect(screen.getByText('Vacuum System')).toBeTruthy();
    expect(screen.queryByText('Pump Panel (code)')).toBeNull();

    // No match message.
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText(/No screens match/)).toBeTruthy();
  });

  it('shows an explicit error when the manifest cannot load', async () => {
    stubFetch({});
    renderAt('/');
    expect(await screen.findByText('Could not load the screen manifest')).toBeTruthy();
  });
});

describe('screen page (deep link)', () => {
  it('renders the vacuum screen with mock data, query macros, and embedded display', async () => {
    stubFetch({
      '/manifest.json': MANIFEST,
      '/screens/examples/vacuum-system.screen.json': vacuumScreen,
      '/screens/examples/motor-control.screen.json': MOTOR_SCREEN,
    });

    renderAt('/s/examples/vacuum-system?PREFIX=XX00:9');

    // AppHeader title comes from the screen metadata.
    expect(await screen.findByText('Vacuum System')).toBeTruthy();
    // The screen canvas rendered.
    const root = await screen.findByTestId('screen-root');
    expect(root.dataset.screenId).toBe('vacuum-system');
    // The embedded display resolved relative to the screen document and its
    // node macros were substituted with the ?PREFIX= query macro.
    expect(await screen.findByText('Motor XX00:9:M1')).toBeTruthy();
    // No widget crashed.
    expect(root.querySelectorAll('[data-testid="widget-error"]')).toHaveLength(0);
  });

  it('shows the explicit schema-mismatch error page (never blank)', async () => {
    stubFetch({
      '/manifest.json': MANIFEST,
      '/screens/examples/vacuum-system.screen.json': { ...vacuumScreen, schemaVersion: '9.9' },
    });

    renderAt('/s/examples/vacuum-system');

    expect(await screen.findByText('Schema version mismatch')).toBeTruthy();
    expect(screen.getByText(/declares schemaVersion 9\.9/)).toBeTruthy();
  });

  it('shows an explicit error for unknown screens', async () => {
    stubFetch({ '/manifest.json': MANIFEST });
    renderAt('/s/examples/nope');
    expect(await screen.findByText("No screen 'examples/nope' in the manifest")).toBeTruthy();
  });

  it('opens a nested screen id (slash) via the splat route', async () => {
    const NESTED = {
      ...MOTOR_SCREEN,
      kind: 'screen',
      id: 'CBXFEL/Landing',
      metadata: { ...MOTOR_SCREEN.metadata, title: 'CBXFEL Landing' },
    };
    stubFetch({
      '/manifest.json': MANIFEST,
      '/screens/examples/CBXFEL/Landing.screen.json': NESTED,
    });
    renderAt('/s/examples/CBXFEL/Landing');
    // Resolves (not the "Page not found" splat-miss) — header shows the title.
    expect(await screen.findByText('CBXFEL Landing')).toBeTruthy();
    expect(screen.queryByText('Page not found')).toBeNull();
  });

  it('explains code screens instead of rendering blank', async () => {
    stubFetch({ '/manifest.json': MANIFEST });
    renderAt('/s/cryo/pump-panel');
    expect(await screen.findByText(/is a wrapper screen/)).toBeTruthy();
  });
});

describe('/s/ theme (the second mode-store writer)', () => {
  function stubVacuum() {
    stubFetch({
      '/manifest.json': MANIFEST,
      '/screens/examples/vacuum-system.screen.json': vacuumScreen,
      '/screens/examples/motor-control.screen.json': MOTOR_SCREEN,
    });
  }

  function renderS(path: string, themes: Record<string, 'light' | 'dark'> = {}) {
    return render(
      <ServicesContext.Provider value={services}>
        <MemoryRouter initialEntries={[path]}>
          <App screensBaseUrl={window.location.origin} themes={themes} />
        </MemoryRouter>
      </ServicesContext.Provider>
    );
  }

  function hostTheme(theme: string) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'canopy:theme', theme },
          source: window.parent,
          origin: window.location.origin,
        })
      );
    });
  }

  afterEach(() => {
    __setWidgetRenderProbe(null);
    setMode('light');
    delete document.documentElement.dataset.theme;
  });

  it("a bare /s/ URL renders light (today's look), whatever the store held", async () => {
    stubVacuum();
    setMode('dark');
    const { container } = renderS('/s/examples/vacuum-system');
    expect(getMode()).toBe('light');
    const root = await screen.findByTestId('screen-root');
    expect(root.dataset.theme).toBe('light');
    // The /s/ wrapper (the shell header may carry its own Carbon theme).
    const wrapper = container.querySelector<HTMLElement>('.viewer-embed');
    expect(wrapper?.classList.contains('cds--white')).toBe(true);
    expect(wrapper?.classList.contains('cds--g100')).toBe(false);
  });

  it('wraps the page in a full-height Carbon <Theme>', async () => {
    stubVacuum();
    const { container } = renderS('/s/examples/vacuum-system');
    await screen.findByTestId('screen-root');
    const wrapper = container.querySelector<HTMLElement>('.cds--white');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.classList.contains('viewer-embed')).toBe(true);
    expect(wrapper!.querySelector('[data-testid="screen-root"]')).not.toBeNull();
  });

  it('?theme= resolves through config.themes and sets html[data-theme] to the mode', async () => {
    stubVacuum();
    document.documentElement.dataset.theme = 'light';
    const { container } = renderS('/s/examples/vacuum-system?theme=host-night', {
      'host-night': 'dark',
    });
    const root = await screen.findByTestId('screen-root');
    expect(root.dataset.theme).toBe('dark');
    expect(container.querySelector('.cds--g100.viewer-embed')).not.toBeNull();
    // The document carries the mode, never the theme id.
    expect(document.documentElement.dataset.theme).toBe('dark');
    // It persists nothing (canopy-shell's setColorMode would).
    expect(window.localStorage.getItem('canopy.theme')).toBeNull();
  });

  it('the /s/ wrapper is the host anchor and carries the theme id', async () => {
    stubVacuum();
    const { container } = renderS('/s/examples/vacuum-system?theme=desy-dark');
    await screen.findByTestId('screen-root');
    const anchor = container.querySelector<HTMLElement>('.viewer-embed')!;
    expect(anchor.hasAttribute('data-canopy-host-root')).toBe(true);
    expect(anchor.hasAttribute('data-floating-menu-container')).toBe(true);
    expect(anchor.getAttribute('data-theme')).toBe('desy-dark');
    expect(anchor.classList.contains('cds--g100')).toBe(true);

    // A host message renames the same element; the mode is unchanged.
    hostTheme('retro-dark');
    expect(container.querySelector('.viewer-embed')).toBe(anchor);
    expect(anchor.getAttribute('data-theme')).toBe('retro-dark');
    expect(getMode()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('the /s/ anchor carries the mode without a well-formed theme id', async () => {
    stubVacuum();
    const { container } = renderS('/s/examples/vacuum-system');
    await screen.findByTestId('screen-root');
    const anchor = container.querySelector<HTMLElement>('.viewer-embed')!;
    expect(anchor.hasAttribute('data-canopy-host-root')).toBe(true);
    expect(anchor.getAttribute('data-theme')).toBe('light');
    hostTheme('Not A Theme');
    // Ill-formed: resolved as dark by its name, never written to the DOM.
    expect(anchor.getAttribute('data-theme')).toBe('dark');
  });

  it('a /s/ flip renders no widget, and Carbon follows it', async () => {
    stubVacuum();
    let renders = 0;
    __setWidgetRenderProbe(() => {
      renders += 1;
    });
    const { container } = renderS('/s/examples/vacuum-system', { 'host-night': 'dark' });
    const root = await screen.findByTestId('screen-root');
    expect(await screen.findByText('Motor DEMO:VAC1:M1')).toBeTruthy();
    // Positive control: the probe sees widgets render on mount.
    expect(renders).toBeGreaterThanOrEqual(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    renders = 0;
    hostTheme('host-night');
    expect(root.dataset.theme).toBe('dark');
    expect(container.querySelector('.cds--g100.viewer-embed')).not.toBeNull();
    hostTheme('light');
    expect(root.dataset.theme).toBe('light');
    expect(container.querySelector('.cds--white.viewer-embed')).not.toBeNull();

    expect(renders).toBe(0);
  });
});

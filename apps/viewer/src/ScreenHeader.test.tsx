// ScreenHeader: the zoom buttons take their look from canopy-shell's
// `canopy-btn` class, and ScreenHeader.css carries no button recipe of its own.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScreenHeader } from './ScreenHeader.js';
import type { ScreenHistory, ScreenZoom } from './ScreenHeader.js';
import type { ScreenActionContext } from './screenActions/types.js';

// Same in-memory localStorage shim as App.test.tsx: Node >= 25 can shadow
// jsdom's with an unusable global, and canopy-shell's themeStore reads
// localStorage at import time.
vi.hoisted(() => {
  let usable = false;
  try {
    usable = typeof globalThis.localStorage?.getItem === 'function';
  } catch {
    // Treat a throwing getter as unusable.
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
      Object.defineProperty(target, 'localStorage', { value: memory, configurable: true });
  }
});

// Read from disk: vitest blanks `.css` imports, `?raw` included.
const css = readFileSync(createRequire(import.meta.url).resolve('./ScreenHeader.css'), 'utf8');

/** The selectors of every rule in `text`, comments removed. */
function selectors(text: string): string[] {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((rule) => rule.split('{')[0].trim())
    .filter((selector) => selector !== '');
}

/** The declarations of the rule whose selector is exactly `selector`. */
function declarations(text: string, selector: string): string[] {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = bare.split('}').find((r) => r.split('{')[0].trim() === selector);
  if (rule === undefined) return [];
  return rule
    .split('{')[1]
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d !== '');
}

function zoom(overrides: Partial<ScreenZoom> = {}): ScreenZoom {
  return {
    scale: 1,
    fit: false,
    onZoomOut: vi.fn(),
    onZoomIn: vi.fn(),
    onFit: vi.fn(),
    onActualSize: vi.fn(),
    ...overrides,
  };
}

function history(overrides: Partial<ScreenHistory> = {}): ScreenHistory {
  return {
    back: { enabled: true, onClick: vi.fn() },
    forward: { enabled: false, onClick: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ScreenHeader bar', () => {
  it('stays the dark label-only bar in both themes, without a skip link', () => {
    for (const mode of ['light', 'dark']) {
      document.documentElement.dataset.theme = mode;
      render(<ScreenHeader title="GTL" />);
      const header = screen.getByRole('banner');
      expect(header.closest('.cds--g100')).not.toBeNull();
      expect(header.classList.contains('canopy-header--brand')).toBe(false);
      expect(header.querySelector('.cds--header__name--prefix')).toBeNull();
      expect(header.querySelector('.cds--header__name')?.textContent).toBe('SCREEN');
      expect(header.querySelector('.cds--skip-to-content')).toBeNull();
      cleanup();
    }
    delete document.documentElement.dataset.theme;
  });
});

describe('ScreenHeader zoom buttons', () => {
  it('carry canopy-btn beside screen-header__button', () => {
    render(<ScreenHeader title="GTL" zoom={zoom()} />);
    const buttons = screen.getByRole('group', { name: 'Zoom' }).querySelectorAll('button');
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.classList.contains('canopy-btn')).toBe(true);
      expect(button.classList.contains('screen-header__button')).toBe(true);
    }
  });

  it('keep the text modifier and the pressed state of Fit', () => {
    render(<ScreenHeader title="GTL" zoom={zoom({ fit: true })} />);
    const fit = screen.getByRole('button', { name: 'Fit' });
    expect(fit.classList.contains('screen-header__button--text')).toBe(true);
    expect(fit.classList.contains('canopy-btn')).toBe(true);
    expect(fit.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Actual size' }).classList.contains('canopy-btn')
    ).toBe(true);
  });

  it('are absent without a zoom', () => {
    render(<ScreenHeader title="GTL" />);
    expect(screen.queryByRole('group', { name: 'Zoom' })).toBeNull();
    expect(document.querySelector('.screen-header__button')).toBeNull();
  });
});

describe('ScreenHeader history buttons', () => {
  it('are absent without a history (tool tabs, the /s/ route)', () => {
    render(<ScreenHeader title="GTL" zoom={zoom()} />);
    expect(screen.queryByRole('group', { name: 'History' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forward' })).toBeNull();
  });

  it('show ◀ then ▶ as canopy-btn buttons', () => {
    render(<ScreenHeader title="GTL" history={history()} />);
    const buttons = screen.getByRole('group', { name: 'History' }).querySelectorAll('button');
    expect([...buttons].map((b) => b.getAttribute('aria-label'))).toEqual(['Back', 'Forward']);
    expect([...buttons].map((b) => b.textContent)).toEqual(['◀', '▶']);
    for (const button of buttons) {
      expect(button.classList.contains('canopy-btn')).toBe(true);
      expect(button.classList.contains('screen-header__button')).toBe(true);
    }
  });

  it('disable a direction whose stack is empty and enable the other', () => {
    render(<ScreenHeader title="GTL" history={history()} />);
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('dispatch the click of an enabled button and ignore a disabled one', () => {
    const h = history();
    render(<ScreenHeader title="GTL" history={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(h.back.onClick).toHaveBeenCalledTimes(1);
    expect(h.forward.onClick).not.toHaveBeenCalled();
  });

  it('title a target open elsewhere "Switch to <title>", else Back/Forward', () => {
    render(
      <ScreenHeader
        title="GTL"
        history={history({
          back: { enabled: true, switchTo: 'Booster RF', onClick: vi.fn() },
          forward: { enabled: true, onClick: vi.fn() },
        })}
      />
    );
    expect(screen.getByRole('button', { name: 'Back' }).getAttribute('title')).toBe(
      'Switch to Booster RF'
    );
    expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('title')).toBe('Forward');
  });

  it('bind no Alt+Left/Right shortcut', () => {
    const h = history({ forward: { enabled: true, onClick: vi.fn() } });
    render(<ScreenHeader title="GTL" history={h} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    expect(h.back.onClick).not.toHaveBeenCalled();
    expect(h.forward.onClick).not.toHaveBeenCalled();
  });
});

/** A header `header` px wide whose fixed parts are 100 px each. */
function stubWidths(header: number, part = 100) {
  // A real observer reports once on observe.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe() {
        this.callback();
      }
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('screen-header') ? header : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.parentElement?.classList.contains('cds--header') ? part : 0;
  });
}

const actionCtx: ScreenActionContext = {
  screen: {
    category: 'drafts',
    id: 'e2e-panel',
    title: 'E2E Panel',
    macros: {},
    element: document.createElement('div'),
    documentUrl: 'http://localhost/screens/drafts/e2e-panel.screen.json',
  },
  zoom: { scale: 1, fit: false },
  link: 'http://localhost/s/drafts/e2e-panel',
};

describe('ScreenHeader layout', () => {
  it('puts ◀ ▶ beside the title block, not inside the shrinking one', () => {
    render(<ScreenHeader title="GTL" zoom={zoom()} history={history()} />);
    const group = screen.getByRole('group', { name: 'History' });
    const info = document.querySelector('.screen-header__info')!;
    expect(info.contains(group)).toBe(false);
    expect(group.parentElement).toBe(info.parentElement);
    expect(group.nextElementSibling).toBe(info);
  });

  it('keeps the history group and the zoom group from shrinking, and ellipsises the title', () => {
    expect(declarations(css, '.screen-header__history')).toContain('flex: none');
    expect(declarations(css, '.screen-header__zoom')).toContain('flex: none');
    const title = declarations(css, '.screen-header__title');
    expect(title).toContain('text-overflow: ellipsis');
    expect(title).toContain('white-space: nowrap');
    expect(title).toContain('overflow: hidden');
  });
});

describe('ScreenHeader in a narrow header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows every control in the bar when they fit', () => {
    stubWidths(1200);
    render(<ScreenHeader title="GTL" zoom={zoom()} history={history()} actions={actionCtx} />);
    const bar = screen.getByTestId('screen-header');
    expect(bar.querySelector('.screen-header__zoom')).not.toBeNull();
    expect(bar.querySelector('[data-screen-action="print"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'More controls' })).toBeNull();
  });

  it('collapses the zoom group and the actions into one overflow menu below the fit width', () => {
    // ◀ ▶ + title room 214, label 150, zoom 150, actions 150: 375 fits none of the stages.
    stubWidths(375, 150);
    const z = zoom();
    render(<ScreenHeader title="GTL" zoom={z} history={history()} actions={actionCtx} />);
    const bar = screen.getByTestId('screen-header');
    // ◀ ▶ stay in the bar; zoom and actions leave it for the menu.
    expect(bar.querySelector('[aria-label="Back"]')).not.toBeNull();
    expect(bar.querySelector('[aria-label="Forward"]')).not.toBeNull();
    expect(bar.querySelector('.screen-header__zoom')).toBeNull();
    expect(bar.querySelector('[data-screen-action]')).toBeNull();
    const more = screen.getByRole('button', { name: 'More controls' });
    expect(bar.contains(more)).toBe(true);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Zoom' })).toBeNull();

    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('group', { name: 'Screen controls' });
    expect(more.getAttribute('aria-controls')).toBe(menu.id);
    expect(bar.contains(menu)).toBe(false);
    // The menu escapes the clipping tile bar and paints as the dark header does.
    expect(menu.closest('.cds--g100')).not.toBeNull();
    expect(menu.querySelector('[data-screen-action="print"]')).not.toBeNull();
    expect(menu.querySelector('[data-screen-action="copy-link"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(z.onZoomIn).toHaveBeenCalledTimes(1);
    // A zoom step keeps the menu open for the next one.
    expect(more.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Screen controls' })).toBeNull();
  });

  it('moves the actions first and keeps the zoom group while it still fits', () => {
    // Label + ◀ ▶ + title room 264, zoom 100, actions 100: 420 fits all but the actions.
    stubWidths(420);
    render(<ScreenHeader title="GTL" zoom={zoom()} history={history()} actions={actionCtx} />);
    const bar = screen.getByTestId('screen-header');
    expect(bar.querySelector('.screen-header__zoom')).not.toBeNull();
    expect(bar.querySelector('[data-screen-action]')).toBeNull();
    expect(bar.classList.contains('screen-header--no-label')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'More controls' }));
    const menu = screen.getByRole('group', { name: 'Screen controls' });
    expect(menu.querySelector('[data-screen-action="print"]')).not.toBeNull();
    expect(menu.querySelector('.screen-header__zoom')).toBeNull();
    expect(screen.getAllByRole('group', { name: 'Zoom' })).toHaveLength(1);
  });

  it('then drops the SCREEN label before it collapses the zoom group', () => {
    // 330 fits ◀ ▶ + title room 164, zoom 100 and the menu button, not the label as well.
    stubWidths(330);
    render(<ScreenHeader title="GTL" zoom={zoom()} history={history()} actions={actionCtx} />);
    const bar = screen.getByTestId('screen-header');
    expect(bar.classList.contains('screen-header--no-label')).toBe(true);
    expect(bar.querySelector('.screen-header__zoom')).not.toBeNull();
    expect(bar.querySelector('[data-screen-action]')).toBeNull();
    expect(declarations(css, '.screen-header--no-label .canopy-header__name')).toContain(
      'display: none'
    );
  });

  it('closes the overflow menu on a press outside it', () => {
    stubWidths(250, 150);
    render(<ScreenHeader title="GTL" zoom={zoom()} actions={actionCtx} />);
    const more = screen.getByRole('button', { name: 'More controls' });
    fireEvent.click(more);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Zoom out' }));
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(document.body);
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the full layout where ResizeObserver is missing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<ScreenHeader title="GTL" zoom={zoom()} history={history()} actions={actionCtx} />);
    expect(screen.getByRole('group', { name: 'Zoom' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'More controls' })).toBeNull();
  });

  it('has nothing to collapse without zoom or actions', () => {
    stubWidths(200);
    render(<ScreenHeader title="GTL" history={history()} />);
    expect(screen.queryByRole('button', { name: 'More controls' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined();
  });
});

describe('ScreenHeader.css', () => {
  it('declares no .screen-header__button rule', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((selector) => selector.includes('.screen-header__button'))).toEqual([]);
  });

  it('leaves .screen-header without paint', () => {
    const own = declarations(css, '.screen-header');
    expect(own.length).toBeGreaterThan(0);
    const painted = own.filter((d) => /^(background|color|border|box-shadow|outline)/.test(d));
    expect(painted).toEqual([]);
  });

  it('takes its colours and fonts from contract variables', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bare).not.toMatch(/--cds-/);
    const fonts = bare.match(/font-family:[^;]*/g) ?? [];
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(font).toContain('var(--canopy-font-');
  });
});

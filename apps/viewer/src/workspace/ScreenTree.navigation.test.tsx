// ScreenTree with a library navigation: the Screens branch shows the
// library's groups and leaves in its order, the folder tree sits in a last,
// collapsed "All screens" group, and an absent or invalid navigation leaves
// the tree as it is without one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ManifestScreen } from '../api.js';
import { memberKey } from './collections.js';
import { ScreenTree, collapsedStorageKey } from './ScreenTree.js';
import type { BrowseCollections } from './ScreenTree.js';
import { EMPTY_STATE } from './useCollections.js';

// Same in-memory localStorage shim as ScreenTree.test.tsx.
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

function entry(category: string, id: string, title: string, kind = 'ir'): ManifestScreen {
  return { id, kind, title, category, path: `screens/${category}/${id}.screen.json` };
}

const SCREENS: ManifestScreen[] = [
  entry('plant', 'overview', 'Plant Overview'),
  entry('plant', 'pumps/p1', 'Pump One'),
  entry('plant', 'pumps/p2', 'Pump Two'),
  entry('plant', 'valves/v1', 'Valve One'),
  entry('plant', 'old/code', 'Old Code Screen', 'code'),
  entry('plant', 'tanks/t1', 'Tank Level'),
];

const NAVIGATION = [
  { screen: 'plant/overview', label: 'Start here' },
  {
    label: 'Pumping',
    screen: 'plant/overview',
    children: [{ screen: 'plant/pumps/p2' }, { screen: 'plant/pumps/p1', label: 'First pump' }],
  },
  { label: 'Valves', children: [{ screen: 'plant/valves/v1' }] },
];

function labels(): string[] {
  return Array.from(document.querySelectorAll('[role="treeitem"]')).map(
    (item) => item.querySelector(':scope > .nav-tree__row .nav-tree__label')?.textContent ?? ''
  );
}

const item = (name: string) => screen.getByRole('treeitem', { name });
const chevron = (name: string) =>
  item(name).querySelector<HTMLElement>(
    ':scope > .nav-tree__row [data-testid="nav-tree-chevron"]'
  )!;

function collections(over: Partial<BrowseCollections> = {}): BrowseCollections {
  const pinned = over.state?.pinned ?? [];
  return {
    enabled: true,
    shown: [],
    state: { ...EMPTY_STATE, pinned },
    recent: [],
    pinnedKeys: new Set(pinned.map(memberKey)),
    openMember: vi.fn(),
    openAll: vi.fn(),
    pin: vi.fn(() => Promise.resolve()),
    unpin: vi.fn(() => Promise.resolve()),
    untick: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve({ ok: true as const, missing: false })),
    setRecentHover: vi.fn(),
    ...over,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalThis.localStorage?.removeItem(collapsedStorageKey());
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe('ScreenTree with a library navigation', () => {
  it("shows the library's tree in its order, then All screens, collapsed", () => {
    render(<ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={() => {}} />);
    expect(labels()).toEqual([
      'Screens',
      'Start here',
      'Pumping',
      'Pump Two',
      'First pump',
      'Valves',
      'Valve One',
      'All screens',
    ]);
    expect(item('All screens').getAttribute('aria-expanded')).toBe('false');
    expect(warn).not.toHaveBeenCalled();
  });

  it('All screens holds the folder tree unchanged and remembers being opened', () => {
    const first = render(
      <ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={() => {}} />
    );
    fireEvent.click(screen.getByText('All screens'));
    const all = item('All screens');
    expect(all.getAttribute('aria-expanded')).toBe('true');
    expect(
      Array.from(all.querySelectorAll('[role="treeitem"] > .nav-tree__row .nav-tree__label'))
        .map((label) => label.textContent)
        .slice(1)
    ).toEqual([
      'plant',
      'old',
      'Old Code Screen',
      'pumps',
      'Pump One',
      'Pump Two',
      'tanks',
      'Tank Level',
      'valves',
      'Valve One',
      'Plant Overview',
    ]);
    first.unmount();
    render(<ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={() => {}} />);
    expect(item('All screens').getAttribute('aria-expanded')).toBe('true');
  });

  it('a leaf opens its screen; a group that names a screen opens it from its row and expands from its chevron', () => {
    const onOpen = vi.fn();
    render(<ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('First pump'));
    expect(onOpen).toHaveBeenLastCalledWith('plant/pumps/p1', 'replace');

    fireEvent.click(screen.getByText('Pumping'));
    expect(onOpen).toHaveBeenLastCalledWith('plant/overview', 'replace');
    expect(item('Pumping').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chevron('Pumping'));
    expect(item('Pumping').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('First pump')).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(2);

    // A group without a screen toggles from its row and opens nothing.
    fireEvent.click(screen.getByText('Valves'));
    expect(item('Valves').getAttribute('aria-expanded')).toBe('false');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps the menu, the pin star and the drag on a navigation leaf', () => {
    const onOpen = vi.fn();
    const onDragStart = vi.fn();
    const api = collections();
    render(
      <ScreenTree
        screens={SCREENS}
        navigation={NAVIGATION}
        onOpen={onOpen}
        onDragStart={onDragStart}
        collections={api}
      />
    );
    fireEvent.contextMenu(screen.getByText('First pump'));
    fireEvent.click(screen.getByText('Open in new tab'));
    expect(api.openMember).toHaveBeenCalledWith({ screen: 'plant/pumps/p1' }, { newTab: true });
    fireEvent.contextMenu(screen.getByText('First pump'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(api.pin).toHaveBeenCalledWith({ screen: 'plant/pumps/p1' });
    const row = item('First pump').querySelector<HTMLElement>(':scope > .nav-tree__row')!;
    fireEvent.dragStart(row, { dataTransfer: { setData: () => {}, effectAllowed: 'none' } });
    expect(onDragStart).toHaveBeenCalledWith({ screen: 'plant/pumps/p1' }, expect.anything());
  });

  it('marks the active screen in the navigation', () => {
    render(
      <ScreenTree
        screens={SCREENS}
        navigation={NAVIGATION}
        activeKey="plant/valves/v1"
        onOpen={() => {}}
      />
    );
    expect(item('Valve One').getAttribute('aria-selected')).toBe('true');
  });

  it('search finds a screen by label, title or id, and every screen under All screens', () => {
    render(<ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={() => {}} />);
    const box = screen.getByRole('searchbox');
    // By the library's label and by the screen's own title: the leaf, and the folder row.
    fireEvent.change(box, { target: { value: 'first' } });
    expect(labels()).toEqual(['Screens', 'Pumping', 'First pump']);
    fireEvent.change(box, { target: { value: 'pump one' } });
    expect(labels()).toEqual([
      'Screens',
      'Pumping',
      'First pump',
      'All screens',
      'plant',
      'pumps',
      'Pump One',
    ]);
    // A screen the navigation does not name is still found.
    fireEvent.change(box, { target: { value: 'tank' } });
    expect(labels()).toEqual(['Screens', 'All screens', 'plant', 'tanks', 'Tank Level']);
  });

  it('skips screens that are not listed and names them in one warning', () => {
    const navigation = [
      { screen: 'plant/gone' },
      { label: 'Group', children: [{ screen: 'plant/pumps/p1' }, { screen: 'plant/also-gone' }] },
    ];
    const { rerender } = render(
      <ScreenTree screens={SCREENS} navigation={navigation} onOpen={() => {}} />
    );
    expect(labels()).toEqual(['Screens', 'Group', 'Pump One', 'All screens']);
    rerender(<ScreenTree screens={[...SCREENS]} navigation={navigation} onOpen={() => {}} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('plant/gone, plant/also-gone');
  });

  it('shows the same row twice when the library names a screen twice', () => {
    const navigation = [
      { label: 'A', children: [{ screen: 'plant/pumps/p1' }] },
      { label: 'B', children: [{ screen: 'plant/pumps/p1' }] },
    ];
    render(<ScreenTree screens={SCREENS} navigation={navigation} onOpen={() => {}} />);
    expect(within(item('A')).getByText('Pump One')).toBeTruthy();
    expect(within(item('B')).getByText('Pump One')).toBeTruthy();
  });
});

const DEEP_SCREENS: ManifestScreen[] = [
  ...SCREENS,
  entry('plant', 'unit-4-1', 'Unit 4-1'),
  entry('plant', 'zone/ab04c-xy1', 'Sensor Row'),
];

const DEEP = [
  { screen: 'plant/overview', label: 'Start here' },
  {
    label: 'Pumping',
    screen: 'plant/overview',
    children: [
      { screen: 'plant/pumps/p2' },
      {
        label: 'Spares',
        screen: 'plant/tanks/t1',
        children: [
          { screen: 'plant/pumps/p1', label: 'First pump' },
          { label: 'Cold store', children: [{ screen: 'plant/valves/v1' }] },
        ],
      },
    ],
  },
  { label: 'Valves', children: [{ screen: 'plant/valves/v1', label: 'Main valve' }] },
];

const TWO_LEVELS = [
  'Screens',
  'Start here',
  'Pumping',
  'Pump Two',
  'Spares',
  'Valves',
  'Main valve',
  'All screens',
];

const stored = (): string[] =>
  JSON.parse(globalThis.localStorage.getItem(collapsedStorageKey()) ?? '[]') as string[];

describe('ScreenTree navigation: what is open', () => {
  it('starts on the top entries and their direct children', () => {
    render(<ScreenTree screens={DEEP_SCREENS} navigation={DEEP} onOpen={() => {}} />);
    expect(labels()).toEqual(TWO_LEVELS);
    expect(item('Pumping').getAttribute('aria-expanded')).toBe('true');
    expect(item('Spares').getAttribute('aria-expanded')).toBe('false');
    expect(stored()).toEqual([]);
  });

  it('remembers what was opened and collapsed across a remount', () => {
    const first = render(<ScreenTree screens={DEEP_SCREENS} navigation={DEEP} onOpen={() => {}} />);
    fireEvent.click(chevron('Spares'));
    fireEvent.click(screen.getByText('Valves'));
    const after = [
      'Screens',
      'Start here',
      'Pumping',
      'Pump Two',
      'Spares',
      'First pump',
      'Cold store',
      'Valves',
      'All screens',
    ];
    expect(labels()).toEqual(after);
    first.unmount();
    render(<ScreenTree screens={DEEP_SCREENS} navigation={DEEP} onOpen={() => {}} />);
    expect(labels()).toEqual(after);
    // Collapsing the deep group again leaves no entry for it.
    fireEvent.click(chevron('Spares'));
    expect(stored().some((id) => id.endsWith(':expanded'))).toBe(false);
  });

  it('opens the path to the open screen and marks it; the path can be collapsed again', () => {
    const view = render(
      <ScreenTree
        screens={DEEP_SCREENS}
        navigation={DEEP}
        activeKey="plant/pumps/p1"
        onOpen={() => {}}
      />
    );
    expect(item('Spares').getAttribute('aria-expanded')).toBe('true');
    expect(item('First pump').getAttribute('aria-selected')).toBe('true');
    expect(item('Cold store').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chevron('Spares'));
    // A new manifest of the same screens does not open it again.
    view.rerender(
      <ScreenTree
        screens={[...DEEP_SCREENS]}
        navigation={DEEP}
        activeKey="plant/pumps/p1"
        onOpen={() => {}}
      />
    );
    expect(item('Spares').getAttribute('aria-expanded')).toBe('false');
    // Another screen becomes the open one: its path opens, through a collapsed top group too.
    fireEvent.click(chevron('Pumping'));
    view.rerender(
      <ScreenTree
        screens={DEEP_SCREENS}
        navigation={DEEP}
        activeKey="plant/pumps/p2"
        onOpen={() => {}}
      />
    );
    expect(item('Pump Two').getAttribute('aria-selected')).toBe('true');
  });

  it('leaves the tree alone when the open screen already shows somewhere', () => {
    // Valve One shows under Valves; its deeper entry under Cold store stays closed.
    render(
      <ScreenTree
        screens={DEEP_SCREENS}
        navigation={DEEP}
        activeKey="plant/valves/v1"
        onOpen={() => {}}
      />
    );
    expect(labels()).toEqual(TWO_LEVELS);
    expect(item('Main valve').getAttribute('aria-selected')).toBe('true');
  });

  it('a group that names a screen opens it and itself from its name; its arrow only toggles', () => {
    const onOpen = vi.fn();
    render(<ScreenTree screens={DEEP_SCREENS} navigation={DEEP} onOpen={onOpen} />);
    fireEvent.click(chevron('Spares'));
    expect(item('Spares').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chevron('Spares'));
    expect(item('Spares').getAttribute('aria-expanded')).toBe('false');
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Spares'));
    expect(onOpen).toHaveBeenLastCalledWith('plant/tanks/t1', 'replace');
    expect(item('Spares').getAttribute('aria-expanded')).toBe('true');
    // The name opens, it never collapses.
    fireEvent.click(screen.getByText('Spares'));
    expect(item('Spares').getAttribute('aria-expanded')).toBe('true');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('ScreenTree filter: separators', () => {
  const found = (query: string): string[] => {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
    return labels().filter((label) => label === 'Unit 4-1' || label === 'Sensor Row');
  };

  it.each(['unit-4-1', 'UNIT_4_1', 'Unit.4.1', 'unit 4 1', 'unit/4:1', 'Unit_4'])(
    'finds a screen by its id typed as %s, without a navigation',
    (query) => {
      render(<ScreenTree screens={DEEP_SCREENS} onOpen={() => {}} />);
      expect(found(query)).toEqual(['Unit 4-1']);
    }
  );

  it.each(['AB04C:XY1', 'ab04c_xy1', 'AB04C-XY1', 'zone/ab04c-xy1', 'XY1'])(
    'finds a screen by its id typed as %s',
    (query) => {
      render(<ScreenTree screens={DEEP_SCREENS} onOpen={() => {}} />);
      expect(found(query)).toEqual(['Sensor Row']);
    }
  );

  it('folds the title and a navigation label the same way', () => {
    const navigation = [
      { screen: 'plant/zone/ab04c-xy1', label: 'Row_7:North' },
      { label: 'Units', children: [{ screen: 'plant/unit-4-1' }] },
    ];
    render(<ScreenTree screens={DEEP_SCREENS} navigation={navigation} onOpen={() => {}} />);
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'row-7 north' } });
    expect(labels()).toEqual(['Screens', 'Row_7:North']);
    fireEvent.change(box, { target: { value: 'UNIT_4_1' } });
    expect(labels()).toEqual(['Screens', 'Units', 'Unit 4-1', 'All screens', 'plant', 'Unit 4-1']);
  });

  it('still matches from the start of a part only, and nothing on separators alone', () => {
    render(<ScreenTree screens={DEEP_SCREENS} onOpen={() => {}} />);
    expect(found('nit_4_1')).toEqual([]);
    expect(found('4c_xy1')).toEqual([]);
    expect(found('_:_')).toEqual([]);
  });
});

describe('ScreenTree without a usable navigation', () => {
  const plain = () => {
    const { unmount } = render(<ScreenTree screens={SCREENS} onOpen={() => {}} />);
    const out = labels();
    unmount();
    return out;
  };

  it('an invalid navigation leaves the folder tree and warns once', () => {
    const expected = plain();
    expect(expected[0]).toBe('All screens');
    const invalid = [{ label: 'No children, no screen' }];
    const { rerender } = render(
      <ScreenTree screens={SCREENS} navigation={invalid} onOpen={() => {}} />
    );
    expect(labels()).toEqual(expected);
    rerender(<ScreenTree screens={[...SCREENS]} navigation={invalid} onOpen={() => {}} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('navigation[0]: neither a screen nor a group');
  });

  it.each([
    ['an empty navigation', []],
    ['a navigation naming no listed screen', [{ screen: 'plant/gone' }]],
    ['no navigation', undefined],
    ['a null navigation', null],
  ])('%s leaves the folder tree', (_name, navigation) => {
    const expected = plain();
    render(<ScreenTree screens={SCREENS} navigation={navigation} onOpen={() => {}} />);
    expect(labels()).toEqual(expected);
  });
});

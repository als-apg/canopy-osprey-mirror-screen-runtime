// ScreenTree builds the All screens rows once per manifest, not once per
// render: the same node objects reach NavTree until what a row shows changes,
// while their handlers keep calling the latest render's callbacks.

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ManifestScreen } from '../api.js';
import type { NavNode, NavTreeProps } from './NavTree.js';
import { BRANCH_SCREENS, ScreenTree } from './ScreenTree.js';
import { tabKey } from './tabs.js';

const seen = vi.hoisted(() => {
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
  return { nodes: [] as (readonly unknown[])[] };
});

vi.mock('./NavTree.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./NavTree.js')>();
  return {
    ...actual,
    NavTree: (props: NavTreeProps) => {
      seen.nodes.push(props.nodes);
      return createElement(actual.NavTree, props);
    },
  };
});

function entry(id: string, title: string): ManifestScreen {
  return { id, kind: 'ir', title, category: 'lib', path: `screens/lib/${id}.screen.json` };
}

const SCREENS: ManifestScreen[] = [
  entry('ring/a', 'Alpha'),
  entry('ring/b', 'Beta'),
  entry('line/c', 'Gamma'),
];

/** The All screens branch's rows as NavTree last got them. */
function screenRows(): readonly NavNode[] {
  const nodes = seen.nodes.at(-1) as readonly NavNode[];
  const branch = nodes.find((node) => node.id === BRANCH_SCREENS);
  if (!branch?.children) throw new Error('no All screens branch');
  return branch.children;
}

beforeEach(() => {
  seen.nodes = [];
  globalThis.localStorage?.clear();
});

afterEach(() => {
  cleanup();
});

describe('ScreenTree row memo', () => {
  it('hands NavTree the same All screens rows on a render that changes none of them', () => {
    const view = render(<ScreenTree screens={SCREENS} onOpen={() => {}} activeKey={null} />);
    const first = screenRows();
    const renders = seen.nodes.length;

    view.rerender(
      <ScreenTree screens={SCREENS} onOpen={() => {}} activeKey={tabKey('lib', 'ring/a')} />
    );
    expect(seen.nodes.length).toBeGreaterThan(renders);
    expect(screenRows()).toBe(first);
    expect(screen.getByRole('treeitem', { name: 'Alpha' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('builds new rows for a new manifest', () => {
    const view = render(<ScreenTree screens={SCREENS} onOpen={() => {}} />);
    const first = screenRows();
    view.rerender(
      <ScreenTree screens={[...SCREENS, entry('line/d', 'Delta')]} onOpen={() => {}} />
    );
    expect(screenRows()).not.toBe(first);
    expect(screen.getByRole('treeitem', { name: 'Delta' })).toBeTruthy();
  });

  it('builds new rows when a folder is folded', () => {
    render(<ScreenTree screens={SCREENS} onOpen={() => {}} />);
    const first = screenRows();
    fireEvent.click(screen.getByText('ring'));
    expect(screenRows()).not.toBe(first);
    expect(screen.queryByRole('treeitem', { name: 'Alpha' })).toBeNull();
  });

  it("calls the latest render's callbacks from rows it did not rebuild", () => {
    const before = vi.fn();
    const after = vi.fn();
    const intent = vi.fn();
    const view = render(<ScreenTree screens={SCREENS} onOpen={before} onIntent={() => {}} />);
    const first = screenRows();
    view.rerender(<ScreenTree screens={SCREENS} onOpen={after} onIntent={intent} />);
    expect(screenRows()).toBe(first);

    const row = screen.getByText('Alpha').closest('.nav-tree__row') as HTMLElement;
    fireEvent.mouseDown(row, { button: 0 });
    fireEvent.click(row);
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(tabKey('lib', 'ring/a'), 'replace');
    expect(intent).toHaveBeenCalledWith(tabKey('lib', 'ring/a'));
  });

  it('reports the same rendered keys as before the memo: every openable row, once', () => {
    const onRenderedKeys = vi.fn();
    const view = render(
      <ScreenTree screens={SCREENS} onOpen={() => {}} onRenderedKeys={onRenderedKeys} />
    );
    expect([...onRenderedKeys.mock.calls.at(-1)![0]].sort()).toEqual([
      'screen:lib/line/c',
      'screen:lib/ring/a',
      'screen:lib/ring/b',
    ]);
    const calls = onRenderedKeys.mock.calls.length;
    // A new manifest with the same screens reports nothing new.
    view.rerender(
      <ScreenTree screens={[...SCREENS]} onOpen={() => {}} onRenderedKeys={onRenderedKeys} />
    );
    expect(onRenderedKeys).toHaveBeenCalledTimes(calls);
  });
});

describe("ScreenTree row memo with the library's navigation", () => {
  const NAVIGATION = [
    { screen: 'lib/line/c', label: 'Start here' },
    { label: 'Ring', screen: 'lib/ring/a', children: [{ screen: 'lib/ring/b' }] },
  ];
  const row = (label: string) => screen.getByText(label).closest('.nav-tree__row') as HTMLElement;

  it('hands NavTree the same navigation rows on a render that changes none of them', () => {
    const view = render(
      <ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={() => {}} activeKey={null} />
    );
    const first = screenRows();
    expect(first.map((node) => node.label)).toEqual(['Start here', 'Ring', 'All screens']);
    view.rerender(
      <ScreenTree
        screens={SCREENS}
        navigation={NAVIGATION}
        onOpen={() => {}}
        activeKey={tabKey('lib', 'ring/b')}
      />
    );
    const next = screenRows();
    expect(next.slice(0, 2)).toEqual(first.slice(0, 2));
    next.slice(0, 2).forEach((node, index) => expect(node).toBe(first[index]));
    // The open screen is marked on its navigation row.
    expect(screen.getByRole('treeitem', { name: 'Beta' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('reports the press of a navigation leaf, and of a group that names a screen', () => {
    const intent = vi.fn();
    const stale = vi.fn();
    const view = render(
      <ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={() => {}} onIntent={stale} />
    );
    view.rerender(
      <ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={() => {}} onIntent={intent} />
    );
    fireEvent.mouseDown(row('Start here'), { button: 0 });
    fireEvent.mouseDown(row('Ring'), { button: 0 });
    fireEvent.mouseDown(row('Beta'), { button: 0 });
    expect(intent.mock.calls).toEqual([
      [tabKey('lib', 'line/c')],
      [tabKey('lib', 'ring/a')],
      [tabKey('lib', 'ring/b')],
    ]);
    expect(stale).not.toHaveBeenCalled();
  });

  it("opens through the latest render's callback, and a group row still expands itself", () => {
    const before = vi.fn();
    const after = vi.fn();
    const view = render(<ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={before} />);
    fireEvent.click(
      screen
        .getByRole('treeitem', { name: 'Ring' })
        .querySelector('[data-testid="nav-tree-chevron"]')!
    );
    expect(screen.queryByText('Beta')).toBeNull();
    view.rerender(<ScreenTree screens={SCREENS} navigation={NAVIGATION} onOpen={after} />);
    fireEvent.click(row('Ring'));
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(tabKey('lib', 'ring/a'), 'replace');
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('reports each screen once in the rendered keys although it has two rows', () => {
    const onRenderedKeys = vi.fn();
    render(
      <ScreenTree
        screens={SCREENS}
        navigation={NAVIGATION}
        onOpen={() => {}}
        onRenderedKeys={onRenderedKeys}
      />
    );
    expect([...onRenderedKeys.mock.calls.at(-1)![0]].sort()).toEqual([
      'screen:lib/line/c',
      'screen:lib/ring/a',
      'screen:lib/ring/b',
    ]);
  });
});

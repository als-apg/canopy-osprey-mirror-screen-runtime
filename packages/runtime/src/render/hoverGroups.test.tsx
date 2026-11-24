// Hover groups: nodes that share a name in `props.hoverGroups` hover as one,
// `props.hoverDimGroup` lets the rest of a drawing step back, and
// `props.hoverLabelLines` puts live channel values into the one hover label.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PVData, PVListener, PVService } from '@slaclab/canopy-client';
import { DISCONNECTED_PV } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { PropertyValue, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import { ActionHostContext } from '../actions/ActionHostContext.js';
import type { ActionHost } from '../actions/ActionHostContext.js';
import { nodeChannels } from './collectPVs.js';
import { hoverLabelLines } from './hover.js';
import { HoverGroupStore, hoverDimGroupOf, hoverGroupsOf } from './hoverGroups.js';
import { ScreenRenderer } from './ScreenRenderer.js';

/** A PVService whose values the test sets; it records who is subscribed. */
class StubService implements PVService {
  readonly isConnected = true;
  private readonly values = new Map<string, PVData>();
  private readonly listeners = new Map<string, Set<PVListener>>();

  /** The channels subscribed now. */
  subscribed(): string[] {
    return [...this.listeners].filter(([, set]) => set.size > 0).map(([name]) => name);
  }

  set(name: string, data: Partial<PVData>): void {
    const next = { ...DISCONNECTED_PV, connected: true, ...data };
    this.values.set(name, next);
    act(() => {
      for (const listener of this.listeners.get(name) ?? []) listener(next);
    });
  }

  subscribe(name: string, listener: PVListener): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener);
    const held = this.values.get(name);
    if (held) listener(held);
    return () => set.delete(listener);
  }
  put(): void {}
  getSnapshot(name: string): PVData | undefined {
    return this.values.get(name);
  }
  connect(): void {}
  disconnect(): void {}
}

let service: StubService;

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  service = new StubService();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeHost() {
  return {
    resolveManifest: vi.fn<ActionHost['resolveManifest']>(() => '/view/detail'),
    navigate: vi.fn<ActionHost['navigate']>(),
    openWindow: vi.fn<ActionHost['openWindow']>(),
    close: vi.fn<ActionHost['close']>(),
    showError: vi.fn<ActionHost['showError']>(),
  } satisfies ActionHost;
}

const OPEN_DETAIL = [{ type: 'open_display', file: 'detail.screen.json', target: 'replace' }];

const TRIANGLE = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 0, y: 40 },
];

let nextY = 0;
function node(id: string, type: string, props: Record<string, unknown>): WidgetNode {
  nextY += 50;
  return {
    id,
    type,
    props: props as Record<string, PropertyValue>,
    geometry: { x: 10, y: nextY, width: 60, height: 40 },
  };
}

function doc(children: WidgetNode[], embedded = false): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: embedded ? 'part' : 'groups',
    metadata: {
      title: 'groups',
      source: { type: 'hand-authored' },
      size: { width: 400, height: 600 },
    },
    macros: [{ name: 'DEV', default: 'DEV:1' }],
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 600 },
      children,
    },
  };
}

function renderDoc(children: WidgetNode[], host: ActionHost = makeHost()) {
  nextY = 0;
  const result = render(
    <PVServiceProvider service={service}>
      <ActionHostContext.Provider value={host}>
        <ScreenRenderer
          screen={doc(children)}
          resolveScreen={() =>
            Promise.resolve(
              doc([node('inner', 'rectangle', { hoverGroups: ['coil-1', 'circuit'] })], true)
            )
          }
        />
      </ActionHostContext.Provider>
    </PVServiceProvider>
  );
  const wrapper = (id: string) =>
    result.container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
  const layer = (id: string) => wrapper(id).querySelector<HTMLElement>('[data-canopy-hover]');
  const level = (id: string) => layer(id)?.dataset.canopyHoverLevel ?? null;
  return { ...result, wrapper, layer, level };
}

/** A coil drawn as a shape, an ellipse, a box, a line and a list row; a second coil of the circuit. */
function coilScreen(extra: Record<string, unknown> = {}): WidgetNode[] {
  return [
    node('shape', 'polygon', {
      points: TRIANGLE,
      hitArea: 'shape',
      hoverGroups: ['coil-1', 'circuit'],
      hoverLabel: 'Coil 1',
      ...extra,
    }),
    node('round', 'ellipse', { hoverGroups: ['coil-1', 'circuit'], ...extra }),
    node('box', 'rectangle', { hoverGroups: ['coil-1', 'circuit'], ...extra }),
    node('stroke', 'line', { hoverGroups: ['coil-1'], ...extra }),
    node('row', 'text-label', {
      text: 'Coil 1',
      hoverGroups: ['coil-1', 'circuit'],
      hoverLabel: 'Row of coil 1',
      ...extra,
    }),
    node('other-coil', 'polygon', {
      points: TRIANGLE,
      hitArea: 'shape',
      hoverGroups: ['coil-2', 'circuit'],
      hoverLabel: 'Coil 2',
      ...extra,
    }),
    node('elsewhere', 'rectangle', { hoverGroups: ['coil-9'], ...extra }),
    node('plain', 'rectangle', extra),
  ];
}

describe('hover group props', () => {
  it('reads hoverGroups as its non-blank strings, in order', () => {
    expect(hoverGroupsOf({ hoverGroups: ['coil-4', ' circuit-main ', '', 7, null] })).toEqual([
      'coil-4',
      'circuit-main',
    ]);
    expect(hoverGroupsOf({ hoverGroups: 'coil-4' })).toEqual([]);
    expect(hoverGroupsOf({})).toEqual([]);
  });

  it('reads hoverDimGroup as a non-blank string', () => {
    expect(hoverDimGroupOf({ hoverDimGroup: ' magnet ' })).toBe('magnet');
    expect(hoverDimGroupOf({ hoverDimGroup: '' })).toBeNull();
    expect(hoverDimGroupOf({ hoverDimGroup: 3 })).toBeNull();
  });
});

describe('the hover group store', () => {
  it('gives every node its role in the hover of one', () => {
    const store = new HoverGroupStore();
    const hovered = {};
    const other = {};
    expect(store.roleOf(other, ['coil-1'], null)).toBeNull();
    store.enter(hovered, ['coil-1', 'circuit', 'magnet'], 'drawing');
    expect(store.roleOf(hovered, ['coil-1', 'circuit', 'magnet'], 'drawing')).toBe('hovered');
    expect(store.roleOf(other, ['coil-1'], 'drawing')).toBe('member');
    // The narrowest group of the hovered node decides, wherever the other lists it.
    expect(store.roleOf(other, ['pair', 'coil-1'], null)).toBe('member');
    expect(store.roleOf(other, ['coil-2', 'circuit'], 'drawing')).toBe('related');
    expect(store.roleOf(other, ['magnet'], null)).toBe('related');
    expect(store.roleOf(other, ['coil-9'], 'drawing')).toBe('dimmed');
    expect(store.roleOf(other, [], 'drawing')).toBe('dimmed');
    expect(store.roleOf(other, ['coil-9'], 'another')).toBeNull();
    expect(store.roleOf(other, ['coil-9'], null)).toBeNull();
    store.leave(hovered);
    expect(store.roleOf(other, ['coil-1'], 'drawing')).toBeNull();
  });

  it('does not dim for a hovered node that names no drawing', () => {
    const store = new HoverGroupStore();
    store.enter({}, ['coil-1'], null);
    expect(store.roleOf({}, ['coil-9'], 'drawing')).toBeNull();
  });

  it('hovers the node entered last, and falls back to the one around it', () => {
    const store = new HoverGroupStore();
    const outer = {};
    const inner = {};
    const notified = vi.fn();
    store.subscribe(notified);
    store.enter(outer, ['frame'], null);
    store.enter(inner, ['coil-1'], null);
    expect(store.roleOf(inner, ['coil-1'], null)).toBe('hovered');
    expect(store.roleOf(outer, ['frame'], null)).toBeNull();
    store.leave(inner);
    expect(store.roleOf(outer, ['frame'], null)).toBe('hovered');
    store.leave(outer);
    expect(notified).toHaveBeenCalledTimes(4);
    // Leaving a node that is not entered tells nobody.
    store.leave(outer);
    expect(notified).toHaveBeenCalledTimes(4);
  });
});

describe('hover groups', () => {
  it('highlight every member of the narrowest group, of whatever type', () => {
    const { wrapper, level, container } = renderDoc(coilScreen());
    expect(container.querySelector('[data-canopy-hover]')).toBeNull();

    fireEvent.mouseEnter(wrapper('box'));
    for (const id of ['shape', 'round', 'box', 'stroke', 'row']) {
      expect(level(id), id).toBe('strong');
    }
    expect(level('elsewhere')).toBeNull();
    expect(level('plain')).toBeNull();

    fireEvent.mouseLeave(wrapper('box'));
    expect(container.querySelector('[data-canopy-hover]')).toBeNull();
  });

  it('give the nodes of a wider group the lighter highlight', () => {
    const { wrapper, layer, level } = renderDoc(coilScreen());
    fireEvent.mouseEnter(wrapper('row'));
    expect(level('other-coil')).toBe('related');
    const related = layer('other-coil')!.querySelector<SVGElement>('svg')!;
    expect(Number(related.style.opacity)).toBeLessThan(1);
    const strong = layer('shape')!.querySelector<SVGElement>('svg')!;
    expect(strong.style.opacity).toBe('');
    // The other way round, coil 1 is the related one.
    fireEvent.mouseLeave(wrapper('row'));
    fireEvent.mouseEnter(wrapper('other-coil'));
    expect(level('other-coil')).toBe('strong');
    expect(level('box')).toBe('related');
    expect(Number(layer('box')!.style.opacity)).toBeLessThan(1);
    // A member of the narrow group only is no part of the wide one.
    expect(level('stroke')).toBeNull();
  });

  it('draw each member in its own form: shape, ellipse, box', () => {
    const { wrapper, layer } = renderDoc(coilScreen());
    fireEvent.mouseEnter(wrapper('row'));
    expect(layer('shape')!.dataset.canopyHover).toBe('shape');
    expect(layer('shape')!.querySelector('[data-canopy-hover-fill]')!.getAttribute('points')).toBe(
      '0,0 60,0 0,40'
    );
    expect(layer('round')!.style.borderRadius).toBe('50%');
    expect(layer('box')!.style.borderRadius).toBe('');
    // A highlighted text row is tinted over its whole box.
    const tint = layer('row')!.querySelector<HTMLElement>('[data-canopy-hover-fill]')!;
    expect(tint.style.background).toContain('var(--cr-7, #0f62fe)');
    expect(Number(tint.style.opacity)).toBeGreaterThan(0);
  });

  it('show one label: that of the node the pointer is on', () => {
    const { wrapper, container } = renderDoc(coilScreen());
    fireEvent.mouseEnter(wrapper('row'));
    expect(container.querySelectorAll('[data-canopy-hover-label]')).toHaveLength(1);
    expect(screen.getByText('Row of coil 1')).not.toBeNull();
    // 'Coil 1' is the row's own text; the shape's label of that name is not shown.
    expect(screen.getAllByText('Coil 1')).toHaveLength(1);
    expect(screen.queryByText('Coil 2')).toBeNull();

    fireEvent.mouseLeave(wrapper('row'));
    fireEvent.mouseEnter(wrapper('box'));
    // The hovered node has no label: none is shown.
    expect(container.querySelectorAll('[data-canopy-hover-label]')).toHaveLength(0);
  });

  it('take the pointer without actions, with no pointer cursor', () => {
    const { wrapper } = renderDoc(coilScreen());
    expect(wrapper('box').style.pointerEvents).toBe('auto');
    expect(wrapper('row').style.pointerEvents).toBe('auto');
    expect(wrapper('box').style.cursor).toBe('');
    // A polygon met on its shape leaves its box alone and draws its target.
    expect(wrapper('shape').style.pointerEvents).toBe('none');
    expect(wrapper('shape').querySelector('[data-canopy-hit]')).not.toBeNull();
    // A node without groups is as before.
    expect(wrapper('plain').style.pointerEvents).toBe('none');
  });

  it('keep the click of each member', async () => {
    const host = makeHost();
    const { wrapper, level } = renderDoc(
      [
        node('box', 'rectangle', { hoverGroups: ['coil-1'], actions: OPEN_DETAIL }),
        node('row', 'text-label', { text: 'Coil 1', hoverGroups: ['coil-1'] }),
      ],
      host
    );
    expect(wrapper('box').style.cursor).toBe('pointer');
    fireEvent.mouseEnter(wrapper('row'));
    expect(level('box')).toBe('strong');
    fireEvent.click(wrapper('row'));
    expect(host.navigate).not.toHaveBeenCalled();
    fireEvent.click(wrapper('box'));
    await vi.waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(1));
  });

  it('reach into an embedded screen, and out of it', async () => {
    const { wrapper, level, container } = renderDoc([
      node('box', 'rectangle', { hoverGroups: ['coil-1'] }),
      node('tile', 'embedded-display', { file: 'part.screen.json' }),
    ]);
    await vi.waitFor(() =>
      expect(container.querySelector('[data-node-id="inner"]')).not.toBeNull()
    );
    fireEvent.mouseEnter(wrapper('box'));
    expect(level('inner')).toBe('strong');
    fireEvent.mouseLeave(wrapper('box'));
    fireEvent.mouseEnter(wrapper('inner'));
    expect(level('box')).toBe('strong');
  });

  it('substitute macros in group names', () => {
    const { wrapper, level } = renderDoc([
      node('a', 'rectangle', { hoverGroups: ['${DEV}:coil'] }),
      node('b', 'rectangle', { hoverGroups: ['DEV:1:coil'] }),
    ]);
    fireEvent.mouseEnter(wrapper('a'));
    expect(level('b')).toBe('strong');
  });

  it('let go of a hovered node that hides', () => {
    const { wrapper, level, rerender } = renderDoc(coilScreen());
    fireEvent.mouseEnter(wrapper('box'));
    expect(level('row')).toBe('strong');
    const children = coilScreen().filter((child) => child.id !== 'box');
    rerender(
      <PVServiceProvider service={service}>
        <ActionHostContext.Provider value={makeHost()}>
          <ScreenRenderer screen={doc(children)} />
        </ActionHostContext.Provider>
      </PVServiceProvider>
    );
    expect(level('row')).toBeNull();
  });

  it('leave a node without hoverGroups as it was', () => {
    const { wrapper, layer, container } = renderDoc([
      node('area', 'rectangle', { actions: OPEN_DETAIL, hoverLabel: 'Open' }),
      node('member', 'rectangle', { hoverGroups: ['coil-1'] }),
    ]);
    fireEvent.mouseEnter(wrapper('area'));
    expect(container.querySelectorAll('[data-canopy-hover]')).toHaveLength(1);
    expect(layer('area')!.dataset.canopyHoverLevel).toBe('strong');
    expect(layer('area')!.style.opacity).toBe('');
    expect(screen.getByText('Open').style.zIndex).toBe('');
    fireEvent.mouseLeave(wrapper('area'));
    expect(layer('area')).toBeNull();
  });
});

describe('hoverDimGroup', () => {
  const dimmed = (el: HTMLElement) => el.hasAttribute('data-canopy-hover-dimmed');

  it('dims the parts of the hovered drawing that are not highlighted', () => {
    const { wrapper } = renderDoc([
      ...coilScreen({ hoverDimGroup: 'magnet' }),
      node('other-drawing', 'rectangle', { hoverGroups: ['coil-9'], hoverDimGroup: 'pump' }),
    ]);
    expect(wrapper('elsewhere').style.opacity).toBe('1');

    fireEvent.mouseEnter(wrapper('box'));
    // No highlight: dimmed, with or without groups of its own.
    for (const id of ['elsewhere', 'plain']) {
      expect(dimmed(wrapper(id)), id).toBe(true);
      expect(Number(wrapper(id).style.opacity)).toBeLessThan(1);
    }
    // Highlighted, strongly or lightly: not dimmed.
    for (const id of ['box', 'row', 'shape', 'other-coil']) {
      expect(dimmed(wrapper(id)), id).toBe(false);
      expect(wrapper(id).style.opacity).toBe('1');
    }
    // Another drawing stays as it is.
    expect(dimmed(wrapper('other-drawing'))).toBe(false);

    fireEvent.mouseLeave(wrapper('box'));
    expect(dimmed(wrapper('elsewhere'))).toBe(false);
    expect(wrapper('elsewhere').style.opacity).toBe('1');
  });

  it('is off without the prop', () => {
    const { wrapper } = renderDoc(coilScreen());
    fireEvent.mouseEnter(wrapper('box'));
    expect(dimmed(wrapper('elsewhere'))).toBe(false);
    expect(dimmed(wrapper('plain'))).toBe(false);
  });

  it('multiplies an authored transparency', () => {
    const { wrapper } = renderDoc([
      node('box', 'rectangle', { hoverGroups: ['coil-1'], hoverDimGroup: 'magnet' }),
      node('faint', 'rectangle', { opacity: 50, hoverDimGroup: 'magnet' }),
    ]);
    expect(wrapper('faint').style.opacity).toBe('0.5');
    fireEvent.mouseEnter(wrapper('box'));
    const opacity = Number(wrapper('faint').style.opacity);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(0.5);
  });

  it('does not dim for a hover on a node without hoverGroups', () => {
    const { wrapper } = renderDoc([
      node('area', 'rectangle', { actions: OPEN_DETAIL, hoverDimGroup: 'magnet' }),
      node('part', 'rectangle', { hoverDimGroup: 'magnet' }),
    ]);
    fireEvent.mouseEnter(wrapper('area'));
    expect(dimmed(wrapper('part'))).toBe(false);
  });
});

describe('hoverLabelLines', () => {
  const LINES = [
    { text: 'Main circuit' },
    { label: 'Current', pv: '${DEV}:Current', precision: 1 },
    { label: 'State', pv: 'DEV:1:State' },
    { pv: 'DEV:1:Temperature', precision: 2, showUnits: false },
  ];

  const lines = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-canopy-hover-line]')].map((el) => el.textContent);

  it('reads text lines and channel lines, and leaves out anything else', () => {
    expect(
      hoverLabelLines({
        hoverLabelLines: [
          { text: 'Main circuit' },
          { label: 'Current', pv: ' DEV:1:Current ', precision: 1 },
          { pv: 'DEV:1:State', showUnits: false },
          { label: 'no channel' },
          { text: '' },
          'text',
          null,
        ],
      })
    ).toEqual([
      { text: 'Main circuit' },
      { label: 'Current', pv: 'DEV:1:Current', precision: 1 },
      { pv: 'DEV:1:State', showUnits: false },
    ]);
    expect(hoverLabelLines({ hoverLabelLines: 'Main circuit' })).toEqual([]);
    expect(hoverLabelLines({})).toEqual([]);
  });

  it('shows the lines under the hoverLabel, values as a text readout formats them', () => {
    service.set('DEV:1:Current', { value: 12.3456, displayValue: '12.346 A', units: 'A' });
    service.set('DEV:1:State', { value: 1, displayValue: 'On', enumChoices: ['Off', 'On'] });
    service.set('DEV:1:Temperature', { value: 31.257, displayValue: '31.3 degC', units: 'degC' });
    const { wrapper, container } = renderDoc([
      node('box', 'rectangle', {
        hoverGroups: ['coil-1'],
        hoverLabel: 'Coil 1',
        hoverLabelLines: LINES,
      }),
    ]);
    expect(lines(container)).toEqual([]);
    fireEvent.mouseEnter(wrapper('box'));
    expect(container.querySelectorAll('[data-canopy-hover-label]')).toHaveLength(1);
    expect(screen.getByText('Coil 1')).not.toBeNull();
    expect(lines(container)).toEqual([
      'Main circuit',
      // The authored precision, and the channel's unit.
      'Current: 12.3 A',
      // No precision: the channel's own text.
      'State: On',
      // No label: the value alone; showUnits false leaves the unit out.
      '31.26',
    ]);
  });

  it('follows the channel while the label shows', () => {
    service.set('DEV:1:Current', { value: 1, displayValue: '1 A', units: 'A' });
    const { wrapper, container } = renderDoc([
      node('box', 'rectangle', {
        hoverGroups: ['coil-1'],
        hoverLabelLines: [{ label: 'Current', pv: 'DEV:1:Current', precision: 2 }],
      }),
    ]);
    fireEvent.mouseEnter(wrapper('box'));
    expect(lines(container)).toEqual(['Current: 1.00 A']);
    service.set('DEV:1:Current', { value: 2.5, displayValue: '2.5 A', units: 'A' });
    expect(lines(container)).toEqual(['Current: 2.50 A']);
  });

  it('shows a channel that is down as a text readout does', () => {
    service.set('DEV:1:Current', { connected: false });
    const { wrapper, container } = renderDoc([
      node('box', 'rectangle', {
        hoverGroups: ['coil-1'],
        hoverLabelLines: [
          { label: 'Current', pv: 'DEV:1:Current', precision: 2 },
          { label: 'Never seen', pv: 'DEV:1:Missing' },
        ],
      }),
    ]);
    fireEvent.mouseEnter(wrapper('box'));
    expect(lines(container)).toEqual(['Current: ---', 'Never seen: ---']);
    const value = container.querySelector<HTMLElement>('[data-pv="DEV:1:Current"]')!;
    expect(value.dataset.pvNostate).toBe('true');
    // Its return shows the value, with no mark left.
    service.set('DEV:1:Current', { value: 3, displayValue: '3 A', units: 'A' });
    expect(lines(container)[0]).toBe('Current: 3.00 A');
    expect(
      container.querySelector<HTMLElement>('[data-pv="DEV:1:Current"]')!.dataset.pvNostate
    ).toBeUndefined();
  });

  it('subscribes a label channel only while the label shows', () => {
    const { wrapper } = renderDoc([
      node('box', 'rectangle', { hoverGroups: ['coil-1'], hoverLabelLines: LINES }),
      node('row', 'text-label', { text: 'Coil 1', hoverGroups: ['coil-1'] }),
    ]);
    expect(service.subscribed()).toEqual([]);
    // The channels are no part of the node's own: no cue, no data-pv.
    expect(wrapper('box').hasAttribute('data-pv')).toBe(false);
    expect(wrapper('box').hasAttribute('data-pv-state')).toBe(false);

    // A member is highlighted without the label: still nothing.
    fireEvent.mouseEnter(wrapper('row'));
    expect(service.subscribed()).toEqual([]);
    fireEvent.mouseLeave(wrapper('row'));

    fireEvent.mouseEnter(wrapper('box'));
    expect(service.subscribed().sort()).toEqual([
      'DEV:1:Current',
      'DEV:1:State',
      'DEV:1:Temperature',
    ]);
    fireEvent.mouseLeave(wrapper('box'));
    expect(service.subscribed()).toEqual([]);
  });

  it('is not read for the channels a node shows', () => {
    expect(nodeChannels('rectangle', { hoverLabelLines: LINES, pvName: 'DEV:1:Shown' })).toEqual([
      'DEV:1:Shown',
    ]);
  });

  it('works on a clickable node without groups, and lifts the label over later nodes', () => {
    service.set('DEV:1:Current', { value: 4, displayValue: '4 A', units: 'A' });
    const { wrapper, container } = renderDoc([
      node('area', 'rectangle', {
        actions: OPEN_DETAIL,
        hoverLabelLines: [{ label: 'Current', pv: 'DEV:1:Current' }],
      }),
    ]);
    fireEvent.mouseEnter(wrapper('area'));
    expect(lines(container)).toEqual(['Current: 4 A']);
    expect(container.querySelector<HTMLElement>('[data-canopy-hover-label]')!.style.zIndex).toBe(
      '1'
    );
  });

  it('shows on a shape, at the point the shape gives the label', () => {
    service.set('DEV:1:Current', { value: 4, displayValue: '4 A', units: 'A' });
    const { wrapper, container } = renderDoc([
      node('shape', 'polygon', {
        points: TRIANGLE,
        hitArea: 'shape',
        hoverGroups: ['coil-1'],
        hoverLabelAt: [20, 10],
        hoverLabelLines: [{ label: 'Current', pv: 'DEV:1:Current' }],
      }),
    ]);
    fireEvent.mouseOver(wrapper('shape').querySelector('[data-canopy-hit]')!);
    expect(lines(container)).toEqual(['Current: 4 A']);
    const label = container.querySelector<HTMLElement>('[data-canopy-hover-label]')!;
    expect(label.style.left).toBe('20px');
    expect(label.style.top).toBe('10px');
  });

  it('shows nothing on a node that is neither clickable nor in a group', () => {
    const { wrapper, container } = renderDoc([
      node('plain', 'rectangle', { hoverLabelLines: LINES }),
    ]);
    fireEvent.mouseEnter(wrapper('plain'));
    expect(lines(container)).toEqual([]);
    expect(service.subscribed()).toEqual([]);
  });
});

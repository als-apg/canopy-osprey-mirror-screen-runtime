// Clickable-area affordances: a node carrying `props.actions` shows a pointer
// cursor and, while hovered, a translucent accent fill, an accent outline and
// its optional `hoverLabel`; any node may draw a resting outline
// (`outlineColor` / `outlineWidth`), which a rule can bind to live data.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { PropertyValue, Rule, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import type { FormulaScalarValue, FormulaSpec, FormulaSubscribeOptions } from '../formula.js';
import { FormulaSubscriberContext } from '../formula.js';
import { ActionHostContext } from '../actions/ActionHostContext.js';
import type { ActionHost } from '../actions/ActionHostContext.js';
import { FormulaError } from '../formula.js';
import { ScreenRenderer } from './ScreenRenderer.js';

class StubSubscriber {
  readonly subscriptions: { spec: FormulaSpec; options: FormulaSubscribeOptions }[] = [];

  subscribe(spec: FormulaSpec, options: FormulaSubscribeOptions): () => void {
    this.subscriptions.push({ spec, options });
    return () => {};
  }

  push(value: FormulaScalarValue): void {
    act(() => {
      for (const s of this.subscriptions) s.options.onResult(value);
    });
  }

  fail(error: Error): void {
    act(() => {
      for (const s of this.subscriptions) s.options.onError?.(error);
    });
  }
}

let service: MockPVService;
let stub: StubSubscriber;

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  service = new MockPVService();
  service.connect();
  stub = new StubSubscriber();
});

afterEach(() => {
  cleanup();
  service.disconnect();
  vi.restoreAllMocks();
});

function makeHost() {
  return {
    resolveManifest: vi.fn<ActionHost['resolveManifest']>(() => '/view/booster'),
    navigate: vi.fn<ActionHost['navigate']>(),
    openWindow: vi.fn<ActionHost['openWindow']>(),
    close: vi.fn<ActionHost['close']>(),
    showError: vi.fn<ActionHost['showError']>(),
  } satisfies ActionHost;
}

function doc(children: WidgetNode[]): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 'hover',
    metadata: {
      title: 'hover',
      source: { type: 'hand-authored' },
      size: { width: 400, height: 300 },
    },
    macros: [{ name: 'SECTION', default: 'Booster' }],
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children,
    },
  };
}

const OPEN_BOOSTER = [{ type: 'open_display', file: 'booster.screen.json', target: 'replace' }];

function area(props: Record<string, unknown>, rules?: Rule[]): WidgetNode {
  return {
    id: 'area',
    type: 'rectangle',
    props: props as Record<string, PropertyValue>,
    geometry: { x: 20, y: 30, width: 200, height: 100 },
    ...(rules ? { rules } : {}),
  };
}

function renderDoc(children: WidgetNode[], host: ActionHost = makeHost()) {
  const result = render(
    <PVServiceProvider service={service}>
      <FormulaSubscriberContext.Provider value={stub}>
        <ActionHostContext.Provider value={host}>
          <ScreenRenderer screen={doc(children)} />
        </ActionHostContext.Provider>
      </FormulaSubscriberContext.Provider>
    </PVServiceProvider>
  );
  const wrapper = result.container.querySelector<HTMLElement>('[data-node-id="area"]')!;
  return { ...result, wrapper };
}

const hoverLayer = (wrapper: HTMLElement) =>
  wrapper.querySelector<HTMLElement>('[data-canopy-hover]');

describe('clickable areas', () => {
  it('give a node with actions a pointer cursor', () => {
    const { wrapper } = renderDoc([area({ actions: OPEN_BOOSTER })]);
    expect(wrapper.style.cursor).toBe('pointer');
    expect(wrapper.style.pointerEvents).toBe('auto');
  });

  it('highlight while hovered: accent fill and outline, inert to the pointer', () => {
    const { wrapper } = renderDoc([area({ actions: OPEN_BOOSTER })]);
    expect(hoverLayer(wrapper)).toBeNull();

    fireEvent.mouseEnter(wrapper);
    const layer = hoverLayer(wrapper)!;
    expect(layer).not.toBeNull();
    expect(layer.style.pointerEvents).toBe('none');
    // The default scheme's ActiveText role (index 7) is the accent.
    expect(layer.style.outline).toContain('var(--cr-7, #0f62fe)');
    const fill = layer.querySelector<HTMLElement>('[data-canopy-hover-fill]')!;
    expect(fill.style.background).toContain('var(--cr-7, #0f62fe)');
    expect(Number(fill.style.opacity)).toBeGreaterThan(0);
    expect(Number(fill.style.opacity)).toBeLessThan(0.5);

    fireEvent.mouseLeave(wrapper);
    expect(hoverLayer(wrapper)).toBeNull();
  });

  it('show the hoverLabel only while hovered, macros substituted', () => {
    const { wrapper } = renderDoc([
      area({ actions: OPEN_BOOSTER, hoverLabel: 'Open ${SECTION} →' }),
    ]);
    expect(screen.queryByText('Open Booster →')).toBeNull();
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText('Open Booster →')).not.toBeNull();
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText('Open Booster →')).toBeNull();
  });

  it('anchor the label bottom-left inside the node by default, inert to the pointer', () => {
    const { wrapper } = renderDoc([area({ actions: OPEN_BOOSTER, hoverLabel: 'Open' })]);
    fireEvent.mouseEnter(wrapper);
    const layer = hoverLayer(wrapper)!;
    expect(layer.dataset.placement).toBe('bottom-left');
    expect(layer.style.alignItems).toBe('flex-end');
    expect(layer.style.justifyContent).toBe('flex-start');
    expect(screen.getByText('Open').style.pointerEvents).toBe('none');
  });

  it('place the label where hoverLabelPlacement says; an unknown value falls back', () => {
    const { wrapper } = renderDoc([
      area({ actions: OPEN_BOOSTER, hoverLabel: 'Open', hoverLabelPlacement: 'center' }),
    ]);
    fireEvent.mouseEnter(wrapper);
    expect(hoverLayer(wrapper)!.style.alignItems).toBe('center');
    expect(hoverLayer(wrapper)!.style.justifyContent).toBe('center');
    cleanup();
    const odd = renderDoc([
      area({ actions: OPEN_BOOSTER, hoverLabel: 'Open', hoverLabelPlacement: 'middle' }),
    ]).wrapper;
    fireEvent.mouseEnter(odd);
    expect(hoverLayer(odd)!.dataset.placement).toBe('bottom-left');
  });

  it('still open their target on click', async () => {
    const host = makeHost();
    const { wrapper } = renderDoc([area({ actions: OPEN_BOOSTER, hoverLabel: 'Open' })], host);
    fireEvent.mouseEnter(wrapper);
    fireEvent.click(wrapper);
    await vi.waitFor(() => expect(host.navigate).toHaveBeenCalled());
  });

  it('leave a node without actions alone: no cursor, no highlight, no label', () => {
    const { wrapper } = renderDoc([area({ hoverLabel: 'Open Booster →' })]);
    expect(wrapper.style.cursor).toBe('');
    fireEvent.mouseEnter(wrapper);
    expect(hoverLayer(wrapper)).toBeNull();
    expect(screen.queryByText('Open Booster →')).toBeNull();
  });
});

describe('a polygon met on its shape (hitArea: "shape")', () => {
  // A band bent round a corner: its box is 200 x 100, the band 30 wide.
  const BAND = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 170, y: 100 },
    { x: 170, y: 30 },
    { x: 0, y: 30 },
  ];

  function shapeArea(props: Record<string, unknown>): WidgetNode {
    return {
      id: 'area',
      type: 'polygon',
      props: { points: BAND, ...props } as Record<string, PropertyValue>,
      geometry: { x: 20, y: 30, width: 200, height: 100 },
    };
  }

  const target = (wrapper: HTMLElement) => wrapper.querySelector<SVGElement>('[data-canopy-hit]');

  it('without hitArea is met on its box, as before', () => {
    const { wrapper } = renderDoc([shapeArea({ actions: OPEN_BOOSTER, hoverLabel: 'Open' })]);
    expect(wrapper.style.pointerEvents).toBe('auto');
    expect(target(wrapper)).toBeNull();
    fireEvent.mouseEnter(wrapper);
    expect(hoverLayer(wrapper)!.dataset.canopyHover).toBe('');
    expect(hoverLayer(wrapper)!.style.outline).not.toBe('');
  });

  it('leaves its box to what lies under it; the shape takes the pointer', () => {
    const { wrapper } = renderDoc([shapeArea({ actions: OPEN_BOOSTER, hitArea: 'shape' })]);
    expect(wrapper.style.pointerEvents).toBe('none');
    expect(wrapper.style.cursor).toBe('pointer');
    expect(target(wrapper)!.style.pointerEvents).toBe('all');
  });

  it('highlights the shape itself while hovered, with one label', () => {
    const { wrapper } = renderDoc([
      shapeArea({ actions: OPEN_BOOSTER, hitArea: 'shape', hoverLabel: 'Open ${SECTION} →' }),
    ]);
    expect(hoverLayer(wrapper)).toBeNull();

    fireEvent.mouseOver(target(wrapper)!);
    expect(wrapper.querySelectorAll('[data-canopy-hover]')).toHaveLength(1);
    const layer = hoverLayer(wrapper)!;
    expect(layer.dataset.canopyHover).toBe('shape');
    expect(layer.style.pointerEvents).toBe('none');
    // No box: the layer draws the shape's own points, in the accent.
    expect(layer.style.outline).toBe('');
    const fill = layer.querySelector<SVGElement>('[data-canopy-hover-fill]')!;
    expect(fill.tagName).toBe('polygon');
    expect(fill.getAttribute('points')).toBe('0,0 200,0 200,100 170,100 170,30 0,30');
    expect(fill.getAttribute('fill')).toContain('var(--cr-7, #0f62fe)');
    expect(fill.getAttribute('stroke')).toContain('var(--cr-7, #0f62fe)');
    expect(Number(fill.getAttribute('fill-opacity'))).toBeLessThan(0.5);
    expect(screen.getAllByText('Open Booster →')).toHaveLength(1);
    expect(screen.getByText('Open Booster →').style.pointerEvents).toBe('none');

    fireEvent.mouseOut(target(wrapper)!);
    expect(hoverLayer(wrapper)).toBeNull();
    expect(screen.queryByText('Open Booster →')).toBeNull();
  });

  it('centres the label on a point inside the shape, not on the middle of its box', () => {
    const { wrapper } = renderDoc([
      shapeArea({ actions: OPEN_BOOSTER, hitArea: 'shape', hoverLabel: 'Open' }),
    ]);
    fireEvent.mouseEnter(wrapper);
    const label = screen.getByText('Open');
    const x = parseFloat(label.style.left);
    const y = parseFloat(label.style.top);
    // In the 30-wide band: the top run or the right-hand run.
    expect((y > 0 && y < 30 && x > 0 && x < 200) || (x > 170 && x < 200 && y < 100)).toBe(true);
    expect(label.style.transform).toContain('translate(-50%, -50%)');
  });

  it('centres the label on hoverLabelAt when it names a point', () => {
    const { wrapper } = renderDoc([
      shapeArea({
        actions: OPEN_BOOSTER,
        hitArea: 'shape',
        hoverLabel: 'Open',
        hoverLabelAt: [40, 15],
      }),
    ]);
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText('Open').style.left).toBe('40px');
    expect(screen.getByText('Open').style.top).toBe('15px');
  });

  it('keeps the label upright on a turned node', () => {
    const { wrapper } = renderDoc([
      shapeArea({ actions: OPEN_BOOSTER, hitArea: 'shape', hoverLabel: 'Open', rotation: 40 }),
    ]);
    expect(wrapper.style.transform).toBe('rotate(40deg)');
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText('Open').style.transform).toContain('rotate(-40deg)');
  });

  it('highlights an open line along its path, at its hit width', () => {
    const { wrapper } = renderDoc([
      shapeArea({
        actions: OPEN_BOOSTER,
        hitArea: 'shape',
        closed: false,
        hitWidth: 18,
        hoverLabel: 'Open',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      }),
    ]);
    expect(target(wrapper)!.style.pointerEvents).toBe('stroke');
    fireEvent.mouseEnter(wrapper);
    const fill = hoverLayer(wrapper)!.querySelector<SVGElement>('[data-canopy-hover-fill]')!;
    expect(fill.tagName).toBe('polyline');
    expect(fill.getAttribute('fill')).toBe('none');
    expect(fill.getAttribute('stroke-width')).toBe('18');
    // The label sits half way along the path.
    expect(screen.getByText('Open').style.left).toBe('100px');
    expect(screen.getByText('Open').style.top).toBe('0px');
  });

  it('runs the node actions on a click on the shape', async () => {
    const host = makeHost();
    const { wrapper } = renderDoc([shapeArea({ actions: OPEN_BOOSTER, hitArea: 'shape' })], host);
    fireEvent.click(target(wrapper)!);
    await vi.waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(1));
  });

  it('takes no pointer at all without actions', () => {
    const { wrapper } = renderDoc([shapeArea({ hitArea: 'shape', hoverLabel: 'Open' })]);
    expect(wrapper.style.pointerEvents).toBe('none');
    expect(target(wrapper)).toBeNull();
    fireEvent.mouseEnter(wrapper);
    expect(hoverLayer(wrapper)).toBeNull();
  });

  it('is met on its box when its points draw no shape', () => {
    const { wrapper } = renderDoc([
      shapeArea({ actions: OPEN_BOOSTER, hitArea: 'shape', points: BAND.slice(0, 2) }),
    ]);
    expect(wrapper.style.pointerEvents).toBe('auto');
    expect(target(wrapper)).toBeNull();
    fireEvent.mouseEnter(wrapper);
    expect(hoverLayer(wrapper)!.dataset.canopyHover).toBe('');
  });

  it('is a polygon prop: another node type keeps its box', () => {
    const { wrapper } = renderDoc([area({ actions: OPEN_BOOSTER, hitArea: 'shape' })]);
    expect(wrapper.style.pointerEvents).toBe('auto');
    fireEvent.mouseEnter(wrapper);
    expect(hoverLayer(wrapper)!.dataset.canopyHover).toBe('');
  });
});

describe('resting outline', () => {
  it('draws outlineColor inside the box at outlineWidth (default 2)', () => {
    const { wrapper } = renderDoc([area({ outlineColor: '#24a148' })]);
    expect(wrapper.style.outline).toBe('2px solid #24a148');
    expect(wrapper.style.outlineOffset).toBe('-2px');
    cleanup();
    const wide = renderDoc([area({ outlineColor: '#24a148', outlineWidth: 4 })]).wrapper;
    expect(wide.style.outline).toBe('4px solid #24a148');
    expect(wide.style.outlineOffset).toBe('-4px');
  });

  it('resolves a ColorRole outline against the theme', () => {
    const { wrapper } = renderDoc([
      area({ outlineColor: { $role: 'MINOR', fallback: '#f1c21b' } }),
    ]);
    expect(wrapper.style.outline).toContain('var(--cr-2, #f1c21b)');
  });

  it('draws nothing without outlineColor or with a non-positive width', () => {
    expect(renderDoc([area({ outlineWidth: 3 })]).wrapper.style.outline).toBe('');
    cleanup();
    expect(
      renderDoc([area({ outlineColor: '#24a148', outlineWidth: 0 })]).wrapper.style.outline
    ).toBe('');
  });

  it('follows a rule bound to live data (alarm tint)', () => {
    const rule: Rule = {
      id: 'tint',
      name: 'alarm tint',
      targetProperty: 'outlineColor',
      default: { $role: 'OK', fallback: '#24a148' },
      pvs: [{ name: 'SEC:SEVR', trigger: true }],
      conditions: [
        { expression: '{0} >= 2', value: { $role: 'MAJOR', fallback: '#da1e28' } },
        { expression: '{0} >= 1', value: { $role: 'MINOR', fallback: '#f1c21b' } },
      ],
    };
    const { wrapper } = renderDoc([
      area(
        { actions: OPEN_BOOSTER, outlineColor: { $role: 'DISCONNECTED', fallback: '#6f6f6f' } },
        [rule]
      ),
    ]);
    // The ladder delivers arm indexes: 0 = MAJOR, 1 = MINOR, -1 = default.
    stub.push(0);
    expect(wrapper.style.outline).toContain('var(--cr-3, #da1e28)');
    stub.push(1);
    expect(wrapper.style.outline).toContain('var(--cr-2, #f1c21b)');
    stub.push(-1);
    expect(wrapper.style.outline).toContain('var(--cr-1, #24a148)');
  });

  it('shows the base outline, never the default arm, while the rule input is disconnected', () => {
    const rule: Rule = {
      id: 'tint',
      name: 'alarm tint',
      targetProperty: 'outlineColor',
      default: { $role: 'OK', fallback: '#24a148' },
      pvs: [{ name: 'SEC:SEVR', trigger: true }],
      conditions: [{ expression: '{0} >= 2', value: { $role: 'MAJOR', fallback: '#da1e28' } }],
    };
    const neutral = { $role: 'DISCONNECTED', fallback: '#6f6f6f' };
    const { wrapper } = renderDoc([area({ outlineColor: neutral }, [rule])]);
    // No result yet (never connected): the base outline.
    expect(wrapper.style.outline).toContain('var(--cr-5, #6f6f6f)');
    stub.push(-1);
    expect(wrapper.style.outline).toContain('var(--cr-1, #24a148)');
    // A dropped input is a retryable error: the rule goes stale and its output
    // drops; the node then draws the no-data cue, which outranks any outline.
    stub.fail(new FormulaError('input_disconnected', 'input disconnected', true));
    expect(wrapper.style.outline).toMatch(/^1px dashed var\(--cr-\d+, #da1e28\)$/);
    expect(wrapper.style.outline).not.toContain('#24a148');
  });

  it('gives way to the hover outline while hovered', () => {
    const { wrapper } = renderDoc([area({ actions: OPEN_BOOSTER, outlineColor: '#24a148' })]);
    fireEvent.mouseEnter(wrapper);
    expect(wrapper.style.outline).toBe('');
    fireEvent.mouseLeave(wrapper);
    expect(wrapper.style.outline).toBe('2px solid #24a148');
  });
});

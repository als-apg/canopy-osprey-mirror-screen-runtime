// Per-widget-type render coverage: every IR type in the runtime map renders
// against MockPVService without crashing; unregistered/unknown types become
// labeled placeholders; a crashing component is contained to its own box.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { registerBuiltinWidgets, widgetRegistry } from '@slaclab/canopy-screen-widgets';
import type { PropertyValue, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import { ScreenRenderer } from './ScreenRenderer.js';

let service: MockPVService;

beforeAll(() => {
  registerBuiltinWidgets();
});

beforeEach(() => {
  service = new MockPVService();
  service.connect();
});

afterEach(() => {
  cleanup();
  service.disconnect();
});

function wrap(children: ReactNode) {
  return <PVServiceProvider service={service}>{children}</PVServiceProvider>;
}

function screenWith(node: Omit<WidgetNode, 'id' | 'geometry'>): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 'one-widget',
    metadata: { title: 't', source: { type: 'hand-authored' }, size: { width: 300, height: 100 } },
    macros: [],
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 300, height: 100 },
      children: [
        { id: 'w-x', geometry: { x: 10, y: 10, width: 120, height: 30 }, ...node } as WidgetNode,
      ],
    },
  };
}

// [IR type, props] — one per mapped-and-registered runtime widget type.
const RENDERABLE: [string, Record<string, PropertyValue>][] = [
  ['text-label', { text: 'hello' }],
  ['pv-label', { pv: 'DEV:RB', precision: 2 }],
  ['pv-text-input', { pv: 'DEV:SP' }],
  ['pv-button', { pv: 'DEV:CMD', label: 'Fire', pressValue: 1 }],
  ['regular-button', { label: 'Plain' }],
  ['related-display-button', { file: 'other.screen.json', label: 'Open it' }],
  ['shell-command-button', { command: 'ls', label: 'Run it' }],
  ['qwidget-container', {}],
  ['pv-radio-group', { pv: 'DEV:MODE' }],
  ['waveform-plot', { title: 'Trace', curves: [{ y_channel: 'DEV:WF', color: '#f00' }] }],
  ['pv-checkbox', { pv: 'DEV:ENABLE', label: 'Enable' }],
  ['pv-enum-combobox', { pv: 'DEV:MODE' }],
  ['pv-slider', { pv: 'DEV:SP', min: 0, max: 10 }],
  ['pv-progress-bar', { pv: 'DEV:PROG', min: 0, max: 100 }],
  ['pv-byte-led', { pv: 'DEV:BITS', numBits: 8 }],
  ['pv-led', { pv: 'DEV:STATE' }],
  ['pv-toggle', { pv: 'DEV:ON' }],
  ['image-view', { src: 'nonexistent.png' }],
  ['rectangle', { fill: true, fillColor: '#123123' }],
  ['ellipse', { lineColor: '#aaaaaa' }],
  ['arc', { startAngle: 0, spanAngle: 180 }],
  ['line', { arrowEnd: true }],
  ['group', {}],
  ['group-box', { title: 'Grouped' }],
  ['frame', {}],
  ['scroll-area', {}],
  ['tabs', {}],
];

// Identity-mapped IR types whose catalog widgets have no registered
// component on this branch — they must degrade to labeled placeholders.
// (pv-tank is exercised separately below with a deliberately crashing
// component registered for it.)
const PLACEHOLDER_TYPES = ['pv-spinbox', 'pv-meter', 'pv-gauge', 'pv-thermometer'];

describe('per-widget-type rendering', () => {
  it.each(RENDERABLE)('renders %s without error box', (type, props) => {
    const { container } = render(wrap(<ScreenRenderer screen={screenWith({ type, props })} />));
    expect(container.querySelectorAll('[data-testid="widget-error"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="widget-placeholder"]')).toHaveLength(0);
  });

  it.each(PLACEHOLDER_TYPES.map((t) => [t]))(
    'renders %s as a labeled placeholder (no registered component)',
    (type) => {
      render(wrap(<ScreenRenderer screen={screenWith({ type, props: { pv: 'DEV:X' } })} />));
      const box = screen.getByTestId('widget-placeholder');
      expect(box.textContent).toContain(type);
    }
  );

  it('renders a channel-less pv-label using its static text', () => {
    // `text` set, no `pv` → show the text, not `---`.
    render(
      wrap(<ScreenRenderer screen={screenWith({ type: 'pv-label', props: { text: 'Hello' } })} />)
    );
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('renders unknown-widget as a placeholder labeled with the original class', () => {
    render(
      wrap(
        <ScreenRenderer
          screen={screenWith({
            type: 'unknown-widget',
            props: { originalClass: 'activeXYZClass', originalProps: { a: 1 } },
          })}
        />
      )
    );
    expect(screen.getByTestId('widget-placeholder').textContent).toContain('activeXYZClass');
  });

  it('renders a never-seen IR type as a placeholder labeled with the type', () => {
    render(wrap(<ScreenRenderer screen={screenWith({ type: 'martian-widget', props: {} })} />));
    expect(screen.getByTestId('widget-placeholder').textContent).toContain('martian-widget');
  });

  it('resolves image-view src through resolveAsset', () => {
    const { container } = render(
      wrap(
        <ScreenRenderer
          screen={screenWith({ type: 'image-view', props: { src: 'images/beamline.png' } })}
          resolveAsset={(ref) => `https://assets.example/screens/${ref}`}
        />
      )
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://assets.example/screens/images/beamline.png');
    // alt keeps the original filename, not the resolved URL.
    expect(img?.getAttribute('alt')).toBe('images/beamline.png');
  });

  it('uses the image-view src verbatim without resolveAsset', () => {
    const { container } = render(
      wrap(<ScreenRenderer screen={screenWith({ type: 'image-view', props: { src: 'x.png' } })} />)
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('x.png');
  });

  it('contains a crashing widget component to its own error box', () => {
    // pv-tank identity-maps to the catalog type PVTank, unregistered by the
    // builtins — register a bomb for it, scoped to this test's registry use.
    widgetRegistry.register({
      type: 'PVTank',
      label: 'Tank (bomb)',
      category: 'indicator',
      icon: 'x',
      defaultLayout: { x: 0, y: 0, width: 10, height: 10 },
      defaultProps: {},
      component: () => {
        throw new Error('boom');
      },
      propsSchema: [],
    });

    const doc = screenWith({ type: 'pv-tank', props: { pv: 'DEV:LVL' } });
    (doc.root.children as WidgetNode[]).push({
      id: 'w-ok',
      type: 'text-label',
      props: { text: 'survivor' },
      geometry: { x: 10, y: 60, width: 100, height: 20 },
    });

    render(wrap(<ScreenRenderer screen={doc} />));

    const errorBox = screen.getByTestId('widget-error');
    expect(errorBox.textContent).toContain('boom');
    // The sibling keeps rendering — containment is per-widget.
    expect(screen.getByText('survivor')).toBeTruthy();
  });
});

// Widget actions wired into the renderer: a click on a widget carrying
// `props.actions` runs dispatchActions with the instance PV service, the
// widget's macros, the declaring document and the ActionHost callbacks.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { WriteGate, registerBuiltinWidgets } from '@slaclab/canopy-screen-widgets';
import type { WriteGateService, WriteRequest } from '@slaclab/canopy-screen-widgets';
import type { PropertyValue, ScreenJSON, WidgetNode } from '@slaclab/canopy-screen-ir';
import { ScreenRenderer } from './ScreenRenderer.js';
import { ActionHostContext } from '../actions/ActionHostContext.js';
import type { ActionHost } from '../actions/ActionHostContext.js';

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
  vi.restoreAllMocks();
});

function makeHost() {
  return {
    resolveManifest: vi.fn<ActionHost['resolveManifest']>(() => '/view/details'),
    navigate: vi.fn<ActionHost['navigate']>(),
    openWindow: vi.fn<ActionHost['openWindow']>(),
    close: vi.fn<ActionHost['close']>(),
    showError: vi.fn<ActionHost['showError']>(),
  } satisfies ActionHost;
}

function wrap(children: ReactNode, host?: ActionHost) {
  const inner = host ? (
    <ActionHostContext.Provider value={host}>{children}</ActionHostContext.Provider>
  ) : (
    children
  );
  return <PVServiceProvider service={service}>{inner}</PVServiceProvider>;
}

function doc(id: string, children: WidgetNode[], macros: ScreenJSON['macros'] = []): ScreenJSON {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id,
    metadata: { title: id, source: { type: 'hand-authored' }, size: { width: 400, height: 300 } },
    macros,
    root: {
      id: `${id}-root`,
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children,
    },
  };
}

function button(id: string, label: string, actions: unknown[]): WidgetNode {
  return {
    id,
    type: 'regular-button',
    props: { label, actions: actions as unknown as PropertyValue },
    geometry: { x: 10, y: 10, width: 100, height: 30 },
  };
}

describe('widget actions', () => {
  it('writes every write_pv action through the PV service on click, in order', async () => {
    const put = vi.spyOn(service, 'put');
    const screenJson = doc(
      'top',
      [
        button('b1', 'Go', [
          { type: 'write_pv', pvName: '${P}:A', value: 1 },
          { type: 'write_pv', pvName: 'X:B', value: 'on' },
        ]),
      ],
      [{ name: 'P', default: 'SYS' }]
    );
    render(wrap(<ScreenRenderer screen={screenJson} />));

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[0]).toEqual(['SYS:A', 1]);
    expect(put.mock.calls[1]).toEqual(['X:B', 'on']);
  });

  describe('props.actionsAsMenu', () => {
    const onOff = [
      { type: 'write_pv', pvName: 'X:HV_ON:SP', value: '1', description: 'ON' },
      { type: 'write_pv', pvName: 'X:HV_ON:SP', value: '0', description: 'OFF' },
    ];

    it('offers the actions by description and runs only the one picked', async () => {
      const put = vi.spyOn(service, 'put');
      const node = button('b1', 'HV ON/OFF', onOff);
      const screenJson = doc('top', [{ ...node, props: { ...node.props, actionsAsMenu: true } }]);
      render(wrap(<ScreenRenderer screen={screenJson} />));

      fireEvent.click(screen.getByRole('button', { name: 'HV ON/OFF' }));
      expect(put).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('menuitem', { name: 'OFF' }));

      await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
      expect(put.mock.calls[0]).toEqual(['X:HV_ON:SP', '0']);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('without it, writes to one channel still run in order (a pulse)', async () => {
      const put = vi.spyOn(service, 'put');
      render(wrap(<ScreenRenderer screen={doc('top', [button('b1', 'Reset', onOff)])} />));

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
      expect(put.mock.calls.map((c) => c[1])).toEqual(['1', '0']);
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it("sends a click's machine writes as one run of the provided WriteGate, loc:// on the router", async () => {
    const put = vi.spyOn(service, 'put');
    const runs: WriteRequest[][] = [];
    const gate: WriteGateService = {
      confirmWrites: () => true,
      run: async (writes) => {
        runs.push([...writes]);
        return writes.map(() => ({
          outcome: 'confirmed' as const,
          code: null,
          status: null,
          detail: 'written',
          coalesced: false,
        }));
      },
    };
    const screenJson = doc('top', [
      button('b1', 'Go', [
        { type: 'write_pv', pvName: 'SYS:A', value: 1 },
        { type: 'write_pv', pvName: 'loc://L', value: 5 },
        { type: 'write_pv', pvName: 'X:B', value: 'on' },
      ]),
    ]);
    render(
      wrap(
        <WriteGate.Provider value={gate}>
          <ScreenRenderer screen={screenJson} />
        </WriteGate.Provider>
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]).toEqual([
      { pv: 'SYS:A', value: 1 },
      { pv: 'X:B', value: 'on' },
    ]);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toBe('loc://L');
  });

  it('resolves open_display files against the declaring embedded document', async () => {
    const host = makeHost();
    const child = doc('child', [
      button('open', 'Details', [
        { type: 'open_display', file: '../details.screen.json', target: 'replace' },
      ]),
    ]);
    const parent = doc('parent', [
      {
        id: 'embed',
        type: 'embedded-display',
        props: { file: 'embedded/child' },
        geometry: { x: 0, y: 0, width: 300, height: 200 },
      },
    ]);
    const resolveScreen = vi.fn().mockResolvedValue(child);
    render(
      wrap(
        <ScreenRenderer screen={parent} screenPath="a/b/parent" resolveScreen={resolveScreen} />,
        host
      )
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));

    await waitFor(() => expect(host.navigate).toHaveBeenCalledWith('/view/details'));
    expect(host.resolveManifest).toHaveBeenCalledWith('a/b/details.screen.json');
  });

  describe('props.confirmWrites', () => {
    function gated(node: WidgetNode) {
      const options: unknown[] = [];
      const gate: WriteGateService = {
        confirmWrites: () => false,
        run: async (writes, ...rest) => {
          options.push(rest.length === 0 ? undefined : rest[0]);
          return writes.map(() => ({
            outcome: 'confirmed' as const,
            code: null,
            status: null,
            detail: 'written',
            coalesced: false,
          }));
        },
      };
      render(
        wrap(
          <WriteGate.Provider value={gate}>
            <ScreenRenderer screen={doc('top', [node])} />
          </WriteGate.Provider>
        )
      );
      fireEvent.click(screen.getByRole('button', { name: 'Go' }));
      return options;
    }
    const write = [{ type: 'write_pv', pvName: 'X:A', value: 1 }];

    // The node's label travels with every run, for a dialog the gate may open.
    const named = { dialog: { label: 'Go', action: 'press' } };

    it("asks the gate to confirm the click's run when the node sets it true", async () => {
      const node = button('b1', 'Go', write);
      const options = gated({ ...node, props: { ...node.props, confirmWrites: true } });
      await waitFor(() => expect(options).toEqual([{ confirm: true, ...named }]));
    });

    it('asks for no dialog on a node without it, or with a plain no', async () => {
      for (const value of [undefined, false, 'false']) {
        const node = button('b1', 'Go', write);
        const props = value === undefined ? node.props : { ...node.props, confirmWrites: value };
        const options = gated({ ...node, props });
        await waitFor(() => expect(options).toEqual([named]));
        cleanup();
      }
    });

    it('asks for any other value: "true", 1, a macro result', async () => {
      for (const value of ['true', 1, 'yes']) {
        const node = button('b1', 'Go', write);
        const options = gated({ ...node, props: { ...node.props, confirmWrites: value } });
        await waitFor(() => expect(options).toEqual([{ confirm: true, ...named }]));
        cleanup();
      }
    });
  });

  describe('what the dialog says: confirmTitle, confirmText, confirmVerb, confirmKind', () => {
    /** Renders `nodes` under a gate that records each run's writes and options. */
    function recorded(nodes: WidgetNode[], macros: ScreenJSON['macros'] = []) {
      const runs: { writes: WriteRequest[]; options: unknown }[] = [];
      const gate: WriteGateService = {
        confirmWrites: () => false,
        run: async (writes, ...rest) => {
          runs.push({ writes: [...writes], options: rest[0] });
          return writes.map(() => ({
            outcome: 'confirmed' as const,
            code: null,
            status: null,
            detail: 'written',
            coalesced: false,
          }));
        },
      };
      render(
        wrap(
          <WriteGate.Provider value={gate}>
            <ScreenRenderer screen={doc('top', nodes, macros)} />
          </WriteGate.Provider>
        )
      );
      return runs;
    }
    const SAID = {
      confirmTitle: 'Reboot controller RACK1:CTRL1?',
      confirmText: 'It commands 2 power supplies.',
      confirmVerb: 'Reboot',
      confirmKind: 'consequence',
    };
    const WORDS = {
      title: 'Reboot controller RACK1:CTRL1?',
      text: 'It commands 2 power supplies.',
      verb: 'Reboot',
      kind: 'consequence',
    };

    it("a node's click actions carry the four props and its label to the gate", async () => {
      const node = button('b1', 'Reboot', [
        { type: 'write_pv', pvName: 'RACK1:CTRL1:Reboot', value: 0 },
      ]);
      const runs = recorded([{ ...node, props: { ...node.props, confirmWrites: true, ...SAID } }]);
      fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]).toEqual({
        writes: [{ pv: 'RACK1:CTRL1:Reboot', value: 0 }],
        options: { confirm: true, dialog: { ...WORDS, label: 'Reboot', action: 'press' } },
      });
    });

    it('the wording asks for no dialog on its own', async () => {
      const node = button('b1', 'Reboot', [
        { type: 'write_pv', pvName: 'RACK1:CTRL1:Reboot', value: 0 },
      ]);
      const runs = recorded([{ ...node, props: { ...node.props, ...SAID } }]);
      fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0].options).toEqual({ dialog: { ...WORDS, label: 'Reboot', action: 'press' } });
    });

    it('macros are substituted in the wording, as in any string of a screen', async () => {
      const node = button('b1', 'Reboot', [
        { type: 'write_pv', pvName: '$(DEV):Reboot', value: 0 },
      ]);
      const runs = recorded(
        [{ ...node, props: { ...node.props, confirmTitle: 'Reboot controller $(DEV)?' } }],
        [{ name: 'DEV', default: 'RACK1:CTRL1' }]
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]).toEqual({
        writes: [{ pv: 'RACK1:CTRL1:Reboot', value: 0 }],
        options: {
          dialog: { title: 'Reboot controller RACK1:CTRL1?', label: 'Reboot', action: 'press' },
        },
      });
    });

    it('a pick from an action menu is named by the item picked', async () => {
      const node = button('b1', 'HV ON/OFF', [
        { type: 'write_pv', pvName: 'DEV:HV:Enable', value: 1, description: 'ON' },
        { type: 'write_pv', pvName: 'DEV:HV:Enable', value: 0, description: 'OFF' },
      ]);
      const runs = recorded([{ ...node, props: { ...node.props, actionsAsMenu: true } }]);
      fireEvent.click(screen.getByRole('button', { name: 'HV ON/OFF' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'OFF' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]).toEqual({
        writes: [{ pv: 'DEV:HV:Enable', value: 0 }],
        options: { dialog: { label: 'OFF', action: 'press' } },
      });
    });

    it('a pv-button carries them from the Screen-IR to its own write', async () => {
      const runs = recorded([
        {
          id: 'pb',
          type: 'pv-button',
          props: {
            pv: 'RACK1:CTRL1:Reboot',
            label: 'Reboot',
            pressValue: 0,
            confirmWrites: true,
            ...SAID,
          },
          geometry: { x: 10, y: 10, width: 100, height: 30 },
        },
      ]);
      fireEvent.click(await screen.findByRole('button', { name: 'Reboot' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]).toEqual({
        writes: [{ pv: 'RACK1:CTRL1:Reboot', value: 0 }],
        options: { confirm: true, dialog: { ...WORDS, label: 'Reboot', action: 'press' } },
      });
    });

    it('a pv-text-input carries them from the Screen-IR to its own write', async () => {
      const runs = recorded([
        {
          id: 'pt',
          type: 'pv-text-input',
          props: {
            pv: 'sim://sine',
            confirmTitle: 'Change the set point?',
            confirmMessage: 'The supply ramps at once.',
          },
          geometry: { x: 10, y: 10, width: 100, height: 30 },
        },
      ]);
      const input = await waitFor(() => {
        const el = document.querySelector('[data-node-id="pt"] input') as HTMLInputElement;
        expect(el.disabled).toBe(false);
        return el;
      });
      fireEvent.change(input, { target: { value: '2.5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]).toEqual({
        writes: [{ pv: 'sim://sine', value: 2.5, entered: '2.5' }],
        options: {
          dialog: {
            title: 'Change the set point?',
            text: 'The supply ramps at once.',
            action: 'set',
          },
        },
      });
    });

    it('an Apply node carries them to the staged run, worded as an Apply', async () => {
      const apply = button('apply', 'Apply', [{ type: 'apply_staged', scope: 'set' }]);
      const runs = recorded([
        {
          id: 'e1',
          type: 'pv-text-input',
          props: { pv: 'sim://sine', stage: 'set' },
          geometry: { x: 10, y: 50, width: 100, height: 30 },
        },
        {
          ...apply,
          props: { ...apply.props, confirmWrites: true, confirmText: 'Both supplies ramp.' },
        },
      ]);
      const input = await waitFor(() => {
        const el = document.querySelector('[data-node-id="e1"] input') as HTMLInputElement;
        expect(el.disabled).toBe(false);
        return el;
      });
      fireEvent.change(input, { target: { value: '2.5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(runs).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0].writes).toEqual([{ pv: 'sim://sine', value: 2.5, entered: '2.5' }]);
      expect(runs[0].options).toEqual({
        nameStopped: true,
        stopUnlessConfirmed: true,
        confirm: true,
        dialog: { text: 'Both supplies ramp.', label: 'Apply', action: 'apply' },
        check: expect.any(Function),
      });
    });
  });

  describe('staged entries and apply_staged', () => {
    function entry(id: string, pv: string, y: number, stage?: string): WidgetNode {
      return {
        id,
        type: 'pv-text-input',
        props: stage === undefined ? { pv } : { pv, stage },
        geometry: { x: 10, y, width: 100, height: 30 },
      };
    }
    function setup(nodes: WidgetNode[], answer: 'declined' | 'confirmed' = 'confirmed') {
      const runs: WriteRequest[][] = [];
      const gate: WriteGateService = {
        confirmWrites: () => false,
        run: async (writes) => {
          runs.push([...writes]);
          if (answer === 'declined') return 'declined';
          return writes.map(() => ({
            outcome: 'confirmed' as const,
            code: null,
            status: null,
            detail: 'written',
            coalesced: false,
          }));
        },
      };
      const put = vi.spyOn(service, 'put');
      render(
        wrap(
          <WriteGate.Provider value={gate}>
            <ScreenRenderer screen={doc('top', nodes)} />
          </WriteGate.Provider>
        )
      );
      return { runs, put };
    }
    async function type(nodeId: string, text: string) {
      const input = await waitFor(() => {
        const el = document.querySelector(`[data-node-id="${nodeId}"] input`) as HTMLInputElement;
        expect(el.disabled).toBe(false);
        return el;
      });
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter' });
      return input;
    }
    const applyButton = button('apply', 'Apply', [{ type: 'apply_staged', scope: 'set' }]);

    it('Enter in staging entries writes nothing; Apply writes them as one run and clears them', async () => {
      const { runs, put } = setup([
        entry('e1', 'sim://sine', 50, 'set'),
        entry('e2', 'sim://ramp', 90, 'set'),
        applyButton,
      ]);
      const first = await type('e1', '2.5');
      const second = await type('e2', '4');
      expect(runs).toEqual([]);
      expect(first.value).toBe('2.5');
      expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]).toEqual([
        { pv: 'sim://sine', value: 2.5, entered: '2.5' },
        { pv: 'sim://ramp', value: 4, entered: '4' },
      ]);
      await waitFor(() =>
        expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0)
      );
      expect(second.value).not.toBe('4');
      expect(put).not.toHaveBeenCalled();
    });

    it('a declined Apply keeps the staged values in their entries', async () => {
      const { runs } = setup([entry('e1', 'sim://sine', 50, 'set'), applyButton], 'declined');
      const input = await type('e1', '2.5');
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(input.value).toBe('2.5');
      expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(1);
    });

    it('clear_staged returns the entries to the live value, unwritten', async () => {
      const { runs } = setup([
        entry('e1', 'sim://sine', 50, 'set'),
        button('reset', 'Reset', [{ type: 'clear_staged', scope: 'set' }]),
      ]);
      await type('e1', '2.5');
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await waitFor(() =>
        expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0)
      );
      expect(runs).toEqual([]);
    });

    it('an entry without a stage on the same screen writes on Enter, as before', async () => {
      const { runs } = setup([entry('e1', 'sim://sine', 50), applyButton]);
      await type('e1', '2.5');
      await waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]).toEqual([{ pv: 'sim://sine', value: 2.5, entered: '2.5' }]);
      expect(document.querySelectorAll('[data-staged="true"]')).toHaveLength(0);
    });

    describe('while nothing is staged', () => {
      const resetButton: WidgetNode = {
        ...button('reset', 'Reset', [{ type: 'clear_staged', scope: 'set' }]),
        geometry: { x: 150, y: 10, width: 100, height: 30 },
      };
      const node = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
      const badge = (id: string) =>
        node(id).querySelector('[data-testid="canopy-staged-count"]')?.textContent ?? null;

      it('Apply and Reset are disabled and say why; a click runs nothing', async () => {
        const { runs } = setup([entry('e1', 'sim://sine', 50, 'set'), applyButton, resetButton]);
        for (const id of ['apply', 'reset']) {
          expect(node(id).getAttribute('aria-disabled')).toBe('true');
          expect(node(id).getAttribute('title')).toBe('nothing staged');
          expect(node(id).querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
          expect(badge(id)).toBeNull();
          expect(node(id).getAttribute('data-staged-count')).toBe('0');
        }
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(runs).toEqual([]);
      });

      it('they come alive with the count of staged values, and go back after the write', async () => {
        const { runs } = setup([
          entry('e1', 'sim://sine', 50, 'set'),
          entry('e2', 'sim://ramp', 90, 'set'),
          entry('e3', 'sim://noise', 130, 'other'),
          applyButton,
          resetButton,
        ]);
        await type('e1', '2.5');
        await waitFor(() => expect(badge('apply')).toBe('1'));
        await type('e2', '4');
        await type('e3', '7');
        await waitFor(() => expect(badge('apply')).toBe('2'));
        expect(badge('reset')).toBe('2');
        expect(node('apply').getAttribute('data-staged-count')).toBe('2');
        expect(node('apply').getAttribute('aria-disabled')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        await waitFor(() => expect(runs).toHaveLength(1));
        await waitFor(() => expect(node('apply').getAttribute('aria-disabled')).toBe('true'));
        expect(badge('apply')).toBeNull();
      });

      it('a node that also carries another action stays live', async () => {
        const mixed = button('mixed', 'Apply and close', [
          { type: 'apply_staged', scope: 'set' },
          { type: 'close_display' },
        ]);
        const host = makeHost();
        render(wrap(<ScreenRenderer screen={doc('top', [mixed])} />, host));
        expect(node('mixed').getAttribute('aria-disabled')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Apply and close' }));
        await waitFor(() => expect(host.close).toHaveBeenCalled());
      });

      it('a node with no staging action carries no count', () => {
        setup([button('w', 'Go', [{ type: 'write_pv', pvName: 'X:A', value: 1 }])]);
        expect(node('w').getAttribute('data-staged-count')).toBeNull();
        expect(node('w').getAttribute('aria-disabled')).toBeNull();
      });
    });

    it('an Apply button is inert while the gate refuses machine writes', async () => {
      const reason = 'writes are off';
      const inert = { disabled: true, reason };
      const gate: WriteGateService = {
        confirmWrites: () => false,
        run: vi.fn(async () => []),
        writes: () => inert,
        subscribeWrites: () => () => {},
      };
      render(
        wrap(
          <WriteGate.Provider value={gate}>
            <ScreenRenderer screen={doc('top', [applyButton])} />
          </WriteGate.Provider>
        )
      );
      const wrapper = document.querySelector('[data-node-id="apply"]') as HTMLElement;
      expect(wrapper.getAttribute('aria-disabled')).toBe('true');
      expect(wrapper.getAttribute('title')).toBe(reason);
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(gate.run).not.toHaveBeenCalled();
    });
  });

  it('attaches no click handler when the actions list is malformed', async () => {
    const put = vi.spyOn(service, 'put');
    const screenJson = doc('top', [
      button('b1', 'Bad', [
        { type: 'write_pv', pvName: 'X:A', value: 1 },
        { type: 'write_pv', pvName: 'X:B' },
      ]),
    ]);
    render(wrap(<ScreenRenderer screen={screenJson} />));

    fireEvent.click(screen.getByRole('button', { name: 'Bad' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(put).not.toHaveBeenCalled();
  });

  it('works without an ActionHost provider (warn-only default)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const screenJson = doc('top', [button('c', 'Close', [{ type: 'close_display' }])]);
    render(wrap(<ScreenRenderer screen={screenJson} />));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.calls[0][0])).toContain('ActionHost');
  });
});

describe('device right-click menu', () => {
  const node = (id: string, type: string, pv: string): WidgetNode => ({
    id,
    type,
    props: { pv, device: 'SYS:QF1' },
    geometry: { x: 10, y: 10, width: 100, height: 30 },
  });
  // A setpoint entry first in the screen and by name, its readback second.
  const tile = [
    node('w-sp', 'pv-text-input', 'SYS:QF1:A_SP'),
    node('w-rb', 'pv-label', 'SYS:QF1:Z_RB'),
  ];
  const wrapper = () => document.querySelector('[data-node-id="w-rb"]') as HTMLElement;

  it("plots the device's channels in Trace, values before setpoints", () => {
    const host = { ...makeHost(), plotPVs: vi.fn<NonNullable<ActionHost['plotPVs']>>() };
    render(wrap(<ScreenRenderer screen={doc('top', tile)} />, host));

    expect(fireEvent.contextMenu(wrapper())).toBe(false); // the browser menu is replaced
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Trace' }));

    expect(host.plotPVs).toHaveBeenCalledWith(['SYS:QF1:Z_RB', 'SYS:QF1:A_SP']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('leaves the browser menu where the host cannot plot', () => {
    render(wrap(<ScreenRenderer screen={doc('top', tile)} />, makeHost()));

    expect(fireEvent.contextMenu(wrapper())).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

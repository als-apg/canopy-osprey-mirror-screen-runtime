// The library's navigation: the shapes parseNavigation accepts and what it
// says about the rest, and how resolveNavigation fits it to the manifest.

import { describe, expect, it } from 'vitest';
import type { ManifestScreen } from '../api.js';
import {
  MAX_NAVIGATION_DEPTH,
  MAX_NAVIGATION_ENTRIES,
  parseNavigation,
  resolveNavigation,
} from './navigation.js';
import type { NavigationEntry } from './navigation.js';

function entry(category: string, id: string, title: string): ManifestScreen {
  return { id, kind: 'ir', title, category, path: `screens/${category}/${id}.screen.json` };
}

const SCREENS = [
  entry('plant', 'overview', 'Plant Overview'),
  entry('plant', 'pumps/p1', 'Pump One'),
  entry('plant', 'pumps/p2', 'Pump Two'),
];

const errorOf = (raw: unknown) => {
  const parsed = parseNavigation(raw);
  return parsed !== null && 'error' in parsed ? parsed.error : null;
};

describe('parseNavigation', () => {
  it('reads no navigation as null', () => {
    expect(parseNavigation(undefined)).toBeNull();
    expect(parseNavigation(null)).toBeNull();
  });

  it('keeps leaves and nested groups in order, with their optional parts', () => {
    const raw = [
      { screen: 'plant/overview' },
      {
        label: 'Pumps',
        screen: 'plant/overview',
        children: [
          { screen: 'plant/pumps/p2', label: 'Second' },
          { label: 'Empty', children: [] },
        ],
      },
    ];
    expect(parseNavigation(raw)).toEqual({ entries: raw });
  });

  it.each([
    [{}, 'navigation: not a list'],
    ['plant/overview', 'navigation: not a list'],
    [['plant/overview'], 'navigation[0]: not an object'],
    [[{ label: 'Only a label' }], 'navigation[0]: neither a screen nor a group'],
    [[{ screen: 'overview' }], 'navigation[0]: screen is not "<category>/<id>"'],
    [[{ screen: 7 }], 'navigation[0]: screen is not "<category>/<id>"'],
    [
      [{ screen: 'plant/overview', label: ' ' }],
      'navigation[0]: label is not a text of 1 to 120 characters',
    ],
    [[{ children: [] }], 'navigation[0]: a group needs a label'],
    [[{ label: 'G', children: {} }], 'navigation[0].children: not a list'],
    [[{ screen: 'plant/overview', icon: 'x' }], 'navigation[0]: unknown key "icon"'],
    [
      [{ screen: 'plant/overview' }, { label: 'G', children: [{ screen: '' }] }],
      'navigation[1].children[0]: screen is not "<category>/<id>"',
    ],
  ])('rejects %j: %s', (raw, message) => {
    expect(errorOf(raw)).toBe(message);
  });

  it('rejects groups nested too deep and too many entries', () => {
    let deep: unknown[] = [{ screen: 'plant/overview' }];
    for (let i = 0; i < MAX_NAVIGATION_DEPTH; i += 1) deep = [{ label: 'G', children: deep }];
    expect(errorOf(deep)).toContain(`nested deeper than ${MAX_NAVIGATION_DEPTH}`);
    const many = Array.from({ length: MAX_NAVIGATION_ENTRIES + 1 }, () => ({
      screen: 'plant/overview',
    }));
    expect(errorOf(many)).toBe(`more than ${MAX_NAVIGATION_ENTRIES} entries`);
    expect(errorOf(many.slice(1))).toBeNull();
  });
});

describe('resolveNavigation', () => {
  const resolve = (entries: NavigationEntry[]) => resolveNavigation(entries, SCREENS);

  it('labels a leaf with its label, else the screen title, and numbers the places', () => {
    const { entries, missing } = resolve([
      { screen: 'plant/overview' },
      { label: 'Pumps', children: [{ screen: 'plant/pumps/p1', label: 'First' }] },
    ]);
    expect(missing).toEqual([]);
    expect(entries).toEqual([
      { path: '0', label: 'Plant Overview', screen: SCREENS[0] },
      {
        path: '1',
        label: 'Pumps',
        children: [{ path: '1.0', label: 'First', screen: SCREENS[1] }],
      },
    ]);
  });

  it('skips unlisted screens, lists each once, and drops a group left with nothing', () => {
    const { entries, missing } = resolve([
      { screen: 'plant/gone' },
      { label: 'Gone', children: [{ screen: 'plant/gone' }, { screen: 'other/missing' }] },
      { label: 'Kept', screen: 'plant/nowhere', children: [{ screen: 'plant/pumps/p2' }] },
      { label: 'Opens', screen: 'plant/overview', children: [{ screen: 'plant/gone' }] },
    ]);
    expect(missing).toEqual(['plant/gone', 'other/missing', 'plant/nowhere']);
    expect(entries.map((e) => [e.path, e.label, e.screen?.id, e.children?.length])).toEqual([
      ['2', 'Kept', undefined, 1],
      ['3', 'Opens', 'overview', 0],
    ]);
  });
});

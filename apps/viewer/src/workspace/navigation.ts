// A library's own navigation tree: the optional `navigation` of the manifest.
// Pure: no DOM, no storage. The Browse tree (ScreenTree.tsx) shows it in place
// of the folder tree, which then sits in a last, collapsed "All screens" group.
//
// The value is a list of entries, in the order they are shown. An entry is
//
//   a leaf     { "screen": "<category>/<id>", "label"?: "<text>" }
//   a group    { "label": "<text>", "children": [ <entry>, ... ],
//                "screen"?: "<category>/<id>" }
//
// A leaf opens its screen and shows `label`, else the screen's title. A group
// shows `label` and holds its children; with a `screen` its row opens that
// screen and its chevron expands it. Groups nest up to MAX_NAVIGATION_DEPTH;
// one navigation holds at most MAX_NAVIGATION_ENTRIES entries. Any other shape
// makes the whole value invalid: the tree then shows the folders alone.

import type { ManifestScreen } from '../api.js';

/** The deepest nesting of groups (a top-level entry is at depth 1). */
export const MAX_NAVIGATION_DEPTH = 8;
/** The most entries, groups and leaves together. */
export const MAX_NAVIGATION_ENTRIES = 2000;
/** The longest label, in characters. */
export const MAX_NAVIGATION_LABEL = 120;

export interface NavigationEntry {
  /** '<category>/<id>' of the screen the entry opens. */
  screen?: string;
  label?: string;
  /** Present on a group, in display order. */
  children?: readonly NavigationEntry[];
}

export type ParsedNavigation =
  | { entries: readonly NavigationEntry[] }
  /** What is wrong with the value, naming the entry (`navigation[1].children[0]: …`). */
  | { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_NAVIGATION_LABEL;
}

/** '<category>/<id>' with both parts non-empty. */
function isScreenRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const slash = value.indexOf('/');
  return slash > 0 && slash < value.length - 1;
}

/**
 * The manifest's `navigation` as entries, or what is wrong with it. `undefined`
 * and `null` (no navigation) parse to null.
 */
export function parseNavigation(raw: unknown): ParsedNavigation | null {
  if (raw === undefined || raw === null) return null;
  let count = 0;
  const list = (value: unknown, at: string, depth: number): NavigationEntry[] | string => {
    if (!Array.isArray(value)) return `${at}: not a list`;
    if (depth > MAX_NAVIGATION_DEPTH) return `${at}: nested deeper than ${MAX_NAVIGATION_DEPTH}`;
    const out: NavigationEntry[] = [];
    for (const [index, item] of value.entries()) {
      const here = `${at}[${index}]`;
      count += 1;
      if (count > MAX_NAVIGATION_ENTRIES) return `more than ${MAX_NAVIGATION_ENTRIES} entries`;
      if (!isRecord(item)) return `${here}: not an object`;
      const unknown = Object.keys(item).find((k) => !['screen', 'label', 'children'].includes(k));
      if (unknown !== undefined) return `${here}: unknown key "${unknown}"`;
      const { screen, label, children } = item;
      if (screen !== undefined && !isScreenRef(screen)) {
        return `${here}: screen is not "<category>/<id>"`;
      }
      if (label !== undefined && !isLabel(label)) {
        return `${here}: label is not a text of 1 to ${MAX_NAVIGATION_LABEL} characters`;
      }
      const entry: NavigationEntry = {};
      if (screen !== undefined) entry.screen = screen;
      if (label !== undefined) entry.label = label;
      if (children !== undefined) {
        if (label === undefined) return `${here}: a group needs a label`;
        const parsed = list(children, `${here}.children`, depth + 1);
        if (typeof parsed === 'string') return parsed;
        entry.children = parsed;
      } else if (screen === undefined) {
        return `${here}: neither a screen nor a group`;
      }
      out.push(entry);
    }
    return out;
  };
  const entries = list(raw, 'navigation', 1);
  return typeof entries === 'string' ? { error: entries } : { entries };
}

/** A navigation entry whose screens exist in the manifest. */
export interface ResolvedEntry {
  /** Its place in the navigation (`0.2.1`): unique, stable while the file is. */
  path: string;
  label: string;
  /** The manifest entry it opens; absent on a group without a screen. */
  screen?: ManifestScreen;
  /** Present on a group (possibly empty when the group opens a screen). */
  children?: ResolvedEntry[];
}

export interface ResolvedNavigation {
  entries: ResolvedEntry[];
  /** The screen refs the navigation names that the manifest does not list, once each, in order. */
  missing: string[];
}

/**
 * `entries` against the manifest's `screens`: a leaf whose screen is not
 * listed is skipped, a group keeps its label but loses a screen that is not
 * listed, and a group left with neither children nor a screen is skipped.
 */
export function resolveNavigation(
  entries: readonly NavigationEntry[],
  screens: readonly ManifestScreen[]
): ResolvedNavigation {
  const byRef = new Map(screens.map((s) => [`${s.category}/${s.id}`, s]));
  const missing = new Set<string>();
  const find = (ref: string | undefined): ManifestScreen | undefined => {
    if (ref === undefined) return undefined;
    const found = byRef.get(ref);
    if (found === undefined) missing.add(ref);
    return found;
  };
  const walk = (list: readonly NavigationEntry[], prefix: string): ResolvedEntry[] => {
    const out: ResolvedEntry[] = [];
    for (const [index, entry] of list.entries()) {
      const path = prefix === '' ? String(index) : `${prefix}.${index}`;
      const screen = find(entry.screen);
      if (entry.children === undefined) {
        if (screen) out.push({ path, label: entry.label ?? screen.title, screen });
        continue;
      }
      const children = walk(entry.children, path);
      if (children.length === 0 && screen === undefined) continue;
      out.push({ path, label: entry.label ?? '', ...(screen ? { screen } : {}), children });
    }
    return out;
  };
  const resolved = walk(entries, '');
  return { entries: resolved, missing: [...missing] };
}

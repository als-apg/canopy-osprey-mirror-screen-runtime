// "Plot in Data Browser": which of a screen's PVs the chooser preselects,
// how many the data browser gets at most, and the Trace query that opens it.
//
// A converted panel such as GTLView shows ~180 PVs; plotting them all draws
// noise, so the operator picks. The cap is one colour cycle of Trace's palettes
// (12): beyond it curves repeat colours and the legend stops telling them
// apart, and every curve costs Trace an archive request and a live
// subscription. The query must also fit Trace's 4 KB embed-query limit, which
// 12 names of up to ~300 bytes always do.

import type { ScreenPVGroup, ScreenPVRole } from '@slaclab/canopy-screen-runtime';
import { TRACE_QUERY_MAX_BYTES } from '../config.js';

/** At most this many PVs go to the data browser at once. */
export const MAX_PLOT_PVS = 12;

/** The preselection: a small, readable plot. */
export const DEFAULT_PLOT_PVS = 6;

// Roles worth plotting first: values the screen shows as numbers or curves.
// Rule and formula inputs, LEDs and writes are offered, never preselected.
const PRESELECTED_ROLES: readonly ScreenPVRole[] = ['readback', 'plot'];

/**
 * The PVs to preselect: the first `limit` readbacks and plotted channels in
 * screen order (the top screen first, then each embedded screen). None when
 * the screen shows no value of that kind; the operator picks then.
 */
export function defaultSelection(
  groups: readonly ScreenPVGroup[],
  limit: number = DEFAULT_PLOT_PVS
): string[] {
  const picked: string[] = [];
  for (const group of groups) {
    for (const pv of group.pvs) {
      if (picked.length >= limit) return picked;
      if (PRESELECTED_ROLES.includes(pv.role)) picked.push(pv.name);
    }
  }
  return picked;
}

/**
 * `groups` narrowed to `search` (case-insensitive, every word must match):
 * a group whose title or macros match keeps all its PVs, any other keeps the
 * PVs whose name matches. Groups left empty are dropped.
 */
export function filterGroups(groups: readonly ScreenPVGroup[], search: string): ScreenPVGroup[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const nonEmpty = groups.filter((g) => g.pvs.length > 0);
  if (words.length === 0) return nonEmpty;
  const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const out: ScreenPVGroup[] = [];
  for (const group of nonEmpty) {
    if (matches(`${group.title} ${group.detail}`)) {
      out.push(group);
      continue;
    }
    const pvs = group.pvs.filter((pv) => matches(pv.name));
    if (pvs.length > 0) out.push({ ...group, pvs });
  }
  return out;
}

// Percent-encode a query component, leaving ":" readable as Trace does.
function component(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ':');
}

/**
 * The Trace embed query that plots `pvs` over the time range of `current`
 * (the data browser's query; `-1h` when it names none). Trace's axis and
 * display settings in `current` are left behind: they belong to its PVs.
 */
export function plotQuery(pvs: readonly string[], current: string = ''): string {
  const params = new URLSearchParams(current);
  const parts = pvs.map((pv) => `pv=${component(pv)}`);
  const range = params.get('range') ?? '-1h';
  parts.push(`range=${component(range)}`);
  if (range === 'custom') {
    for (const key of ['from', 'to']) {
      const value = params.get(key);
      if (value) parts.push(`${key}=${component(value)}`);
    }
  }
  return parts.join('&');
}

/** True when `query` fits Trace's embed-query limit. */
export function fitsTraceQuery(query: string): boolean {
  return new TextEncoder().encode(query).length <= TRACE_QUERY_MAX_BYTES;
}

/**
 * `current` (the data browser's query) with `pv` added to what it plots, its
 * time range and display settings kept; `current` itself when it plots `pv`
 * already. Null at the PV cap, or when the result exceeds Trace's limit.
 */
export function addPVQuery(current: string, pv: string): string | null {
  const plotted = new URLSearchParams(current).getAll('pv');
  if (plotted.includes(pv)) return current;
  if (plotted.length >= MAX_PLOT_PVS) return null;
  const query = plotted.length === 0 ? plotQuery([pv], current) : `${current}&pv=${component(pv)}`;
  return fitsTraceQuery(query) ? query : null;
}

/** As many Y PVs as the correlation plot draws against one X. */
export const MAX_CORRELATION_YS = 8;

/**
 * The correlation query that plots `y` against `x`: `current` (the
 * correlation plot's query) with `y` added when it already plots against
 * `x` and has room, else a new plot of the pair.
 */
export function correlationQuery(x: string, y: string, current: string = ''): string {
  const params = new URLSearchParams(current);
  if (params.get('x') === x) {
    const ys = params.getAll('y');
    if (ys.includes(y)) return current;
    if (ys.length < MAX_CORRELATION_YS) {
      const query = `${current}&y=${component(y)}`;
      if (fitsTraceQuery(query)) return query;
    }
  }
  return `x=${component(x)}&y=${component(y)}`;
}

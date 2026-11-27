// Shared fetches for opening a screen.
//
//   manifest   screens that open in the same moment without a manifest someone
//              else keeps (several restored tabs, before the workspace's first
//              manifest) await one request and one parse instead of one each.
//              Nothing is kept once it lands.
//   early      `prefetchScreenDocument` starts a screen's fetch before the page
//              that shows it exists (the press on a tree row); the page's
//              `loadScreenDocument` for the same base, path and rev then takes
//              that request instead of sending its own. A started fetch is
//              taken once, kept at most PREFETCH_TTL_MS, and only the last
//              PREFETCH_MAX are kept, so nothing is fetched on speculation
//              beyond the row the operator pressed. A reload past the HTTP
//              cache (`fresh`) never takes it, and a failed one is forgotten:
//              the page fetches for itself.

import type { ScreenJSON } from '@slaclab/canopy-screen-ir';
import type { Manifest } from './api.js';
import { fetchManifest, fetchScreenDocument } from './api.js';

/** How long a started fetch waits for the page that takes it. */
export const PREFETCH_TTL_MS = 10_000;
/** How many started fetches are kept. */
export const PREFETCH_MAX = 4;

const manifests = new Map<string, Promise<Manifest>>();

/** `fetchManifest`, shared by every caller while one request for the same manifest is in flight. */
export function fetchManifestShared(
  baseUrl: string,
  options?: { fresh?: boolean }
): Promise<Manifest> {
  const key = `${baseUrl}|${options?.fresh ? 'fresh' : ''}`;
  const pending = manifests.get(key);
  if (pending) return pending;
  const started = fetchManifest(baseUrl, options);
  manifests.set(key, started);
  const forget = () => {
    if (manifests.get(key) === started) manifests.delete(key);
  };
  started.then(forget, forget);
  return started;
}

interface Started {
  document: Promise<ScreenJSON>;
  at: number;
}

const started = new Map<string, Started>();

function documentKey(baseUrl: string, path: string, rev: string | undefined): string {
  return `${baseUrl}|${path}|${rev ?? ''}`;
}

/** Starts fetching the screen document at `path` (its manifest entry's `rev`), unless already started. */
export function prefetchScreenDocument(baseUrl: string, path: string, rev?: string): void {
  const key = documentKey(baseUrl, path, rev);
  const now = Date.now();
  for (const [other, entry] of started) {
    if (now - entry.at > PREFETCH_TTL_MS) started.delete(other);
  }
  if (started.has(key)) return;
  const document = fetchScreenDocument(baseUrl, path);
  // The page that takes it handles the failure; an untaken one is dropped.
  document.catch(() => {
    if (started.get(key)?.document === document) started.delete(key);
  });
  started.set(key, { document, at: now });
  while (started.size > PREFETCH_MAX) started.delete(started.keys().next().value!);
}

/**
 * The screen document at `path`: the fetch `prefetchScreenDocument` started
 * for the same base, path and rev when there is one, else a fetch of its own.
 * `fresh` fetches past the HTTP cache and never takes a started fetch.
 */
export function loadScreenDocument(
  baseUrl: string,
  path: string,
  rev: string | undefined,
  options?: { fresh?: boolean }
): Promise<ScreenJSON> {
  const key = documentKey(baseUrl, path, rev);
  const early = started.get(key);
  started.delete(key);
  if (!options?.fresh && early && Date.now() - early.at <= PREFETCH_TTL_MS) {
    return early.document.catch(() => fetchScreenDocument(baseUrl, path));
  }
  return fetchScreenDocument(baseUrl, path, options);
}

/** Forgets every shared fetch (tests). */
export function resetScreenDocuments(): void {
  manifests.clear();
  started.clear();
}

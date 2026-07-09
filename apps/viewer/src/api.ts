// canopy-screens content access: manifest + screen documents.

import type { ScreenJSON } from '@slaclab/canopy-screen-ir';
import type { ResolveScreen } from '@slaclab/canopy-screen-runtime';

/** One entry of the content repo's generated manifest.json. */
export interface ManifestScreen {
  id: string;
  /** 'ir' renders here; 'wrapper'/'code' screens are code-based (not yet viewable). */
  kind: string;
  title: string;
  category: string;
  /** Repo-relative path of the document, e.g. screens/examples/x.screen.json */
  path: string;
  macros?: { name: string; default?: string; description?: string }[];
  tags?: string[];
  schemaVersion?: string;
}

export interface Manifest {
  screens: ManifestScreen[];
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} fetching ${url}`);
  }
  return response.json();
}

export async function fetchManifest(baseUrl: string): Promise<Manifest> {
  const data = (await fetchJson(`${baseUrl}/manifest.json`)) as Manifest;
  if (!Array.isArray(data.screens)) {
    throw new Error('manifest.json has no screens[] array');
  }
  return data;
}

export async function fetchScreenDocument(baseUrl: string, path: string): Promise<ScreenJSON> {
  return (await fetchJson(`${baseUrl}/${path}`)) as ScreenJSON;
}

/**
 * Build the runtime's resolveScreen for a screen document: embedded refs
 * resolve relative to the TOP screen document's directory (nested chains
 * resolve against the same base — a documented v0.1 simplification).
 */
export function makeResolveScreen(baseUrl: string, screenPath: string): ResolveScreen {
  const directory = screenPath.includes('/')
    ? screenPath.slice(0, screenPath.lastIndexOf('/') + 1)
    : '';
  return async (ref: string) => {
    const target = new URL(`${directory}${ref}`, `${resolveDocumentOrigin(baseUrl)}/`).toString();
    return (await fetchJson(target)) as ScreenJSON;
  };
}

// new URL() needs an absolute base; same-origin '' resolves against the page.
function resolveDocumentOrigin(baseUrl: string): string {
  if (baseUrl) return baseUrl;
  return window.location.origin;
}

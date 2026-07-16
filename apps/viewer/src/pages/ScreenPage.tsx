// /s/:category/:id — render one IR screen with ?MACRO=value query macros.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PVServiceProvider } from '@slaclab/canopy-react';
import { SCHEMA_VERSION } from '@slaclab/canopy-screen-ir';
import type { ScreenJSON } from '@slaclab/canopy-screen-ir';
import { FormulaSubscriberContext, ScreenRenderer } from '@slaclab/canopy-screen-runtime';
import { AppHeader } from '@slaclab/canopy-shell';
import type { ManifestScreen } from '../api.js';
import { fetchManifest, fetchScreenDocument, makeResolveAsset, makeResolveScreen } from '../api.js';
import { ErrorPanel, ScreenErrorBoundary } from '../ErrorPanel.js';
import { useServices } from '../services.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; title: string; detail?: string }
  | { status: 'ready'; entry: ManifestScreen; screen: ScreenJSON };

function useScreenDocument(
  screensBaseUrl: string,
  category: string | undefined,
  id: string | undefined
): LoadState {
  // The result is tagged with the request it answered; a route change makes
  // it stale, so "loading" is derived instead of reset inside the effect.
  const key = `${screensBaseUrl}|${category}|${id}`;
  const [loaded, setLoaded] = useState<{ key: string; state: LoadState } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async (): Promise<LoadState> => {
      const manifest = await fetchManifest(screensBaseUrl);
      const entry = manifest.screens.find((s) => s.category === category && s.id === id);
      if (!entry) {
        return {
          status: 'error',
          title: `No screen '${category}/${id}' in the manifest`,
        };
      }
      if (entry.kind !== 'ir') {
        return {
          status: 'error',
          title: `Screen '${entry.title}' is a ${entry.kind} screen`,
          detail: 'Only IR screens (.screen.json) are viewable in this version.',
        };
      }
      const screen = await fetchScreenDocument(screensBaseUrl, entry.path);
      if (screen.schemaVersion !== SCHEMA_VERSION) {
        return {
          status: 'error',
          title: 'Schema version mismatch',
          detail:
            `'${entry.path}' declares schemaVersion ${String(screen.schemaVersion)}, ` +
            `but this viewer speaks ${SCHEMA_VERSION}. Re-save the screen with a matching ` +
            `canopy-screen-builder, or update the viewer.`,
        };
      }
      return { status: 'ready', entry, screen };
    })().then(
      (next) => {
        if (!cancelled) setLoaded({ key, state: next });
      },
      (err: unknown) => {
        if (!cancelled)
          setLoaded({
            key,
            state: {
              status: 'error',
              title: 'Could not load the screen',
              detail: err instanceof Error ? err.message : String(err),
            },
          });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [screensBaseUrl, category, id, key]);

  return loaded && loaded.key === key ? loaded.state : { status: 'loading' };
}

export function ScreenPage({ screensBaseUrl }: { screensBaseUrl: string }) {
  const { category, id } = useParams<{ category: string; id: string }>();
  const [searchParams] = useSearchParams();
  const services = useServices();
  const state = useScreenDocument(screensBaseUrl, category, id);

  // Every ?NAME=value query parameter is a macro value.
  const macros = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, value] of searchParams.entries()) out[name] = value;
    return out;
  }, [searchParams]);

  const resolveScreen = useMemo(
    () =>
      state.status === 'ready' ? makeResolveScreen(screensBaseUrl, state.entry.path) : undefined,
    [screensBaseUrl, state]
  );
  const resolveAsset = useMemo(
    () =>
      state.status === 'ready' ? makeResolveAsset(screensBaseUrl, state.entry.path) : undefined,
    [screensBaseUrl, state]
  );

  const title = state.status === 'ready' ? state.screen.metadata.title : 'Canopy Screens';

  return (
    <div className="viewer-page">
      <AppHeader title={title}>
        <Link className="viewer-back" to="/">
          All screens
        </Link>
      </AppHeader>
      <main className="viewer-content viewer-content--screen">
        {state.status === 'loading' && <p className="viewer-loading">Loading screen…</p>}
        {state.status === 'error' && <ErrorPanel title={state.title} detail={state.detail} />}
        {state.status === 'ready' && (
          <ScreenErrorBoundary screenId={state.screen.id}>
            <PVServiceProvider service={services.pv}>
              <FormulaSubscriberContext.Provider value={services.formulas}>
                <div className="viewer-canvas">
                  <ScreenRenderer
                    screen={state.screen}
                    macros={macros}
                    resolveScreen={resolveScreen}
                    resolveAsset={resolveAsset}
                  />
                </div>
              </FormulaSubscriberContext.Provider>
            </PVServiceProvider>
          </ScreenErrorBoundary>
        )}
      </main>
    </div>
  );
}

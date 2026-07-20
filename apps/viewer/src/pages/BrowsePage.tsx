// Browse/search over the content manifest: title/category/id filter, link cards.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from '@carbon/react';
import { AppHeader } from '@slaclab/canopy-shell';
import type { Manifest, ManifestScreen } from '../api.js';
import { fetchManifest } from '../api.js';
import { ErrorPanel } from '../ErrorPanel.js';

function matches(entry: ManifestScreen, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    entry.title.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q) ||
    entry.id.toLowerCase().includes(q)
  );
}

function ScreenCard({ entry }: { entry: ManifestScreen }) {
  const body = (
    <>
      <span className="screen-card__title">{entry.title}</span>
      <span className="screen-card__meta">
        {entry.category} / {entry.id}
      </span>
      {entry.kind !== 'ir' && (
        <span className="screen-card__note">code screen — not yet viewable</span>
      )}
    </>
  );

  if (entry.kind !== 'ir') {
    return <div className="screen-card screen-card--disabled">{body}</div>;
  }
  return (
    <Link
      className="screen-card"
      // Encode each segment but keep slashes as separators so the splat route matches.
      to={`/s/${encodeURIComponent(entry.category)}/${entry.id
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`}
    >
      {body}
    </Link>
  );
}

export function BrowsePage({ screensBaseUrl }: { screensBaseUrl: string }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchManifest(screensBaseUrl).then(
      (m) => {
        if (!cancelled) setManifest(m);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [screensBaseUrl]);

  const visible = useMemo(
    () => (manifest?.screens ?? []).filter((entry) => matches(entry, query)),
    [manifest, query]
  );

  return (
    <div className="viewer-page">
      <AppHeader title="Canopy Screens" />
      <main className="viewer-content">
        {error && <ErrorPanel title="Could not load the screen manifest" detail={error} />}
        {!error && !manifest && <p className="viewer-loading">Loading manifest…</p>}
        {manifest && (
          <>
            <Search
              id="screen-search"
              labelText="Search screens"
              placeholder="Filter by title, category, or id"
              value={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            />
            <div className="screen-card-grid">
              {visible.map((entry) => (
                <ScreenCard key={`${entry.category}/${entry.id}`} entry={entry} />
              ))}
              {visible.length === 0 && <p>No screens match “{query}”.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

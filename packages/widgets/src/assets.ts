// Asset URL resolution for widgets that reference external files by name
// (today: ScreenImage's `filename`).
//
// Screen documents record asset references as the filename found in the
// source file, not as a fetchable URL — only the composition root knows
// where assets are actually served from. It provides a resolver through
// this context; the default is identity, for filenames that already are
// URLs (and for hosts like the builder that don't resolve assets).

import { createContext, useContext } from 'react';

/** Maps an asset reference (e.g. an image filename) to a fetchable URL. */
export type ResolveAsset = (ref: string) => string;

const identity: ResolveAsset = (ref) => ref;

export const AssetResolverContext = createContext<ResolveAsset>(identity);

/** The asset resolver provided by the composition root (identity if none). */
export function useResolveAsset(): ResolveAsset {
  return useContext(AssetResolverContext);
}

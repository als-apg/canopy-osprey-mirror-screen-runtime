# canopy-screen-runtime

Runs the screens built with
[canopy-screen-builder](https://github.com/slaclab/canopy-screen-builder):
Screen IR, React renderer, widget set, and the operator-facing viewer.

Content (the screens themselves) lives in
[canopy-screens](https://github.com/slaclab/canopy-screens); live data comes
from [Canopy](https://github.com/slaclab/Canopy) through the
[canopy-sdk-js](https://github.com/slaclab/canopy-sdk-js) packages.

## Workspace

| Package                                              | Purpose                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`@slaclab/canopy-screen-ir`](packages/screen-ir)    | Canonical Screen IR — types, JSON Schema, `validate()` (ported verbatim from the builder; frozen contract) |
| [`@slaclab/canopy-screen-widgets`](packages/widgets) | Carbon PV widgets, drawing primitives, and the widget registry shared by builder and runtime               |
| [`@slaclab/canopy-screen-runtime`](packages/runtime) | `ScreenRenderer` — macros, embedded screens, per-widget containment, and Fox-compiled widget rules         |
| [`@slaclab/canopy-screen-codegen`](packages/codegen) | `generateTSX` — ejectable React code from screen models (generation direction only)                        |
| [`viewer`](apps/viewer)                              | **Canopy Screens** — browse `/` and deep-link `/s/:category/:id?MACRO=value` over canopy-screens content   |

## Development

Requires [pnpm](https://pnpm.io) (see `packageManager` in package.json).

```bash
pnpm install        # see the TEMPORARY overrides note below
pnpm build          # tsc builds every package, vite builds the viewer
pnpm test           # build + vitest across the workspace
pnpm lint           # eslint
pnpm format:check   # prettier
pnpm typecheck      # build + tsc --noEmit everywhere (includes tests)
pnpm dev            # = pnpm --filter viewer dev
```

The viewer's [README](apps/viewer/README.md) documents pointing
`VITE_SCREENS_BASE_URL` at a locally served canopy-screens checkout for the
end-to-end smoke test.

## TEMPORARY: linked SDK packages

The `@slaclab/canopy-client` / `canopy-react` / `canopy-shell` dependencies
are declared with their real `^0.1.0` ranges, but those packages are **not
published yet**. Until they are, `pnpm-workspace.yaml` carries a
clearly-marked TEMPORARY `overrides` block linking them from a sibling
`../canopy-sdk-js` checkout (build it first: `pnpm install && pnpm build`
there), and the viewer's vite config pins react/carbon deduplication for the
linked copies. Consequences:

- local install/build/test work against the sibling checkout;
- **CI cannot pass `pnpm install` until the SDK publishes to GitHub
  Packages** — the workflows note this and are expected red until then;
- the overrides block (and the mirror note in the root package.json) is
  removed before merge once the SDK is published.

`.npmrc` already routes the `@slaclab` scope to
`https://npm.pkg.github.com` for the day that happens.

## Documentation

`docs/` is a [zensical](https://zensical.org) site published by the
`gh-pages` workflow (`uv run zensical serve` locally, with
[uv](https://docs.astral.sh/uv/)).

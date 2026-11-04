# Canopy Screens (viewer)

The operator-facing viewer for [canopy-screens](https://github.com/slaclab/canopy-screens)
content: browse the screen manifest, deep-link into a screen, and run it live.

## Routes

| Route              | Purpose                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `/`                | Browse the screen manifest                                                 |
| `/s/:category/:id` | Render one IR screen with its header; every `?NAME=value` param is a macro |

Screens whose manifest `kind` is not `ir` (wrapper/code screens) get an
explicit "not yet viewable" card/page. Documents whose `schemaVersion` does
not match `@slaclab/canopy-screen-ir`'s `SCHEMA_VERSION` get an explicit
error page — never a blank screen. Each screen renders inside its own error
boundary, and each widget inside the screen has another one.

`?render=edm|carbon` on a screen URL is reserved (not a macro): it selects the
render mode for that page, overriding `renderMode` in `config.json`. `edm`
presents alarms and text the way the legacy EDM display did — alarm-sensitive
values recoloured with EDM's alarm colours, EDM's disconnected outline, flush
text — on Carbon widget chrome; `carbon` shows severity pills and Carbon
paddings.

## Configuration (`config.json`)

The viewer reads its configuration at runtime from `config.json`, fetched
relative to the page (`document.baseURI`), so one build (`base: './'`) serves
under any mount path. Nothing is baked in at build time. In a deployment
`canopy_mcp` serves this file; there is no Canopy base URL and no API key in
it — the viewer talks to the origin that serves it.

| Key             | Default | Meaning                                                                                                  |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `pvMode`        | `hare`  | `mock` = simulated PVs, rules inert · `hare` = live Canopy. A missing or unknown value means `hare`      |
| `renderMode`    | `edm`   | `edm` (alarms and text as the legacy EDM display drew them) · `carbon` (severity pills, Carbon paddings) |
| `screensPath`   | `.`     | Where the canopy-screens content (`manifest.json` + `screens/**`) lives, relative to the app             |
| `themes`        | `{}`    | Theme id → `light` \| `dark`; other values are ignored                                                   |
| `colorScheme`   | bundled | Flattened color scheme (screen-ir `FlatScheme`); an invalid value falls back to the bundled default      |
| `backend`       | absent  | Hare mode: the data backend's identity `{ name, label, notice }`, or `null` when it was unreachable      |
| `binding`       | absent  | Hare mode: the data backend's binding id, or `null`. Seeds the backend badge with `backend`              |
| `confirmWrites` | `true`  | Hare mode: ask before every machine write; only a literal `false` turns it off                           |

The parse rules for each key are in the header of `src/config.ts`.

```json
{ "pvMode": "hare", "screensPath": "screens", "themes": { "vacuum-system": "dark" } }
```

When `config.json` is missing or does not parse (e.g. under `vite dev`, where
no `canopy_mcp` is running), the viewer falls back to
`{ "pvMode": "mock", "screensPath": ".", "themes": {} }`.

`src/services.ts` is the composition root: `mock` builds a `MockPVService`
(no Formula Engine — rules stay at their base values), `hare` builds
`HarePVService` plus the SDK's Formula Engine service wrapped in the runtime's
formula-subscriber adapter.

## Local dev against a canopy-screens checkout (smoke test)

```bash
# 1. serve the content repo (any static server with CORS works)
cd ../canopy-screens        # your checkout of slaclab/canopy-screens
npx serve --cors -l 8123 .

# 2. point the viewer at it (mock PVs; served from apps/viewer/public/)
cd ../canopy-screen-runtime
mkdir -p apps/viewer/public
echo '{"pvMode": "mock", "screensPath": "http://localhost:8123"}' > apps/viewer/public/config.json

# 3. run the viewer (from the workspace root)
pnpm --filter viewer dev
```

Then open the printed URL: the landing page lists `Vacuum System`, and the
deep link `/s/examples/vacuum-system?PREFIX=XX00:9` renders the screen with
mock data and the `PREFIX` macro overridden. (This flow is manual; the same
paths are covered by the vitest component tests in `src/App.test.tsx`.)

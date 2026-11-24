# `@slaclab/canopy-screen-runtime`

Renders canonical Screen IR documents (`@slaclab/canopy-screen-ir`) as live
React screens.

```tsx
import { ScreenRenderer } from '@slaclab/canopy-screen-runtime';

<ScreenRenderer
  screen={screenJson}
  macros={{ PREFIX: 'DEMO:VAC1' }}
  resolveScreen={(ref) => fetch(base + ref).then((r) => r.json())}
/>;
```

What the renderer does:

- **Geometry** — absolute IR coordinates; children nest inside their parent
  with the parent origin subtracted; z-order is `children` array order.
- **Macros** — screen-declared defaults ⊕ caller values, substituted across
  ALL string props (`${NAME}` canonical, `$(NAME)` legacy); embedded screens
  get parent macros ⊕ the node's `macros` overrides (child defaults weakest).
  Unresolved macros stay visible verbatim.
- **Widgets** — instantiated through the `@slaclab/canopy-screen-widgets`
  registry via an IR→registry mapping; unknown/unregistered types become
  labeled placeholder boxes; every widget sits in its own error boundary.
- **Clickable areas** — a node carrying `actions` runs them on a click. It
  shows a pointer cursor and, while hovered, an accent tint and outline with
  its optional `hoverLabel`. The pointer meets the node on its box (the box
  turned by `rotation`, if any). A `polygon` can be met on its drawn shape
  instead, so that a band along an arc or a bent line is one area, not a row
  of boxes:

  | Polygon prop   | Value                                                                                                                                                                                                                        |
  | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `hitArea`      | `"shape"`: a closed polygon is met over its inside and its outline, an open one (`closed: false`) along its path. The node's box takes no pointer events, so what lies under its corners stays reachable. Absent: the box.   |
  | `hitWidth`     | Open polygons: the width of the path the pointer meets, in authored px, round at ends and bends. Default: `lineWidth`, at least 12. Never less than `lineWidth`.                                                             |
  | `hoverLabelAt` | `[x, y]` in the node's own coordinates (as `points`): where the hover label is centred. Default: half way along an open path; the centroid of a convex polygon; else a point well inside the shape, at the middle of a band. |

  Hovering such a node highlights the shape itself and shows one label, kept
  upright whatever turns the node and kept inside the screen. Where shapes
  overlap, the later node in `children` is met. A polygon with `hitArea` but
  no `actions` (and no `device`) takes no pointer events at all.

- **Hover groups** — one thing drawn as many nodes (a coil as two polygons,
  an ellipse and a row in a list) hovers as one. Three props, on any node
  type:

  | Prop              | Value                                                                                                                                                                                                                                                                                                                          |
  | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `hoverGroups`     | `string[]`, group names from narrow to wide: `["coil-4", "circuit-main"]`. While the pointer is on such a node, every node whose `hoverGroups` holds its **first** name is highlighted as a hovered clickable area is, and every other node that holds one of its **further** names gets the same highlight at lower strength. |
  | `hoverDimGroup`   | `string`, the name of the drawing the node is a part of. While the hovered node carries `hoverGroups` and the same `hoverDimGroup`, the nodes of that drawing with neither highlight are drawn at reduced opacity. Absent: nothing is dimmed.                                                                                  |
  | `hoverLabelLines` | A list of short lines for the hover label, under the `hoverLabel` if there is one. A line is `{ "text": "…" }` or `{ "label": "Current", "pv": "DEV:1:Current", "precision": 2 }`: the channel's live value, as `label: value`. `label`, `precision` and `showUnits` are optional.                                             |

  A node with `hoverGroups` takes the pointer whether it has `actions` or
  not: on its box, or a polygon with `hitArea: "shape"` on its shape. Only a
  node with `actions` shows the pointer cursor, and a click runs the actions
  of the node it lands on, as before. The highlight follows the node: the
  shape of a polygon met on its shape, the ellipse of an `ellipse`, else the
  box, which on a `text-label` tints the row. One label shows, that of the
  node the pointer is on. Names are matched over the whole rendered screen,
  embedded screens included, after macro substitution: a macro in a name
  (`"${DEV}-coil"`) keeps the instances of an embedded screen apart. Put
  `hoverDimGroup` on the parts, not on a container around them: a dimmed
  container dims everything in it.

  A value line is formatted as a text readout formats it: with `precision`,
  that many decimals and the channel's unit (`"showUnits": false` leaves the
  unit out); without, the channel's own text (its precision, unit or enum
  label). A channel that is not connected shows `---`. The channels of a
  label are subscribed only while the label shows, starting from the value
  the screen already holds; they are no part of the node's own channels (no
  `data-pv`, no disconnected cue, not in `collectScreenPVs`). The lines show
  on a node that hovers: one with `actions` or with `hoverGroups` (a group
  of one will do). Such a label is drawn over the nodes that follow its own
  and is kept inside the screen. On a polygon met on its shape a tall label
  covers the part unless `hoverLabelAt` moves it; the point may lie outside
  the shape.

  ```json
  [
    {
      "id": "coil-4-upper",
      "type": "polygon",
      "geometry": { "x": 80, "y": 60, "width": 100, "height": 40 },
      "props": {
        "points": [
          { "x": 0, "y": 0 },
          { "x": 100, "y": 0 },
          { "x": 100, "y": 40 },
          { "x": 0, "y": 40 }
        ],
        "hitArea": "shape",
        "hoverGroups": ["coil-4", "circuit-main"],
        "hoverDimGroup": "magnet",
        "hoverLabel": "Coil 4",
        "hoverLabelAt": [50, -50],
        "hoverLabelLines": [
          { "text": "Main circuit" },
          { "label": "Current", "pv": "DEV:1:Current", "precision": 2 },
          { "label": "State", "pv": "DEV:1:State" }
        ]
      }
    },
    {
      "id": "coil-4-lower",
      "type": "polygon",
      "geometry": { "x": 80, "y": 180, "width": 100, "height": 40 },
      "props": {
        "points": [
          { "x": 0, "y": 0 },
          { "x": 100, "y": 0 },
          { "x": 100, "y": 40 },
          { "x": 0, "y": 40 }
        ],
        "hitArea": "shape",
        "hoverGroups": ["coil-4", "circuit-main"],
        "hoverDimGroup": "magnet"
      }
    },
    {
      "id": "coil-4-row",
      "type": "text-label",
      "geometry": { "x": 400, "y": 60, "width": 200, "height": 24 },
      "props": { "text": "Coil 4", "hoverGroups": ["coil-4", "circuit-main"] }
    }
  ]
  ```

- **Embedded screens** — resolved through the caller's `resolveScreen`, with
  a depth cap and a ref-chain cycle guard; schema-version-gated.
- **Rules** — compiled client-side to Formula Engine `FormulaSpec`s at
  subscription time (`compileRule`): a condition/value ladder becomes ONE
  nested Python conditional expression
  (`v0 if (c0) else (v1 if (c1) else (default))`), `formula://` references are
  inlined (the Formula Engine rejects formula-of-formula bindings), macros in
  PV bindings resolve before subscribing. Outputs patch the target property
  reactively with precedence `base props < rule output`; `visible` composes by
  AND. The renderer stays service-agnostic: provide a `FormulaSubscriber` via
  `FormulaSubscriberContext` — the SDK's Formula Engine service fits through
  `createFormulaEngineSubscriber`.
- **Formulas over many channels** — a scalar formula may hold a vector token:
  `{*}` is every binding of the formula, `{g.*}` the bindings whose key starts
  with `g.` (`max(severity({*}))`, `nanmax(abs({set.*} - {read.*}))`). Its
  bindings all stay in the spec; inlined into a rule the token is namespaced
  like the keys (`{worst.*}`). A rule condition may apply `severity({N})` or
  `connected({N})` to a plain channel, not to a `formula://` reference, and
  takes no vector token itself: a rule reaches a roll-up through
  `formula://<name>`. `label({N})` is the enum string of a channel's value,
  under the same rule. The in-page evaluator (`loc://` formulas, fixture mode)
  answers such a formula as the server does (the cases in
  `src/rules/__fixtures__/formula-vector-cases.json` hold both to one
  behaviour), without the server's pacing: it evaluates on every change. A
  result carries a summary of the members (`vectorInputs`: how many, which
  have no value); the node the formula feeds shows it on hover when it takes
  the pointer. An error names the inputs it failed on: `PVs not available` for
  inputs with no sample or a lost connection, `PVs without a number` for
  connected inputs whose sample is no number (NaN, text, an array, empty). `nanmax`, `nanmin`, `nanmean` and `nansum` leave out members without a
  number, but with no member left they do not answer: the formula fails with
  `input_missing`, also inside a comparison or a conditional (`count` still
  answers, with the number of members). A roll-up light is still best written with `severity()` and
  `connected()`, which count a missing member as INVALID. A node never shows a better
  state than its formula stands behind: before the first result it draws its authored props; after any
  error, or with no answer within `formulaStartTimeoutMs()` (3 s), a rule
  gives no output, the node draws the disconnected cue, and the hover says
  what failed. A colour such a rule drives (a property named `...Color`,
  `color` or `background`) is then drawn in the viewer's own no-state colour,
  the token of the disconnected look (`--pydm-alarm-disconnected`, the
  scheme's `DISCONNECTED` role), whatever the screen authored: the authored
  colour shows only while the node waits for its first result. A colour
  drawn on top of another (the property `color`, or one with `foreground`,
  `text` or `font` in its name) takes the theme's `Text` role instead, so that
  text on a no-state background stays readable. On a no-state fill the cue is
  drawn in the `Text` role too, so that it stands out. A result
  whose value is null gives no output either, and a colour its rule drives is
  the no-state colour too.
- **Formula channels** — a widget channel prop bound to `formula://<name>` (a
  converted EDM `CALC\` / PyDM `calc://` channel) reads the rendering
  screen's `formulas[]` entry, its bindings macro-resolved with that screen's
  effective macros (embedded screens use their own formulas and macros). Each
  screen wraps the PV context in a `ScreenPVService` that evaluates the
  formula through the same `FormulaSubscriber` as rules and feeds widgets
  value, severity and connected state; other addresses pass through to the
  enclosing PV service. Formula channels are read-only (writes are rejected);
  unknown names, non-scalar kinds and Formula Engine errors show as disconnected
  with a console warning. Without the Formula Engine (mock mode) they stay
  disconnected, except formulas over `loc://` locals only, which evaluate in
  the page.

Live PV data is consumed by the widgets through `@slaclab/canopy-react`
context; the composition root chooses the concrete services.

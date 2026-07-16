# `@slaclab/canopy-screen-codegen`

Generates ejectable, human-readable React TSX from a screen model
(`generateTSX`) — the generation direction of canopy-screen-builder's
eject/round-trip pair. Parsing (`parseTSX`) stays in the builder.

Generated code imports the real packages:

```tsx
import { usePV } from '@slaclab/canopy-react';
import type { ScreenProps } from '@slaclab/canopy-screen-runtime';
import { Screen } from '@slaclab/canopy-screen-runtime';
import { PVTextDisplay, Rectangle, Group } from '@slaclab/canopy-screen-widgets';
```

(The `Screen` runtime component and `ScreenProps` type are the emission
targets for ejected apps; they land with the eject workflow.)

The input `ScreenModel` here is the subset of the builder's editor model that
generation consumes — the builder's full model is structurally assignable.

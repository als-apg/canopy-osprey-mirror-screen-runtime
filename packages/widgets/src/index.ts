// @slaclab/canopy-screen-widgets — Carbon PV widgets, drawing primitives, and
// the widget registry.

// DisplayFormat is a merged value+type export (const object + type alias of
// the same name); re-exporting it via plain `export {}` already carries both
// facets, so it must not also appear in the `export type {}` list below
// (TypeScript rejects that as a duplicate identifier).
export { WIDGET_CATALOG, ALL_WIDGET_TYPES, DisplayFormat } from './types.js';
export type {
  RuleExpression,
  RulePV,
  Rule,
  Action,
  LayoutMode,
  Position,
  Size,
  AbsoluteLayout,
  WidgetType,
  WidgetProps,
} from './types.js';

export { alarmColor, alarmBorderColor, alarmBorderStyle } from './alarm.js';

export { widgetRegistry } from './registry/WidgetRegistry.js';
export type {
  WidgetDefinition,
  PropSchema,
  WidgetRendererProps,
} from './registry/WidgetRegistry.js';

export { registerBuiltinWidgets } from './registry/registerBuiltins.js';

export {
  CarbonPVTextDisplay,
  CarbonPVTextInput,
  CarbonPVButton,
  CarbonPVSlider,
  CarbonPVToggle,
  CarbonPVProgressBar,
  CarbonPVLed,
  CarbonPVDropdown,
  CarbonPVCheckbox,
  CarbonPVByteIndicator,
} from './pv-wrappers/CarbonWidgets.js';

export { ArcWidget } from './drawing/ArcWidget.js';
export { LineWidget } from './drawing/LineWidget.js';
export { ScreenImageWidget } from './drawing/ScreenImageWidget.js';

export { useFitText, computeFitFontSize, MIN_FONT_SIZE } from './shared/useFitText.js';
export type { UseFitTextResult } from './shared/useFitText.js';

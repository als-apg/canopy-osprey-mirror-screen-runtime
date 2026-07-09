// @slaclab/canopy-screen-runtime — renders Screen IR documents with live
// PV widgets, macro resolution, embedded screens, and Fox-compiled rules.

export { ScreenRenderer } from './render/ScreenRenderer.js';
export type { ScreenRendererProps, ResolveScreen } from './render/ScreenRenderer.js';
export { mapIRWidget } from './render/irMap.js';
export type { MappedWidget } from './render/irMap.js';

export {
  substituteMacros,
  substituteDeep,
  substituteProps,
  resolveScreenMacros,
  childMacros,
  hasMacro,
} from './macros.js';

export { FOX_PREFIX, isFoxRef, foxName } from './foxRef.js';

export type {
  FormulaKind,
  FormulaSpec,
  FormulaScalarValue,
  FormulaSubscribeOptions,
  FormulaSubscriber,
} from './formula.js';
export { FormulaSubscriberContext, useFormulaSubscriber } from './formula.js';

export { createFoxFormulaSubscriber } from './rules/foxAdapter.js';
export type { FoxServiceLike } from './rules/foxAdapter.js';

export {
  compileRule,
  compileFormulaSpec,
  toWireExpression,
  RuleCompileError,
} from './rules/compileRule.js';
export type { CompiledRule, RuleScalar } from './rules/compileRule.js';
export { applyRuleOutputs } from './rules/applyRules.js';
export type { EffectiveNode } from './rules/applyRules.js';
export { useWidgetRules } from './rules/useWidgetRules.js';

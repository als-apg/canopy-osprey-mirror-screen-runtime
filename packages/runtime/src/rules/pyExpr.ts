// Minimal evaluator for the Formula Engine expression subset (sandboxed Python
// expressions) so formulas whose inputs are all CLIENT-side (loc:// locals)
// can evaluate without a server round-trip. Mirrors what compileRule emits:
// nested conditionals (`a if c else b`), and/or/not, comparisons, arithmetic,
// `{token}` placeholders, literals, and a small math-function namespace.
//
// Formulas over many channels evaluate here too, as on the server: a vector
// token (`{*}`: every binding; `{g.*}`: the bindings whose key starts with
// `g.`, ordered by key) is a vector of numbers, arithmetic and comparisons
// work member by member, a reduction (`max`, `sum`, `count_nonzero`, the
// `nan*` forms, ...) gives one value, and `severity({x})` / `connected({x})`
// read a channel's status, `label({x})` the enum string of its value. The
// caller passes the status and the enum strings of each binding.
//
// This is NOT a general Python evaluator — anything outside the subset
// throws PyExprError and the caller downgrades to a warning (same contract
// as Formula Engine-side validation failures).

export class PyExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PyExprError';
  }
}

export type PyValue = number | string | boolean | null;

/** A binding's status, for `severity()`, `connected()` and `label()`. */
export interface PyStatus {
  /** 0 NO_ALARM, 1 MINOR, 2 MAJOR, 3 INVALID. */
  readonly severity: number;
  /** Whether the channel is connected and has a sample. */
  readonly connected: boolean;
  /** The channel's enum strings, by value; absent when it has none. */
  readonly labels?: readonly string[] | undefined;
}

/** A vector token's value, or a member-by-member result. `bool`: of a comparison. */
class Vec {
  readonly data: readonly number[];
  readonly bool: boolean;
  /** The vector tokens whose values it holds (none: of status functions only). */
  readonly tokens: readonly string[];
  constructor(data: readonly number[], bool = false, tokens: readonly string[] = []) {
    this.data = data;
    this.bool = bool;
    this.tokens = tokens;
  }
}

/**
 * The vector tokens of the running evaluation whose values met a use that
 * does not leave a member without a number out. A use is guarded only when
 * the values go straight into `nanmax`, `nanmin`, `nansum`, `nanmean` or
 * `count`, through nothing but `+ - * /`, a sign, and a function of one
 * number. Every other use (a comparison, another reduction, `where`, `clip`,
 * a power, a condition) is unguarded: there a member without a number would
 * pass for one. Decided by the expression alone: collected in a dry run over
 * stand-in values, in which a value of the wrong kind stops nothing.
 */
let unguarded: Set<string> | null = null;

function unguard(...values: readonly Val[]): void {
  for (const v of values) {
    if (v instanceof Vec) for (const token of v.tokens) unguarded?.add(token);
  }
}

/**
 * The vector tokens of the running dry run whose values go into `nanmax`,
 * `nanmin`, `nansum` or `nanmean`: such a reduction has nothing to answer
 * with when no member of the token has a number.
 */
let reduced: Set<string> | null = null;
const NAN_REDUCTIONS = new Set(['nanmax', 'nanmin', 'nansum', 'nanmean']);

const GUARDED_REDUCTIONS = new Set(['nanmax', 'nanmin', 'nansum', 'nanmean', 'count']);
const GUARDED_FUNCTIONS = new Set(
  'abs sqrt exp log log10 ln floor ceil radians degrees sin cos tan asin acos atan sinh cosh tanh'.split(
    ' '
  )
);

type Val = PyValue | Vec;

const STATUS_FUNCTIONS = new Set(['severity', 'connected', 'label']);
const NO_STATUS: PyStatus = { severity: 3, connected: false };

/**
 * The key prefix a vector token covers ('' for `*`), or null for a plain
 * token. A token that is itself a binding key is always plain.
 */
function vectorPrefix(token: string, has: (key: string) => boolean): string | null {
  if (has(token)) return null;
  if (token === '*') return '';
  return token.endsWith('.*') ? token.slice(0, -1) : null;
}

/** The members of a vector token under `prefix`, ordered by key as text. */
function membersOf(prefix: string, keys: Iterable<string>): string[] {
  return [...keys]
    .filter((key) => key.startsWith(prefix))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A member's number: NaN when it has none. Text is never a number for a
 * member, numeric text too; nor is null (no sample, or one that is not one value).
 */
export function memberNumber(value: PyValue | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return NaN;
}

type TokenType = 'num' | 'str' | 'name' | 'binding' | 'op';

interface Token {
  type: TokenType;
  text: string;
}

const OPS = [
  '**',
  '==',
  '!=',
  '<=',
  '>=',
  '//',
  '(',
  ')',
  ',',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
] as const;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '{') {
      const end = source.indexOf('}', i);
      if (end === -1) throw new PyExprError('unterminated {token}');
      tokens.push({ type: 'binding', text: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\' && j + 1 < source.length) {
          const esc = source[j + 1]!;
          text += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          j += 2;
        } else {
          text += source[j];
          j += 1;
        }
      }
      if (j >= source.length) throw new PyExprError('unterminated string');
      tokens.push({ type: 'str', text });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(c) && /[0-9]/.test(source.slice(i).replace('.', '')[0] ?? '')) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(source.slice(i));
      if (m) {
        tokens.push({ type: 'num', text: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(i))!;
      tokens.push({ type: 'name', text: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      tokens.push({ type: 'op', text: op });
      i += op.length;
      continue;
    }
    throw new PyExprError(`unexpected character '${c}'`);
  }
  return tokens;
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  max: (...a) => Math.max(...a),
  min: (...a) => Math.min(...a),
  abs: (a) => Math.abs(a!),
  sqrt: (a) => Math.sqrt(a!),
  floor: (a) => Math.floor(a!),
  ceil: (a) => Math.ceil(a!),
  round: (a) => Math.round(a!),
  exp: (a) => Math.exp(a!),
  log: (a) => Math.log(a!),
  log10: (a) => Math.log10(a!),
  pow: (a, b) => Math.pow(a!, b!),
  sin: (a) => Math.sin(a!),
  cos: (a) => Math.cos(a!),
  tan: (a) => Math.tan(a!),
  asin: (a) => Math.asin(a!),
  acos: (a) => Math.acos(a!),
  atan: (a) => Math.atan(a!),
  atan2: (a, b) => Math.atan2(a!, b!),
} as Record<string, (...args: number[]) => number>;

function truthy(value: Val): boolean {
  if (value instanceof Vec) {
    unguard(value);
    if (unguarded) return false;
    throw new PyExprError(
      'and, or, not and the conditional need one value, not a vector; reduce it first'
    );
  }
  if (value === null || value === false) return false;
  if (value === 0 || value === '') return false;
  return true;
}

function asNumber(value: Val, context: string): number {
  if (value instanceof Vec) {
    unguard(value);
    if (unguarded) return NaN;
    throw new PyExprError(`${context} needs one value, not a vector; reduce it first`);
  }
  if (unguarded) return typeof value === 'number' ? value : NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new PyExprError(`${context} needs a number, got ${JSON.stringify(value)}`);
}

/** `v` as a read of member `i` of a vector of `size`: its member, or its one number. */
function spread(v: Val, size: number, context: string): (i: number) => number {
  if (v instanceof Vec) {
    if (v.data.length !== size) {
      if (unguarded) return () => NaN;
      throw new PyExprError(`${context}: vectors of ${size} and ${v.data.length} members`);
    }
    return (i) => v.data[i]!;
  }
  const n = asNumber(v, context);
  return () => n;
}

/** `f` member by member over operands of which at least one is a vector. */
function lift(
  operands: readonly Val[],
  context: string,
  f: (...members: number[]) => number,
  { bool = false, guarded = false }: { bool?: boolean; guarded?: boolean } = {}
): Vec {
  if (!guarded) unguard(...operands);
  const size = operands.find((v) => v instanceof Vec)!.data.length;
  const reads = operands.map((v) => spread(v, size, context));
  return new Vec(
    Array.from({ length: size }, (_, i) => f(...reads.map((read) => read(i)))),
    bool,
    [...new Set(operands.flatMap((v) => (v instanceof Vec ? v.tokens : [])))]
  );
}

const hasNaN = (data: readonly number[]) => data.some((v) => Number.isNaN(v));
const present = (data: readonly number[]) => data.filter((v) => !Number.isNaN(v));
const total = (data: readonly number[]) => data.reduce((sum, v) => sum + v, 0);

function variance(data: readonly number[]): number {
  const mean = total(data) / data.length;
  return total(data.map((v) => (v - mean) ** 2)) / data.length;
}

/** Reductions of a vector to one number. */
const REDUCTIONS: Record<string, (data: readonly number[]) => number> = {
  max: (d) => (hasNaN(d) ? NaN : Math.max(...d)),
  min: (d) => (hasNaN(d) ? NaN : Math.min(...d)),
  sum: total,
  mean: (d) => total(d) / d.length,
  // Population variance and standard deviation, as numpy's defaults.
  var: variance,
  std: (d) => Math.sqrt(variance(d)),
  ptp: (d) => (hasNaN(d) ? NaN : Math.max(...d) - Math.min(...d)),
  count: (d) => d.length,
  count_nonzero: (d) => d.filter((v) => v !== 0).length,
  nanmax: (d) => (present(d).length === 0 ? NaN : Math.max(...present(d))),
  nanmin: (d) => (present(d).length === 0 ? NaN : Math.min(...present(d))),
  nansum: (d) => total(present(d)),
  nanmean: (d) => total(present(d)) / present(d).length,
};
/** Reductions that keep a comparison's truth value (`max({*} > 3)` is true or false). */
const KEEPS_BOOL = new Set(['max', 'min', 'nanmax', 'nanmin']);
/** Reductions that only a vector has; on one value they see one member. */
const VECTOR_ONLY = new Set(Object.keys(REDUCTIONS).filter((n) => n !== 'max' && n !== 'min'));

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  private readonly bindings: ReadonlyMap<string, PyValue>;
  private readonly status: ReadonlyMap<string, PyStatus> | undefined;

  constructor(
    tokens: Token[],
    bindings: ReadonlyMap<string, PyValue>,
    status?: ReadonlyMap<string, PyStatus>
  ) {
    this.tokens = tokens;
    this.bindings = bindings;
    this.status = status;
  }

  /** The value of `{token}`: a binding's, or the vector of a vector token's members. */
  private read(token: string): Val {
    if (this.bindings.has(token)) return this.bindings.get(token)!;
    const prefix = vectorPrefix(token, (key) => this.bindings.has(key));
    const members = prefix === null ? [] : membersOf(prefix, this.bindings.keys());
    if (members.length === 0) throw new PyExprError(`unbound token {${token}}`);
    return new Vec(
      members.map((key) =>
        this.status && !(this.status.get(key) ?? NO_STATUS).connected
          ? NaN
          : memberNumber(this.bindings.get(key))
      ),
      false,
      [token]
    );
  }

  /** `severity({token})` or `connected({token})`, after the name and `(`. */
  private statusCall(name: string): Val {
    const t = this.peek();
    const close = this.tokens[this.pos + 1];
    if (!t || t.type !== 'binding' || !close || close.type !== 'op' || close.text !== ')') {
      throw new PyExprError(`${name}() takes exactly one {token}`);
    }
    this.pos += 2;
    if (name === 'label') return this.label(t.text);
    const one = (key: string): number => {
      const s = this.status?.get(key) ?? NO_STATUS;
      if (name === 'connected') return s.connected ? 1 : 0;
      return s.connected ? s.severity : 3;
    };
    if (this.bindings.has(t.text)) return one(t.text);
    const prefix = vectorPrefix(t.text, (key) => this.bindings.has(key));
    const members = prefix === null ? [] : membersOf(prefix, this.bindings.keys());
    if (members.length === 0) throw new PyExprError(`unbound token {${t.text}}`);
    return new Vec(members.map(one));
  }

  /**
   * `label({token})`: the enum string of the channel's value. A value that
   * is text already is its own label; a value the channel has no enum string
   * for (a fraction, a negative number, a boolean), and any value of a channel
   * without enum strings, has the empty one.
   */
  private label(token: string): string {
    if (!this.bindings.has(token)) {
      throw new PyExprError('label() takes exactly one {token} of one channel, not a vector token');
    }
    const value = this.bindings.get(token)!;
    if (typeof value === 'string') return value;
    // A flag is not an index; a fraction and a negative number index nothing.
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return '';
    return this.status?.get(token)?.labels?.[value] ?? '';
  }

  /** A call of a function of the namespace, after the name and `(`. */
  private call(name: string): Val {
    const args: Val[] = [];
    if (!this.takeOp(')')) {
      for (;;) {
        args.push(this.conditional());
        if (this.takeOp(',')) continue;
        if (this.takeOp(')')) break;
        throw new PyExprError(`bad argument list for ${name}()`);
      }
    }
    const first = args[0];
    if (name === 'where') {
      if (args.length !== 3) throw new PyExprError('where() takes a condition and two values');
      unguard(...args);
      if (!args.some((a) => a instanceof Vec)) return truthy(first!) ? args[1]! : args[2]!;
      return lift(args, 'where()', (c, a, b) => (c !== 0 ? a! : b!));
    }
    if (name === 'clip') {
      if (args.length !== 3) throw new PyExprError('clip() takes a value and two bounds');
      const clip = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
      if (args.some((a) => a instanceof Vec)) {
        return lift(args, 'clip()', (x, lo, hi) => (Number.isNaN(x!) ? NaN : clip(x!, lo!, hi!)));
      }
      const [x, lo, hi] = args.map((a) => asNumber(a, 'clip()'));
      return clip(x!, lo!, hi!);
    }
    const reduce = REDUCTIONS[name];
    if (reduce && args.length === 1 && (first instanceof Vec || VECTOR_ONLY.has(name))) {
      if (!GUARDED_REDUCTIONS.has(name)) unguard(first!);
      if (NAN_REDUCTIONS.has(name) && first instanceof Vec) {
        for (const token of first.tokens) reduced?.add(token);
      }
      const data = first instanceof Vec ? first.data : [asNumber(first!, `${name}()`)];
      const value = reduce(data);
      return first instanceof Vec && first.bool && KEEPS_BOOL.has(name) ? value !== 0 : value;
    }
    const fn = FUNCTIONS[name];
    if (!fn) throw new PyExprError(`unknown name '${name}'`);
    if (args.length === 1 && first instanceof Vec) {
      if (!GUARDED_FUNCTIONS.has(name)) unguard(first);
      return new Vec(
        first.data.map((v) => fn(v)),
        false,
        first.tokens
      );
    }
    return fn(...args.map((a) => asNumber(a, `${name}()`)));
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private takeOp(text: string): boolean {
    const t = this.peek();
    if (t && t.type === 'op' && t.text === text) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private takeName(text: string): boolean {
    const t = this.peek();
    if (t && t.type === 'name' && t.text === text) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  parse(): PyValue {
    const value = this.conditional();
    if (this.pos !== this.tokens.length) {
      throw new PyExprError(`trailing input at token ${this.pos}`);
    }
    if (value instanceof Vec) {
      unguard(value);
      if (unguarded) return null;
      throw new PyExprError(
        'a scalar formula must reduce a vector token to one value, e.g. max(...), sum(...), count_nonzero(...)'
      );
    }
    return value;
  }

  // conditional := or ('if' or 'else' conditional)?
  private conditional(): Val {
    const value = this.or();
    if (this.takeName('if')) {
      const cond = this.or();
      if (!this.takeName('else')) throw new PyExprError("conditional missing 'else'");
      const alt = this.conditional();
      unguard(value, alt);
      return truthy(cond) ? value : alt;
    }
    return value;
  }

  private or(): Val {
    let value = this.and();
    while (this.takeName('or')) {
      const rhs = this.and();
      unguard(value, rhs);
      value = truthy(value) ? value : rhs;
    }
    return value;
  }

  private and(): Val {
    let value = this.not();
    while (this.takeName('and')) {
      const rhs = this.not();
      unguard(value, rhs);
      value = truthy(value) ? rhs : value;
    }
    return value;
  }

  private not(): Val {
    if (this.takeName('not')) return !truthy(this.not());
    return this.comparison();
  }

  private comparison(): Val {
    const lhs = this.arith();
    const t = this.peek();
    if (t && t.type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.text)) {
      this.pos += 1;
      const rhs = this.arith();
      if (lhs instanceof Vec || rhs instanceof Vec) {
        const compare: Record<string, (x: number, y: number) => boolean> = {
          '==': (x, y) => x === y,
          '!=': (x, y) => x !== y,
          '<': (x, y) => x < y,
          '<=': (x, y) => x <= y,
          '>': (x, y) => x > y,
          '>=': (x, y) => x >= y,
        };
        const test = compare[t.text]!;
        return lift([lhs, rhs], t.text, (x, y) => (test(x!, y!) ? 1 : 0), { bool: true });
      }
      switch (t.text) {
        case '==':
          return lhs === rhs;
        case '!=':
          return lhs !== rhs;
        case '<':
          return asNumber(lhs, '<') < asNumber(rhs, '<');
        case '<=':
          return asNumber(lhs, '<=') <= asNumber(rhs, '<=');
        case '>':
          return asNumber(lhs, '>') > asNumber(rhs, '>');
        case '>=':
          return asNumber(lhs, '>=') >= asNumber(rhs, '>=');
      }
    }
    return lhs;
  }

  private arith(): Val {
    let value = this.term();
    for (;;) {
      if (this.takeOp('+')) {
        const rhs = this.term();
        if (value instanceof Vec || rhs instanceof Vec) {
          value = lift([value, rhs], '+', (x, y) => x! + y!, { guarded: true });
        } else if (typeof value === 'string' && typeof rhs === 'string') {
          value = value + rhs;
        } else {
          value = asNumber(value, '+') + asNumber(rhs, '+');
        }
      } else if (this.takeOp('-')) {
        value = this.binary(value, this.term(), '-', (x, y) => x - y, true);
      } else {
        return value;
      }
    }
  }

  private term(): Val {
    let value = this.factor();
    for (;;) {
      if (this.takeOp('*')) value = this.binary(value, this.factor(), '*', (x, y) => x * y, true);
      else if (this.takeOp('/'))
        value = this.binary(value, this.factor(), '/', (x, y) => x / y, true);
      else if (this.takeOp('//'))
        value = this.binary(value, this.factor(), '//', (x, y) => Math.floor(x / y));
      else if (this.takeOp('%')) value = this.binary(value, this.factor(), '%', (x, y) => x % y);
      else return value;
    }
  }

  /** `f` of two operands: of their numbers, or member by member. */
  private binary(
    a: Val,
    b: Val,
    context: string,
    f: (x: number, y: number) => number,
    guarded = false
  ): Val {
    if (a instanceof Vec || b instanceof Vec) {
      return lift([a, b], context, (x, y) => f(x!, y!), { guarded });
    }
    return f(asNumber(a, context), asNumber(b, context));
  }

  private factor(): Val {
    if (this.takeOp('+')) return this.binary(this.factor(), 0, 'unary +', (x) => x, true);
    if (this.takeOp('-')) return this.binary(this.factor(), 0, 'unary -', (x) => -x, true);
    return this.power();
  }

  private power(): Val {
    const base = this.atom();
    if (this.takeOp('**')) {
      return this.binary(base, this.factor(), '**', (x, y) => Math.pow(x, y));
    }
    return base;
  }

  private atom(): Val {
    const t = this.peek();
    if (!t) throw new PyExprError('unexpected end of expression');
    if (t.type === 'num') {
      this.pos += 1;
      return Number(t.text);
    }
    if (t.type === 'str') {
      this.pos += 1;
      return t.text;
    }
    if (t.type === 'binding') {
      this.pos += 1;
      return this.read(t.text);
    }
    if (t.type === 'op' && t.text === '(') {
      this.pos += 1;
      const value = this.conditional();
      if (!this.takeOp(')')) throw new PyExprError("missing ')'");
      return value;
    }
    if (t.type === 'name') {
      this.pos += 1;
      if (t.text === 'True') return true;
      if (t.text === 'False') return false;
      if (t.text === 'None') return null;
      const known =
        STATUS_FUNCTIONS.has(t.text) ||
        t.text === 'where' ||
        t.text === 'clip' ||
        t.text in REDUCTIONS ||
        t.text in FUNCTIONS;
      if (known && this.takeOp('(')) {
        return STATUS_FUNCTIONS.has(t.text) ? this.statusCall(t.text) : this.call(t.text);
      }
      throw new PyExprError(`unknown name '${t.text}'`);
    }
    throw new PyExprError(`unexpected token '${t.text}'`);
  }
}

/**
 * Evaluate a Formula Engine wire expression against `{token}` binding values.
 * `status` gives each binding's status for `severity()` and `connected()`; a
 * binding without one, or not connected, reads as severity 3, not connected,
 * and as a vector member has no number.
 */
export function evaluatePyExpr(
  expression: string,
  bindings: ReadonlyMap<string, PyValue>,
  status?: ReadonlyMap<string, PyStatus>
): PyValue {
  return new Parser(tokenize(expression), bindings, status).parse();
}

/**
 * The vector tokens whose values the expression uses unguarded (see
 * `unguarded`), from a dry run in which every binding is the number 1. An
 * error of the expression itself (syntax, an unknown name) is returned.
 */
function unguardedUses(
  expression: string,
  keys: readonly string[]
): { tokens: readonly string[]; reduced: readonly string[]; fault?: PyExprError } {
  const before = [unguarded, reduced] as const;
  const trace = new Set<string>();
  const nan = new Set<string>();
  unguarded = trace;
  reduced = nan;
  try {
    evaluatePyExpr(expression, new Map(keys.map((key) => [key, 1])));
    return { tokens: [...trace], reduced: [...nan] };
  } catch (error) {
    if (!(error instanceof PyExprError)) throw error;
    return { tokens: [...trace], reduced: [...nan], fault: error };
  } finally {
    [unguarded, reduced] = before;
  }
}

/** How an expression reads its bindings. */
export interface PyExprInputs {
  /** Each vector token with its members, ordered by key. */
  readonly vectors: ReadonlyMap<string, readonly string[]>;
  /** Every member of a vector token, once, in order of first use. */
  readonly members: readonly string[];
  /** Bindings read as a plain value: the formula has no result without them. */
  readonly strict: ReadonlySet<string>;
  /** Whether the expression has a vector token, a status function or `label()`. */
  readonly status: boolean;
  /** The vector tokens with a use of their values that a member without a number fails. */
  readonly unguarded: readonly string[];
  /** The vector tokens that go into `nanmax`, `nanmin`, `nansum` or `nanmean`. */
  readonly reduced: readonly string[];
  /** An error of the expression itself, whatever the values. */
  readonly fault?: PyExprError;
}

/**
 * Which of `keys` the expression reads as a plain value, and which only as a
 * member of a vector token or through `severity()` / `connected()`. `label()`
 * reads the value. Throws PyExprError
 * for a token with nothing bound and a status function without exactly one token.
 */
export function analyzePyExpr(expression: string, keys: readonly string[]): PyExprInputs {
  const tokens = tokenize(expression);
  const has = (key: string) => keys.includes(key);
  const vectors = new Map<string, readonly string[]>();
  const strict = new Set<string>();
  let status = false;
  tokens.forEach((t, i) => {
    if (t.type === 'name' && STATUS_FUNCTIONS.has(t.text) && tokens[i + 1]?.text === '(') {
      status = true;
      const arg = tokens[i + 2];
      const close = tokens[i + 3];
      if (arg?.type !== 'binding' || close?.type !== 'op' || close.text !== ')') {
        throw new PyExprError(`${t.text}() takes exactly one {token}`);
      }
    }
    if (t.type !== 'binding') return;
    const prefix = vectorPrefix(t.text, has);
    const before = tokens[i - 2];
    const inCall =
      before?.type === 'name' &&
      STATUS_FUNCTIONS.has(before.text) &&
      tokens[i - 1]?.text === '(' &&
      tokens[i + 1]?.text === ')';
    if (prefix !== null) {
      if (inCall && before.text === 'label') {
        throw new PyExprError(
          'label() takes exactly one {token} of one channel, not a vector token'
        );
      }
      const members = membersOf(prefix, keys);
      if (members.length === 0) throw new PyExprError(`{${t.text}} matches no binding`);
      vectors.set(t.text, members);
      return;
    }
    if (!has(t.text)) throw new PyExprError(`unbound token {${t.text}}`);
    if (!inCall || before.text === 'label') strict.add(t.text);
  });
  const members = [...new Set([...vectors.values()].flat())];
  const uses = vectors.size > 0 ? unguardedUses(expression, keys) : { tokens: [], reduced: [] };
  return {
    vectors,
    members,
    strict,
    status: status || vectors.size > 0,
    unguarded: uses.tokens,
    reduced: uses.reduced,
    ...(uses.fault ? { fault: uses.fault } : {}),
  };
}

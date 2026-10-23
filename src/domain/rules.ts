import { tidy, type FieldErrors, type Validated } from "./accounts.ts";
import { findCurrency, formatAmount, parseAmount } from "./money.ts";

// "If a transaction looks like this, it gets that category." Rules have no
// order: when the ones that match a transaction disagree, none is picked.

export const RULE_MATCHES = ["contains", "regex"] as const;
export type RuleMatch = (typeof RULE_MATCHES)[number];

/** Bounds on the size of an amount, money in or out, in minor units. */
export interface AmountRange {
  /** Transactions in other currencies never match. */
  currency: string;
  /** At least this much; null for no lower bound. */
  min: number | null;
  /** Under this much; null for no upper bound. */
  max: number | null;
}

/** "under 10.00 €", "15.00 € or more", "10.00 € or more, under 15.00 €". */
export function describeAmount({ currency, min, max }: AmountRange): string {
  return [
    min !== null && `${formatAmount(min, currency)} or more`,
    max !== null && `under ${formatAmount(max, currency)}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** What a transaction must look like for a rule to match it. */
export interface RuleCondition {
  match: RuleMatch;
  /**
   * The text the description contains, or the regular expression it matches.
   * Both ignore case, and runs of spaces count as one.
   */
  text: string;
  /** Only this account's transactions; null for any account. */
  accountId: number | null;
  /** Only amounts of this size; null for any amount. */
  amount: AmountRange | null;
}

export interface Rule extends RuleCondition {
  id: number;
  categoryId: number;
}

/** A transaction as rules see it. */
export interface RuleTarget {
  description: string;
  amount: number;
  accountId: number;
  /** Its account's currency. */
  currency: string;
}

/** The rule form's fields, as typed. */
export interface RuleFields {
  match: string;
  text: string;
  accountId: number | null;
  /** The amount bounds as typed: empty for none. */
  min: string;
  max: string;
  /** The bounds' currency when no account is picked; otherwise the account's. */
  currency: string;
  categoryId: number | null;
}

const MAX_LENGTH = 200;

function isRuleMatch(match: string): match is RuleMatch {
  return (RULE_MATCHES as readonly string[]).includes(match);
}

/**
 * Checks the rule form. `accounts` gives each account's currency, by id;
 * `categoryIds` are the categories that exist.
 */
export function validateRule(
  fields: RuleFields,
  {
    accounts,
    categoryIds,
  }: { accounts: Map<number, string>; categoryIds: Set<number> },
): Validated<RuleCondition & { categoryId: number }> {
  const errors: FieldErrors = {};
  const match = fields.match;
  if (!isRuleMatch(match))
    errors.match = "Pick contains or regular expression.";

  const text = match === "regex" ? fields.text.trim() : tidy(fields.text);
  if (!text) errors.text = "Enter the text to look for.";
  else if (text.length > MAX_LENGTH)
    errors.text = `Keep it under ${MAX_LENGTH} characters.`;
  else if (match === "regex" && !compiles(text))
    errors.text = "That isn't a valid regular expression.";

  const { accountId, categoryId } = fields;
  if (accountId !== null && !accounts.has(accountId))
    errors.accountId = "Pick an account, or any account.";
  if (categoryId === null || !categoryIds.has(categoryId))
    errors.categoryId = "Pick a category.";

  // An account's transactions are all in its currency.
  const currency =
    accountId !== null ? accounts.get(accountId) : fields.currency;
  let amount: AmountRange | null = null;
  if (fields.min.trim() || fields.max.trim()) {
    if (!currency || !findCurrency(currency)) {
      errors.currency = "Pick a currency.";
    } else {
      const bound = (typed: string, key: "min" | "max") => {
        if (!typed.trim()) return null;
        const parsed = parseAmount(typed, currency);
        if (!parsed.ok) errors[key] = parsed.error;
        else if (parsed.minor <= 0) errors[key] = "Enter an amount above zero.";
        else return parsed.minor;
        return null;
      };
      const min = bound(fields.min, "min");
      const max = bound(fields.max, "max");
      if (min !== null && max !== null && max <= min)
        errors.max = "Make it more than the lower amount.";
      amount = { currency, min, max };
    }
  }

  if (
    Object.keys(errors).length > 0 ||
    !isRuleMatch(match) ||
    categoryId === null
  ) {
    return { ok: false, errors };
  }
  return { ok: true, value: { match, text, accountId, amount, categoryId } };
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Whether a description contains the text, ignoring case and repeated
 * spaces: a rule's "contains", and S5's search. Empty text matches any.
 */
export function contains(text: string): (description: string) => boolean {
  const needle = squeeze(text).toLowerCase();
  return (description) => squeeze(description).toLowerCase().includes(needle);
}

/** A rule's description test, compiled once for many transactions. */
function describes(rule: Pick<RuleCondition, "match" | "text">) {
  if (rule.match === "regex") {
    const pattern = new RegExp(rule.text, "i");
    return (description: string) => pattern.test(squeeze(description));
  }
  return contains(rule.text);
}

function inRange(range: AmountRange | null, t: RuleTarget): boolean {
  if (!range) return true;
  if (range.currency !== t.currency) return false;
  const size = Math.abs(t.amount);
  return (
    (range.min === null || size >= range.min) &&
    (range.max === null || size < range.max)
  );
}

/** A test for transactions, compiled once from a rule's condition. */
export function matcher(rule: RuleCondition): (t: RuleTarget) => boolean {
  const described = describes(rule);
  return (t) =>
    (rule.accountId === null || rule.accountId === t.accountId) &&
    inRange(rule.amount, t) &&
    described(t.description);
}

/**
 * A rule's text to start from, made from a transaction's description. Words
 * with digits are often a date, a store number or a reference, so it's the
 * longest run of words without any, the last one if two are as long
 * ("PAGAMENTO POS 12/10 ESSELUNGA MILANO" gives "ESSELUNGA MILANO").
 */
export function suggestText(description: string): string {
  const text = squeeze(description);
  let best: string[] = [];
  let run: string[] = [];
  for (const word of [...text.split(" "), "0"]) {
    if (!/\d/.test(word)) run.push(word);
    else {
      if (run.length > 0 && run.length >= best.length) best = run;
      run = [];
    }
  }
  return best.length > 0 ? best.join(" ") : text;
}

export type RuleOutcome<R extends Rule = Rule> =
  | { kind: "none" }
  /** The rules that match agree. `ruleId` is the oldest of them. */
  | { kind: "category"; categoryId: number; ruleId: number }
  /** The rules that match disagree, so the transaction goes to Review. */
  | { kind: "conflict"; rules: R[] };

/** What the rules say about transactions, compiled once for many. */
export function ruleChecker<R extends Rule>(
  rules: R[],
): (t: RuleTarget) => RuleOutcome<R> {
  const compiled = rules.map((rule) => ({ rule, test: matcher(rule) }));
  return (t) => {
    const matched = compiled.filter(({ test }) => test(t)).map((c) => c.rule);
    const [first] = matched.toSorted((a, b) => a.id - b.id);
    if (!first) return { kind: "none" };
    if (matched.some((r) => r.categoryId !== first.categoryId)) {
      return { kind: "conflict", rules: matched };
    }
    return { kind: "category", categoryId: first.categoryId, ruleId: first.id };
  };
}

/** A transaction that gets a category, and the rule credited with it. */
export interface Categorized {
  id: number;
  categoryId: number;
  ruleId: number;
}

/** What saving a rule would do to the uncategorized transactions. */
export interface RuleEffect {
  /** It matches these, and every rule that does agrees: they get its category. */
  matching: Categorized[];
  /** It matches these too, but another rule that does gives another category. */
  conflicts: number;
  /**
   * Editing: conflicts its old version was part of, which it no longer
   * matches, so the rules left can settle them.
   */
  settled: Categorized[];
}

/**
 * What saving `rule`, a new one or an edit of one of `rules`, would do to
 * `uncategorized` transactions. Only those can change: a transaction with a
 * category keeps it. A new rule's id must be above every other's, as the
 * database gives it.
 */
export function ruleEffect(
  rules: Rule[],
  rule: Rule,
  uncategorized: (RuleTarget & { id: number })[],
): RuleEffect {
  const old = rules.find((r) => r.id === rule.id);
  const before = ruleChecker(rules);
  const after = ruleChecker([...rules.filter((r) => r.id !== rule.id), rule]);
  const matches = matcher(rule);
  const matchedBefore = old ? matcher(old) : () => false;

  const effect: RuleEffect = { matching: [], conflicts: 0, settled: [] };
  for (const t of uncategorized) {
    const now = matches(t);
    if (!now && !(matchedBefore(t) && before(t).kind === "conflict")) continue;
    const outcome = after(t);
    if (outcome.kind === "category") {
      const { categoryId, ruleId } = outcome;
      (now ? effect.matching : effect.settled).push({
        id: t.id,
        categoryId,
        ruleId,
      });
    } else if (now) effect.conflicts += 1;
  }
  return effect;
}

/**
 * Pairs of rules that could both match one transaction while giving it
 * different categories, so it would go to Review. Found two ways:
 * - by description: a "contains" rule's own text, taken as a description,
 *   matches the other rule ("AMAZON PRIME" matches contains "AMAZON"), and
 *   their accounts, currencies and amounts can meet;
 * - by the transactions that both match, the only way to tell for two
 *   regular expressions.
 * Returns, for each rule that overlaps, the ids of the others.
 */
export function findOverlaps(
  rules: Rule[],
  transactions: RuleTarget[],
  accountCurrency: (accountId: number) => string | undefined,
): Map<number, number[]> {
  const pairs = new Set<string>();
  const add = (a: Rule, b: Rule) => {
    if (a.categoryId === b.categoryId) return;
    pairs.add(a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
  };

  const currencyOf = (r: Rule) =>
    r.amount?.currency ??
    (r.accountId === null ? undefined : accountCurrency(r.accountId));
  const canMeet = (a: Rule, b: Rule) => {
    if (a.accountId !== null && b.accountId !== null) {
      if (a.accountId !== b.accountId) return false;
    }
    const [ca, cb] = [currencyOf(a), currencyOf(b)];
    if (ca !== undefined && cb !== undefined && ca !== cb) return false;
    if (a.amount && b.amount) {
      const low = Math.max(a.amount.min ?? 0, b.amount.min ?? 0);
      const high = Math.min(a.amount.max ?? Infinity, b.amount.max ?? Infinity);
      if (low >= high) return false;
    }
    return true;
  };
  const tests = new Map(rules.map((r) => [r.id, describes(r)]));
  const textMatches = (a: Rule, b: Rule) =>
    a.match === "contains" && tests.get(b.id)!(a.text);

  for (const [i, a] of rules.entries()) {
    for (const b of rules.slice(i + 1)) {
      if (canMeet(a, b) && (textMatches(a, b) || textMatches(b, a))) {
        add(a, b);
      }
    }
  }

  const compiled = rules.map((rule) => ({ rule, test: matcher(rule) }));
  for (const t of transactions) {
    const matched = compiled.filter(({ test }) => test(t)).map((c) => c.rule);
    for (const [i, a] of matched.entries()) {
      for (const b of matched.slice(i + 1)) add(a, b);
    }
  }

  const overlaps = new Map<number, number[]>();
  for (const pair of pairs) {
    const [a, b] = pair.split(":").map(Number) as [number, number];
    overlaps.set(a, [...(overlaps.get(a) ?? []), b]);
    overlaps.set(b, [...(overlaps.get(b) ?? []), a]);
  }
  return overlaps;
}

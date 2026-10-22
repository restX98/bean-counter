import { useId, useState } from "react";
import { groupCategories } from "../../domain/categories.ts";
import { currencies, formatSize, parseAmount } from "../../domain/money.ts";
import {
  describeAmount,
  RULE_MATCHES,
  type RuleFields,
} from "../../domain/rules.ts";
import {
  useAccounts,
  useCategories,
  useCreateRule,
  useRulePreview,
  useRules,
  useUpdateRule,
  type RuleListItem,
} from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { plural, RULE_MATCH_LABELS, ruleName } from "../labels.ts";
import { useDebounced } from "../useDebounced.ts";
import { CategoryForm } from "./CategoryForm.tsx";

/** The category picker's option that opens the category form. */
const NEW = "new";
const GROUP_TITLES = { income: "Income", expense: "Expenses" };

interface Props {
  /** The rule to edit; left out to add one. */
  rule?: RuleListItem;
  onClose: () => void;
  /** Edit mode: opens the delete dialog. */
  onDelete?: () => void;
}

/** The fields of a rule to edit, or of a new one with bounds in `currency`. */
function initialFields(
  rule: RuleListItem | undefined,
  currency: string,
): RuleFields {
  if (!rule) {
    return {
      match: "contains",
      text: "",
      accountId: null,
      min: "",
      max: "",
      currency,
      categoryId: null,
    };
  }
  const { amount } = rule;
  const bound = (minor: number | null) =>
    minor === null || !amount ? "" : formatSize(minor, amount.currency);
  return {
    match: rule.match,
    text: rule.text,
    accountId: rule.accountId,
    min: bound(amount?.min ?? null),
    max: bound(amount?.max ?? null),
    currency: amount?.currency ?? currency,
    categoryId: rule.categoryId,
  };
}

/** Says which amounts the typed bounds match, once they read as amounts. */
function amountHint(min: string, max: string, currency: string): string {
  if (!min.trim() && !max.trim()) {
    return "Any amount. Fill in one or both to narrow it, money in or out.";
  }
  const read = (typed: string) => {
    if (!typed.trim()) return null;
    const parsed = parseAmount(typed, currency);
    return parsed.ok && parsed.minor > 0 ? parsed.minor : undefined;
  };
  const low = read(min);
  const high = read(max);
  if (
    low === undefined ||
    high === undefined ||
    (low !== null && high !== null && high <= low)
  ) {
    return "The amount's size, money in or out.";
  }
  return `Amounts ${describeAmount({ currency, min: low, max: high })}, in or out.`;
}

/**
 * D6: add a rule or edit one. While I type, it shows the rules it would
 * overlap and offers to categorize the uncategorized transactions it
 * concerns.
 */
export function RuleForm({ rule, onClose, onDelete }: Props) {
  const id = useId();
  const { data: accounts = [] } = useAccounts();
  const categories = useCategories();
  const rules = useRules();
  const create = useCreateRule();
  const update = useUpdateRule(rule?.id ?? 0);
  const saving = rule ? update : create;
  const errors = fieldErrors(saving.error);
  // The accounts it can be for: open ones, and the one it has.
  const choices = accounts.filter(
    (a) => !a.archivedOn || a.id === rule?.accountId,
  );
  const [fields, setFields] = useState(() =>
    initialFields(rule, choices[0]?.currency ?? "EUR"),
  );
  const [apply, setApply] = useState(true);
  const [settle, setSettle] = useState(true);
  const [addingCategory, setAddingCategory] = useState(false);
  const set = (more: Partial<RuleFields>) =>
    setFields((current) => ({ ...current, ...more }));

  // An account's transactions are all in its currency.
  const account = accounts.find((a) => a.id === fields.accountId);
  const currency = account?.currency ?? fields.currency;
  const preview = useRulePreview(useDebounced(fields), rule?.id ?? null);
  const effect = preview.data?.valid ? preview.data : null;

  const names = new Map(
    categories.data?.categories.map((c) => [c.id, c.name]) ?? [],
  );
  const others = new Map(rules.data?.rules.map((r) => [r.id, r]) ?? []);
  const describe = (ids: number[]) =>
    ids.flatMap((other) => {
      const r = others.get(other);
      return r
        ? [`${ruleName(r, accounts)} → ${names.get(r.categoryId) ?? ""}`]
        : [];
    });
  const overlaps = describe(effect?.overlaps ?? []);
  const resolved =
    effect && rule
      ? describe(rule.overlaps.filter((o) => !effect.overlaps.includes(o)))
      : [];
  const matching = effect?.matching ?? 0;
  const conflicts = effect?.conflicts ?? 0;
  const settled = effect?.settled ?? [];
  const settledCount = settled.reduce((n, s) => n + s.count, 0);

  const groups = groupCategories(categories.data?.categories ?? []);
  const pickCategory = (value: string) => {
    if (value === NEW) setAddingCategory(true);
    else set({ categoryId: value === "" ? null : Number(value) });
  };

  // Only what was offered: a transaction is never categorized unasked.
  const save = () =>
    saving.mutate(
      {
        ...fields,
        apply: apply && matching > 0,
        settle: settle && settledCount > 0,
      },
      { onSuccess: onClose },
    );

  const textError = errors.text ?? errors.match;
  const textHint = "Case doesn't matter, and runs of spaces count as one.";
  const amountError = errors.min ?? errors.max ?? errors.currency;
  const amountText = amountHint(fields.min, fields.max, currency);
  const amountIds = describedBy(`${id}-amount`, amountError, amountText)[
    "aria-describedby"
  ];

  return (
    <>
      <Dialog
        title={rule ? "Edit rule" : "Add rule"}
        onClose={onClose}
        onSubmit={save}
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving.isPending}
            >
              Save rule
            </button>
          </>
        }
      >
        <FormError error={saving.error} />
        <div className="form">
          <Field
            id={`${id}-text`}
            label="Description"
            error={textError}
            hint={textHint}
          >
            <div className="field-row inline">
              <span className="select-wrap">
                <select
                  className="select"
                  aria-label="How to test the description"
                  value={fields.match}
                  onChange={(e) => set({ match: e.target.value })}
                >
                  {RULE_MATCHES.map((match) => (
                    <option key={match} value={match}>
                      {RULE_MATCH_LABELS[match]}
                    </option>
                  ))}
                </select>
                <Icon name="chevron" />
              </span>
              <input
                id={`${id}-text`}
                className="input"
                value={fields.text}
                onChange={(e) => set({ text: e.target.value })}
                placeholder={
                  fields.match === "regex" ? "e.g. ^SALARY" : "e.g. ESSELUNGA"
                }
                autoComplete="off"
                spellCheck={false}
                data-autofocus
                {...describedBy(`${id}-text`, textError, textHint)}
              />
            </div>
          </Field>

          <Field
            id={`${id}-amount`}
            label="Amount"
            optional
            error={amountError}
            hint={amountText}
            group
          >
            <div
              className="field-row inline"
              role="group"
              aria-labelledby={`${id}-amount-label`}
            >
              <input
                className="input"
                aria-label="At least"
                placeholder="At least"
                value={fields.min}
                onChange={(e) => set({ min: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={errors.min ? true : undefined}
                aria-describedby={amountIds}
              />
              <input
                className="input"
                aria-label="Under"
                placeholder="Under"
                value={fields.max}
                onChange={(e) => set({ max: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={errors.max ? true : undefined}
                aria-describedby={amountIds}
              />
              <span className="select-wrap">
                <select
                  className="select"
                  aria-label={account ? "Currency (the account's)" : "Currency"}
                  value={currency}
                  disabled={account !== undefined}
                  onChange={(e) => set({ currency: e.target.value })}
                  aria-invalid={errors.currency ? true : undefined}
                >
                  {currencies().map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
                <Icon name="chevron" />
              </span>
            </div>
          </Field>

          <Field
            id={`${id}-account`}
            label="Account"
            optional
            error={errors.accountId}
          >
            <span className="select-wrap">
              <select
                id={`${id}-account`}
                className="select"
                value={fields.accountId ?? ""}
                onChange={(e) =>
                  set({
                    accountId:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                {...describedBy(`${id}-account`, errors.accountId)}
              >
                <option value="">Any account</option>
                {choices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Icon name="chevron" />
            </span>
          </Field>

          <Field
            id={`${id}-category`}
            label="Category"
            error={errors.categoryId}
          >
            <span className="select-wrap">
              <select
                id={`${id}-category`}
                className="select"
                value={fields.categoryId ?? ""}
                disabled={!categories.data}
                onChange={(e) => pickCategory(e.target.value)}
                {...describedBy(`${id}-category`, errors.categoryId)}
              >
                {fields.categoryId === null && (
                  <option value="">Pick a category</option>
                )}
                {groups.map((group) => (
                  <optgroup key={group.type} label={GROUP_TITLES[group.type]}>
                    {group.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={NEW}>New category…</option>
              </select>
              <Icon name="chevron" />
            </span>
          </Field>

          {overlaps.length > 0 && (
            <div className="banner tone-warning" role="status">
              <Icon name="alert" />
              <span className="text">
                <strong>
                  {overlaps.length === 1
                    ? "It overlaps another rule"
                    : `It overlaps ${overlaps.length} other rules`}
                </strong>
                <span className="change-list">
                  {overlaps.map((o) => (
                    <span key={o}>{o}</span>
                  ))}
                </span>
                A transaction they both match goes to Review instead of getting
                a category.
              </span>
            </div>
          )}
          {resolved.length > 0 && (
            <div className="banner tone-success" role="status">
              <Icon name="check" />
              <span className="text">
                <strong>No more overlap</strong>
                With these changes, it no longer overlaps:
                <span className="change-list">
                  {resolved.map((o) => (
                    <span key={o}>{o}</span>
                  ))}
                </span>
              </span>
            </div>
          )}

          {matching > 0 && (
            <label className="check">
              <input
                type="checkbox"
                className="visually-hidden"
                checked={apply}
                onChange={(e) => setApply(e.target.checked)}
              />
              <span className="box">{apply && <Icon name="check" />}</span>
              <span>
                Also apply to {plural(matching, "uncategorized transaction")}{" "}
                that {matching === 1 ? "matches" : "match"}
              </span>
            </label>
          )}
          {settledCount > 0 && (
            <label className="check">
              <input
                type="checkbox"
                className="visually-hidden"
                checked={settle}
                onChange={(e) => setSettle(e.target.checked)}
              />
              <span className="box">{settle && <Icon name="check" />}</span>
              <span>
                Re-check{" "}
                {settledCount === 1
                  ? "the rule conflict"
                  : `the ${settledCount} rule conflicts`}{" "}
                in Review ({settledCount === 1 ? "it'll" : "they'll"} get{" "}
                {settled.map((s) => names.get(s.categoryId)).join(" or ")})
              </span>
            </label>
          )}
          <p className="caption">
            Transactions that already have a category are never changed.
            {conflicts > 0 &&
              ` ${plural(conflicts, "uncategorized transaction")} ${conflicts === 1 ? "matches" : "match"} it and a rule with another category, so ${conflicts === 1 ? "it goes" : "they go"} to Review.`}
          </p>

          {rule && onDelete && (
            <button
              type="button"
              className="link danger-link"
              onClick={onDelete}
            >
              Delete this rule…
            </button>
          )}
        </div>
      </Dialog>

      {addingCategory && (
        <CategoryForm
          onClose={() => setAddingCategory(false)}
          onSaved={(category) => set({ categoryId: category.id })}
        />
      )}
    </>
  );
}

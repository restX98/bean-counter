import { useId, useState } from "react";
import { Link } from "react-router";
import { monthChoices, type BudgetFields } from "../../domain/budgets.ts";
import { formatMonth } from "../../domain/dates.ts";
import { currencySymbol, formatAmount } from "../../domain/money.ts";
import {
  useAddBudget,
  useSpendingReport,
  type Budget,
  type BudgetList,
} from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";

/**
 * The months a budget in a currency can start in, newest first: from next
 * month back to the oldest with transactions in it.
 */
const startMonths = (list: BudgetList, currency: string) =>
  monthChoices(list.firstMonths[currency] ?? list.thisMonth, list.thisMonth);

/** What the start month means for the first limit. */
function startHint(
  start: string,
  thisMonth: string,
  category: string | undefined,
  spent: string | null,
) {
  if (start > thisMonth) {
    return `It counts from ${formatMonth(start)}: what you spend before then doesn't.`;
  }
  if (start < thisMonth) {
    return `It counts from ${formatMonth(start)}, in full: everything spent on ${category ?? "the category"} since then comes out of it.`;
  }
  const name = formatMonth(start).split(" ")[0];
  return (
    `The whole ${name} limit counts.` +
    (category && spent
      ? ` The ${spent} already spent on ${category} this month comes out of it.`
      : "")
  );
}

/** D7, adding: a monthly limit for an expense category without a budget. */
export function AddBudget({
  list,
  onClose,
  onAdded,
}: {
  /** S14's list: the categories, currencies and months on offer. */
  list: BudgetList;
  onClose: () => void;
  onAdded: (budget: Budget) => void;
}) {
  const id = useId();
  const adding = useAddBudget();
  const errors = fieldErrors(adding.error);
  const [fields, setFields] = useState<BudgetFields>({
    categoryId: null,
    currency: list.currency,
    limit: "",
    start: list.thisMonth,
  });
  const months = startMonths(list, fields.currency);
  const category = list.available.find((c) => c.id === fields.categoryId);
  // What it spent this month already comes out of the first limit.
  const spending = useSpendingReport(
    {
      currency: fields.currency,
      period: { from: fields.start, to: fields.start },
    },
    category !== undefined && fields.start === list.thisMonth,
  );
  const spent = spending.data?.lines.find(
    (l) => l.categoryId === category?.id,
  )?.amount;
  const hint = startHint(
    fields.start,
    list.thisMonth,
    category?.name,
    spent ? formatAmount(spent, fields.currency) : null,
  );

  const save = () =>
    adding.mutate(fields, {
      onSuccess: (budget) => {
        onClose();
        onAdded(budget);
      },
    });

  const categoryHint =
    list.available.length > 0 ? (
      "Expense categories without a budget."
    ) : (
      <>
        Every expense category has a budget.{" "}
        <Link className="link" to="/categories">
          Add a category
        </Link>{" "}
        first.
      </>
    );
  const currencyHint =
    "Only spending in this currency counts toward the budget.";

  return (
    <Dialog
      title="Add budget"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={adding.isPending}
          >
            Save budget
          </button>
        </>
      }
    >
      <FormError error={adding.error} />
      <div className="form">
        <Field
          id={`${id}-category`}
          label="Category"
          error={errors.categoryId}
          hint={categoryHint}
        >
          <span className="select-wrap">
            <select
              id={`${id}-category`}
              className="select"
              value={fields.categoryId ?? ""}
              disabled={list.available.length === 0}
              onChange={(e) =>
                setFields({
                  ...fields,
                  categoryId:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              data-autofocus
              {...describedBy(`${id}-category`, errors.categoryId, true)}
            >
              <option value="">Pick a category</option>
              {list.available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Icon name="chevron" />
          </span>
        </Field>

        {list.currencies.length > 1 && (
          <Field
            id={`${id}-currency`}
            label="Currency"
            error={errors.currency}
            hint={currencyHint}
          >
            <span className="select-wrap">
              <select
                id={`${id}-currency`}
                className="select"
                value={fields.currency}
                onChange={(e) => {
                  const currency = e.target.value;
                  setFields({
                    ...fields,
                    currency,
                    // A month this currency has no transactions in yet.
                    start: startMonths(list, currency).includes(fields.start)
                      ? fields.start
                      : list.thisMonth,
                  });
                }}
                {...describedBy(`${id}-currency`, errors.currency, true)}
              >
                {list.currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Icon name="chevron" />
            </span>
          </Field>
        )}

        <div className="field-row inline">
          <Field id={`${id}-limit`} label="Monthly limit" error={errors.limit}>
            <span className="input suffix">
              <input
                id={`${id}-limit`}
                value={fields.limit}
                onChange={(e) =>
                  setFields({ ...fields, limit: e.target.value })
                }
                placeholder="e.g. 150.00"
                inputMode="decimal"
                autoComplete="off"
                {...describedBy(`${id}-limit`, errors.limit)}
              />
              <span className="muted">{currencySymbol(fields.currency)}</span>
            </span>
          </Field>
          <Field id={`${id}-start`} label="Starts in" error={errors.start}>
            <span className="select-wrap">
              <select
                id={`${id}-start`}
                className="select"
                value={fields.start}
                onChange={(e) =>
                  setFields({ ...fields, start: e.target.value })
                }
                {...describedBy(`${id}-start`, errors.start, hint)}
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonth(m)}
                  </option>
                ))}
              </select>
              <Icon name="chevron" />
            </span>
          </Field>
        </div>
        <p className="caption" id={`${id}-start-hint`}>
          {hint}
        </p>
      </div>
    </Dialog>
  );
}

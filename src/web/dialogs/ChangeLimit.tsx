import { Fragment, useId, useState } from "react";
import { limitIn, monthChoices } from "../../domain/budgets.ts";
import { addMonths, formatMonth } from "../../domain/dates.ts";
import {
  currencySymbol,
  formatAmount,
  parseAmount,
} from "../../domain/money.ts";
import { useChangeLimit, type Budget } from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { listNames } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

/**
 * What the running balance does with a new limit: what it carries over
 * from the month before, then the new limit each month.
 */
function runningFrom(budget: Budget, from: string, amount: string) {
  const { start, restarts } = budget.plan;
  if (from === start || restarts.includes(from)) {
    return `Running balance: ${amount} each month from ${formatMonth(from)}.`;
  }
  const before = budget.history.find((m) => m.month === addMonths(from, -1));
  if (!before) return `Running balance: ${amount} more each month.`;
  const carried = formatAmount(before.running, budget.currency, {
    signed: true,
  });
  return `Running balance: ${carried} carried over, then ${amount} more each month.`;
}

/** D7, changing the limit: a new limit from a month on. */
export function ChangeLimit({
  budget: b,
  onClose,
  onSaved,
}: {
  budget: Budget;
  onClose: () => void;
  onSaved: (amount: number, from: string) => void;
}) {
  const id = useId();
  const isMobile = useIsMobile();
  const change = useChangeLimit(b.id);
  const errors = fieldErrors(change.error);
  const months = monthChoices(b.plan.start, b.thisMonth);
  // Next month, unless the budget starts later.
  const [fields, setFields] = useState({ limit: "", from: months[0]! });
  const money = (minor: number) => formatAmount(minor, b.currency);

  const current = limitIn(b.plan, b.thisMonth);
  const later = b.plan.limits.filter((l) => l.from > b.thisMonth);
  const typed = parseAmount(fields.limit, b.currency);
  const amount = typed.ok && typed.minor > 0 ? typed.minor : null;
  // A new limit replaces the ones from its month on.
  const replaced = b.plan.limits.filter((l) => l.from >= fields.from);

  const save = () =>
    change.mutate(fields, {
      onSuccess: (saved) => {
        onClose();
        onSaved(limitIn(saved.plan, fields.from)!, fields.from);
      },
    });

  return (
    <Dialog
      title={isMobile ? "Change limit" : `Change limit · ${b.name}`}
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
            disabled={change.isPending}
          >
            Save limit
          </button>
        </>
      }
    >
      <FormError error={change.error} />
      <div className="form">
        <dl className="facts">
          {current !== null && (
            <>
              <dt>Current limit</dt>
              <dd>{money(current)} per month</dd>
            </>
          )}
          {later.map((l) => (
            <Fragment key={l.from}>
              <dt>From {formatMonth(l.from)}</dt>
              <dd>{money(l.amount)} per month</dd>
            </Fragment>
          ))}
        </dl>
        <div className="field-row inline">
          <Field id={`${id}-limit`} label="New limit" error={errors.limit}>
            <span className="input suffix">
              <input
                id={`${id}-limit`}
                value={fields.limit}
                onChange={(e) =>
                  setFields({ ...fields, limit: e.target.value })
                }
                placeholder="e.g. 350.00"
                inputMode="decimal"
                autoComplete="off"
                data-autofocus
                {...describedBy(`${id}-limit`, errors.limit)}
              />
              <span className="muted">{currencySymbol(b.currency)}</span>
            </span>
          </Field>
          <Field id={`${id}-from`} label="Applies from" error={errors.from}>
            <span className="select-wrap">
              <select
                id={`${id}-from`}
                className="select"
                value={fields.from}
                onChange={(e) => setFields({ ...fields, from: e.target.value })}
                {...describedBy(`${id}-from`, errors.from, true)}
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
        <p className="caption" id={`${id}-from-hint`}>
          Earlier months keep the limit they had, so the running balance stays
          correct.
        </p>
        {amount !== null && (
          <div className="banner tone-info" role="status">
            <Icon name="info" />
            <span className="text">
              <strong>From {formatMonth(fields.from)}</strong>
              {runningFrom(b, fields.from, money(amount))}
              {replaced.length > 0 &&
                ` It replaces ${listNames(
                  replaced.map(
                    (l) => `${money(l.amount)} from ${formatMonth(l.from)}`,
                  ),
                )}.`}
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

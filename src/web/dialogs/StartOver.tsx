import { useId, useState } from "react";
import { budgetStatus, limitIn, restartChoices } from "../../domain/budgets.ts";
import { formatMonth } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { useStartOver, type Budget } from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { useIsMobile } from "../useIsMobile.ts";

/** What starting over from a month does to the running balance. */
function afterRestart(budget: Budget, from: string) {
  const money = (minor: number, signed = false) =>
    formatAmount(minor, budget.currency, { signed });
  const now = budget.status?.running.left ?? null;
  if (from > budget.month) {
    const dropped =
      now === null ? "" : ` Today's ${money(now, true)} is dropped.`;
    return `The running balance starts at ${money(0)}, then ${money(limitIn(budget.plan, from)!)} is added each month.${dropped}`;
  }
  // A month with transactions already: count it again from there.
  const spent = (month: string) =>
    budget.history.find((m) => m.month === month)?.spent ?? 0;
  const then = budgetStatus(
    { ...budget.plan, restarts: [...budget.plan.restarts, from] },
    spent,
    budget.month,
  )!;
  return `The running balance counts only from ${formatMonth(from)} on: ${money(then.running.left, true)}${now === null ? "" : ` instead of today's ${money(now, true)}`}.`;
}

/** D7, starting over: the running balance counts again from a month. */
export function StartOver({
  budget: b,
  onClose,
  onSaved,
}: {
  budget: Budget;
  onClose: () => void;
  onSaved: (from: string) => void;
}) {
  const id = useId();
  const isMobile = useIsMobile();
  const restart = useStartOver(b.id);
  const errors = fieldErrors(restart.error);
  const months = restartChoices(b.plan, b.thisMonth);
  // Next month: the usual fresh start.
  const [from, setFrom] = useState(months[0]!);
  const running = b.status?.running;

  const save = () =>
    restart.mutate(
      { from },
      {
        onSuccess: () => {
          onClose();
          onSaved(from);
        },
      },
    );

  return (
    <Dialog
      title={isMobile ? "Start over" : `Start over · ${b.name}`}
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
            disabled={restart.isPending}
          >
            Start over
          </button>
        </>
      }
    >
      <FormError error={restart.error} />
      <div className="form">
        {running && (
          <dl className="facts">
            <dt>Running balance now</dt>
            <dd>
              {formatAmount(running.left, b.currency, { signed: true })} since{" "}
              {formatMonth(running.since)}
            </dd>
          </dl>
        )}
        <Field
          id={`${id}-from`}
          label="Count from"
          error={errors.from}
          hint="Months before it stay in the history but no longer count."
        >
          <span className="select-wrap">
            <select
              id={`${id}-from`}
              className="select"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-autofocus
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
        <div className="banner tone-warning" role="status">
          <Icon name="alert" />
          <span className="text">
            <strong>From {formatMonth(from)}</strong>
            {afterRestart(b, from)}
          </span>
        </div>
      </div>
    </Dialog>
  );
}

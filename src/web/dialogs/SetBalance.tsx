import { useId, useState } from "react";
import { validateAnchor, type Account } from "../../domain/accounts.ts";
import { compareBalance, type Comparison } from "../../domain/balances.ts";
import { formatDate, todayIso } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { useAddCheck, useLedger, useSetBalance } from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { useIsMobile } from "../useIsMobile.ts";

/**
 * D2: the balance shown in the bank app. Once the account has transactions,
 * the app compares it with its own balance that day first. If they differ,
 * I choose: it becomes the anchor, or it's kept to look for what's missing.
 */
export function SetBalance({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const id = useId();
  const isMobile = useIsMobile();
  const { anchor, currency } = account;
  const compares = anchor !== null && account.transactionCount > 0;
  const ledger = useLedger(account.id, compares);
  const saving = useSetBalance(account.id);
  const keeping = useAddCheck(account.id);
  const errors = fieldErrors(keeping.error ?? saving.error);
  const error = errors.anchorAmount ?? errors.anchorDate;
  const busy = saving.isPending || keeping.isPending;
  const [fields, setFields] = useState({ amount: "", date: todayIso() });
  // Set once the app has compared the balance and found a difference.
  const [differs, setDiffers] = useState<
    (Comparison & { date: string }) | null
  >(null);
  const money = (minor: number) => formatAmount(minor, currency);

  const change = (next: typeof fields) => {
    setFields(next);
    setDiffers(null);
  };
  const save = () => {
    keeping.reset();
    saving.mutate(fields, { onSuccess: onClose });
  };
  const keep = () => {
    saving.reset();
    keeping.mutate(fields, { onSuccess: onClose });
  };
  const submit = () => {
    if (differs) return save();
    const valid = validateAnchor(fields, currency, todayIso());
    if (valid.ok && anchor && ledger.data) {
      const { amount, date } = valid.value;
      const comparison = compareBalance(anchor, ledger.data.transactions, {
        date,
        balance: amount,
      });
      if (comparison.difference !== 0) {
        return setDiffers({ ...comparison, date });
      }
    }
    save();
  };

  return (
    <Dialog
      title={isMobile ? "Set balance" : `Set balance · ${account.name}`}
      onClose={onClose}
      onSubmit={submit}
      actions={
        differs ? (
          <>
            {!isMobile && (
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={keep}
            >
              Look for what's missing
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Use my balance
            </button>
          </>
        ) : (
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
              disabled={busy || (compares && !ledger.data)}
            >
              Save balance
            </button>
          </>
        )
      }
    >
      <FormError error={keeping.error ?? saving.error ?? ledger.error} />
      <div className="form">
        <p className="muted">
          Enter the balance shown in your bank app and its date.
          {compares
            ? " The app compares it with its own balance before using it."
            : anchor &&
              ` It replaces the current anchor, ${money(anchor.amount)} on ${formatDate(anchor.date)}.`}
        </p>
        <Field id={`${id}-amount`} label="Balance and date" error={error}>
          <div className="field-row">
            <input
              id={`${id}-amount`}
              className="input"
              value={fields.amount}
              onChange={(e) => change({ ...fields, amount: e.target.value })}
              placeholder="e.g. 3,240.50"
              inputMode="decimal"
              autoComplete="off"
              data-autofocus
              {...describedBy(`${id}-amount`, error)}
            />
            <input
              type="date"
              className="input"
              aria-label="Date of the balance"
              value={fields.date}
              max={todayIso()}
              onChange={(e) => change({ ...fields, date: e.target.value })}
              aria-invalid={errors.anchorDate ? true : undefined}
            />
          </div>
        </Field>
        {differs && anchor && (
          <>
            <div className="banner tone-warning" role="status">
              <Icon name="alert" />
              <span className="text">
                <strong>
                  {money(Math.abs(differs.difference))}{" "}
                  {differs.difference > 0 ? "more" : "less"} than the app's
                  balance
                </strong>
                On {formatDate(differs.date)} the app has {money(differs.app)}.{" "}
                {differs.lastDate &&
                  `Its transactions end on ${formatDate(differs.lastDate)}, so newer ones may not be imported yet. Otherwise, `}
                {differs.lastDate ? "a" : "A"} transaction may be missing, or
                the current anchor ({money(anchor.amount)} on{" "}
                {formatDate(anchor.date)}) was wrong.
              </span>
            </div>
            <p className="muted">
              <strong>Use my balance</strong> makes it the anchor: every balance
              goes {differs.difference > 0 ? "up" : "down"} by{" "}
              {money(Math.abs(differs.difference))}.{" "}
              <strong>Look for what's missing</strong> keeps the anchor and
              shows the difference on the account's page until it's found.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

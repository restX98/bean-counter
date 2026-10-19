import { useId, useState } from "react";
import type { Account } from "../../domain/accounts.ts";
import { formatDate, todayIso } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { useSetBalance } from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { useIsMobile } from "../useIsMobile.ts";

/**
 * D2: the balance shown in the bank app becomes the anchor. Until the account
 * has transactions there's no balance of the app's own to compare it with.
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
  const saving = useSetBalance(account.id);
  const errors = fieldErrors(saving.error);
  const error = errors.anchorAmount ?? errors.anchorDate;
  const [fields, setFields] = useState({ amount: "", date: todayIso() });

  return (
    <Dialog
      title={isMobile ? "Set balance" : `Set balance · ${account.name}`}
      onClose={onClose}
      onSubmit={() => saving.mutate(fields, { onSuccess: onClose })}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving.isPending}
          >
            Save balance
          </button>
        </>
      }
    >
      <FormError error={saving.error} />
      <div className="form">
        <p className="muted">
          Enter the balance shown in your bank app and its date.
          {account.anchor &&
            ` It replaces the current anchor, ${formatAmount(account.anchor.amount, account.currency)} on ${formatDate(account.anchor.date)}.`}
        </p>
        <Field id={`${id}-amount`} label="Balance and date" error={error}>
          <div className="field-row">
            <input
              id={`${id}-amount`}
              className="input"
              value={fields.amount}
              onChange={(e) => setFields({ ...fields, amount: e.target.value })}
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
              onChange={(e) => setFields({ ...fields, date: e.target.value })}
              aria-invalid={errors.anchorDate ? true : undefined}
            />
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

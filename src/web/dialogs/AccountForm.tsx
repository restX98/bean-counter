import { useId, useState } from "react";
import {
  ACCOUNT_TYPES,
  type Account,
  type AccountFields,
} from "../../domain/accounts.ts";
import { formatDate, todayIso } from "../../domain/dates.ts";
import { currencies, formatAmount } from "../../domain/money.ts";
import { useCreateAccount, useUpdateAccount } from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { TYPE_LABELS } from "../labels.ts";

interface Props {
  /** The account to edit; left out to add one. */
  account?: Account;
  onClose: () => void;
  onSaved?: (account: Account) => void;
  /** Edit mode: the anchor changes through Set balance. */
  onSetBalance?: () => void;
  /** Adding: the currency to start with, such as a statement's. */
  currency?: string;
}

/** D1: add an account (with an optional balance anchor) or edit one. */
export function AccountForm({
  account,
  onClose,
  onSaved,
  onSetBalance,
  currency = "EUR",
}: Props) {
  const id = useId();
  const create = useCreateAccount();
  const update = useUpdateAccount(account?.id ?? 0);
  const saving = account ? update : create;
  const errors = fieldErrors(saving.error);

  const [fields, setFields] = useState<AccountFields>(() =>
    account
      ? {
          name: account.name,
          bank: account.bank,
          type: account.type,
          currency: account.currency,
        }
      : { name: "", bank: "", type: "checking", currency },
  );
  const [anchor, setAnchor] = useState({ amount: "", date: todayIso() });
  const set = (change: Partial<AccountFields>) =>
    setFields((f) => ({ ...f, ...change }));

  const save = () => {
    const onSuccess = (saved: Account) => {
      onClose();
      onSaved?.(saved);
    };
    if (account) update.mutate(fields, { onSuccess });
    else
      create.mutate(
        { ...fields, ...(anchor.amount.trim() ? { anchor } : {}) },
        { onSuccess },
      );
  };

  const currencyHint = account
    ? "You can change it until the account has transactions."
    : undefined;
  const anchorHint = account ? (
    <>
      To change it, use{" "}
      <button type="button" className="link" onClick={onSetBalance}>
        Set balance
      </button>
      .
    </>
  ) : (
    "Skip this if you don't know it yet. If the statement has no balance column, the import will ask for it."
  );
  const anchorError = errors.anchorAmount ?? errors.anchorDate;

  return (
    <Dialog
      title={account ? "Edit account" : "Add account"}
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
            disabled={saving.isPending}
          >
            {account ? "Save changes" : "Save account"}
          </button>
        </>
      }
    >
      <FormError error={saving.error} />
      <div className="form">
        <Field id={`${id}-name`} label="Name" error={errors.name}>
          <input
            id={`${id}-name`}
            className="input"
            value={fields.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Main checking"
            autoComplete="off"
            data-autofocus
            {...describedBy(`${id}-name`, errors.name)}
          />
        </Field>

        <Field id={`${id}-bank`} label="Bank" error={errors.bank}>
          <input
            id={`${id}-bank`}
            className="input"
            value={fields.bank}
            onChange={(e) => set({ bank: e.target.value })}
            placeholder="e.g. Bank A"
            autoComplete="off"
            {...describedBy(`${id}-bank`, errors.bank)}
          />
        </Field>

        <Field id={`${id}-type`} label="Type" error={errors.type} group>
          <div
            className="seg fill"
            role="radiogroup"
            aria-labelledby={`${id}-type-label`}
          >
            {ACCOUNT_TYPES.map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  className="visually-hidden"
                  name={`${id}-type`}
                  value={type}
                  checked={fields.type === type}
                  onChange={() => set({ type })}
                />
                {TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </Field>

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
              onChange={(e) => set({ currency: e.target.value })}
              {...describedBy(`${id}-currency`, errors.currency, currencyHint)}
            >
              {currencies().map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
            <Icon name="chevron" />
          </span>
        </Field>

        {account ? (
          <Field id={`${id}-anchor`} label="Balance anchor" hint={anchorHint}>
            <input
              id={`${id}-anchor`}
              className="input is-readonly"
              readOnly
              value={
                account.anchor
                  ? `${formatAmount(account.anchor.amount, account.currency)} on ${formatDate(account.anchor.date)}`
                  : "Not set yet"
              }
              {...describedBy(`${id}-anchor`, undefined, anchorHint)}
            />
          </Field>
        ) : (
          <Field
            id={`${id}-amount`}
            label="Balance anchor"
            optional
            error={anchorError}
            hint={anchorHint}
          >
            <div className="field-row">
              <input
                id={`${id}-amount`}
                className="input"
                value={anchor.amount}
                onChange={(e) =>
                  setAnchor({ ...anchor, amount: e.target.value })
                }
                placeholder="Current balance, e.g. 3,240.50"
                inputMode="decimal"
                autoComplete="off"
                {...describedBy(`${id}-amount`, anchorError, anchorHint)}
              />
              <input
                type="date"
                className="input"
                aria-label="Date of the balance"
                value={anchor.date}
                max={todayIso()}
                onChange={(e) => setAnchor({ ...anchor, date: e.target.value })}
                aria-invalid={errors.anchorDate ? true : undefined}
              />
            </div>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

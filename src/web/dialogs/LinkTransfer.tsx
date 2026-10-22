import { useId, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import {
  useAccounts,
  useLink,
  useLinkOptions,
  type TransferChange,
  type TransferSide,
} from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";
import { Loading } from "../components/Page.tsx";
import { plural } from "../labels.ts";

/** The transaction to link, as S2 and S6 have it. */
interface Linking {
  id: number;
  description: string;
  date: string;
  amount: number;
  accountId: number;
  currency: string;
}

/**
 * D4: links a transaction with its other side, picked from my other
 * accounts' transactions going the opposite way within the transfer window.
 */
export function LinkTransfer({
  transaction: t,
  onClose,
  onLinked,
}: {
  transaction: Linking;
  onClose: () => void;
  /** After it's linked: what changed, and the side I picked. */
  onLinked?: (change: TransferChange, other: TransferSide) => void;
}) {
  const id = useId();
  const options = useLinkOptions(t.id);
  const { data: accounts = [] } = useAccounts();
  const link = useLink();
  const [picked, setPicked] = useState<number | null>(null);

  const account = (accountId: number) =>
    accounts.find((a) => a.id === accountId);
  const list = options.data?.options ?? [];
  // The first one, until I pick another.
  const chosen = list.find((o) => o.id === picked) ?? list[0];
  const days = options.data && plural(options.data.window, "day");
  const save = () =>
    chosen &&
    link.mutate(
      { id: t.id, otherId: chosen.id },
      {
        onSuccess: (change) => {
          onLinked?.(change, chosen);
          onClose();
        },
      },
    );

  return (
    <Dialog
      title="Link transfer"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {list.length > 0 && (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={link.isPending}
            >
              Link
            </button>
          )}
        </>
      }
    >
      <div className="form">
        <div className="summary">
          <strong>{t.description}</strong>
          <span className={t.amount > 0 ? "amount income" : "amount"}>
            {formatAmount(t.amount, t.currency, { signed: true })}
          </span>
          <span className="caption">
            {account(t.accountId)?.name} · {formatDate(t.date)}
          </span>
        </div>
        <FormError error={options.error ?? link.error} />
        {!options.data ? (
          !options.error && <Loading />
        ) : list.length === 0 ? (
          <p className="muted">
            None of your other accounts has money going the other way within{" "}
            {days} of it.
          </p>
        ) : (
          <>
            <div>
              <p className="label" id={`${id}-label`}>
                Pick the other side
              </p>
              <p className="caption">Opposite direction, within {days}</p>
            </div>
            <div
              className="choices link-options"
              role="radiogroup"
              aria-labelledby={`${id}-label`}
            >
              {list.map((o, i) => {
                const other = account(o.accountId);
                const selected = o === chosen;
                return (
                  <label
                    key={o.id}
                    className={selected ? "choice is-selected" : "choice"}
                  >
                    <input
                      type="radio"
                      className="visually-hidden"
                      name={`${id}-other`}
                      checked={selected}
                      onChange={() => setPicked(o.id)}
                      data-autofocus={i === 0 || undefined}
                    />
                    <span className="radio" aria-hidden="true" />
                    <span className="what">
                      <strong>{o.description}</strong>
                      <span className="caption">
                        {other?.name} · {formatDate(o.date)}
                      </span>
                    </span>
                    <span className="amount">
                      {other &&
                        formatAmount(o.amount, other.currency, {
                          signed: true,
                        })}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
        <p className="caption">
          Accounts in other currencies are listed too when they have a
          transaction in the window; their amounts can't be compared.
        </p>
      </div>
    </Dialog>
  );
}

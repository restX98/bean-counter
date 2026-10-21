import { useEffect, useId, useRef, useState } from "react";
import type { Account } from "../../domain/accounts.ts";
import { groupCategories } from "../../domain/categories.ts";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import {
  useCategories,
  useExclude,
  useSetCategory,
  type LedgerTransaction,
} from "../api.ts";
import { FormError } from "../components/Dialog.tsx";
import { Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { CategoryForm } from "../dialogs/CategoryForm.tsx";
import { useIsMobile } from "../useIsMobile.ts";

/** The picker's option that opens the category form. */
const NEW = "new";
const GROUP_TITLES = { income: "Income", expense: "Expenses" };

/**
 * S6: one transaction, to look at and fix. On desktop it's a side panel that
 * leaves the list usable, so I can go from row to row; on mobile it's full
 * screen.
 */
export function TransactionPanel({
  account,
  transaction: t,
  onClose,
}: {
  account: Account;
  transaction: LedgerTransaction;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const categories = useCategories();
  const setCategory = useSetCategory();
  const exclude = useExclude();
  const [adding, setAdding] = useState(false);
  const readOnly = account.archivedOn !== null;

  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The category form handles its own Escape.
      if (e.key === "Escape" && !adding && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [adding, onClose]);

  // The category just picked, until the list catches up.
  const picking =
    setCategory.isPending && setCategory.variables.id === t.id
      ? setCategory.variables.categoryId
      : undefined;
  const categoryId = picking === undefined ? t.categoryId : picking;
  // The type that matches the amount comes first.
  const first = t.amount > 0 ? "income" : "expense";
  const groups = groupCategories(categories.data?.categories ?? []).toSorted(
    (a, b) => Number(b.type === first) - Number(a.type === first),
  );
  const pick = (value: string) => {
    if (value === NEW) setAdding(true);
    else
      setCategory.mutate({
        id: t.id,
        categoryId: value === "" ? null : Number(value),
      });
  };

  const close = (
    <button
      type="button"
      className={isMobile ? "icon-btn back" : "icon-btn"}
      aria-label="Close"
      onClick={onClose}
    >
      <Icon name={isMobile ? "back" : "x"} />
    </button>
  );

  return (
    <aside
      ref={ref}
      className="panel"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
    >
      <header className="panel-head">
        {isMobile && close}
        <h2 id={`${id}-title`}>Transaction</h2>
        {!isMobile && close}
      </header>
      <div className="detail">
        <FormError
          error={setCategory.error ?? exclude.error ?? categories.error}
        />
        <div className="detail-hero">
          <span className="title">{t.description}</span>
          <span
            className={
              t.amount > 0 && !t.excluded
                ? "big-number amount income"
                : "big-number amount"
            }
          >
            {formatAmount(t.amount, account.currency, { signed: true })}
          </span>
          {t.excluded && (
            <span className="tag tone-neutral">
              <Icon name="eye-off" />
              Excluded
            </span>
          )}
          {t.nearMatchOf !== null && !t.excluded && (
            <span className="caption">
              Kept although it looked like a duplicate
            </span>
          )}
        </div>
        <dl className="facts">
          <dt>Account</dt>
          <dd>{account.name}</dd>
          <dt>Date</dt>
          <dd>
            {formatDate(t.date)}
            {t.time && ` at ${t.time.slice(0, 5)}`}
          </dd>
          {t.reference && (
            <>
              <dt>Reference</dt>
              <dd>{t.reference}</dd>
            </>
          )}
        </dl>

        <section className="detail-section">
          <Field
            id={`${id}-category`}
            label="Category"
            hint={
              t.excluded
                ? "It's excluded, so it doesn't count in reports or budgets whatever its category."
                : undefined
            }
          >
            <span className="select-wrap">
              <select
                id={`${id}-category`}
                className="select"
                value={categoryId ?? ""}
                disabled={readOnly || !categories.data}
                onChange={(e) => pick(e.target.value)}
              >
                <option value="">Uncategorized</option>
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
        </section>

        {!readOnly && (
          <div className="detail-foot">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={exclude.isPending}
              onClick={() =>
                exclude.mutate({ id: t.id, excluded: !t.excluded })
              }
            >
              {t.excluded ? "Restore transaction" : "Exclude transaction"}
            </button>
          </div>
        )}
      </div>

      {adding && (
        <CategoryForm
          type={t.amount > 0 ? "income" : "expense"}
          onClose={() => setAdding(false)}
          onSaved={(category) =>
            setCategory.mutate({ id: t.id, categoryId: category.id })
          }
        />
      )}
    </aside>
  );
}

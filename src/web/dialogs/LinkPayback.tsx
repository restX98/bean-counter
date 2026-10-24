import { useId, useState } from "react";
import { formatDate, formatWhen } from "../../domain/dates.ts";
import { formatAmount, formatSize, parseAmount } from "../../domain/money.ts";
import { prefill } from "../../domain/paybacks.ts";
import {
  useAccounts,
  useCategories,
  usePaybackOptions,
  useSetPaybacks,
  type PaybackOption,
} from "../api.ts";
import { Dialog, fieldErrors, FormError } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading } from "../components/Page.tsx";
import { plural } from "../labels.ts";
import { useDebounced } from "../useDebounced.ts";

/** The transaction to split, as S6 has it. */
interface Linking {
  id: number;
  description: string;
  date: string;
  time: string | null;
  amount: number;
  accountId: number;
  currency: string;
}

/**
 * D9: the expenses a payment pays back, or, from an expense, the payments
 * that pay it back, each with how much. It opens on the split the
 * transaction has. Ticking one prefills what's left, nearest first; what I
 * type stays as it is.
 */
export function LinkPayback({
  transaction: t,
  onClose,
}: {
  transaction: Linking;
  onClose: () => void;
}) {
  const id = useId();
  const paying = t.amount > 0;
  const options = usePaybackOptions(t.id);
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState("");
  const search = useDebounced(text);
  const found = usePaybackOptions(t.id, searching ? search : "");
  const save = useSetPaybacks();
  const categories = useCategories();
  const { data: accounts = [] } = useAccounts();
  // The ones ticked, by id, each with the amount I typed, or null while
  // it's prefilled. Null until the options load: then the split it has.
  const [ticked, setTicked] = useState<Map<number, string | null> | null>(null);
  // Found by a search and ticked: listed with the others from then on.
  const [added, setAdded] = useState<PaybackOption[]>([]);

  if (ticked === null && options.data) {
    setTicked(
      new Map(
        options.data.options
          .filter((o) => o.linked > 0)
          .map((o) => [o.id, formatSize(o.linked, t.currency)]),
      ),
    );
  }
  const picks = ticked ?? new Map<number, string | null>();
  const offered = options.data?.options ?? [];
  const listed = [
    ...offered,
    ...added.filter((a) => !offered.some((o) => o.id === a.id)),
  ];
  const results = (found.data?.options ?? []).filter(
    (o) => !listed.some((l) => l.id === o.id),
  );

  // What each ticked one links: as typed, or its share of what's left.
  const total = Math.abs(t.amount);
  const rows = listed.filter((o) => picks.has(o.id));
  const minor = (typed: string) => {
    const parsed = parseAmount(typed, t.currency);
    return parsed.ok ? parsed.minor : 0;
  };
  const amounts = prefill(
    total,
    rows.map((o) => {
      const typed = picks.get(o.id) ?? null;
      return { left: o.left, typed: typed === null ? null : minor(typed) };
    }),
  );
  const amountOf = new Map(rows.map((o, i) => [o.id, amounts[i] ?? 0]));
  const shown = (o: PaybackOption) =>
    picks.get(o.id) ?? formatSize(amountOf.get(o.id) ?? 0, t.currency);
  const linked = amounts.reduce((sum, a) => sum + a, 0);

  const tick = (o: PaybackOption) => {
    const next = new Map(picks);
    if (next.has(o.id)) next.delete(o.id);
    else next.set(o.id, null);
    setTicked(next);
    if (!listed.includes(o)) setAdded([...added, o]);
  };
  const type = (o: PaybackOption, value: string) =>
    setTicked(new Map(picks).set(o.id, value));
  const submit = () =>
    save.mutate(
      {
        id: t.id,
        links: rows.map((o) => ({ id: o.id, amount: shown(o) })),
      },
      { onSuccess: onClose },
    );

  const money = (amount: number, signed = false) =>
    formatAmount(amount, t.currency, { signed });
  const errors = fieldErrors(save.error);
  const categoryName = (categoryId: number | null) =>
    categoryId === null
      ? paying
        ? "Uncategorized"
        : null
      : categories.data?.categories.find((c) => c.id === categoryId)?.name;
  const days = options.data && plural(options.data.window, "day");

  const choice = (o: PaybackOption) => {
    const on = picks.has(o.id);
    const error = errors[String(o.id)];
    const what = [
      formatDate(o.date),
      categoryName(o.categoryId),
      money(o.amount, true),
      o.left < Math.abs(o.amount) && `${money(o.left)} left`,
    ].filter(Boolean);
    return (
      <div key={o.id} className={on ? "choice pb is-selected" : "choice pb"}>
        <label className="check">
          <input
            type="checkbox"
            className="visually-hidden"
            checked={on}
            onChange={() => tick(o)}
          />
          <span className="box" aria-hidden="true">
            {on && <Icon name="check" />}
          </span>
          <span className="what">
            <strong>{o.description}</strong>
            <span className="caption">{what.join(" · ")}</span>
          </span>
        </label>
        <label className="pb-amount">
          <span className="caption">Payback</span>
          {on ? (
            <input
              className="input"
              inputMode="decimal"
              value={shown(o)}
              aria-label={`Payback, ${o.description}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-${o.id}-error` : undefined}
              onChange={(e) => type(o, e.target.value)}
            />
          ) : (
            <span className="input is-placeholder" aria-hidden="true">
              —
            </span>
          )}
        </label>
        {error && (
          <p className="field-error" id={`${id}-${o.id}-error`}>
            <Icon name="alert" className="icon icon-sm" />
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <Dialog
      title="Link payback"
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={rows.length === 0 || save.isPending}
          >
            Link payback
          </button>
        </>
      }
    >
      <div className="form">
        <div className="summary">
          <strong>{t.description}</strong>
          <span className="amount">{money(t.amount, true)}</span>
          <span className="caption">
            {accounts.find((a) => a.id === t.accountId)?.name} ·{" "}
            {formatWhen(t.date, t.time)}
          </span>
        </div>
        <FormError error={options.error ?? found.error ?? save.error} />
        {!options.data ? (
          !options.error && <Loading />
        ) : (
          <>
            <div>
              <p className="label" id={`${id}-label`}>
                {paying
                  ? "Which expenses does it pay back?"
                  : "Which payments pay it back?"}
              </p>
              <p className="caption">
                {paying
                  ? `Last ${days}, not fully paid back`
                  : `Money in, the ${days} after it, not linked in full`}
              </p>
            </div>
            {listed.length > 0 ? (
              <div
                className="choices"
                role="group"
                aria-labelledby={`${id}-label`}
              >
                {listed.map(choice)}
              </div>
            ) : (
              <p className="muted">
                {paying
                  ? `No expense in the ${days} before it is left to pay back.`
                  : `No money came in during the ${days} after it.`}
              </p>
            )}
            {searching ? (
              <div className="pb-search">
                <span className="input search">
                  <Icon name="search" />
                  <input
                    type="search"
                    value={text}
                    placeholder="Search descriptions"
                    aria-label={
                      paying ? "Search older expenses" : "Search later payments"
                    }
                    autoFocus
                    onChange={(e) => setText(e.target.value)}
                  />
                </span>
                {search.trim() !== "" &&
                  found.data &&
                  (results.length > 0 ? (
                    <div className="choices">{results.map(choice)}</div>
                  ) : (
                    <p className="muted">
                      {paying
                        ? `No older expense left to pay back contains “${search.trim()}”.`
                        : `No later payment left to link contains “${search.trim()}”.`}
                    </p>
                  ))}
              </div>
            ) : (
              <button
                type="button"
                className="link"
                onClick={() => setSearching(true)}
              >
                <Icon name="search" />
                {paying ? "Search older expenses…" : "Search later payments…"}
              </button>
            )}
            {rows.length > 0 && (
              <div
                className={
                  linked > total ? "linked-total is-over" : "linked-total"
                }
                role="status"
              >
                <Icon name={linked > total ? "alert" : "check"} />
                <span>
                  {paying ? "Linked" : "Paid back"}{" "}
                  <strong>
                    {money(linked)} of {money(total)}
                  </strong>
                  {linked > total
                    ? `: ${money(linked - total)} too much.`
                    : paying && linked < total
                      ? `. The other ${money(total - linked)} needs a category.`
                      : !paying && `. Your share is ${money(total - linked)}.`}
                </span>
              </div>
            )}
            {/* Too much is said above already. */}
            {errors.split && linked <= total && (
              <p className="field-error">
                <Icon name="alert" className="icon icon-sm" />
                {errors.split}
              </p>
            )}
            <p className="caption">
              {paying
                ? "Amounts are prefilled with what's left, newest expense first; adjust them. A payback can't be more than what's left on an expense. Any part you don't link needs a category."
                : "Amounts are prefilled with what's left, nearest payment first; adjust them. A payment can't link more than it has left."}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

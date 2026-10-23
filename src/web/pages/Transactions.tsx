import { useRef, useState } from "react";
import { formatDate, formatDay } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import {
  useAccounts,
  useCategories,
  useTransactions,
  type FoundTransactions,
} from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { ImportButton } from "../components/Shell.tsx";
import {
  amountClass,
  TransactionCategory,
} from "../components/TransactionCategory.tsx";
import { useDebounced } from "../useDebounced.ts";
import { useIsMobile } from "../useIsMobile.ts";
import { TransactionPanel } from "./TransactionPanel.tsx";

/** Rows shown at first, and added by "Load more". */
const PAGE = 50;

type Found = FoundTransactions["transactions"][number];

/** The rows in runs of the same day, in the order they come. */
function byDay(rows: Found[]): [string, Found[]][] {
  const days: [string, Found[]][] = [];
  for (const t of rows) {
    const last = days.at(-1);
    if (last?.[0] === t.date) last[1].push(t);
    else days.push([t.date, [t]]);
  }
  return days;
}

/** S5: every account's transactions, newest first, to search and open. */
export function Transactions() {
  const isMobile = useIsMobile();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const typed = useDebounced(text.trim());
  // Clearing the search shows everything again at once.
  const q = text.trim() === "" ? "" : typed;
  // How many rows to show, from the first page again when the search changes.
  const [limit, setLimit] = useState(PAGE);
  const [limitFor, setLimitFor] = useState(q);
  if (limitFor !== q) {
    setLimitFor(q);
    setLimit(PAGE);
  }
  const found = useTransactions({ q, limit });
  const categories = useCategories();
  const accounts = useAccounts();
  // The transaction open in the panel (S6).
  const [openId, setOpenId] = useState<number | null>(null);

  const page = { title: "Transactions" };
  if (!found.data || !accounts.data) {
    return (
      <Page {...page}>
        <Loading error={found.error ?? accounts.error} />
      </Page>
    );
  }
  const { transactions, total } = found.data;
  const account = (id: number) => accounts.data.find((a) => a.id === id);
  const money = (t: Found) =>
    formatAmount(t.amount, account(t.accountId)?.currency ?? "", {
      signed: true,
    });
  const open = transactions.find((t) => t.id === openId);
  const openAccount = open && account(open.accountId);
  const more = () => setLimit(limit + PAGE);
  const clear = () => {
    setText("");
    input.current?.focus();
  };

  if (total === 0 && q === "") {
    return (
      <Page {...page}>
        <EmptyState
          icon="list"
          title="No transactions yet"
          action={<ImportButton label="Import a statement" />}
        >
          Import a statement to see every account's transactions here.
        </EmptyState>
      </Page>
    );
  }

  const rowClass = (t: Found, base: string) =>
    [base, t.excluded && "is-excluded", t.id === openId && "is-open"]
      .filter(Boolean)
      .join(" ");
  const opener = (t: Found) => (
    <button
      type="button"
      className="row-open"
      aria-expanded={t.id === openId}
      onClick={() => setOpenId(t.id)}
    >
      {t.description}
    </button>
  );
  const category = (t: Found) => (
    <>
      <TransactionCategory
        transaction={t}
        accounts={accounts.data}
        categories={categories.data?.categories}
      />
      {t.excluded && (
        <span className="tag tone-neutral">
          <Icon name="eye-off" />
          Excluded
        </span>
      )}
    </>
  );

  return (
    <Page {...page}>
      <div className="filters">
        <span className="input search">
          <Icon name="search" />
          <input
            ref={input}
            type="search"
            aria-label="Search descriptions"
            placeholder="Search description…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text !== "" && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear search"
              onClick={clear}
            >
              <Icon name="x" className="icon icon-sm" />
            </button>
          )}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState
          icon="search"
          title="No transactions match"
          action={
            <button type="button" className="btn btn-secondary" onClick={clear}>
              Clear search
            </button>
          }
        >
          Nothing matches “{q}” in all accounts. Try another word.
        </EmptyState>
      ) : isMobile ? (
        <>
          {byDay(transactions).map(([date, rows]) => (
            <section className="day" key={date}>
              <h2 className="day-head">{formatDay(date)}</h2>
              <div className="card m-list">
                {rows.map((t) => (
                  <div
                    key={t.id}
                    className={rowClass(t, "m-tx tx")}
                    onClick={() => setOpenId(t.id)}
                  >
                    <span className="desc">{opener(t)}</span>
                    <span className={amountClass(t)}>{money(t)}</span>
                    <span className="meta">
                      {account(t.accountId)?.name}
                      {t.time && ` · ${t.time.slice(0, 5)}`} · {category(t)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {total > transactions.length && (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={more}
            >
              Load more
            </button>
          )}
        </>
      ) : (
        <section className="card table">
          <div className="tr head" aria-hidden="true">
            <span>Date</span>
            <span>Account</span>
            <span>Description</span>
            <span>Category</span>
            <span className="r">Amount</span>
          </div>
          {transactions.map((t) => (
            <div
              key={t.id}
              className={rowClass(t, "tr tx")}
              onClick={() => setOpenId(t.id)}
            >
              <span className="date">
                {formatDate(t.date)}
                {t.time && (
                  <span className="caption">{t.time.slice(0, 5)}</span>
                )}
              </span>
              <span className="acct">{account(t.accountId)?.name}</span>
              <span className="desc">{opener(t)}</span>
              <span className="cat">{category(t)}</span>
              <span className={amountClass(t)}>{money(t)}</span>
            </div>
          ))}
          {total > transactions.length && (
            <div className="table-foot">
              <span>
                Showing the {transactions.length} most recent of {total}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={more}
              >
                Load more
              </button>
            </div>
          )}
        </section>
      )}
      {open && openAccount && (
        <TransactionPanel
          account={openAccount}
          transaction={open}
          onClose={() => setOpenId(null)}
        />
      )}
    </Page>
  );
}

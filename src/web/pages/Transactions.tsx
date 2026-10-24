import { useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { Account } from "../../domain/accounts.ts";
import { groupCategories, type Category } from "../../domain/categories.ts";
import { formatDate, formatDay, formatMonth } from "../../domain/dates.ts";
import {
  formatPeriod,
  isTransactionType,
  readPeriod,
  TRANSACTION_TYPES,
  writePeriod,
  type Filters,
} from "../../domain/filters.ts";
import { formatAmount } from "../../domain/money.ts";
import { reportCurrencies } from "../../domain/reports.ts";
import {
  useAccounts,
  useCategories,
  useTransaction,
  useTransactions,
  type FoundTransaction,
} from "../api.ts";
import { Dialog } from "../components/Dialog.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { ImportButton } from "../components/Shell.tsx";
import {
  amountClass,
  TransactionCategory,
} from "../components/TransactionCategory.tsx";
import {
  plural,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPE_PLURALS,
} from "../labels.ts";
import { useDebounced } from "../useDebounced.ts";
import { useIsMobile } from "../useIsMobile.ts";
import { TransactionPanel } from "./TransactionPanel.tsx";

/** Rows shown at first, and added by "Load more". */
const PAGE = 50;

/** The Account dropdown's value for every account in a currency. */
const CURRENCY = "currency:";

/** The filters but the search, which stays on the page. */
type Picked = Omit<Filters, "q">;

const NONE: Picked = {
  accountId: null,
  currency: null,
  period: null,
  categoryId: null,
  type: null,
};

/**
 * The filters in the address, so that a report can link to them:
 * ?account=2&period=2026-08..2026-10&category=5&type=expense, or
 * ?currency=EUR for every account in a currency. Whatever isn't valid is
 * left out.
 */
function readFilters(params: URLSearchParams): Picked {
  const id = (name: string) => {
    const value = Number(params.get(name));
    return Number.isInteger(value) && value > 0 ? value : null;
  };
  const type = params.get("type") ?? "";
  const currency = params.get("currency") ?? "";
  return {
    accountId: id("account"),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    period: readPeriod(params.get("period") ?? ""),
    categoryId: id("category"),
    type: isTransactionType(type) ? type : null,
  };
}

function writeFilters({
  accountId,
  currency,
  period,
  categoryId,
  type,
}: Picked): URLSearchParams {
  const params = new URLSearchParams();
  if (accountId !== null) params.set("account", String(accountId));
  if (currency) params.set("currency", currency);
  if (period) params.set("period", writePeriod(period));
  if (categoryId !== null) params.set("category", String(categoryId));
  if (type) params.set("type", type);
  return params;
}

/** The rows in runs of the same day, in the order they come. */
function byDay(rows: FoundTransaction[]): [string, FoundTransaction[]][] {
  const days: [string, FoundTransaction[]][] = [];
  for (const t of rows) {
    const last = days.at(-1);
    if (last?.[0] === t.date) last[1].push(t);
    else days.push([t.date, [t]]);
  }
  return days;
}

/**
 * S5: every account's transactions, newest first, to filter, search and
 * open. On a phone the filters are in a sheet, and chips show those set.
 */
export function Transactions() {
  const isMobile = useIsMobile();
  const input = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const picked = readFilters(params);
  const [text, setText] = useState("");
  const typed = useDebounced(text.trim());
  // Clearing the search shows everything again at once.
  const q = text.trim() === "" ? "" : typed;
  const filters: Filters = { ...picked, q };
  // How many rows to show, from the first page again when a filter changes.
  const [limit, setLimit] = useState(PAGE);
  const [limitFor, setLimitFor] = useState(JSON.stringify(filters));
  if (limitFor !== JSON.stringify(filters)) {
    setLimitFor(JSON.stringify(filters));
    setLimit(PAGE);
  }
  const found = useTransactions(filters, limit);
  const categories = useCategories();
  const accounts = useAccounts();
  const [sheet, setSheet] = useState(false);
  // The transaction open in the panel (S6), which stays open when a change
  // takes it out of the list.
  const [openId, setOpenId] = useState<number | null>(null);
  const detail = useTransaction(openId);

  const page = {
    title: "Transactions",
    mobileActions: (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setSheet(true)}
      >
        <Icon name="filter" />
        Filter
      </button>
    ),
  };
  if (!found.data || !accounts.data) {
    return (
      <Page {...page}>
        <Loading error={found.error ?? accounts.error} />
      </Page>
    );
  }
  const { transactions, total, months } = found.data;

  if (months.length === 0) {
    return (
      <Page title={page.title}>
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

  const account = (id: number) => accounts.data.find((a) => a.id === id);
  const categoryName = (id: number) =>
    categories.data?.categories.find((c) => c.id === id)?.name;
  const money = (t: FoundTransaction) =>
    formatAmount(t.amount, account(t.accountId)?.currency ?? "", {
      signed: true,
    });
  const open =
    transactions.find((t) => t.id === openId) ??
    (detail.data?.id === openId ? detail.data : undefined);
  const openAccount = open && account(open.accountId);
  const pick = (change: Partial<Picked>) =>
    setParams(writeFilters({ ...picked, ...change }), { replace: true });
  const more = () => setLimit(limit + PAGE);
  const clearSearch = () => {
    setText("");
    input.current?.focus();
  };
  const filtered = Object.values(picked).some((value) => value !== null);

  // On a phone, what's set, each with a way to take it off.
  const chips = [
    picked.period && {
      label: formatPeriod(picked.period),
      off: { period: null },
    },
    picked.accountId !== null && {
      label: account(picked.accountId)?.name ?? "Unknown account",
      off: { accountId: null },
    },
    picked.currency !== null && {
      label: `${picked.currency} accounts`,
      off: { currency: null },
    },
    picked.categoryId !== null && {
      label: categoryName(picked.categoryId) ?? "Unknown category",
      off: { categoryId: null },
    },
    picked.type && {
      label: TRANSACTION_TYPE_LABELS[picked.type],
      off: { type: null },
    },
  ].filter((chip) => chip !== false && chip !== null);

  const rowClass = (t: FoundTransaction, base: string) =>
    [base, t.excluded && "is-excluded", t.id === openId && "is-open"]
      .filter(Boolean)
      .join(" ");
  const opener = (t: FoundTransaction) => (
    <button
      type="button"
      className="row-open"
      aria-expanded={t.id === openId}
      onClick={() => setOpenId(t.id)}
    >
      {t.description}
    </button>
  );
  const category = (t: FoundTransaction) => (
    <>
      <TransactionCategory
        transaction={t}
        currency={account(t.accountId)?.currency ?? ""}
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
  const selects = (labelled: boolean) => (
    <FilterSelects
      picked={picked}
      onPick={pick}
      months={months}
      accounts={accounts.data}
      categories={categories.data?.categories ?? []}
      labelled={labelled}
    />
  );

  return (
    <Page {...page}>
      <div className="filters">
        {!isMobile && selects(false)}
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
              onClick={clearSearch}
            >
              <Icon name="x" className="icon icon-sm" />
            </button>
          )}
        </span>
      </div>
      {isMobile && chips.length > 0 && (
        <div className="chips" role="group" aria-label="Filters">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className="chip is-active"
              aria-label={`Remove filter: ${chip.label}`}
              onClick={() => pick(chip.off)}
            >
              {chip.label}
              <Icon name="x" />
            </button>
          ))}
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon="search"
          title="No transactions match"
          action={
            filtered ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setText("");
                  pick(NONE);
                }}
              >
                Clear filters
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={clearSearch}
              >
                Clear search
              </button>
            )
          }
        >
          <Nothing
            picked={picked}
            q={q}
            account={
              picked.accountId !== null
                ? account(picked.accountId)?.name
                : picked.currency
                  ? `${picked.currency} accounts`
                  : undefined
            }
            category={
              picked.categoryId === null
                ? undefined
                : categoryName(picked.categoryId)
            }
          />
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
      {isMobile && sheet && (
        <Dialog
          title="Filter"
          onClose={() => setSheet(false)}
          onSubmit={() => setSheet(false)}
          actions={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!filtered}
                onClick={() => pick(NONE)}
              >
                Clear filters
              </button>
              <button type="submit" className="btn btn-primary">
                {found.isPlaceholderData
                  ? "Show transactions"
                  : `Show ${plural(total, "transaction")}`}
              </button>
            </>
          }
        >
          <div className="form">{selects(true)}</div>
        </Dialog>
      )}
      {open && openAccount && (
        <TransactionPanel
          account={openAccount}
          transaction={open}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
        />
      )}
    </Page>
  );
}

/**
 * The account, period, category and type: a row of dropdowns on desktop,
 * labelled fields in the phone's sheet. They apply as soon as they change.
 */
function FilterSelects({
  picked,
  onPick,
  months,
  accounts,
  categories,
  labelled,
}: {
  picked: Picked;
  onPick: (change: Partial<Picked>) => void;
  months: string[];
  accounts: Account[];
  categories: Category[];
  labelled: boolean;
}) {
  const id = useId();
  const period = picked.period && writePeriod(picked.period);
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const archived = accounts.filter((a) => a.archivedOn !== null);
  const currencies = reportCurrencies(accounts);
  const toId = (value: string) => (value === "" ? null : Number(value));
  return (
    <>
      <Choice
        id={`${id}-account`}
        label="Account"
        labelled={labelled}
        value={
          picked.accountId ??
          (picked.currency ? `${CURRENCY}${picked.currency}` : "")
        }
        onChange={(value) =>
          onPick(
            value.startsWith(CURRENCY)
              ? { accountId: null, currency: value.slice(CURRENCY.length) }
              : { accountId: toId(value), currency: null },
          )
        }
      >
        <option value="">All accounts</option>
        {/* With more than one currency, a report links to one of them. */}
        {currencies.length > 1 &&
          currencies.map((c) => (
            <option key={c} value={`${CURRENCY}${c}`}>
              All {c} accounts
            </option>
          ))}
        {accounts
          .filter((a) => a.archivedOn === null)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        {archived.length > 0 && (
          <optgroup label="Archived">
            {archived.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        )}
      </Choice>
      <Choice
        id={`${id}-period`}
        label="Period"
        labelled={labelled}
        value={period ?? ""}
        onChange={(value) => onPick({ period: readPeriod(value) })}
      >
        <option value="">All time</option>
        {/* A period a report linked to, when no month in the list is it. */}
        {picked.period && period && !months.includes(period) && (
          <option value={period}>{formatPeriod(picked.period)}</option>
        )}
        {years.map((year) => (
          <optgroup key={year} label={year}>
            {months
              .filter((m) => m.startsWith(year))
              .map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
          </optgroup>
        ))}
      </Choice>
      <Choice
        id={`${id}-category`}
        label="Category"
        labelled={labelled}
        value={picked.categoryId ?? ""}
        onChange={(value) => onPick({ categoryId: toId(value) })}
      >
        <option value="">All categories</option>
        {groupCategories(categories).map((group) => (
          <optgroup
            key={group.type}
            label={group.type === "income" ? "Income" : "Expenses"}
          >
            {group.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Choice>
      <Choice
        id={`${id}-type`}
        label="Type"
        labelled={labelled}
        value={picked.type ?? ""}
        onChange={(value) =>
          onPick({ type: isTransactionType(value) ? value : null })
        }
      >
        <option value="">All types</option>
        {TRANSACTION_TYPES.map((type) => (
          <option key={type} value={type}>
            {TRANSACTION_TYPE_LABELS[type]}
          </option>
        ))}
      </Choice>
    </>
  );
}

/** One filter's dropdown, labelled in the sheet, named for screen readers in the row. */
function Choice({
  id,
  label,
  labelled,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  labelled: boolean;
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const select = (
    <span className="select-wrap">
      <select
        id={id}
        className="select"
        aria-label={labelled ? undefined : label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <Icon name="chevron" />
    </span>
  );
  return labelled ? (
    <Field id={id} label={label}>
      {select}
    </Field>
  ) : (
    select
  );
}

/**
 * Why the list is empty, in the filters' words: "Nothing in October 2026
 * matches “netflix” among expenses in all accounts. Try another word, or a
 * longer period."
 */
function Nothing({
  picked,
  q,
  account,
  category,
}: {
  picked: Picked;
  q: string;
  account: string | undefined;
  category: string | undefined;
}) {
  const where = [
    "Nothing",
    picked.period && `in ${formatPeriod(picked.period)}`,
    q && `matches “${q}”`,
    picked.type && `among ${TRANSACTION_TYPE_PLURALS[picked.type]}`,
    category && `under ${category}`,
    `in ${account ?? "all accounts"}`,
  ].filter(Boolean);
  const tries = [q && "another word", picked.period && "a longer period"]
    .filter(Boolean)
    .join(", or ");
  return (
    <>
      {where.join(" ")}. {tries ? `Try ${tries}.` : "Try other filters."}
    </>
  );
}

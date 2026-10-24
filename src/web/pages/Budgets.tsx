import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { addMonths, formatMonth, isMonth } from "../../domain/dates.ts";
import { formatAmount, formatSize } from "../../domain/money.ts";
import { useBudgets, type BudgetList, type BudgetRow } from "../api.ts";
import { CurrencySwitch } from "../components/CurrencySwitch.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { linesTo } from "../components/Report.tsx";
import { ImportButton } from "../components/Shell.tsx";
import { Toast } from "../components/Toast.tsx";
import { AddBudget } from "../dialogs/AddBudget.tsx";
import { useIsMobile } from "../useIsMobile.ts";

/** This month, or the running balance (brief §6.2). */
type View = "month" | "running";

/** A started budget's numbers in a view, and how full its bar is. */
interface Figures {
  /** The month's limit, or everything budgeted since it counts from. */
  limit: number;
  spent: number;
  left: number;
  /** 0 to 100: what's spent, in percent of the limit. */
  filled: number;
}

function figures(budget: BudgetRow, view: View): Figures | null {
  const { status } = budget;
  if (!status) return null;
  const { limit, spent, left } =
    view === "month"
      ? status.month
      : {
          limit: status.running.budgeted,
          spent: status.running.spent,
          left: status.running.left,
        };
  const filled = Math.round((Math.max(0, spent) / limit) * 100);
  return { limit, spent, left, filled: Math.min(100, filled) };
}

/** Over budget first, then the others by name; those not started last. */
function ordered(budgets: BudgetRow[], view: View) {
  const rank = (b: BudgetRow) => {
    const f = figures(b, view);
    return f === null ? 2 : f.left < 0 ? 0 : 1;
  };
  return budgets.toSorted((a, b) => rank(a) - rank(b));
}

/**
 * S14: the budgets of one currency in one month, picked in the address
 * (?month=2026-10&currency=USD&view=running) like the reports. Each opens
 * its history (S15).
 */
export function Budgets() {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? "";
  const currency = params.get("currency") ?? "";
  const view: View = params.get("view") === "running" ? "running" : "month";
  const list = useBudgets({
    month: isMonth(month) ? month : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
  });
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(
    null,
  );

  const add = (
    <button
      type="button"
      className={isMobile ? "btn btn-primary btn-sm" : "btn btn-primary"}
      onClick={() => setAdding(true)}
    >
      <Icon name="plus" />
      {isMobile ? "Add" : "Add budget"}
    </button>
  );
  const page = { title: "Budgets" };
  if (!list.data) {
    return (
      <Page {...page}>
        <Loading error={list.error} />
      </Page>
    );
  }

  const r = list.data;
  const go = (change: { month?: string; currency?: string; view?: View }) => {
    const next = { month: r.month, currency: r.currency, view, ...change };
    setParams(
      {
        month: next.month,
        currency: next.currency,
        ...(next.view === "running" && { view: "running" }),
      },
      { replace: true },
    );
  };
  const noAccounts = r.currencies.length === 0;

  return (
    <Page
      {...page}
      actions={!noAccounts && add}
      mobileActions={!noAccounts && add}
    >
      {noAccounts ? (
        <EmptyState
          icon="gauge"
          title="No budgets yet"
          action={<ImportButton label="Import a statement" />}
        >
          Budgets count what you spend in your accounts. Import a statement
          first, then set a monthly limit for a category.
        </EmptyState>
      ) : r.budgets.length === 0 ? (
        <>
          {r.currencies.length > 1 && (
            <div className="controls">
              <CurrencySwitch
                currencies={r.currencies}
                value={r.currency}
                onChange={(currency) => go({ currency })}
              />
            </div>
          )}
          <EmptyState
            icon="gauge"
            title={
              r.currencies.length > 1
                ? `No ${r.currency} budgets yet`
                : "No budgets yet"
            }
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" />
                Add budget
              </button>
            }
          >
            Set a monthly limit for a category and see how much is left as the
            month goes on. Unspent money can carry over.
          </EmptyState>
        </>
      ) : (
        <div
          className={list.isPlaceholderData ? "report is-loading" : "report"}
        >
          <Controls list={r} view={view} go={go} />
          {isMobile ? (
            <MobileList list={r} view={view} />
          ) : (
            <DesktopList list={r} view={view} />
          )}
          <Note list={r} view={view} />
        </div>
      )}

      {adding && (
        <AddBudget
          list={r}
          onClose={() => setAdding(false)}
          onAdded={(budget) => {
            go({ currency: budget.currency });
            setToast((previous) => ({
              key: (previous?.key ?? 0) + 1,
              text: `${budget.name} now has a budget of ${formatAmount(budget.plan.limits[0]!.amount, budget.currency)} a month, from ${formatMonth(budget.plan.start)}.`,
            }));
          }}
        />
      )}
      {toast && (
        <Toast
          key={toast.key}
          text={toast.text}
          onDone={() => setToast(null)}
        />
      )}
    </Page>
  );
}

/** The view, the currency and the month. */
function Controls({
  list: r,
  view,
  go,
}: {
  list: BudgetList;
  view: View;
  go: (change: { month?: string; currency?: string; view?: View }) => void;
}) {
  const id = useId();
  // Back to the month the oldest budget starts.
  const oldest = r.budgets.map((b) => b.start).sort()[0] ?? r.month;
  const views: [View, string][] = [
    ["month", "This month"],
    ["running", "Running balance"],
  ];
  return (
    <div className="controls">
      <div className="seg" role="radiogroup" aria-label="View">
        {views.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              className="visually-hidden"
              name={`${id}-view`}
              checked={view === value}
              onChange={() => go({ view: value })}
            />
            {label}
          </label>
        ))}
      </div>
      <CurrencySwitch
        currencies={r.currencies}
        value={r.currency}
        onChange={(currency) => go({ currency })}
      />
      <span className="month-nav push">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous month"
          disabled={r.month <= oldest}
          onClick={() => go({ month: addMonths(r.month, -1) })}
        >
          <Icon name="prev" />
        </button>
        <span aria-live="polite">
          {formatMonth(r.month)}
          {r.month === r.thisMonth && (
            <span className="caption"> · so far</span>
          )}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next month"
          disabled={r.month >= r.thisMonth}
          onClick={() => go({ month: addMonths(r.month, 1) })}
        >
          <Icon name="next" />
        </button>
      </span>
    </div>
  );
}

function Bar({ figures: f }: { figures: Figures }) {
  const over = f.left < 0;
  return (
    <span className={over ? "bar is-over" : "bar"} aria-hidden="true">
      <span style={{ width: `${over ? 100 : f.filled}%` }} />
    </span>
  );
}

function OverTag() {
  return (
    <span className="tag tone-danger">
      <Icon name="alert" />
      Over
    </span>
  );
}

/** What a row says to a screen reader, as its columns can't. */
function rowLabel(budget: BudgetRow, view: View, f: Figures | null) {
  const money = (minor: number) => formatAmount(minor, budget.currency);
  if (!f) return `${budget.name}: starts in ${formatMonth(budget.start)}`;
  const of =
    view === "month"
      ? `${money(f.spent)} spent of ${money(f.limit)}`
      : `${money(f.spent)} spent of ${money(f.limit)} budgeted since ${formatMonth(budget.status!.running.since)}`;
  const left = f.left < 0 ? `${money(-f.left)} over` : `${money(f.left)} left`;
  return `${budget.name}: ${of}, ${left}`;
}

function DesktopList({ list: r, view }: { list: BudgetList; view: View }) {
  const money = (minor: number, signed = false) =>
    formatAmount(minor, r.currency, { signed });
  const running = view === "running";
  return (
    <section className="card table">
      <div className={running ? "br run head" : "br head"} aria-hidden="true">
        <span>Category</span>
        {running && <span>Since</span>}
        <span className="r">{running ? "Budgeted" : "Limit"}</span>
        <span className="r">Spent</span>
        <span className="r">Left</span>
        <span>Progress</span>
      </div>
      {ordered(r.budgets, view).map((b) => {
        const f = figures(b, view);
        return (
          <Link
            key={b.id}
            className={running ? "br run" : "br"}
            to={`/budgets/${b.id}`}
            aria-label={rowLabel(b, view, f)}
          >
            <span className="name">{b.name}</span>
            {f === null ? (
              <span className="muted-cell later">
                Starts in {formatMonth(b.start)}, with {money(b.limit)} a month
              </span>
            ) : (
              <>
                {running && (
                  <span className="muted-cell">
                    {formatMonth(b.status!.running.since)}
                  </span>
                )}
                <span className="num">{money(f.limit)}</span>
                <span className="num">{money(f.spent)}</span>
                <span className={f.left < 0 ? "num neg" : "num"}>
                  {money(f.left, running)}
                </span>
                <span className="progress">
                  <Bar figures={f} />
                  {f.left < 0 && <OverTag />}
                </span>
              </>
            )}
          </Link>
        );
      })}
    </section>
  );
}

function MobileList({ list: r, view }: { list: BudgetList; view: View }) {
  const money = (minor: number, signed = false) =>
    formatAmount(minor, r.currency, { signed });
  return ordered(r.budgets, view).map((b) => {
    const f = figures(b, view);
    const over = f !== null && f.left < 0;
    return (
      <Link
        key={b.id}
        className="card m-budget"
        to={`/budgets/${b.id}`}
        aria-label={rowLabel(b, view, f)}
      >
        <strong>
          {b.name} {over && <OverTag />}
        </strong>
        {f === null ? (
          <>
            <span className="amount">{money(b.limit)}</span>
            <span className="caption">Starts in {formatMonth(b.start)}</span>
          </>
        ) : view === "month" ? (
          <>
            <span className="amount">
              {formatSize(f.spent, r.currency)} / {money(f.limit)}
            </span>
            <Bar figures={f} />
            <span className="caption">
              {over ? (
                <span className="over">{money(-f.left)} over</span>
              ) : (
                `${money(f.left)} left`
              )}
            </span>
          </>
        ) : (
          <>
            <span className={over ? "amount over" : "amount"}>
              {money(f.left, true)}
            </span>
            <Bar figures={f} />
            <span className="caption">
              {money(f.limit)} budgeted · {money(f.spent)} spent · since{" "}
              {formatMonth(b.status!.running.since)}
            </span>
          </>
        )}
      </Link>
    );
  });
}

/**
 * Under the list: the month's spending that counts toward no budget, or
 * how the running balance adds up, with a budget's numbers.
 */
function Note({ list: r, view }: { list: BudgetList; view: View }) {
  const money = (minor: number, signed = false) =>
    formatAmount(minor, r.currency, { signed });
  if (view === "running") {
    const example = ordered(r.budgets, view).find((b) => b.status);
    const run = example?.status?.running;
    return (
      <p className="caption">
        Running balance = every month's limit since the budget started, minus
        everything spent.
        {example &&
          run &&
          ` ${example.name}: ${money(run.budgeted)} budgeted − ${money(run.spent)} spent = ${money(run.left, true)}.`}
      </p>
    );
  }
  if (r.uncategorized >= 0) return null;
  const when =
    r.month === r.thisMonth ? "this month" : `in ${formatMonth(r.month)}`;
  return (
    <p className="caption">
      Uncategorized spending {when} ({money(r.uncategorized)}) doesn't count
      toward any budget until you{" "}
      <Link
        className="link"
        to={linesTo({ categoryId: null }, "expense", {
          period: { from: r.month, to: r.month },
          currency: r.currency,
          currencies: r.currencies,
        })}
      >
        categorize it
      </Link>
      .
    </p>
  );
}

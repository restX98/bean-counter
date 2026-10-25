import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { groupByCurrency, type CurrencyGroup } from "../../domain/accounts.ts";
import { formatMonth } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { shownEnd } from "../../domain/review.ts";
import {
  useAccounts,
  useBudgets,
  useMonthlyReport,
  useReview,
  type BudgetRow,
  type MonthlyReport,
  type ReviewMismatch,
} from "../api.ts";
import { BudgetBar, OverTag, spentOf } from "../components/BudgetBar.tsx";
import { CurrencySwitch } from "../components/CurrencySwitch.tsx";
import { EmptyState, FirstRunSteps } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { ImportButton } from "../components/Shell.tsx";
import { AccountForm } from "../dialogs/AccountForm.tsx";
import { listNames, plural, TYPE_LABELS } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

/**
 * S1, where I stand: the balances in one currency, the newest month's
 * income and expenses, and what waits in Review. Before that, the
 * first-run steps: no accounts (→ Add account), then nothing imported
 * (→ Import). The currency is in the address (?currency=USD).
 */
export function Dashboard() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const { data: accounts, error } = useAccounts();
  const groups = accounts ? groupByCurrency(accounts) : [];
  const group =
    groups.find((g) => g.currency === params.get("currency")) ?? groups[0];
  const report = useMonthlyReport({
    currency: group?.currency ?? null,
    month: null,
  });
  const [adding, setAdding] = useState(false);

  const page = { title: "Dashboard", mobileTitle: "Home" };
  if (!accounts) {
    return (
      <Page {...page}>
        <Loading error={error} />
      </Page>
    );
  }

  const imported = groups.some((g) =>
    g.accounts.some((a) => a.transactionCount > 0),
  );
  if (!group || !imported) {
    return (
      <Page {...page}>
        {!group ? (
          <EmptyState
            icon="wallet"
            title={
              accounts.length > 0 ? "No active accounts" : "No accounts yet"
            }
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" />
                Add account
              </button>
            }
            after={<FirstRunSteps next={0} />}
          >
            Add an account, then import a statement to see your cashflow.
          </EmptyState>
        ) : (
          <EmptyState
            icon="import"
            title="No transactions yet"
            action={<ImportButton label="Import a statement" />}
            after={<FirstRunSteps next={1} />}
          >
            Import a statement to see your balances, income and expenses here.
          </EmptyState>
        )}
        {adding && (
          <AccountForm
            onClose={() => setAdding(false)}
            onSaved={(account) => navigate(`/accounts/${account.id}`)}
          />
        )}
      </Page>
    );
  }

  const switcher = (
    <CurrencySwitch
      className={isMobile ? "seg fill" : "seg"}
      currencies={groups.map((g) => g.currency)}
      value={group.currency}
      onChange={(currency) => setParams({ currency }, { replace: true })}
    />
  );
  const r = report.data;
  // Under the balances on desktop, after the month on a phone.
  const budgets = (
    <BudgetsCard currency={group.currency} several={groups.length > 1} />
  );
  return (
    <Page
      {...page}
      subtitle={
        r?.first &&
        `${formatMonth(r.month)}${r.month === r.thisMonth ? " · so far" : ""}`
      }
      actions={
        <>
          {switcher}
          <ImportButton />
        </>
      }
      mobileActions={<ImportButton className="btn btn-primary btn-sm" />}
    >
      {isMobile && switcher}
      <div className="grid-2">
        <div className="grid-col">
          <BalanceCard
            group={group}
            others={groups.filter((g) => g !== group)}
          />
          {!isMobile && budgets}
        </div>
        <div className="grid-col">
          {r ? (
            <MonthCard report={r} several={groups.length > 1} />
          ) : (
            <Loading error={report.error} />
          )}
          {isMobile && budgets}
          <ReviewCard />
        </div>
      </div>
    </Page>
  );
}

/**
 * The total in one currency and each account's balance. An account whose
 * balances part from the bank's says by how much, as Review does.
 */
function BalanceCard({
  group,
  others,
}: {
  group: CurrencyGroup;
  others: CurrencyGroup[];
}) {
  const { data: review } = useReview();
  const money = (minor: number) => formatAmount(minor, group.currency);
  // The newest place each account parts from the bank.
  const newest = new Map<number, ReviewMismatch>();
  for (const m of review?.mismatches ?? []) {
    const seen = newest.get(m.accountId);
    if (!seen || m.until > seen.until) newest.set(m.accountId, m);
  }
  const off = (accountId: number) => {
    const m = newest.get(accountId);
    if (!m) return null;
    const { app, bank } = shownEnd(m);
    return Math.abs(bank - app);
  };
  const elsewhere = others.flatMap((g) => g.accounts.map((a) => a.name));

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Total balance</h2>
        <span className="caption">
          {group.currency} · {plural(group.accounts.length, "account")}
        </span>
      </div>
      <span className="big-number">
        {group.total === null ? "—" : money(group.total)}
      </span>
      <div className="accounts">
        {group.accounts.map((a) => {
          const by = off(a.id);
          return (
            <div className="account" key={a.id}>
              <span className="name">
                <Link className="link" to={`/accounts/${a.id}`}>
                  {a.name}
                </Link>
                {by !== null && (
                  <span className="tag tone-warning">
                    <Icon name="alert" />
                    Off by {money(by)}
                  </span>
                )}
              </span>
              <span className="caption">
                {a.bank} · {TYPE_LABELS[a.type].toLowerCase()}
                {!a.balance && " · No balance yet"}
              </span>
              <span className="amount">
                {a.balance ? money(a.balance.amount) : "—"}
              </span>
            </div>
          );
        })}
      </div>
      {elsewhere.length > 0 && (
        <p className="caption">
          {listNames(elsewhere)} ({others.map((g) => g.currency).join(", ")}){" "}
          {elsewhere.length === 1 ? "shows" : "show"} when you switch currency.
        </p>
      )}
    </section>
  );
}

/** The newest month's income, expenses and net, with the way to S12. */
function MonthCard({
  report: r,
  several,
}: {
  report: MonthlyReport;
  /** Accounts in more than one currency: the report needs this one. */
  several: boolean;
}) {
  const money = (minor: number) =>
    formatAmount(minor, r.currency, { signed: true });
  const query = new URLSearchParams({ month: r.month });
  if (several) query.set("currency", r.currency);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          {r.first ? formatMonth(r.month) : "This month"}
        </h2>
        {r.month === r.thisMonth && <span className="caption">so far</span>}
      </div>
      {r.first ? (
        <div className="kv">
          <span>Income</span>
          <span className="amount income">{money(r.income.total)}</span>
          <span>Expenses</span>
          <span className="amount">{money(r.expenses.total)}</span>
          <span className="total">Net cashflow</span>
          <span className="amount total">{money(r.net)}</span>
        </div>
      ) : (
        <p className="muted">
          Nothing imported into your {r.currency} accounts yet.
        </p>
      )}
      {r.first && (
        <div className="card-foot">
          <Link className="link" to={`/reports/monthly?${query}`}>
            Open monthly report
            <Icon name="arrow" />
          </Link>
        </div>
      )}
    </section>
  );
}

/** How many budgets the dashboard shows. */
const SHOWN_BUDGETS = 5;

/**
 * The newest month's budgets at a glance, over budget first, with the way
 * to S14. Hidden until a budget in this currency has started.
 */
function BudgetsCard({
  currency,
  several,
}: {
  currency: string;
  /** Accounts in more than one currency: Budgets needs this one. */
  several: boolean;
}) {
  const { data } = useBudgets({ currency, month: null });
  const started = (data?.budgets ?? []).filter((b) => b.status !== null);
  if (!data || started.length === 0) return null;
  const over = (b: BudgetRow) => b.status!.month.left < 0;
  const shown = started
    .toSorted((a, b) => Number(over(b)) - Number(over(a)))
    .slice(0, SHOWN_BUDGETS);
  const month =
    data.month === data.thisMonth
      ? `${formatMonth(data.month).split(" ")[0]} so far`
      : formatMonth(data.month);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Budgets</h2>
        <span className="caption">{month}</span>
      </div>
      {shown.map((b) => {
        const { spent, limit } = b.status!.month;
        return (
          <div className="budget" key={b.id}>
            <span className="name">
              <Link className="link" to={`/budgets/${b.id}`}>
                {b.name}
              </Link>
              {over(b) && <OverTag />}
            </span>
            <span className={over(b) ? "amount" : "amount muted"}>
              {spentOf(spent, limit, currency)}
            </span>
            <BudgetBar spent={spent} limit={limit} />
          </div>
        );
      })}
      <div className="card-foot">
        <Link
          className="link"
          to={
            several
              ? `/budgets?${new URLSearchParams({ currency })}`
              : "/budgets"
          }
        >
          {data.budgets.length > shown.length
            ? `All ${data.budgets.length} budgets`
            : "All budgets"}
          <Icon name="arrow" />
        </Link>
      </div>
    </section>
  );
}

/** What waits in Review, by group. Hidden when nothing does. */
function ReviewCard() {
  const { data } = useReview();
  if (!data || data.count === 0) return null;
  const groups: [number, string, string][] = [
    [data.paybacks.length, "possible payback", "possible paybacks"],
    [
      data.uncategorized.length,
      "uncategorized transaction",
      "uncategorized transactions",
    ],
    [data.conflicts.length, "rule conflict", "rule conflicts"],
    [
      data.transfers.length + data.exchanges.length,
      "transfer to confirm",
      "transfers to confirm",
    ],
    [data.mismatches.length, "balance mismatch", "balance mismatches"],
  ];
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Review</h2>
        <span className="badge">{data.count}</span>
      </div>
      <p>
        <strong>
          {plural(data.count, "item")} {data.count === 1 ? "needs" : "need"}{" "}
          your decision
        </strong>
      </p>
      <ul className="counts">
        {groups
          .filter(([count]) => count > 0)
          .map(([count, one, many]) => (
            <li key={one}>
              <span className="badge neutral">{count}</span>
              {count === 1 ? one : many}
            </li>
          ))}
      </ul>
      <div className="card-foot">
        <Link className="btn btn-secondary" to="/review">
          Open Review
        </Link>
      </div>
    </section>
  );
}

import { Fragment } from "react";
import { Link, useSearchParams } from "react-router";
import type { Category, CategoryType } from "../../domain/categories.ts";
import {
  addMonths,
  formatDate,
  formatMonth,
  isMonth,
} from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import type { ReportLine } from "../../domain/reports.ts";
import {
  useAccounts,
  useCategories,
  useMonthlyReport,
  type MonthlyReport,
} from "../api.ts";
import { CurrencySwitch } from "../components/CurrencySwitch.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { MonthBars } from "../components/MonthBars.tsx";
import { Loading, Page } from "../components/Page.tsx";
import {
  linesTo,
  NotCountedYet,
  ReportTabs,
  WaitingBanner,
} from "../components/Report.tsx";
import { ImportButton } from "../components/Shell.tsx";

/**
 * S12, Monthly in vs out: one month in one currency, picked in the address
 * (?month=2026-10&currency=USD) so the dashboard can link to it. Each line
 * opens its transactions, and the chart's months open theirs.
 */
export function Reports() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? "";
  const currency = params.get("currency") ?? "";
  const asked = {
    month: isMonth(month) ? month : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
  const report = useMonthlyReport(asked);
  const accounts = useAccounts();
  const categories = useCategories();

  const page = { title: "Reports" };
  const tabs = <ReportTabs currency={asked.currency} />;
  if (!report.data || !accounts.data) {
    return (
      <Page {...page}>
        {tabs}
        <Loading error={report.error ?? accounts.error} />
      </Page>
    );
  }
  const r = report.data;
  if (r.first === null) {
    return (
      <Page {...page}>
        {tabs}
        <EmptyState
          icon="chart"
          title="No transactions yet"
          action={<ImportButton label="Import a statement" />}
        >
          Import a statement to see your income, expenses and savings month by
          month.
        </EmptyState>
      </Page>
    );
  }

  const go = (change: { month?: string; currency?: string }) =>
    setParams(
      { month: r.month, currency: r.currency, ...change },
      { replace: true },
    );
  const money = (minor: number, signed = true) =>
    formatAmount(minor, r.currency, { signed });
  const soFar = r.month === r.thisMonth;
  const accountName = (accountId: number) =>
    accounts.data.find((a) => a.id === accountId)?.name ?? "";
  const nothing =
    r.income.lines.length === 0 &&
    r.expenses.lines.length === 0 &&
    r.movedToSavings.transfers.length === 0 &&
    r.pending.length === 0;

  return (
    <Page {...page}>
      {tabs}
      <div
        className={report.isPlaceholderData ? "report is-loading" : "report"}
      >
        <div className="controls">
          <span className="month-nav">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous month"
              disabled={r.month <= r.first}
              onClick={() => go({ month: addMonths(r.month, -1) })}
            >
              <Icon name="prev" />
            </button>
            <span aria-live="polite">
              {formatMonth(r.month)}
              {soFar && <span className="caption"> · so far</span>}
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
          <CurrencySwitch
            className="seg push"
            currencies={r.currencies}
            value={r.currency}
            onChange={(currency) => go({ currency })}
          />
        </div>

        <WaitingBanner count={r.waiting} />

        {nothing ? (
          <EmptyState icon="chart" title={`Nothing in ${formatMonth(r.month)}`}>
            No transactions in your {r.currency} accounts this month
            {soFar && " yet"}. Import its statement, or pick another month.
          </EmptyState>
        ) : (
          <div className="grid-2">
            <InOut
              report={r}
              money={money}
              soFar={soFar}
              categories={categories.data?.categories ?? []}
            />
            <MovedToSavings
              report={r}
              money={money}
              accountName={accountName}
            />
          </div>
        )}

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Last 12 months</h2>
            <span className="caption">{r.currency}</span>
          </div>
          <MonthBars
            months={r.months}
            currency={r.currency}
            thisMonth={r.thisMonth}
            onPick={(month) => go({ month })}
          />
          <div className="key">
            <span>
              <span className="swatch income" />
              Income
            </span>
            <span>
              <span className="swatch expenses" />
              Expenses
            </span>
            {r.months.some((m) => m.month === r.thisMonth) && (
              <span>
                {formatMonth(r.thisMonth).split(" ")[0]} is the month so far
              </span>
            )}
          </div>
        </section>
      </div>
    </Page>
  );
}

/** Income, expenses, net and savings rate (brief §6.1). */
function InOut({
  report: r,
  money,
  soFar,
  categories,
}: {
  report: MonthlyReport;
  money: (minor: number) => string;
  soFar: boolean;
  categories: Category[];
}) {
  const name = (line: ReportLine) =>
    line.categoryId === null
      ? "Uncategorized"
      : (categories.find((c) => c.id === line.categoryId)?.name ?? "");
  const side = (title: string, type: CategoryType) => {
    const { lines, total } = type === "income" ? r.income : r.expenses;
    return (
      <>
        <strong>{title}</strong>
        <span className={type === "income" ? "amount income" : "amount"}>
          <strong>{money(total)}</strong>
        </span>
        {lines.map((line) => (
          <Fragment key={line.categoryId ?? "none"}>
            <Link
              className="indent"
              to={linesTo(line, type, {
                period: { from: r.month, to: r.month },
                currency: r.currency,
                currencies: r.currencies,
              })}
            >
              {name(line)}
            </Link>
            <span className="amount sub">{money(line.amount)}</span>
          </Fragment>
        ))}
      </>
    );
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{formatMonth(r.month)}</h2>
        {soFar && <span className="caption">so far</span>}
      </div>
      <div className="kv">
        {side("Income", "income")}
        {side("Expenses", "expense")}
        <span className="total">Net cashflow</span>
        <span className="amount total">{money(r.net)}</span>
        <span className="muted">Savings rate</span>
        <span className="amount muted">
          {r.savingsRate === null
            ? "—"
            : `${Math.round(r.savingsRate * 100)} %`}
        </span>
      </div>
    </section>
  );
}

/**
 * Net transfers from checking into savings, each with its direction, and
 * the possible transfers not counted until I decide.
 */
function MovedToSavings({
  report: r,
  money,
  accountName,
}: {
  report: MonthlyReport;
  money: (minor: number, signed?: boolean) => string;
  accountName: (accountId: number) => string;
}) {
  const { transfers, total } = r.movedToSavings;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Moved to savings</h2>
        <span className="amount transfer card-title">
          {money(total, total < 0)}
        </span>
      </div>
      {transfers.length === 0 ? (
        <p className="muted">
          Nothing moved between checking and savings this month.
        </p>
      ) : (
        transfers.map(({ amount, savings, other }) => (
          <div className="linked" key={savings.id}>
            <Icon name="transfer" />
            <strong>
              {amount >= 0
                ? `${accountName(other.accountId)} → ${accountName(savings.accountId)}`
                : `${accountName(savings.accountId)} → ${accountName(other.accountId)}`}
            </strong>
            <span className="caption">
              {formatDate(savings.date)} · {savings.description}
            </span>
            <span className="amount transfer">
              {money(Math.abs(amount), false)}
            </span>
          </div>
        ))
      )}
      <NotCountedYet pending={r.pending} currency={r.currency} />
    </section>
  );
}

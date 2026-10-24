import { useState } from "react";
import { Link, useParams } from "react-router";
import { limitIn, restartChoices } from "../../domain/budgets.ts";
import { formatMonth } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { reportCurrencies } from "../../domain/reports.ts";
import { useAccounts, useBudget, type Budget } from "../api.ts";
import { BudgetBar, spentOf } from "../components/BudgetBar.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { linesTo } from "../components/Report.tsx";
import { Toast } from "../components/Toast.tsx";
import { ChangeLimit } from "../dialogs/ChangeLimit.tsx";
import { StartOver } from "../dialogs/StartOver.tsx";
import { useIsMobile } from "../useIsMobile.ts";

/**
 * S15: a budget month by month, newest first, each month with the limit it
 * had. Change limit and Start over open D7.
 */
export function BudgetDetail() {
  const isMobile = useIsMobile();
  const id = Number(useParams().id);
  const budget = useBudget(id);
  const accounts = useAccounts();
  const [open, setOpen] = useState<"limit" | "restart" | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(
    null,
  );

  const back = { to: "/budgets", label: "Back to Budgets" };
  if (!budget.data || !accounts.data) {
    return (
      <Page title="Budget" back={back}>
        <Loading error={budget.error ?? accounts.error} />
      </Page>
    );
  }

  const b = budget.data;
  const money = (minor: number, signed = false) =>
    formatAmount(minor, b.currency, { signed });
  const limitNow = limitIn(b.plan, b.thisMonth) ?? b.plan.limits[0]!.amount;
  const details = `${b.currency} · ${money(limitNow)} per month · since ${formatMonth(b.plan.start)}`;
  const canRestart = restartChoices(b.plan, b.thisMonth).length > 0;
  const notify = (text: string) =>
    setToast((previous) => ({ key: (previous?.key ?? 0) + 1, text }));

  const actions = (
    <>
      {canRestart && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOpen("restart")}
        >
          Start over…
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen("limit")}
      >
        Change limit
      </button>
    </>
  );
  // A month's transactions in S5, as the budget counts them.
  const transactionsIn = (month: string) =>
    linesTo({ categoryId: b.categoryId }, "expense", {
      period: { from: month, to: month },
      currency: b.currency,
      currencies: reportCurrencies(accounts.data),
    });
  const monthName = (month: string) =>
    month === b.thisMonth
      ? `${formatMonth(month)} · so far`
      : formatMonth(month);
  const history = b.history.toReversed();

  return (
    <Page
      title={b.name}
      subtitle={details}
      crumb={{ to: "/budgets", label: "Budgets" }}
      actions={actions}
      back={back}
    >
      {isMobile && (
        <>
          <p className="muted">{details}</p>
          <div className="m-actions">{actions}</div>
        </>
      )}

      {b.status === null ? (
        <EmptyState
          icon="gauge"
          title={`Starts in ${formatMonth(b.plan.start)}`}
        >
          Its history begins in {formatMonth(b.plan.start)}, with{" "}
          {money(b.plan.limits[0]!.amount)} a month. You can change the limit
          before then.
        </EmptyState>
      ) : (
        <>
          <Summary budget={b} money={money} />
          {isMobile ? (
            <>
              <p className="label">History</p>
              <div className="card m-list">
                {history.map((m) => (
                  <Link
                    key={m.month}
                    className="m-tx"
                    to={transactionsIn(m.month)}
                  >
                    <span className="desc">
                      {monthName(m.month)}
                      {m.restart && " · started over"}
                    </span>
                    <span className="amount">{money(m.running, true)}</span>
                    <span className="meta">
                      <span>
                        {money(m.spent)} of {money(m.limit)} ·{" "}
                        <span className={m.left < 0 ? "over" : undefined}>
                          {money(m.left, true)}
                        </span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <section className="card table">
              <h2 className="group-head">History</h2>
              <div className="br hr head" aria-hidden="true">
                <span>Month</span>
                <span className="r">Limit</span>
                <span className="r">Spent</span>
                <span className="r">Left</span>
                <span className="r">Running balance</span>
                <span />
              </div>
              {history.map((m) => (
                <div key={m.month} className="br hr">
                  <span className="name">
                    {monthName(m.month)}
                    {m.restart && (
                      <span className="tag tone-neutral">Started over</span>
                    )}
                  </span>
                  <span className="num">{money(m.limit)}</span>
                  <span className="num">{money(m.spent)}</span>
                  <span className={m.left < 0 ? "num neg" : "num"}>
                    {money(m.left, true)}
                  </span>
                  <span className={m.running < 0 ? "num neg" : "num"}>
                    {money(m.running, true)}
                  </span>
                  <Link
                    className="link"
                    to={transactionsIn(m.month)}
                    aria-label={`Transactions in ${formatMonth(m.month)}`}
                  >
                    Transactions
                    <Icon name="arrow" />
                  </Link>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      <p className="caption">
        If you change the limit, you choose the month it applies from. Earlier
        months keep the limit they had.
      </p>

      {open === "limit" && (
        <ChangeLimit
          budget={b}
          onClose={() => setOpen(null)}
          onSaved={(amount, from) =>
            notify(
              `${b.name} is now ${money(amount)} a month from ${formatMonth(from)}.`,
            )
          }
        />
      )}
      {open === "restart" && (
        <StartOver
          budget={b}
          onClose={() => setOpen(null)}
          onSaved={(from) =>
            notify(
              `The running balance of ${b.name} now counts from ${formatMonth(from)}.`,
            )
          }
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

/** That month against its limit, and the running balance. */
function Summary({
  budget: b,
  money,
}: {
  budget: Budget;
  money: (minor: number, signed?: boolean) => string;
}) {
  const { month, running } = b.status!;
  const over = month.left < 0;
  return (
    <div className="summary-cards">
      <section className="card big-progress">
        <span className="label">
          {b.month === b.thisMonth ? "This month" : formatMonth(b.month)}
        </span>
        <span className="card-title amount">
          {spentOf(month.spent, month.limit, b.currency)}
        </span>
        <BudgetBar spent={month.spent} limit={month.limit} />
        {over ? (
          <span className="over">{money(-month.left)} over</span>
        ) : (
          <span className="caption">{money(month.left)} left</span>
        )}
      </section>
      <section className="card">
        <span className="label">Running balance</span>
        <span
          className={
            running.left < 0 ? "big-number amount over" : "big-number amount"
          }
        >
          {money(running.left, true)}
        </span>
        <span className="caption">
          {money(running.budgeted)} budgeted · {money(running.spent)} spent
          {running.since !== b.plan.start &&
            ` · since ${formatMonth(running.since)}`}
        </span>
      </section>
    </div>
  );
}

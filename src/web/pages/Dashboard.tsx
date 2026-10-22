import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAccounts, useReview } from "../api.ts";
import { EmptyState, FirstRunSteps } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { ImportButton } from "../components/Shell.tsx";
import { AccountForm } from "../dialogs/AccountForm.tsx";
import { plural } from "../labels.ts";

/**
 * S1, its first-run states for now: no accounts (→ Add account), accounts
 * but nothing imported (→ Import), then statements imported (→ Accounts).
 * Above them, the Review card while something waits there.
 */
export function Dashboard() {
  const navigate = useNavigate();
  const { data: accounts, error } = useAccounts();
  const [adding, setAdding] = useState(false);

  if (!accounts) {
    return (
      <Page title="Dashboard" mobileTitle="Home">
        <Loading error={error} />
      </Page>
    );
  }

  const active = accounts.filter((a) => !a.archivedOn);
  return (
    <Page title="Dashboard" mobileTitle="Home">
      <ReviewCard />
      {active.length === 0 ? (
        <EmptyState
          icon="wallet"
          title={accounts.length > 0 ? "No active accounts" : "No accounts yet"}
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
      ) : active.some((a) => a.transactionCount > 0) ? (
        <EmptyState
          icon="check"
          title="Statements imported"
          action={
            <Link className="btn btn-primary" to="/accounts">
              Open Accounts
            </Link>
          }
          after={<FirstRunSteps next={2} />}
        >
          Each account's page shows its balance and its transactions.
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

/** What waits in Review, by group. Hidden when nothing does. */
function ReviewCard() {
  const { data } = useReview();
  if (!data || data.count === 0) return null;
  const groups: [number, string, string][] = [
    [
      data.uncategorized.length,
      "uncategorized transaction",
      "uncategorized transactions",
    ],
    [data.conflicts.length, "rule conflict", "rule conflicts"],
    [data.transfers.length, "transfer to confirm", "transfers to confirm"],
    [data.mismatches.length, "balance mismatch", "balance mismatches"],
  ];
  return (
    <div className="grid-2">
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
    </div>
  );
}

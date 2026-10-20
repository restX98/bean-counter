import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAccounts } from "../api.ts";
import { EmptyState, FirstRunSteps } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { ImportButton } from "../components/Shell.tsx";
import { AccountForm } from "../dialogs/AccountForm.tsx";

/**
 * S1, its first-run states for now: no accounts (→ Add account), accounts
 * but nothing imported (→ Import), then statements imported (→ Accounts).
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

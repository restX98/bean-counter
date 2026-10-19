import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  groupByCurrency,
  type Account,
  type CurrencyGroup,
} from "../../domain/accounts.ts";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { useAccounts } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { AccountForm } from "../dialogs/AccountForm.tsx";
import { plural, TYPE_LABELS } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

const balanceText = (a: Account) =>
  a.balance ? formatAmount(a.balance.amount, a.currency) : "—";
const totalText = (g: CurrencyGroup) =>
  g.total === null ? "—" : formatAmount(g.total, g.currency);

/** S3: active accounts grouped by currency, archived ones on request. */
export function Accounts() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: accounts, error } = useAccounts();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);

  const add = (
    <button
      type="button"
      className={isMobile ? "btn btn-primary btn-sm" : "btn btn-primary"}
      onClick={() => setAdding(true)}
    >
      <Icon name="plus" />
      {isMobile ? "Add" : "Add account"}
    </button>
  );
  const page = {
    title: "Accounts",
    back: { to: "/more", label: "Back to More" },
  };

  if (!accounts) {
    return (
      <Page {...page}>
        <Loading error={error} />
      </Page>
    );
  }

  const groups = groupByCurrency(accounts);
  const archived = accounts.filter((a) => a.archivedOn);
  const activeCount = accounts.length - archived.length;
  const showArchived = params.get("archived") === "1" && archived.length > 0;
  const List = isMobile ? MobileGroup : DesktopGroup;

  return (
    <Page
      {...page}
      subtitle={
        activeCount > 0 &&
        `${plural(activeCount, "account")} in ${plural(groups.length, "currency", "currencies")}`
      }
      actions={activeCount > 0 && add}
      mobileActions={activeCount > 0 && add}
    >
      {activeCount === 0 && (
        <EmptyState
          icon="wallet"
          title={archived.length > 0 ? "No active accounts" : "No accounts yet"}
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
        >
          Add your bank accounts, then import their statements.
        </EmptyState>
      )}

      {groups.map((group) => (
        <List
          key={group.currency}
          title={group.currency}
          total={totalText(group)}
          accounts={group.accounts}
        />
      ))}

      {archived.length > 0 && (
        <label className="check">
          <input
            type="checkbox"
            className="visually-hidden"
            checked={showArchived}
            onChange={(e) =>
              setParams(e.target.checked ? { archived: "1" } : {}, {
                replace: true,
              })
            }
          />
          <span className="box">{showArchived && <Icon name="check" />}</span>
          <span>Show archived accounts ({archived.length})</span>
        </label>
      )}
      {showArchived && <List title="Archived" accounts={archived} />}

      {adding && (
        <AccountForm
          onClose={() => setAdding(false)}
          onSaved={(account) => navigate(`/accounts/${account.id}`)}
        />
      )}
    </Page>
  );
}

interface GroupProps {
  title: string;
  /** Left out for the archived group: archived accounts have no total. */
  total?: string;
  accounts: Account[];
}

function DesktopGroup({ title, total, accounts }: GroupProps) {
  return (
    <section className="card group">
      <h2 className="group-head">
        {title}
        {total && (
          <span className="total">
            Total <strong>{total}</strong>
          </span>
        )}
      </h2>
      <div className="ar head" aria-hidden="true">
        <span>Account</span>
        <span>Bank</span>
        <span>Type</span>
        <span>Balance</span>
      </div>
      {accounts.map((a) => (
        <Link
          key={a.id}
          className={a.archivedOn ? "ar is-archived" : "ar"}
          to={`/accounts/${a.id}`}
        >
          <span className="name">
            {a.name}
            {a.archivedOn ? (
              <span className="caption">
                Archived {formatDate(a.archivedOn)}
              </span>
            ) : (
              !a.balance && <span className="caption">No balance yet</span>
            )}
          </span>
          <span className="muted-cell">{a.bank}</span>
          <span className="muted-cell">{TYPE_LABELS[a.type]}</span>
          <span className="amount">{balanceText(a)}</span>
        </Link>
      ))}
    </section>
  );
}

function MobileGroup({ title, total, accounts }: GroupProps) {
  return (
    <section className="day">
      <h2 className="day-head">
        {title}
        {total && ` · Total ${total}`}
      </h2>
      <div className="card m-list">
        {accounts.map((a) => (
          <Link
            key={a.id}
            className={a.archivedOn ? "m-tx is-archived" : "m-tx"}
            to={`/accounts/${a.id}`}
          >
            <span className="desc">{a.name}</span>
            <span className="amount">{balanceText(a)}</span>
            <span className="meta">
              {a.bank} · {TYPE_LABELS[a.type]}
              {a.archivedOn
                ? ` · Archived ${formatDate(a.archivedOn)}`
                : !a.balance && " · No balance yet"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

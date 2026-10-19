import { useState } from "react";
import { useParams } from "react-router";
import type { Account } from "../../domain/accounts.ts";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { useAccounts, useArchive } from "../api.ts";
import { FormError } from "../components/Dialog.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { ImportButton } from "../components/Shell.tsx";
import { AccountForm } from "../dialogs/AccountForm.tsx";
import { ArchiveAccount } from "../dialogs/ArchiveAccount.tsx";
import { SetBalance } from "../dialogs/SetBalance.tsx";
import { TYPE_LABELS } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

type Open = "edit" | "balance" | "archive" | null;

const back = { to: "/accounts", label: "Back to Accounts" };

/** S4. There are no transactions yet, so it shows the balances and the empty state. */
export function AccountDetail() {
  const { id } = useParams();
  const { data: accounts, error } = useAccounts();
  const account = accounts?.find((a) => String(a.id) === id);

  if (!accounts) {
    return (
      <Page title="Account" back={back}>
        <Loading error={error} />
      </Page>
    );
  }
  if (!account) {
    return (
      <Page
        title="Account not found"
        crumb={{ to: "/accounts", label: "Accounts" }}
        back={back}
      >
        <EmptyState icon="wallet" title="This account doesn't exist">
          It may have been removed by a restore. Go back to Accounts to see the
          ones you have.
        </EmptyState>
      </Page>
    );
  }
  // A key, so the dialogs and their state start over for another account.
  return <AccountView key={account.id} account={account} />;
}

function AccountView({ account }: { account: Account }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState<Open>(null);
  const unarchive = useArchive(account.id);
  const close = () => setOpen(null);
  const archived = account.archivedOn !== null;
  const details = `${account.bank} · ${TYPE_LABELS[account.type]} · ${account.currency}`;
  const sm = isMobile ? " btn-sm" : "";

  const actions = archived ? (
    <button
      type="button"
      className={`btn btn-secondary${sm}`}
      disabled={unarchive.isPending}
      onClick={() => unarchive.mutate(false)}
    >
      Unarchive
    </button>
  ) : (
    <>
      {!isMobile && <ImportButton account={account.id} />}
      <button
        type="button"
        className={`btn btn-secondary${sm}`}
        onClick={() => setOpen("edit")}
      >
        Edit
      </button>
      <button
        type="button"
        className={`btn btn-secondary${sm}`}
        onClick={() => setOpen("balance")}
      >
        Set balance
      </button>
      <button
        type="button"
        className={`btn btn-ghost${sm}`}
        onClick={() => setOpen("archive")}
      >
        Archive
      </button>
    </>
  );

  return (
    <Page
      title={account.name}
      titleExtra={
        archived && <span className="tag tone-neutral">Archived</span>
      }
      subtitle={details}
      crumb={{ to: "/accounts", label: "Accounts" }}
      actions={actions}
      back={back}
      mobileActions={
        !archived && (
          <ImportButton
            className="btn btn-primary btn-sm"
            account={account.id}
          />
        )
      }
    >
      {isMobile && <p className="muted">{details}</p>}
      {account.archivedOn && (
        <div className="banner tone-neutral">
          <Icon name="info" />
          <span className="text">
            <strong>Archived on {formatDate(account.archivedOn)}</strong>
            This account is read-only and hidden from lists.
          </span>
        </div>
      )}
      {isMobile && <div className="m-actions">{actions}</div>}
      <FormError error={unarchive.error} />

      <Balances account={account} />

      <EmptyState
        icon="list"
        title={archived ? "No transactions" : "No transactions yet"}
        action={
          !archived && (
            <ImportButton account={account.id} label="Import statement" />
          )
        }
      >
        {archived
          ? "Nothing was imported into this account before it was archived."
          : `Import a statement from ${account.bank} to see this account's history.`}
      </EmptyState>

      {open === "edit" && (
        <AccountForm
          account={account}
          onClose={close}
          onSetBalance={() => setOpen("balance")}
        />
      )}
      {open === "balance" && <SetBalance account={account} onClose={close} />}
      {open === "archive" && (
        <ArchiveAccount account={account} onClose={close} />
      )}
    </Page>
  );
}

const ANCHOR_SOURCE = {
  manual: "Entered by hand.",
  statement: "Taken from the statement's balance column.",
};

function Balances({ account }: { account: Account }) {
  const { anchor, balance, currency } = account;
  return (
    <div className="summary-cards">
      <section className="card">
        <span className="label">
          {account.archivedOn ? "Balance when archived" : "Current balance"}
        </span>
        <span className="big-number amount">
          {balance ? formatAmount(balance.amount, currency) : "—"}
        </span>
        <span className="caption">
          {balance
            ? `On ${formatDate(balance.date)}`
            : "Shown after your first import, or once you set the balance"}
        </span>
      </section>
      <section className="card">
        <span className="label">Balance anchor</span>
        <span className="card-title amount">
          {anchor
            ? `${formatAmount(anchor.amount, currency)} on ${formatDate(anchor.date)}`
            : "Not set yet"}
        </span>
        <span className="caption">
          {anchor
            ? `${ANCHOR_SOURCE[anchor.source]} Every other balance is worked out from it.`
            : "If the statement has no balance column, the import asks for it."}
        </span>
      </section>
    </div>
  );
}

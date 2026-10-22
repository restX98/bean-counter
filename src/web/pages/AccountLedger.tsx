import { useState } from "react";
import type { Account } from "../../domain/accounts.ts";
import type { SuspectReason } from "../../domain/balances.ts";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import {
  useCategories,
  useExclude,
  useLedger,
  useRemoveCheck,
  type AccountLedger as Ledger,
  type LedgerGap,
  type LedgerTransaction,
} from "../api.ts";
import { FormError } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading } from "../components/Page.tsx";
import { useIsMobile } from "../useIsMobile.ts";
import { TransactionPanel } from "./TransactionPanel.tsx";

/** Rows shown at first, and added by "Load more". */
const PAGE = 50;

const BECAUSE: Record<SuspectReason, string> = {
  skipped: "it wasn't imported",
  excluded: "you excluded it",
  "kept-near-match": "kept although it looked like a duplicate",
  "same-amount": "same amount",
};

type Check = Ledger["checks"][number];

type Line =
  | { kind: "transaction"; transaction: LedgerTransaction }
  | { kind: "check"; check: Check }
  | { kind: "gap"; gap: LedgerGap; index: number };

/**
 * The newest transactions first. A balance I entered is the one at the end
 * of its day, so it goes above that day's rows; each gap goes where the
 * balances split, under what's dated after its window opens.
 */
function lines({ transactions, gaps, checks }: Ledger): Line[] {
  const result: Line[] = transactions.map((transaction) => ({
    kind: "transaction",
    transaction,
  }));
  const place = (date: string, line: Line) => {
    const at = result.findIndex(
      (l) =>
        (l.kind === "transaction" && l.transaction.date <= date) ||
        (l.kind === "check" && l.check.date <= date),
    );
    result.splice(at === -1 ? result.length : at, 0, line);
  };
  for (const check of checks) place(check.date, { kind: "check", check });
  gaps.forEach((gap, index) => place(gap.after, { kind: "gap", gap, index }));
  return result;
}

const gapId = (index: number) => `gap-${index}`;
const gapDays = ({ after, until }: LedgerGap) =>
  after === until ? day(after) : `${day(after)} – ${day(until)}`;
const day = (date: string) => formatDate(date).slice(0, 5);

/** S4's list: the account's transactions and where the bank disagrees. */
export function AccountLedger({ account }: { account: Account }) {
  const isMobile = useIsMobile();
  const ledger = useLedger(account.id);
  const exclude = useExclude();
  const removeCheck = useRemoveCheck();
  const categories = useCategories();
  const [shown, setShown] = useState(PAGE);
  // The transaction open in the panel (S6).
  const [openId, setOpenId] = useState<number | null>(null);
  const money = (minor: number, signed = false) =>
    formatAmount(minor, account.currency, { signed });
  const readOnly = account.archivedOn !== null;

  if (!ledger.data) return <Loading error={ledger.error} />;
  const { transactions, gaps, offDays, checks } = ledger.data;
  const all = lines(ledger.data);
  const visible = all.slice(0, shown);
  const hasBank =
    checks.length > 0 || transactions.some((t) => t.bankBalance !== null);
  const off = new Set(offDays);
  const last = transactions[0]?.date;
  const open = transactions.find((t) => t.id === openId);
  const names = new Map(
    categories.data?.categories.map((c) => [c.id, c.name]) ?? [],
  );

  const showGap = (index: number) => {
    const at = all.findIndex((l) => l.kind === "gap" && l.index === index);
    if (at >= shown) setShown(at + 1);
    // After the rows render.
    requestAnimationFrame(() =>
      document
        .getElementById(gapId(index))
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const toggle = (t: LedgerTransaction) =>
    !readOnly && (
      <button
        type="button"
        className={isMobile ? "link" : "btn btn-ghost btn-sm"}
        disabled={exclude.isPending}
        onClick={(e) => {
          // Not the row's click, which opens the panel.
          e.stopPropagation();
          exclude.mutate({ id: t.id, excluded: !t.excluded });
        }}
      >
        {t.excluded ? "Restore" : "Exclude"}
      </button>
    );
  // Excluded transactions don't count anywhere, so they don't need one.
  const category = (t: LedgerTransaction) =>
    t.categoryId !== null ? (
      <span>{names.get(t.categoryId)}</span>
    ) : t.excluded || !categories.data ? null : t.conflict ? (
      <span
        className="tag tone-warning"
        title={`Rules disagree: ${t.conflict.map((c) => names.get(c)).join(" or ")}`}
      >
        Rule conflict
      </span>
    ) : (
      <span className="tag tone-warning">Uncategorized</span>
    );
  const rowClass = (t: LedgerTransaction, base: string) =>
    [base, t.excluded && "is-excluded", t.id === openId && "is-open"]
      .filter(Boolean)
      .join(" ");
  const opener = (t: LedgerTransaction) => (
    <button
      type="button"
      className="row-open"
      aria-expanded={t.id === openId}
      onClick={() => setOpenId(t.id)}
    >
      {t.description}
    </button>
  );
  const tags = (t: LedgerTransaction) => (
    <>
      {t.excluded && (
        <span className="tag tone-neutral">
          <Icon name="eye-off" />
          Excluded
        </span>
      )}
      {t.nearMatchOf !== null && !t.excluded && (
        <span className="caption">
          Kept although it looked like a duplicate
        </span>
      )}
    </>
  );
  const amountClass = (t: LedgerTransaction) =>
    t.amount > 0 && !t.excluded ? "amount income" : "amount";
  const remove = (c: Check) =>
    !readOnly && (
      <button
        type="button"
        className={isMobile ? "link" : "btn btn-ghost btn-sm"}
        disabled={removeCheck.isPending}
        onClick={() => removeCheck.mutate(c.id)}
      >
        Remove
      </button>
    );

  return (
    <>
      {gaps.length > 0 && (
        <Mismatch gaps={gaps} money={money} onShow={showGap} />
      )}
      <FormError error={exclude.error ?? removeCheck.error} />

      {isMobile ? (
        <div className="card m-list">
          {visible.map((line) =>
            line.kind === "gap" ? (
              <div
                className="m-gap"
                id={gapId(line.index)}
                key={gapId(line.index)}
              >
                <Icon name="alert" />
                <span>
                  <strong>{gapDays(line.gap)}:</strong>{" "}
                  {line.gap.after === line.gap.until ? (
                    "the bank's balance differs from the balance anchor."
                  ) : (
                    <>
                      the balances split here.{" "}
                      <Suspects gap={line.gap} last={last} money={money} />
                    </>
                  )}
                </span>
              </div>
            ) : line.kind === "check" ? (
              <div
                key={`check-${line.check.id}`}
                className="m-tx ledger is-check"
              >
                <span className="desc">Balance you entered</span>
                <span className="meta">
                  {day(line.check.date)}
                  {remove(line.check)}
                </span>
                <span
                  className={
                    line.check.amount === line.check.app
                      ? "bal wide"
                      : "bal wide is-off"
                  }
                >
                  Balance {money(line.check.app)} · yours{" "}
                  {money(line.check.amount)}
                </span>
              </div>
            ) : (
              <div
                key={line.transaction.id}
                className={rowClass(line.transaction, "m-tx ledger tx")}
                onClick={() => setOpenId(line.transaction.id)}
              >
                <span className="desc">{opener(line.transaction)}</span>
                <span className={amountClass(line.transaction)}>
                  {money(line.transaction.amount, true)}
                </span>
                <span className="meta">
                  {day(line.transaction.date)}
                  {line.transaction.time &&
                    ` ${line.transaction.time.slice(0, 5)}`}
                  {category(line.transaction)}
                  {tags(line.transaction)}
                  {toggle(line.transaction)}
                </span>
                <span
                  className={
                    hasBank && off.has(line.transaction.date)
                      ? "bal wide is-off"
                      : "bal wide"
                  }
                >
                  {line.transaction.balance === null
                    ? "Not counted"
                    : `Balance ${money(line.transaction.balance)}`}
                  {line.transaction.bankBalance !== null &&
                    ` · bank ${money(line.transaction.bankBalance)}`}
                </span>
              </div>
            ),
          )}
        </div>
      ) : (
        <section className="card table">
          <div
            className={hasBank ? "lr bank head" : "lr head"}
            aria-hidden="true"
          >
            <span>Date</span>
            <span>Description</span>
            <span>Category</span>
            <span className="r">Amount</span>
            <span className="r">Balance</span>
            {hasBank && <span className="r">Bank balance</span>}
            <span />
          </div>
          {visible.map((line) =>
            line.kind === "gap" ? (
              <div
                className="gap-row"
                id={gapId(line.index)}
                key={gapId(line.index)}
              >
                <Icon name="alert" />
                <strong>{gapDays(line.gap)}</strong>
                {line.gap.after === line.gap.until ? (
                  <span>
                    The bank's balance this day differs from the balance anchor.
                  </span>
                ) : (
                  <span>
                    The balances split here: something dated in this window is
                    missing from the app, or counted twice.{" "}
                    <Suspects gap={line.gap} last={last} money={money} />
                  </span>
                )}
              </div>
            ) : line.kind === "check" ? (
              <div key={`check-${line.check.id}`} className="lr bank is-check">
                <span className="date">{formatDate(line.check.date)}</span>
                <span className="desc">
                  Balance you entered
                  <span className="caption">
                    {line.check.amount === line.check.app
                      ? "It matches the app's balance now."
                      : "Kept to look for what's missing."}
                  </span>
                </span>
                <span />
                <span />
                <span className="bal">{money(line.check.app)}</span>
                <span
                  className={
                    line.check.amount === line.check.app
                      ? "bank-bal"
                      : "bank-bal is-off"
                  }
                >
                  {line.check.amount !== line.check.app && (
                    <Icon name="alert" />
                  )}
                  {money(line.check.amount)}
                </span>
                <span className="row-act">{remove(line.check)}</span>
              </div>
            ) : (
              <div
                key={line.transaction.id}
                className={rowClass(
                  line.transaction,
                  hasBank ? "lr bank tx" : "lr tx",
                )}
                onClick={() => setOpenId(line.transaction.id)}
              >
                <span className="date">
                  {formatDate(line.transaction.date)}
                  {line.transaction.time && (
                    <span className="caption">
                      {line.transaction.time.slice(0, 5)}
                    </span>
                  )}
                </span>
                <span className="desc">
                  {opener(line.transaction)}
                  {tags(line.transaction)}
                </span>
                <span className="cat">{category(line.transaction)}</span>
                <span className={amountClass(line.transaction)}>
                  {money(line.transaction.amount, true)}
                </span>
                <span className="bal">
                  {line.transaction.balance === null
                    ? "—"
                    : money(line.transaction.balance)}
                </span>
                {hasBank && (
                  <span
                    className={
                      off.has(line.transaction.date) &&
                      line.transaction.bankBalance !== null
                        ? "bank-bal is-off"
                        : "bank-bal"
                    }
                  >
                    {off.has(line.transaction.date) &&
                      line.transaction.bankBalance !== null && (
                        <Icon name="alert" />
                      )}
                    {line.transaction.bankBalance === null
                      ? ""
                      : money(line.transaction.bankBalance)}
                  </span>
                )}
                <span className="row-act">{toggle(line.transaction)}</span>
              </div>
            ),
          )}
          {all.length > shown && (
            <div className="table-foot">
              <span>
                Showing the{" "}
                {visible.filter((l) => l.kind === "transaction").length} most
                recent of {transactions.length}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShown(shown + PAGE)}
              >
                Load more
              </button>
            </div>
          )}
        </section>
      )}
      {isMobile && all.length > shown && (
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => setShown(shown + PAGE)}
        >
          Load more
        </button>
      )}
      {open && (
        <TransactionPanel
          account={account}
          transaction={open}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/** The banner above the list: how far apart, where, and a way to get there. */
function Mismatch({
  gaps,
  money,
  onShow,
}: {
  gaps: LedgerGap[];
  money: (minor: number) => string;
  onShow: (index: number) => void;
}) {
  const [first] = gaps as [LedgerGap];
  return (
    <div className="banner tone-warning" role="status">
      <Icon name="alert" />
      <span className="text">
        <strong>
          {gaps.length === 1
            ? `The app's balances and the bank's differ by ${money(Math.abs(first.amount))}`
            : `The app's balances and the bank's differ in ${gaps.length} places`}
        </strong>
        {first.after === first.until
          ? `On ${formatDate(first.until)}, the bank's balance differs from the balance anchor.`
          : `They split between ${formatDate(first.after)} and ${formatDate(first.until)}: something dated in that window is missing from the app, or counted twice.`}
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onShow(0)}
      >
        Show the gap
      </button>
    </div>
  );
}

/**
 * What would explain a gap: what's likely, else guesses. `last` is the
 * newest transaction's date: a gap that ends after it may be newer
 * transactions that aren't imported yet.
 */
function Suspects({
  gap,
  last,
  money,
}: {
  gap: LedgerGap;
  last: string | undefined;
  money: (minor: number, signed?: boolean) => string;
}) {
  const likely = gap.suspects.filter((s) => s.reason !== "same-amount");
  const listed = likely.length > 0 ? likely : gap.suspects;
  if (listed.length === 0) {
    return last !== undefined && gap.until > last ? (
      <>
        Nothing imported is dated after {day(last)}: import the statement that
        covers these days.
      </>
    ) : (
      <>No excluded or kept transaction in this window would explain it.</>
    );
  }
  return (
    <>
      {listed.slice(0, 3).map((s, i) => (
        <span key={s.id}>
          {i > 0 && " "}
          {s.reason === "same-amount" ? "Possibly" : "Probably"} {s.description}{" "}
          ({money(s.amount, true)}, {day(s.date)}): {BECAUSE[s.reason]}.
        </span>
      ))}
    </>
  );
}

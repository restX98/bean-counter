import { useState } from "react";
import type { Account } from "../../domain/accounts.ts";
import type { SuspectReason } from "../../domain/balances.ts";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import {
  useExclude,
  useLedger,
  type LedgerGap,
  type LedgerTransaction,
} from "../api.ts";
import { FormError } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading } from "../components/Page.tsx";
import { useIsMobile } from "../useIsMobile.ts";

/** Rows shown at first, and added by "Load more". */
const PAGE = 50;

const BECAUSE: Record<SuspectReason, string> = {
  skipped: "it wasn't imported",
  excluded: "you excluded it",
  "kept-near-match": "kept although it looked like a duplicate",
  "same-amount": "same amount",
};

type Line =
  | { kind: "transaction"; transaction: LedgerTransaction }
  | { kind: "gap"; gap: LedgerGap; index: number };

/**
 * The newest transactions first, with each gap placed where the balances
 * split: under the rows dated after its window opens.
 */
function lines(transactions: LedgerTransaction[], gaps: LedgerGap[]): Line[] {
  const result: Line[] = transactions.map((transaction) => ({
    kind: "transaction",
    transaction,
  }));
  gaps.forEach((gap, index) => {
    const at = result.findIndex(
      (line) =>
        line.kind === "transaction" && line.transaction.date <= gap.after,
    );
    result.splice(at === -1 ? result.length : at, 0, {
      kind: "gap",
      gap,
      index,
    });
  });
  return result;
}

const gapId = (index: number) => `gap-${index}`;
const day = (date: string) => formatDate(date).slice(0, 5);

/** S4's list: the account's transactions and where the bank disagrees. */
export function AccountLedger({ account }: { account: Account }) {
  const isMobile = useIsMobile();
  const ledger = useLedger(account.id);
  const exclude = useExclude();
  const [shown, setShown] = useState(PAGE);
  const money = (minor: number, signed = false) =>
    formatAmount(minor, account.currency, { signed });
  const readOnly = account.archivedOn !== null;

  if (!ledger.data) return <Loading error={ledger.error} />;
  const { transactions, gaps, offDays } = ledger.data;
  const all = lines(transactions, gaps);
  const visible = all.slice(0, shown);
  const hasBank = transactions.some((t) => t.bankBalance !== null);
  const off = new Set(offDays);

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
        onClick={() => exclude.mutate({ id: t.id, excluded: !t.excluded })}
      >
        {t.excluded ? "Restore" : "Exclude"}
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

  return (
    <>
      {gaps.length > 0 && (
        <Mismatch gaps={gaps} money={money} onShow={showGap} />
      )}
      <FormError error={exclude.error} />

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
                  <strong>
                    {day(line.gap.after)} – {day(line.gap.until)}:
                  </strong>{" "}
                  the balances split here.{" "}
                  <Suspects gap={line.gap} money={money} />
                </span>
              </div>
            ) : (
              <div
                key={line.transaction.id}
                className={
                  line.transaction.excluded
                    ? "m-tx ledger is-excluded"
                    : "m-tx ledger"
                }
              >
                <span className="desc">{line.transaction.description}</span>
                <span className={amountClass(line.transaction)}>
                  {money(line.transaction.amount, true)}
                </span>
                <span className="meta">
                  {day(line.transaction.date)}
                  {line.transaction.time &&
                    ` ${line.transaction.time.slice(0, 5)}`}
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
                <strong>
                  {day(line.gap.after)} – {day(line.gap.until)}
                </strong>
                <span>
                  The balances split here: something dated in this window is
                  missing from the app, or counted twice.{" "}
                  <Suspects gap={line.gap} money={money} />
                </span>
              </div>
            ) : (
              <div
                key={line.transaction.id}
                className={[
                  "lr",
                  hasBank && "bank",
                  line.transaction.excluded && "is-excluded",
                ]
                  .filter(Boolean)
                  .join(" ")}
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
                  {line.transaction.description}
                  {tags(line.transaction)}
                </span>
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

/** What would explain a gap: what's likely, else guesses. */
function Suspects({
  gap,
  money,
}: {
  gap: LedgerGap;
  money: (minor: number, signed?: boolean) => string;
}) {
  const likely = gap.suspects.filter((s) => s.reason !== "same-amount");
  const listed = likely.length > 0 ? likely : gap.suspects;
  if (listed.length === 0) {
    return (
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

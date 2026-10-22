import type { Account, Anchor } from "../../../domain/accounts.ts";
import type { SuspectReason } from "../../../domain/balances.ts";
import { formatDate } from "../../../domain/dates.ts";
import type { PlanGap } from "../../../domain/import/plan.ts";
import { formatAmount } from "../../../domain/money.ts";
import { Link } from "react-router";
import type { ImportResult } from "../../api.ts";
import { Icon } from "../../components/Icon.tsx";
import { plural } from "../../labels.ts";
import { Flow } from "./Flow.tsx";

const BECAUSE: Record<SuspectReason, string> = {
  skipped: "which wasn't imported",
  excluded: "which you excluded",
  "kept-near-match": "kept although it looked like a duplicate",
  "same-amount": "same amount",
};

interface Props {
  result: ImportResult;
  account: Account;
  fileName: string;
  /** The anchor before the import, to tell whether it changed. */
  before: Anchor | null;
  skipped: number[];
  onAnother: () => void;
  onOpen: () => void;
  onClose: () => void;
}

/** S10: what was imported, and whether the balances agree with the bank. */
export function DoneStep({
  result,
  account,
  fileName,
  before,
  skipped,
  onAnother,
  onOpen,
  onClose,
}: Props) {
  const { anchor, gaps } = result;
  const money = (minor: number) => formatAmount(minor, account.currency);
  // Waiting for a category, the rules' conflicts among them.
  const sent = result.imported - result.linked - result.categorized;
  const mismatch = gaps !== null && gaps.length > 0;
  const open = (
    <button
      type="button"
      className={
        mismatch || sent === 0 ? "btn btn-primary" : "btn btn-secondary"
      }
      onClick={onOpen}
    >
      Open {account.name}
    </button>
  );
  return (
    <Flow step={4} skipped={skipped} onClose={onClose}>
      <div className="narrow">
        <section className="card done">
          <span className="empty-icon">
            <Icon name="check" />
          </span>
          <h2>Import complete</h2>
          <p className="caption">
            {fileName} → {account.name}
          </p>
          <div className="stats">
            <div className="stat">
              <strong>{result.imported}</strong>
              <span>imported</span>
            </div>
            <div className="stat">
              <strong>{result.skipped}</strong>
              <span>skipped as duplicates</span>
            </div>
            <div className="stat">
              <strong>{result.leftOut + result.unreadable}</strong>
              <span>left out or unreadable</span>
            </div>
            <div className="stat">
              <strong>{sent}</strong>
              <span>sent to Review</span>
            </div>
          </div>
          {result.imported > 0 && <p className="caption">{summary(result)}</p>}

          {gaps === null ? (
            <div className="banner tone-neutral">
              <Icon name="info" />
              <span className="text">
                <strong>Balance check skipped</strong>
                This file has no balance column.
                {anchor &&
                  ` ${account.name}'s balance comes from ${anchor.source === "manual" ? "the value you entered" : "a statement's balance column"}: ${money(anchor.amount)} on ${formatDate(anchor.date)}.`}
              </span>
            </div>
          ) : gaps.length === 0 ? (
            <div className="banner tone-success">
              <Icon name="check" />
              <span className="text">
                <strong>Balance matches the bank</strong>
                Every balance in the statement agrees with the app's.
                {anchor &&
                  !before &&
                  ` This was the account's first import, so the statement's last balance, ${money(anchor.amount)} on ${formatDate(anchor.date)}, became the balance anchor.`}
                {anchor &&
                  before &&
                  anchor.date !== before.date &&
                  ` The balance anchor moved to the statement's last balance, ${money(anchor.amount)} on ${formatDate(anchor.date)}.`}
              </span>
            </div>
          ) : (
            <div className="banner tone-warning">
              <Icon name="alert" />
              <span className="text">
                <strong>
                  {gaps.length === 1
                    ? "Balance mismatch"
                    : `${gaps.length} balance mismatches`}
                </strong>
                {gaps.map((gap) => (
                  <Gap key={gap.until + gap.after} gap={gap} money={money} />
                ))}
                {gaps.length === 1
                  ? " It's also listed in Review."
                  : " They're also listed in Review."}
              </span>
            </div>
          )}

          {/* A mismatch is fixed on the account's page, so that comes first. */}
          <div className="actions">
            {mismatch && open}
            {(mismatch || sent > 0) && (
              <Link
                className={mismatch ? "btn btn-secondary" : "btn btn-primary"}
                to="/review"
              >
                {mismatch ? "Go to Review" : `Go to Review (${sent})`}
              </Link>
            )}
            {!mismatch && open}
            <button type="button" className="btn btn-ghost" onClick={onAnother}>
              Import another file
            </button>
          </div>
        </section>
      </div>
    </Flow>
  );
}

/** What became of the imported transactions: transfers, then the rules. */
function summary({ imported, linked, categorized, conflicts }: ImportResult) {
  const transfers =
    linked === 0
      ? ""
      : linked === imported
        ? `${imported === 1 ? "It's a transfer" : "They're all transfers"} with your other accounts, linked to the other side.`
        : `${linked} ${linked === 1 ? "is a transfer" : "are transfers"} with your other accounts, linked to the other side.`;
  const rest = imported - linked;
  if (rest === 0) return transfers;
  const them =
    linked > 0
      ? rest === 1
        ? "the other one"
        : `the other ${rest}`
      : rest === 1
        ? "it"
        : "them";
  const left = rest - categorized;
  const done =
    categorized === rest
      ? `Your rules categorized ${linked === 0 && rest > 1 ? "all of them" : them}.`
      : categorized > 0
        ? `Your rules categorized ${categorized}; ${left} ${left === 1 ? "is" : "are"} still uncategorized.`
        : `No rule categorized ${them}.`;
  const one = conflicts === 1;
  const waiting =
    conflicts === 0
      ? ""
      : `${plural(conflicts, "transaction")} ${one ? "matches" : "match"} rules that disagree, so ${one ? "it waits" : "they wait"} for you to pick a category.`;
  return [transfers, done, waiting].filter(Boolean).join(" ");
}

/**
 * Where a mismatch lies, as precisely as the bank's balances allow, and what
 * would explain it: first what's likely, then guesses.
 */
function Gap({
  gap,
  money,
}: {
  gap: PlanGap;
  money: (minor: number) => string;
}) {
  const size = money(Math.abs(gap.amount));
  const likely = gap.suspects.filter((s) => s.reason !== "same-amount");
  const guesses = gap.suspects.filter((s) => s.reason === "same-amount");
  const describe = (s: PlanGap["suspects"][number]) =>
    `${s.description} (${money(s.amount)}, ${formatDate(s.date)})`;
  return (
    <>
      <span className="gap">
        {gap.after === gap.until
          ? ` On ${formatDate(gap.until)}, the bank's balance differs from the balance anchor by ${size}.`
          : ` A difference of ${size} between ${formatDate(gap.after)} and ${formatDate(gap.until)}: a transaction dated after ${formatDate(gap.after)} and up to ${formatDate(gap.until)} is missing from the app, or counted twice.`}
      </span>
      {likely.length > 0 && (
        <ul className="suspects">
          {likely.slice(0, 3).map((s) => (
            <li key={`${s.id}-${s.line}`}>
              Probably {describe(s)}, {BECAUSE[s.reason]}.
            </li>
          ))}
        </ul>
      )}
      {likely.length === 0 && guesses.length > 0 && (
        <ul className="suspects">
          {guesses.slice(0, 3).map((s) => (
            <li key={`${s.id}-${s.line}`}>
              Possibly {describe(s)}: same amount.
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

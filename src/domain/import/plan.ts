import type { Anchor } from "../accounts.ts";
import {
  bankBalances,
  checkBalances,
  type DayBalance,
  type SuspectReason,
} from "../balances.ts";
import type { RuleOutcome } from "../rules.ts";
import {
  matchTransfers,
  type Dismissed,
  type TransferTarget,
} from "../transfers.ts";
import { findDuplicates, type Imported } from "./duplicates.ts";
import type { StatementRow } from "./mapping.ts";

// What an import will do, before it does it: S9 shows it, and saving
// carries it out.

/** A transaction already in the account. */
export interface Existing extends Imported {
  excluded: boolean;
  /** Kept although it looked like this transaction. */
  nearMatchOf: number | null;
}

export type Decision = "keep" | "skip";

export interface PlannedRow extends StatementRow {
  status: "new" | "duplicate" | "near-match";
  /** The transaction a duplicate or near-match looks like. */
  match: Pick<
    Existing,
    "id" | "date" | "time" | "amount" | "description"
  > | null;
  /** A near-match's decision, once I've made it. */
  decision: Decision | null;
  /** What the rules say about it; nothing for a duplicate. */
  rule: RuleOutcome;
  /** Whether it will be one side of a transfer; nothing for a duplicate. */
  transfer: TransferOutcome;
}

/** A row's transfer: linked to the only candidate, or candidates to pick from. */
export type TransferOutcome =
  | { kind: "none" }
  | { kind: "linked"; accountId: number }
  | { kind: "pick"; count: number; accountIds: number[] };

/** What transfer detection needs to know about the rest of my transactions. */
export interface TransferContext {
  account: { id: number; currency: string };
  /** Every unlinked, counted transaction in an account that isn't archived. */
  pool: TransferTarget[];
  dismissed?: Dismissed;
  window?: number;
}

/** A transaction that could explain a gap: in the account (id) or the file (line). */
export interface PlanSuspect {
  reason: SuspectReason;
  date: string;
  time: string | null;
  amount: number;
  description: string;
  id: number | null;
  line: number | null;
}

export interface PlanGap {
  after: string;
  until: string;
  amount: number;
  suspects: PlanSuspect[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  /** No anchor yet, and no balances in the file: I enter the current one. */
  needsBalance: boolean;
  /** The anchor after the import. */
  anchor: Anchor | null;
  /** Null when there's nothing to compare: no balances in the file, or no anchor. */
  gaps: PlanGap[] | null;
}

/**
 * Plans an import of a file's readable rows into an account.
 *
 * The anchor after the import is the account's, unless:
 * - the account has none: the file's latest balance, or else the one I entered;
 * - the file's balances all agree with the app's, and its latest is more
 *   recent: then that one, so the anchor stays recent.
 */
export function planImport({
  rows,
  existing,
  anchor,
  decisions = {},
  balance = null,
  rules = () => ({ kind: "none" }),
  transfers = null,
}: {
  rows: StatementRow[];
  /** All of the account's transactions, excluded ones too. */
  existing: Existing[];
  anchor: Anchor | null;
  /** Near-match decisions, by line. */
  decisions?: Record<number, Decision>;
  /** The balance I entered, used only when needsBalance. */
  balance?: Pick<Anchor, "amount" | "date"> | null;
  /** What the rules say about a row, in this account. */
  rules?: (row: StatementRow) => RuleOutcome;
  /** Left out, rows are never transfers. */
  transfers?: TransferContext | null;
}): ImportPlan {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const none = { kind: "none" } as const;
  const matched: PlannedRow[] = findDuplicates(rows, existing).map(
    (match, i) => {
      const row = rows[i]!;
      if (match.status === "new") {
        return {
          ...row,
          status: "new",
          match: null,
          decision: null,
          rule: rules(row),
          transfer: none,
        };
      }
      const { id, date, time, amount, description } = byId.get(match.of)!;
      return {
        ...row,
        status: match.status,
        match: { id, date, time, amount, description },
        decision:
          match.status === "near-match" ? (decisions[row.line] ?? null) : null,
        rule: match.status === "near-match" ? rules(row) : none,
        transfer: none,
      };
    },
  );
  const outcomes = transfers ? transferOutcomes(matched, transfers) : null;
  const planned = matched.map((row) => ({
    ...row,
    transfer: outcomes?.get(row.line) ?? none,
  }));

  const bank = bankBalances(rows);
  const latest = bank.at(-1);
  const needsBalance = !anchor && !latest;
  const start: Anchor | null =
    anchor ??
    (latest
      ? { amount: latest.balance, date: latest.date, source: "statement" }
      : balance && { ...balance, source: "manual" });

  const gaps = start && latest ? check(start, existing, planned, bank) : null;
  const moves =
    anchor && latest && gaps?.length === 0 && latest.date > anchor.date;
  return {
    rows: planned,
    needsBalance,
    anchor: moves
      ? { amount: latest.balance, date: latest.date, source: "statement" }
      : start,
    gaps,
  };
}

/**
 * Runs transfer detection as if the rows that may be saved were already
 * there: new ones, and near-matches I haven't skipped. They join the pool
 * with negative ids, so they can't clash with saved transactions.
 */
function transferOutcomes(
  rows: PlannedRow[],
  { account, pool, dismissed, window }: TransferContext,
): Map<number, TransferOutcome> {
  const joining = rows.filter(
    (r) =>
      r.status === "new" ||
      (r.status === "near-match" && r.decision !== "skip"),
  );
  const { links, candidates } = matchTransfers(
    [
      ...pool,
      ...joining.map((r) => ({
        id: -r.line,
        accountId: account.id,
        currency: account.currency,
        date: r.date,
        amount: r.amount,
      })),
    ],
    { window, dismissed },
  );
  const outcomes = new Map<number, TransferOutcome>();
  for (const link of links) {
    for (const [side, other] of [
      [link.out, link.in],
      [link.in, link.out],
    ] as const) {
      if (side.id < 0) {
        outcomes.set(-side.id, { kind: "linked", accountId: other.accountId });
      }
    }
  }
  for (const [id, list] of candidates) {
    if (id < 0) {
      outcomes.set(-id, {
        kind: "pick",
        count: list.length,
        accountIds: [...new Set(list.map((c) => c.accountId))],
      });
    }
  }
  return outcomes;
}

/** Whether a planned row will be saved: new, or a near-match I kept. */
export const isImported = (row: PlannedRow) =>
  row.status === "new" || row.decision === "keep";

function check(
  anchor: Anchor,
  existing: Existing[],
  planned: PlannedRow[],
  bank: DayBalance[],
): PlanGap[] {
  const fromAccount = existing.map((t) => ({
    ...t,
    keptNearMatch: t.nearMatchOf !== null,
    line: null,
  }));
  const fromFile = planned.map((row) => ({
    ...row,
    excluded: false,
    keptNearMatch: row.status === "near-match",
    id: null,
  }));
  return checkBalances({
    anchor,
    transactions: [...fromAccount, ...fromFile.filter(isImported)],
    bank,
    // Undecided near-matches count as skipped until I decide.
    skipped: fromFile.filter((row) => !isImported(row)),
  }).map(({ suspects, ...gap }) => ({
    ...gap,
    suspects: suspects.map(({ reason, transaction: t }) => ({
      reason,
      date: t.date,
      time: t.time,
      amount: t.amount,
      description: t.description,
      id: t.id,
      line: t.line,
    })),
  }));
}

import type { Anchor } from "../accounts.ts";
import {
  bankBalances,
  checkBalances,
  type DayBalance,
  type SuspectReason,
} from "../balances.ts";
import type { RuleOutcome } from "../rules.ts";
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
  match: Pick<Existing, "id" | "date" | "amount" | "description"> | null;
  /** A near-match's decision, once I've made it. */
  decision: Decision | null;
  /** What the rules say about it; nothing for a duplicate. */
  rule: RuleOutcome;
}

/** A transaction that could explain a gap: in the account (id) or the file (line). */
export interface PlanSuspect {
  reason: SuspectReason;
  date: string;
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
}): ImportPlan {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const planned: PlannedRow[] = findDuplicates(rows, existing).map(
    (match, i) => {
      const row = rows[i]!;
      if (match.status === "new") {
        return {
          ...row,
          status: "new",
          match: null,
          decision: null,
          rule: rules(row),
        };
      }
      const { id, date, amount, description } = byId.get(match.of)!;
      return {
        ...row,
        status: match.status,
        match: { id, date, amount, description },
        decision:
          match.status === "near-match" ? (decisions[row.line] ?? null) : null,
        rule: match.status === "near-match" ? rules(row) : { kind: "none" },
      };
    },
  );

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
      amount: t.amount,
      description: t.description,
      id: t.id,
      line: t.line,
    })),
  }));
}

import { describe, expect, it } from "vitest";
import type { StatementRow } from "./mapping.ts";
import { isImported, planImport, type Existing } from "./plan.ts";

const row = (
  line: number,
  date: string,
  amount: number,
  description: string,
  balance: number | null,
): StatementRow => ({
  line,
  date,
  time: null,
  amount,
  description,
  reference: null,
  balance,
});

// Salary, groceries, 500.00 to savings; the bank's balance after each.
const october = [
  row(2, "2026-10-01", 200000, "SALARY", 324050),
  row(3, "2026-10-02", -5630, "ESSELUNGA", 318420),
  row(4, "2026-10-05", -50000, "TRANSFER TO SAVINGS", 268420),
];
const withoutBalances = october.map((r) => ({ ...r, balance: null }));

const existing = (
  id: number,
  date: string,
  amount: number,
  description: string,
): Existing => ({
  id,
  date,
  time: null,
  amount,
  description,
  reference: null,
  excluded: false,
  nearMatchOf: null,
});

describe("planImport", () => {
  it("marks duplicates and near-matches with the transaction they look like", () => {
    const plan = planImport({
      rows: october,
      existing: [
        existing(5, "2026-10-01", 200000, "SALARY"),
        existing(6, "2026-10-02", -5630, "ESSELUNGA MILANO"),
      ],
      anchor: null,
      decisions: { 3: "skip" },
    });
    expect(
      plan.rows.map(({ line, status, match, decision }) => ({
        line,
        status,
        match: match?.id,
        decision,
      })),
    ).toEqual([
      { line: 2, status: "duplicate", match: 5, decision: null },
      { line: 3, status: "near-match", match: 6, decision: "skip" },
      { line: 4, status: "new", match: undefined, decision: null },
    ]);
    expect(plan.rows.filter(isImported).map((r) => r.line)).toEqual([4]);
  });

  it("takes the anchor from the file's latest balance when there's none", () => {
    const plan = planImport({ rows: october, existing: [], anchor: null });
    expect(plan.needsBalance).toBe(false);
    expect(plan.anchor).toEqual({
      amount: 268420,
      date: "2026-10-05",
      source: "statement",
    });
    expect(plan.gaps).toEqual([]);
  });

  it("asks for a balance when there's no anchor and the file has none", () => {
    const plan = planImport({
      rows: withoutBalances,
      existing: [],
      anchor: null,
    });
    expect(plan).toMatchObject({
      needsBalance: true,
      anchor: null,
      gaps: null,
    });

    const entered = planImport({
      rows: withoutBalances,
      existing: [],
      anchor: null,
      balance: { amount: 268420, date: "2026-10-16" },
    });
    expect(entered).toMatchObject({
      needsBalance: true,
      anchor: { amount: 268420, date: "2026-10-16", source: "manual" },
      gaps: null,
    });
  });

  it("moves the anchor to a more recent bank balance when everything agrees", () => {
    const plan = planImport({
      rows: october,
      existing: [],
      anchor: { amount: 124050, date: "2026-09-30", source: "manual" },
    });
    expect(plan.gaps).toEqual([]);
    expect(plan.anchor).toEqual({
      amount: 268420,
      date: "2026-10-05",
      source: "statement",
    });
  });

  it("keeps a more recent anchor", () => {
    const anchor = {
      amount: 268420,
      date: "2026-10-16",
      source: "manual",
    } as const;
    const plan = planImport({ rows: october, existing: [], anchor });
    expect(plan.gaps).toEqual([]);
    expect(plan.anchor).toEqual(anchor);
  });

  it("keeps the anchor when the balances disagree", () => {
    const anchor = {
      amount: 100000,
      date: "2026-09-30",
      source: "manual",
    } as const;
    const plan = planImport({ rows: october, existing: [], anchor });
    expect(plan.gaps).toHaveLength(1);
    expect(plan.anchor).toEqual(anchor);
  });

  it("points to a near-match I kept when it breaks the balances", () => {
    const groceries = existing(6, "2026-10-02", -5630, "ESSELUNGA MILANO");
    const plan = planImport({
      rows: october,
      existing: [groceries],
      anchor: null,
      decisions: { 3: "keep" },
    });
    expect(plan.gaps).toEqual([
      {
        after: "2026-10-01",
        until: "2026-10-02",
        amount: 5630,
        suspects: [
          {
            reason: "kept-near-match",
            date: "2026-10-02",
            amount: -5630,
            description: "ESSELUNGA",
            id: null,
            line: 3,
          },
          {
            reason: "same-amount",
            date: "2026-10-02",
            amount: -5630,
            description: "ESSELUNGA MILANO",
            id: 6,
            line: null,
          },
        ],
      },
    ]);
  });

  it("counts an undecided near-match as skipped in the check", () => {
    const plan = planImport({
      rows: october,
      existing: [existing(6, "2026-10-02", -5630, "ESSELUNGA MILANO")],
      anchor: null,
    });
    expect(plan.rows[1]?.decision).toBeNull();
    expect(plan.gaps).toEqual([]);
  });
});

describe("planImport with rules", () => {
  it("asks the rules about the rows it may import, not the duplicates", () => {
    const asked: string[] = [];
    const plan = planImport({
      rows: october,
      existing: [
        existing(5, "2026-10-01", 200000, "SALARY"),
        existing(6, "2026-10-02", -5630, "ESSELUNGA MILANO"),
      ],
      anchor: null,
      rules: (row) => {
        asked.push(row.description);
        return row.description === "ESSELUNGA"
          ? { kind: "category", categoryId: 1, ruleId: 7 }
          : { kind: "none" };
      },
    });
    expect(asked).toEqual(["ESSELUNGA", "TRANSFER TO SAVINGS"]);
    expect(plan.rows.map((r) => r.rule)).toEqual([
      { kind: "none" },
      { kind: "category", categoryId: 1, ruleId: 7 },
      { kind: "none" },
    ]);
  });
});

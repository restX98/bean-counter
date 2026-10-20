import { describe, expect, it } from "vitest";
import { balanceHistory, bankBalances, checkBalances } from "./balances.ts";

// October: salary on the 1st, groceries on the 2nd, 500.00 to savings on the
// 5th. The bank's balances that month: 3,240.50, 3,184.20, then 2,684.20.
const tx = (
  date: string,
  amount: number,
  excluded = false,
  keptNearMatch = false,
) => ({ date, amount, excluded, keptNearMatch });
const october = [
  tx("2026-10-01", 200000),
  tx("2026-10-02", -5630),
  tx("2026-10-05", -50000),
];
const bank = [
  { date: "2026-10-01", balance: 324050 },
  { date: "2026-10-02", balance: 318420 },
  { date: "2026-10-05", balance: 268420 },
];

describe("balanceHistory", () => {
  it("works the opening balance out backwards from the anchor", () => {
    const history = balanceHistory(
      { date: "2026-10-31", amount: 268420 },
      october,
    );
    expect(history.opening).toBe(124050);
    expect(history.days).toEqual(bank);
  });

  it("gives the same balances wherever the anchor is", () => {
    for (const anchor of [
      { date: "2026-09-30", amount: 124050 },
      { date: "2026-10-02", amount: 318420 },
      { date: "2026-10-05", amount: 268420 },
    ]) {
      expect(balanceHistory(anchor, october).days).toEqual(bank);
    }
  });

  it("answers for any day, with or without transactions", () => {
    const { on } = balanceHistory(
      { date: "2026-10-05", amount: 268420 },
      october,
    );
    expect(on("2026-09-15")).toBe(124050);
    expect(on("2026-10-01")).toBe(324050);
    expect(on("2026-10-04")).toBe(318420);
    expect(on("2026-12-31")).toBe(268420);
  });

  it("ignores excluded transactions", () => {
    const history = balanceHistory({ date: "2026-10-31", amount: 268420 }, [
      ...october,
      tx("2026-10-03", -5630, true),
    ]);
    expect(history.days).toEqual(bank);
  });

  it("is the anchor everywhere when there are no transactions", () => {
    const history = balanceHistory({ date: "2026-10-16", amount: 324050 }, []);
    expect(history.opening).toBe(324050);
    expect(history.on("2020-01-01")).toBe(324050);
  });
});

describe("bankBalances", () => {
  const rows = [
    { date: "2026-10-01", amount: 200000, balance: 324050 },
    { date: "2026-10-02", amount: -5630, balance: 318420 },
    { date: "2026-10-02", amount: -1000, balance: 317420 },
  ];
  const expected = [
    { date: "2026-10-01", balance: 324050 },
    { date: "2026-10-02", balance: 317420 },
  ];

  it("takes each day's last balance, oldest or newest first", () => {
    expect(bankBalances(rows)).toEqual(expected);
    expect(bankBalances(rows.toReversed())).toEqual(expected);
  });

  it("follows the balances, not the file, within a day", () => {
    expect(bankBalances([rows[0]!, rows[2]!, rows[1]!])).toEqual(expected);
    const withZero = [
      ...rows,
      { date: "2026-10-02", amount: 0, balance: 317420 },
    ];
    expect(bankBalances(withZero)).toEqual(expected);
  });

  it("uses the file's order when a day's balances don't chain", () => {
    expect(
      bankBalances([
        { date: "2026-10-02", amount: -5630, balance: 318420 },
        { date: "2026-10-02", amount: -1000, balance: 300000 },
      ]),
    ).toEqual([{ date: "2026-10-02", balance: 300000 }]);
  });

  it("skips rows without a balance", () => {
    expect(
      bankBalances([
        { date: "2026-10-01", amount: 200000, balance: 324050 },
        { date: "2026-10-02", amount: -5630, balance: null },
      ]),
    ).toEqual([{ date: "2026-10-01", balance: 324050 }]);
    expect(bankBalances([])).toEqual([]);
  });
});

describe("checkBalances", () => {
  const coffee = { date: "2026-10-03", amount: -120 };

  it("finds nothing when the balances agree", () => {
    expect(
      checkBalances({
        anchor: { date: "2026-10-05", amount: 268420 },
        transactions: october,
        bank,
      }),
    ).toEqual([]);
  });

  it("places a gap before the anchor between the last day they differ and the first they agree", () => {
    // The bank had a 1.20 coffee on the 3rd that the import skipped.
    const result = checkBalances({
      anchor: { date: "2026-10-05", amount: 268300 },
      transactions: october,
      bank: [
        { date: "2026-10-01", balance: 324050 },
        { date: "2026-10-02", balance: 318420 },
        { date: "2026-10-03", balance: 318300 },
        { date: "2026-10-05", balance: 268300 },
      ],
      skipped: [
        coffee,
        { date: "2026-10-05", amount: -120 },
        { date: "2026-10-03", amount: -100 },
      ],
    });
    expect(result).toEqual([
      {
        after: "2026-10-02",
        until: "2026-10-03",
        amount: -120,
        suspects: [{ transaction: coffee, reason: "skipped" }],
      },
    ]);
  });

  it("places a gap after the anchor between the last day they agree and the first they differ", () => {
    const salary = { date: "2026-10-01", amount: 200000 };
    const result = checkBalances({
      anchor: { date: "2026-09-30", amount: 124050 },
      transactions: october.slice(1),
      bank,
      skipped: [salary],
    });
    expect(result).toEqual([
      {
        after: "2026-09-30",
        until: "2026-10-01",
        amount: 200000,
        suspects: [{ transaction: salary, reason: "skipped" }],
      },
    ]);
  });

  it("points to an excluded transaction that explains a gap", () => {
    const groceries = tx("2026-10-02", -5630, true);
    const result = checkBalances({
      anchor: { date: "2026-10-05", amount: 268420 },
      transactions: [october[0]!, groceries, october[2]!],
      bank,
    });
    expect(result).toEqual([
      {
        after: "2026-10-01",
        until: "2026-10-02",
        amount: -5630,
        suspects: [{ transaction: groceries, reason: "excluded" }],
      },
    ]);
  });

  it("points first to a kept near-match, then to others with that amount", () => {
    // The same 34.90 purchase, imported twice: the second time the bank wrote
    // its description differently, and I kept the near-match.
    const original = tx("2026-10-14", -3490);
    const kept = tx("2026-10-14", -3490, false, true);
    const result = checkBalances({
      anchor: { date: "2026-10-16", amount: 100000 },
      transactions: [
        tx("2026-10-13", -120),
        original,
        kept,
        tx("2026-10-16", -5000),
      ],
      bank: [
        { date: "2026-10-13", balance: 108490 },
        { date: "2026-10-14", balance: 105000 },
        { date: "2026-10-16", balance: 100000 },
      ],
    });
    expect(result).toEqual([
      {
        after: "2026-10-13",
        until: "2026-10-14",
        amount: 3490,
        suspects: [
          { transaction: kept, reason: "kept-near-match" },
          { transaction: original, reason: "same-amount" },
        ],
      },
    ]);
  });

  it("guesses at an extra transaction that has the right amount", () => {
    // A 4.50 payment the bank reversed, but its export still listed.
    const reversed = tx("2026-10-03", -450);
    const result = checkBalances({
      anchor: { date: "2026-10-05", amount: 268420 },
      transactions: [...october, reversed, tx("2026-10-04", -450, true)],
      bank: [...bank.slice(0, 2), { date: "2026-10-03", balance: 318420 }],
    });
    expect(result).toEqual([
      {
        after: "2026-10-02",
        until: "2026-10-03",
        amount: 450,
        suspects: [{ transaction: reversed, reason: "same-amount" }],
      },
    ]);
  });

  it("reaches the anchor when later transactions aren't imported yet", () => {
    // Balance entered on 20/10; only September is imported, and 400.00 went
    // out in October.
    const result = checkBalances({
      anchor: { date: "2026-10-20", amount: 100000 },
      transactions: [tx("2026-09-29", -5000), tx("2026-09-30", -10000)],
      bank: [
        { date: "2026-09-29", balance: 150000 },
        { date: "2026-09-30", balance: 140000 },
      ],
    });
    expect(result).toEqual([
      {
        after: "2026-09-30",
        until: "2026-10-20",
        amount: -40000,
        suspects: [],
      },
    ]);
  });

  it("reports an anchor that disagrees with the bank on its own day", () => {
    expect(
      checkBalances({
        anchor: { date: "2026-10-05", amount: 268000 },
        transactions: october,
        bank: [{ date: "2026-10-05", balance: 268420 }],
      }),
    ).toEqual([
      { after: "2026-10-05", until: "2026-10-05", amount: 420, suspects: [] },
    ]);
  });

  it("reports each gap separately", () => {
    // The salary is missing, and the groceries were imported twice.
    const twice = tx("2026-10-05", -5630);
    const result = checkBalances({
      anchor: { date: "2026-09-30", amount: 124050 },
      transactions: [...october.slice(1), twice],
      bank,
    });
    expect(result).toEqual([
      {
        after: "2026-09-30",
        until: "2026-10-01",
        amount: 200000,
        suspects: [],
      },
      {
        after: "2026-10-02",
        until: "2026-10-05",
        amount: 5630,
        suspects: [{ transaction: twice, reason: "same-amount" }],
      },
    ]);
  });
});

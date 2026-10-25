import { describe, expect, it } from "vitest";
import { inOrder, ledger, type LedgerEntry } from "./ledger.ts";

let nextId = 1;
const entry = (
  date: string,
  amount: number,
  more: Partial<LedgerEntry> = {},
): LedgerEntry => ({
  id: nextId++,
  importId: 1,
  line: nextId,
  date,
  time: null,
  amount,
  excluded: false,
  keptNearMatch: false,
  bankBalance: null,
  ...more,
});

describe("inOrder", () => {
  it("sorts by date, then time", () => {
    const late = entry("2026-10-02", -100, { time: "18:00:00", line: 2 });
    const early = entry("2026-10-02", -200, { time: "08:00:00", line: 3 });
    const before = entry("2026-10-01", 300, { line: 9 });
    expect(inOrder([late, early, before])).toEqual([before, early, late]);
  });

  it("keeps a day's rows in their file's order", () => {
    const a = entry("2026-10-02", -100, { line: 4 });
    const b = entry("2026-10-02", -200, { line: 5 });
    expect(inOrder([b, a])).toEqual([a, b]);
  });

  it("reads backwards a file that lists the newest first", () => {
    // Line 2 is the newest; on the 2nd, line 3 happened after line 4.
    const newest = entry("2026-10-03", -50, { importId: 7, line: 2 });
    const second = entry("2026-10-02", -100, { importId: 7, line: 3 });
    const first = entry("2026-10-02", -200, { importId: 7, line: 4 });
    const oldest = entry("2026-10-01", 300, { importId: 7, line: 5 });
    expect(inOrder([newest, second, first, oldest])).toEqual([
      oldest,
      first,
      second,
      newest,
    ]);
  });
});

describe("ledger", () => {
  const salary = entry("2026-10-01", 200000, { bankBalance: 324050 });
  const groceries = entry("2026-10-02", -5630, { bankBalance: 318420 });
  const savings = entry("2026-10-05", -50000, { bankBalance: 268420 });
  const anchor = { date: "2026-10-05", amount: 268420 };

  it("gives each transaction the balance after it", () => {
    const { entries, gaps, offDays } = ledger(anchor, [
      savings,
      salary,
      groceries,
    ]);
    expect(entries.map((e) => [e.id, e.balance])).toEqual([
      [salary.id, 324050],
      [groceries.id, 318420],
      [savings.id, 268420],
    ]);
    expect(gaps).toEqual([]);
    expect(offDays).toEqual([]);
  });

  it("skips excluded transactions in the running balance", () => {
    const twice = entry("2026-10-02", -5630, { excluded: true });
    const { entries, gaps } = ledger(anchor, [
      salary,
      groceries,
      twice,
      savings,
    ]);
    expect(entries.map((e) => e.balance)).toEqual([
      324050,
      318420,
      null,
      268420,
    ]);
    expect(gaps).toEqual([]);
  });

  it("finds where the app and the bank part ways", () => {
    // The bank also had a 1.20 coffee on the 3rd, which wasn't imported.
    const later = entry("2026-10-05", -50000, { bankBalance: 268300 });
    const { gaps, offDays } = ledger({ date: "2026-10-05", amount: 268300 }, [
      entry("2026-10-01", 200000, { bankBalance: 324050 }),
      entry("2026-10-02", -5630, { bankBalance: 318420 }),
      later,
    ]);
    expect(gaps).toMatchObject([
      { after: "2026-10-02", until: "2026-10-05", amount: -120 },
    ]);
    expect(offDays).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("checks nothing when no file had balances", () => {
    const { gaps, offDays } = ledger(anchor, [
      entry("2026-10-01", 200000),
      entry("2026-10-05", -50000),
    ]);
    expect(gaps).toEqual([]);
    expect(offDays).toEqual([]);
  });

  describe("with balances I entered", () => {
    const plain = [
      entry("2026-10-01", 200000),
      entry("2026-10-02", -5630),
      entry("2026-10-05", -50000),
    ];

    it("places a gap before a balance of mine that differs", () => {
      // Mine on the 20th: 234.20 less, from October's later transactions.
      const { gaps, offDays, checks } = ledger(anchor, plain, [
        { id: 3, date: "2026-10-20", balance: 245000 },
      ]);
      expect(gaps).toMatchObject([
        { after: "2026-10-05", until: "2026-10-20", amount: -23420 },
      ]);
      expect(offDays).toEqual([]);
      expect(checks).toEqual([
        { id: 3, date: "2026-10-20", balance: 245000, app: 268420 },
      ]);
    });

    it("lists the balances I entered oldest first", () => {
      const { checks } = ledger(anchor, plain, [
        { date: "2026-10-20", balance: 268420 },
        { date: "2026-10-02", balance: 318420 },
      ]);
      expect(checks.map((c) => c.date)).toEqual(["2026-10-02", "2026-10-20"]);
    });

    it("finds nothing when mine agrees", () => {
      const { gaps } = ledger(anchor, plain, [
        { date: "2026-10-02", balance: 318420 },
      ]);
      expect(gaps).toEqual([]);
    });

    it("uses mine instead of the file's on the same day", () => {
      const { gaps, offDays } = ledger(
        anchor,
        [salary, groceries, savings],
        [{ date: "2026-10-02", balance: 318320 }],
      );
      // The file agrees on the 1st and the 5th, so mine is off on its own.
      expect(gaps).toMatchObject([
        { after: "2026-10-01", until: "2026-10-02", amount: -100 },
        { after: "2026-10-02", until: "2026-10-05", amount: 100 },
      ]);
      expect(offDays).toEqual([]);
    });
  });
});

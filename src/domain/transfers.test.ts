import { describe, expect, it } from "vitest";
import {
  isCandidate,
  linkOptions,
  matchTransfers,
  pairKey,
  transfersToPick,
  type TransferTarget,
} from "./transfers.ts";

// Main checking is account 1, Savings 2 and Card account 3, all in euros;
// the US account, 4, is in dollars.
const tx = (
  id: number,
  accountId: number,
  date: string,
  amount: number,
  currency = "EUR",
): TransferTarget => ({ id, accountId, currency, date, amount });

const toSavings = tx(1, 1, "2026-10-10", -50000);
const fromChecking = tx(2, 2, "2026-10-10", 50000);

describe("isCandidate", () => {
  it("pairs money out of one account with the same money into another", () => {
    expect(isCandidate(toSavings, fromChecking)).toBe(true);
    expect(isCandidate(fromChecking, toSavings)).toBe(true);
  });

  it("needs two accounts, one currency, opposite amounts", () => {
    expect(isCandidate(toSavings, tx(2, 1, "2026-10-10", 50000))).toBe(false);
    expect(isCandidate(toSavings, tx(2, 4, "2026-10-10", 50000, "USD"))).toBe(
      false,
    );
    expect(isCandidate(toSavings, tx(2, 2, "2026-10-10", -50000))).toBe(false);
    expect(isCandidate(toSavings, tx(2, 2, "2026-10-10", 49999))).toBe(false);
    expect(
      isCandidate(tx(1, 1, "2026-10-10", 0), tx(2, 2, "2026-10-10", 0)),
    ).toBe(false);
  });

  it("allows up to the window's days between the two sides", () => {
    expect(isCandidate(toSavings, tx(2, 2, "2026-10-13", 50000))).toBe(true);
    expect(isCandidate(toSavings, tx(2, 2, "2026-10-07", 50000))).toBe(true);
    expect(isCandidate(toSavings, tx(2, 2, "2026-10-14", 50000))).toBe(false);
    expect(
      isCandidate(toSavings, tx(2, 2, "2026-10-14", 50000), { window: 4 }),
    ).toBe(true);
  });

  it("skips a pair I dismissed", () => {
    expect(
      isCandidate(toSavings, fromChecking, { dismissed: new Set(["1-2"]) }),
    ).toBe(false);
    expect(pairKey(2, 1)).toBe("1-2");
  });
});

describe("matchTransfers", () => {
  it("links a pair that has no other candidates, money out first", () => {
    const groceries = tx(3, 1, "2026-10-10", -5630);
    const { links, candidates } = matchTransfers([
      fromChecking,
      groceries,
      toSavings,
    ]);
    expect(links).toEqual([{ out: toSavings, in: fromChecking }]);
    expect(candidates.size).toBe(0);
  });

  it("asks me to pick when one side has two candidates", () => {
    // 500.00 into Savings on the 10th and on the 12th.
    const deposit = tx(3, 2, "2026-10-12", 50000);
    const { links, candidates } = matchTransfers([
      deposit,
      toSavings,
      fromChecking,
    ]);
    expect(links).toEqual([]);
    expect(candidates).toEqual(
      new Map([
        [1, [fromChecking, deposit]],
        [3, [toSavings]],
        [2, [toSavings]],
      ]),
    );
  });

  it("asks too when the same transfer was made twice", () => {
    const again = [
      tx(3, 1, "2026-10-10", -50000),
      tx(4, 2, "2026-10-10", 50000),
    ];
    const { links, candidates } = matchTransfers([
      toSavings,
      fromChecking,
      ...again,
    ]);
    expect(links).toEqual([]);
    expect([...candidates.values()].map((list) => list.length)).toEqual([
      2, 2, 2, 2,
    ]);
  });

  it("links what's left once I dismiss the other pair", () => {
    const deposit = tx(3, 2, "2026-10-12", 50000);
    const { links, candidates } = matchTransfers(
      [toSavings, fromChecking, deposit],
      { dismissed: new Set([pairKey(1, 2)]) },
    );
    expect(links).toEqual([{ out: toSavings, in: deposit }]);
    expect(candidates.size).toBe(0);
  });

  it("links pairs between any of my accounts, but never across currencies", () => {
    const toCard = tx(3, 1, "2026-10-11", -20000);
    const fromMain = tx(4, 3, "2026-10-11", 20000);
    const exchange = [
      tx(5, 1, "2026-10-12", -100000),
      tx(6, 4, "2026-10-12", 100000, "USD"),
    ];
    const { links, candidates } = matchTransfers([
      toSavings,
      fromChecking,
      toCard,
      fromMain,
      ...exchange,
    ]);
    expect(links).toEqual([
      { out: toSavings, in: fromChecking },
      { out: toCard, in: fromMain },
    ]);
    expect(candidates.size).toBe(0);
  });
});

describe("linkOptions", () => {
  it("lists the candidates, then other currencies going the other way, each oldest first", () => {
    const deposit = tx(3, 2, "2026-10-12", 50000);
    const dollars = tx(4, 4, "2026-10-11", 54500, "USD");
    const pool = [
      deposit,
      dollars,
      fromChecking,
      // Not options: same account, same direction, too late, another amount.
      tx(5, 1, "2026-10-10", 50000),
      tx(6, 2, "2026-10-10", -50000),
      tx(7, 2, "2026-10-14", 50000),
      tx(8, 2, "2026-10-10", 40000),
      tx(9, 4, "2026-10-09", -1000, "USD"),
    ];
    expect(linkOptions(toSavings, pool)).toEqual([
      fromChecking,
      deposit,
      dollars,
    ]);
  });

  it("still offers a pair I dismissed: I can link it by hand", () => {
    expect(linkOptions(toSavings, [fromChecking])).toEqual([fromChecking]);
  });
});

describe("transfersToPick", () => {
  const pick = (pool: TransferTarget[]) =>
    transfersToPick(matchTransfers(pool).candidates).map((t) => [
      t.id,
      t.candidates.map((c) => c.id),
    ]);

  it("asks about the side with two candidates, not each of them", () => {
    const deposit = tx(3, 2, "2026-10-12", 50000);
    expect(pick([toSavings, fromChecking, deposit])).toEqual([[1, [2, 3]]]);
  });

  it("asks about the money going out when both sides are as many", () => {
    const again = [
      tx(3, 1, "2026-10-11", -50000),
      tx(4, 2, "2026-10-11", 50000),
    ];
    expect(pick([toSavings, fromChecking, ...again])).toEqual([
      [1, [2, 4]],
      [3, [2, 4]],
    ]);
  });

  it("asks about the money coming in when fewer came in", () => {
    // Two 500.00 transfers out of different accounts, one 500.00 in.
    const fromCard = tx(3, 3, "2026-10-11", -50000);
    expect(pick([toSavings, fromChecking, fromCard])).toEqual([[2, [1, 3]]]);
  });

  it("asks nothing when every pair links", () => {
    expect(pick([toSavings, fromChecking])).toEqual([]);
  });
});

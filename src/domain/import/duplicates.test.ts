import { describe, expect, it } from "vitest";
import { findDuplicates, type Imported } from "./duplicates.ts";

const row = (
  date: string,
  amount: number,
  description: string,
  reference: string | null = null,
) => ({ date, amount, description, reference });

const imported = (
  id: number,
  date: string,
  amount: number,
  description: string,
  reference: string | null = null,
): Imported => ({ id, date, amount, description, reference });

describe("findDuplicates", () => {
  it("finds every row of a statement imported again", () => {
    const rows = [
      row("2026-10-01", 200000, "SALARY ACME SPA"),
      row("2026-10-02", -5630, "ESSELUNGA MILANO"),
    ];
    expect(
      findDuplicates(rows, [
        imported(1, "2026-10-01", 200000, "SALARY ACME SPA"),
        imported(2, "2026-10-02", -5630, "ESSELUNGA MILANO"),
      ]),
    ).toEqual([
      { status: "duplicate", of: 1 },
      { status: "duplicate", of: 2 },
    ]);
  });

  it("keeps identical rows beyond the ones already imported", () => {
    const coffee = row("2026-10-03", -120, "BAR CENTRALE");
    expect(
      findDuplicates(
        [coffee, coffee, coffee],
        [imported(7, "2026-10-03", -120, "BAR CENTRALE")],
      ),
    ).toEqual([
      { status: "duplicate", of: 7 },
      { status: "new" },
      { status: "new" },
    ]);
    expect(findDuplicates([coffee, coffee], [])).toEqual([
      { status: "new" },
      { status: "new" },
    ]);
  });

  it("matches by bank reference when both have one", () => {
    const rows = [
      row("2026-10-03", -120, "BAR CENTRALE", "TX2"),
      row("2026-10-03", -120, "BAR CENTRALE", "TX3"),
    ];
    // The row with TX2 finds its own transaction, not the first lookalike.
    expect(
      findDuplicates(rows, [
        imported(1, "2026-10-03", -120, "BAR CENTRALE", "TX1"),
        imported(2, "2026-10-03", -120, "BAR CENTRALE", "TX2"),
      ]),
    ).toEqual([{ status: "duplicate", of: 2 }, { status: "new" }]);
  });

  it("matches by values when one side has no reference", () => {
    expect(
      findDuplicates(
        [row("2026-10-01", 200000, "SALARY ACME SPA", "TX9")],
        [imported(1, "2026-10-01", 200000, "SALARY ACME SPA")],
      ),
    ).toEqual([{ status: "duplicate", of: 1 }]);
  });

  it("flags a row with the same date and amount as a near-match", () => {
    const transactions = [imported(4, "2026-10-14", -3490, "AMAZON EU SARL")];
    expect(
      findDuplicates(
        [
          row("2026-10-14", -3490, "AMAZON EU S.A R.L."),
          row("2026-10-15", -3490, "AMAZON EU SARL"),
          row("2026-10-14", -3500, "AMAZON EU SARL"),
        ],
        transactions,
      ),
    ).toEqual([
      { status: "near-match", of: 4 },
      { status: "new" },
      { status: "new" },
    ]);
  });

  it("doesn't flag a near-match when both references differ", () => {
    expect(
      findDuplicates(
        [row("2026-10-14", -3490, "AMAZON EU S.A R.L.", "TX2")],
        [imported(4, "2026-10-14", -3490, "AMAZON EU SARL", "TX1")],
      ),
    ).toEqual([{ status: "new" }]);
  });

  it("doesn't offer a transaction that is already a duplicate as a near-match", () => {
    expect(
      findDuplicates(
        [
          row("2026-10-14", -3490, "AMAZON EU SARL"),
          row("2026-10-14", -3490, "AMAZON MARKETPLACE"),
        ],
        [imported(4, "2026-10-14", -3490, "AMAZON EU SARL")],
      ),
    ).toEqual([{ status: "duplicate", of: 4 }, { status: "new" }]);
  });
});

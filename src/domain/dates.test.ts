import { describe, expect, it } from "vitest";
import { formatDate, isIsoDate, todayIso } from "./dates.ts";

describe("isIsoDate", () => {
  it("accepts real calendar days", () => {
    expect(isIsoDate("2026-10-16")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects days that don't exist and other formats", () => {
    for (const text of [
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "16/10/2026",
      "2026-10-16T00:00",
      "",
    ]) {
      expect(isIsoDate(text), text).toBe(false);
    }
  });
});

describe("todayIso", () => {
  it("uses the local calendar day", () => {
    expect(todayIso(new Date(2026, 9, 19, 23, 59))).toBe("2026-10-19");
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});

describe("formatDate", () => {
  it("shows day/month/year", () => {
    expect(formatDate("2026-10-16")).toBe("16/10/2026");
  });
});

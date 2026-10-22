import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatDate,
  formatWhen,
  isIsoDate,
  todayIso,
} from "./dates.ts";

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

describe("formatWhen", () => {
  it("adds the time, without seconds, when there is one", () => {
    expect(formatWhen("2026-06-12", "21:02:16")).toBe("12/06/2026 21:02");
    expect(formatWhen("2026-06-12", null)).toBe("12/06/2026");
  });

  it("leaves out the year when short", () => {
    expect(formatWhen("2026-06-12", "09:05:00", { short: true })).toBe(
      "12/06 09:05",
    );
    expect(formatWhen("2026-06-12", null, { short: true })).toBe("12/06");
  });

  it("keeps the seconds when asked", () => {
    expect(formatWhen("2026-06-12", "21:02:16", { seconds: true })).toBe(
      "12/06/2026 21:02:16",
    );
    expect(formatWhen("2026-06-12", null, { seconds: true })).toBe(
      "12/06/2026",
    );
  });
});

describe("daysBetween", () => {
  it("counts calendar days either way, across months and leap days", () => {
    expect(daysBetween("2026-10-10", "2026-10-13")).toBe(3);
    expect(daysBetween("2026-10-13", "2026-10-10")).toBe(3);
    expect(daysBetween("2026-09-29", "2026-10-02")).toBe(3);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-10-10", "2026-10-10")).toBe(0);
  });
});

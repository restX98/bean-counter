// Dates are calendar days written as ISO strings, "2026-10-16", with no time
// or time zone. The app shows them as 16/10/2026. A transaction's time, when
// its file had one, is kept apart as "21:02:16".

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Today on this machine's calendar (not in UTC). */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "2026-10-16" → "16/10/2026". */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "2026-10-15" → "Thursday 15/10/2026", heading a day's transactions. */
export function formatDay(iso: string): string {
  const weekday = new Date(utcDay(iso)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${formatDate(iso)}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-10" → "October 2026"; short, "Oct 2026". */
export function formatMonth(month: string, { short = false } = {}): string {
  const [year, number] = month.split("-");
  const name = MONTHS[Number(number) - 1] ?? "";
  return `${short ? name.slice(0, 3) : name} ${year}`;
}

/** "2026-10" moved by whole months: −1 gives "2026-09", +3 "2027-01". */
export function addMonths(month: string, count: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + number - 1 + count;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/**
 * A transaction's date, with its time when its file had one: "16/10/2026
 * 21:02". Short leaves out the year: "16/10 21:02". Seconds keeps them, to
 * tell apart two in the same minute: "16/10/2026 21:02:16".
 */
export function formatWhen(
  date: string,
  time: string | null,
  { short = false, seconds = false } = {},
): string {
  const day = short ? formatDate(date).slice(0, 5) : formatDate(date);
  if (!time) return day;
  return `${day} ${seconds ? time : time.slice(0, 5)}`;
}

/** How many days apart two dates are, whichever comes first. */
export function daysBetween(a: string, b: string): number {
  return Math.abs(utcDay(a) - utcDay(b)) / 86_400_000;
}

/** Midnight UTC of the day, in milliseconds. */
function utcDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return Date.UTC(year, month - 1, day);
}

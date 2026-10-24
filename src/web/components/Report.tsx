import { Link, NavLink } from "react-router";
import type { CategoryType } from "../../domain/categories.ts";
import { writePeriod, type Period } from "../../domain/filters.ts";
import { formatAmount } from "../../domain/money.ts";
import type { NamedTransaction } from "../api.ts";
import { listNames, plural } from "../labels.ts";
import { Icon } from "./Icon.tsx";

/** How many of the transactions left out a note names. */
const NAMED = 3;

/**
 * The reports, as tabs. Each keeps the currency picked in the one before
 * (?currency=USD), when there's one.
 */
export function ReportTabs({ currency }: { currency: string | null }) {
  const query = currency ? `?${new URLSearchParams({ currency })}` : "";
  return (
    <nav className="tabs" aria-label="Reports">
      <NavLink to={`/reports${query}`} end>
        Monthly in vs out
      </NavLink>
      <NavLink to={`/reports/spending${query}`}>Spending by category</NavLink>
    </nav>
  );
}

/**
 * A report line's transactions in S5, picked the way reports count them:
 * its months, its category and type (or uncategorized), and its currency
 * when there are several.
 */
export function linesTo(
  line: { categoryId: number | null },
  type: CategoryType,
  {
    period,
    currency,
    currencies,
  }: { period: Period; currency: string; currencies: string[] },
) {
  const query = new URLSearchParams({ period: writePeriod(period) });
  if (line.categoryId === null) query.set("type", "uncategorized");
  else {
    query.set("category", String(line.categoryId));
    query.set("type", type);
  }
  if (currencies.length > 1) query.set("currency", currency);
  return `/transactions?${query}`;
}

/** How many transactions Review can still change, when there are any. */
export function WaitingBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="banner tone-info" role="status">
      <Icon name="info" />
      <span className="text">
        <strong>
          {plural(count, "transaction")} waiting in Review can still change
          these numbers
        </strong>
        Uncategorized ones count under Uncategorized; possible transfers and
        paybacks are left out until you decide.
      </span>
      <Link className="btn btn-secondary btn-sm" to="/review">
        Open Review
      </Link>
    </div>
  );
}

/**
 * The possible transfers, or paybacks, a report left out, the first few by
 * name.
 */
export function NotCountedYet({
  pending,
  currency,
  kind = "transfers",
}: {
  pending: NamedTransaction[];
  currency: string;
  kind?: "transfers" | "paybacks";
}) {
  if (pending.length === 0) return null;
  const listed = pending
    .slice(0, NAMED)
    .map(
      (t) =>
        `${t.description} ${formatAmount(t.amount, currency, { signed: true })}`,
    );
  if (pending.length > NAMED) {
    listed.push(plural(pending.length - NAMED, "more", "more"));
  }
  const one = pending.length === 1;
  return kind === "transfers" ? (
    <p className="caption">
      Not counted yet: {listNames(listed)}. They may be transfers between your
      accounts: link or dismiss them in Review.
    </p>
  ) : (
    <p className="caption">
      {one ? "Possible payback" : "Possible paybacks"} not counted yet:{" "}
      {listNames(listed)}. {one ? "It" : "They"} may pay back expenses: link{" "}
      {one ? "it, or pick its category," : "them, or pick their categories,"} in
      Review.
    </p>
  );
}

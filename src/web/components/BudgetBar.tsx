import { formatAmount, formatSize, MINUS } from "../../domain/money.ts";
import { Icon } from "./Icon.tsx";

/** "320.00 / 300.00 €": what's spent of a limit. */
export function spentOf(spent: number, limit: number, currency: string) {
  const sign = spent < 0 ? MINUS : "";
  return `${sign}${formatSize(spent, currency)} / ${formatAmount(limit, currency)}`;
}

/**
 * How much of a limit is spent: full and red once it's over. Decorative:
 * the numbers beside it say the same.
 */
export function BudgetBar({ spent, limit }: { spent: number; limit: number }) {
  const over = spent > limit;
  const filled = over
    ? 100
    : Math.round((Math.max(0, spent) / Math.max(1, limit)) * 100);
  return (
    <span className={over ? "bar is-over" : "bar"} aria-hidden="true">
      <span style={{ width: `${filled}%` }} />
    </span>
  );
}

export function OverTag() {
  return (
    <span className="tag tone-danger">
      <Icon name="alert" />
      Over
    </span>
  );
}

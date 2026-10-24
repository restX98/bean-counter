import type { Account } from "../../domain/accounts.ts";
import type { Category } from "../../domain/categories.ts";
import { formatAmount } from "../../domain/money.ts";
import type { ListedTransaction } from "../api.ts";
import { plural } from "../labels.ts";
import { Icon } from "./Icon.tsx";

/**
 * A transaction's category as the lists show it (S4, S5). A transfer names
 * its other side's account instead, and a possible one waits for that
 * decision first. A payment linked in full says how many expenses it pays
 * back instead, and an expense paid back adds my share. Excluded
 * transactions don't count anywhere, so they don't need a category.
 */
export function TransactionCategory({
  transaction: t,
  currency,
  accounts,
  categories,
}: {
  transaction: ListedTransaction;
  /** Its account's. */
  currency: string;
  accounts: Account[];
  /** Undefined while they load. */
  categories: Category[] | undefined;
}) {
  const name = (id: number) => categories?.find((c) => c.id === id)?.name;
  const payback = (text: string) => (
    <span className="tag tone-neutral">
      <Icon name="payback" />
      {text}
    </span>
  );
  if (t.paybacks && t.amount > 0) {
    const tag = payback(`Payback · ${plural(t.paybacks.count, "expense")}`);
    // What it doesn't pay back still needs a category.
    if (t.paybacks.total === t.amount) return tag;
    return (
      <>
        {t.categoryId === null ? (
          <span className="tag tone-warning">Uncategorized</span>
        ) : (
          <span>{name(t.categoryId)}</span>
        )}
        {tag}
      </>
    );
  }
  const share =
    t.paybacks &&
    payback(
      `Your share ${formatAmount(-t.amount - t.paybacks.total, currency)}`,
    );
  if (t.transfer) {
    return (
      <span className="tag tone-neutral">
        <Icon name="transfer" />
        <span className="visually-hidden">Transfer with </span>
        {accounts.find((a) => a.id === t.transfer?.accountId)?.name}
      </span>
    );
  }
  if (t.toPick) {
    return (
      <span className="tag tone-warning">
        <Icon name="transfer" />
        Transfer to pick
      </span>
    );
  }
  if (t.categoryId !== null) {
    return (
      <>
        <span>{name(t.categoryId)}</span>
        {share}
      </>
    );
  }
  if (t.excluded || !categories) return null;
  if (t.conflict) {
    return (
      <span
        className="tag tone-warning"
        title={`Rules disagree: ${t.conflict.map(name).join(" or ")}`}
      >
        <Icon name="alert" />
        Rule conflict
      </span>
    );
  }
  return (
    <>
      <span className="tag tone-warning">Uncategorized</span>
      {share}
    </>
  );
}

/**
 * Green only for income. Money in that has no category yet, or may be a
 * transfer, isn't income until I say so; a transfer and a payback are
 * muted.
 */
export function amountClass(t: ListedTransaction): string {
  if (t.transfer) return "amount transfer";
  if (t.paybacks && t.amount > 0) return "amount payback";
  return t.amount > 0 && t.categoryId !== null && !t.toPick && !t.excluded
    ? "amount income"
    : "amount";
}

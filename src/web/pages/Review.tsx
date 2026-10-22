import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { BothBalances } from "../../domain/balances.ts";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { shownEnd } from "../../domain/review.ts";
import { suggestText } from "../../domain/rules.ts";
import {
  useAccounts,
  useApplyRules,
  useCategories,
  useLink,
  useNotATransfer,
  useReview,
  useRules,
  useSetCategory,
  useUndoTransfer,
  type ReviewExchange,
  type ReviewList,
  type ReviewMismatch,
  type ReviewTransfer,
  type TransferChange,
} from "../api.ts";
import { CategorySelect } from "../components/CategorySelect.tsx";
import { FormError } from "../components/Dialog.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/icons.ts";
import { Loading, Page } from "../components/Page.tsx";
import { Toast } from "../components/Toast.tsx";
import { CategoryForm } from "../dialogs/CategoryForm.tsx";
import { LinkTransfer } from "../dialogs/LinkTransfer.tsx";
import { RuleForm } from "../dialogs/RuleForm.tsx";
import { plural, possibleMatches, ruleText } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

/** Items shown in a group before "Show N more". */
const SHOWN = 5;

type Item =
  ReviewList["uncategorized"][number] | ReviewList["conflicts"][number];
type GroupKey = "uncategorized" | "conflicts" | "transfers" | "mismatches";

/** One item of a group, laid out the same way in every group. */
interface Row {
  key: string;
  date: string;
  account: string;
  /** On a phone, above the item: the account, and the day if it matters. */
  where: string;
  what: ReactNode;
  amount: ReactNode;
  acts: ReactNode;
}

const isConflict = (item: Item): item is ReviewList["conflicts"][number] =>
  "categoryIds" in item;
/** An item's group and transaction, which together name it. */
const keyOf = (item: Item) =>
  `${isConflict(item) ? "conflicts" : "uncategorized"} ${item.id}`;
const transferKey = (item: ReviewTransfer) => `transfers ${item.id}`;
const exchangeKey = (item: ReviewExchange) =>
  `exchanges ${item.id} ${item.other.id}`;
const day = (date: string) => formatDate(date).slice(0, 5);

/**
 * S2: what the app can't decide on its own. Transactions waiting for a
 * category: picking one takes the item off the list, with Undo; a rule's
 * category can be taken with one click. Possible transfers: I pick the
 * other side (D4) or say it isn't one, with Undo. Places where an account's
 * balances and the bank's part ways: fixed on the account's page.
 */
export function Review() {
  const isMobile = useIsMobile();
  const review = useReview();
  const categories = useCategories();
  const accounts = useAccounts();
  const rules = useRules();
  const setCategory = useSetCategory();
  const applyRules = useApplyRules();
  const link = useLink();
  const notATransfer = useNotATransfer();
  const undoTransfer = useUndoTransfer();
  // Items just settled, hidden before the list catches up; Undo brings them
  // back. By group, since a transaction can move to another one (see `keyOf`).
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<{
    key: number;
    text: string;
    undo: () => void;
  } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "category" | "rule"; item: Item }
    | { kind: "link"; item: ReviewTransfer }
    | null
  >(null);
  const [expanded, setExpanded] = useState<ReadonlySet<GroupKey>>(new Set());

  const page = {
    title: "Review",
    back: { to: "/more", label: "Back to More" },
  };
  if (!review.data || !categories.data || !accounts.data) {
    return (
      <Page {...page}>
        <Loading error={review.error ?? categories.error ?? accounts.error} />
      </Page>
    );
  }

  const names = new Map(categories.data.categories.map((c) => [c.id, c.name]));
  const accountNames = new Map(accounts.data.map((a) => [a.id, a.name]));
  const ruleById = new Map(rules.data?.rules.map((r) => [r.id, r]) ?? []);

  const hide = (key: string, hidden: boolean) =>
    setSettled((current) => {
      const next = new Set(current);
      if (hidden) next.add(key);
      else next.delete(key);
      return next;
    });
  // A new key for each message, so its timer starts again.
  const notify = (text: string, undo: () => void) =>
    setToast((previous) => ({
      key: (previous?.key ?? 0) + 1,
      text,
      undo: () => {
        setToast(null);
        undo();
      },
    }));
  const done = (item: Item, category: string) =>
    notify(`${item.description} is now in ${category}.`, () =>
      setCategory.mutate(
        { id: item.id, categoryId: null },
        { onSuccess: () => hide(keyOf(item), false) },
      ),
    );
  // `others`: the transfers that linked on their own after it.
  const transferDone = (
    key: string,
    text: string,
    change: TransferChange,
    others: number,
  ) => {
    hide(key, true);
    notify(
      others > 0
        ? `${text} ${plural(others, "more transfer")} linked on ${others === 1 ? "its" : "their"} own.`
        : text,
      () => undoTransfer.mutate(change, { onSuccess: () => hide(key, false) }),
    );
  };
  const dismiss = (item: ReviewTransfer) => {
    const key = transferKey(item);
    hide(key, true);
    notATransfer.mutate(
      { id: item.id },
      {
        onSuccess: (change) =>
          transferDone(
            key,
            `${item.description} isn't a transfer.`,
            change,
            change.linked.length,
          ),
        onError: () => hide(key, false),
      },
    );
  };
  const linkExchange = (item: ReviewExchange) => {
    const key = exchangeKey(item);
    hide(key, true);
    link.mutate(
      { id: item.id, otherId: item.other.id },
      {
        onSuccess: (change) =>
          transferDone(
            key,
            `${item.description} is now linked to ${accountNames.get(item.other.accountId)}.`,
            change,
            change.linked.length - 1,
          ),
        onError: () => hide(key, false),
      },
    );
  };
  const dismissExchange = (item: ReviewExchange) => {
    const key = exchangeKey(item);
    hide(key, true);
    notATransfer.mutate(
      { id: item.id, otherId: item.other.id },
      {
        onSuccess: (change) =>
          transferDone(
            key,
            `${item.description} and ${item.other.description} aren't a transfer.`,
            change,
            change.linked.length,
          ),
        onError: () => hide(key, false),
      },
    );
  };
  const pick = (item: Item, categoryId: number, name: string) => {
    hide(keyOf(item), true);
    setCategory.mutate(
      { id: item.id, categoryId },
      {
        onSuccess: () => done(item, name),
        onError: () => hide(keyOf(item), false),
      },
    );
  };
  const takeSuggestion = (item: Item) => {
    hide(keyOf(item), true);
    applyRules.mutate(item.id, {
      onSuccess: ({ categoryId }) => done(item, names.get(categoryId) ?? ""),
      onError: () => hide(keyOf(item), false),
    });
  };

  const what = (item: Item) => {
    if (isConflict(item)) {
      const rulesCount = plural(item.ruleIds.length, "rule");
      const disagree = item.categoryIds.map((c) => names.get(c)).join(", ");
      return (
        <span className="what">
          <strong>{item.description}</strong>
          <span className="tag tone-warning">
            <Icon name="alert" />
            {isMobile
              ? `Matches ${rulesCount}`
              : `Matches ${rulesCount}: ${disagree}`}
          </span>
          {isMobile && <span className="caption">{disagree}</span>}
        </span>
      );
    }
    const { suggestion } = item;
    const rule = suggestion && ruleById.get(suggestion.ruleId);
    return (
      <span className="what">
        <strong>{item.description}</strong>
        {suggestion && (
          <span className="caption">
            {rule ? `Rule ${ruleText(rule)}` : "A rule"} gives{" "}
            {names.get(suggestion.categoryId)}
          </span>
        )}
      </span>
    );
  };

  const acts = (item: Item) => {
    const picker = (
      <CategorySelect
        className="select is-placeholder"
        value={null}
        amount={item.amount}
        none="Pick category"
        aria-label={`Category for ${item.description}`}
        onPick={(categoryId) =>
          categoryId !== null &&
          pick(item, categoryId, names.get(categoryId) ?? "")
        }
        onNew={() => setDialog({ kind: "category", item })}
      />
    );
    if (isConflict(item)) return <span className="acts">{picker}</span>;
    if (item.suggestion) {
      return (
        <span className="acts">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={`Use ${names.get(item.suggestion.categoryId)} for ${item.description}`}
            disabled={applyRules.isPending}
            onClick={() => takeSuggestion(item)}
          >
            Use it
          </button>
          {picker}
        </span>
      );
    }
    return (
      <span className="acts">
        {picker}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={`Create rule from ${item.description}`}
          onClick={() => setDialog({ kind: "rule", item })}
        >
          Create rule
        </button>
      </span>
    );
  };

  const transactionRow = (item: Item): Row => {
    const account = accountNames.get(item.accountId) ?? "";
    return {
      key: String(item.id),
      date: item.date,
      account,
      where: `${account} · ${day(item.date)}`,
      what: what(item),
      amount: (
        <span className={item.amount > 0 ? "amount income" : "amount"}>
          {formatAmount(item.amount, item.currency, { signed: true })}
        </span>
      ),
      acts: acts(item),
    };
  };

  const transferRow = (item: ReviewTransfer): Row => {
    const account = accountNames.get(item.accountId) ?? "";
    const where = [
      ...new Set(
        item.candidates.map((c) => accountNames.get(c.accountId) ?? ""),
      ),
    ];
    return {
      key: String(item.id),
      date: item.date,
      account,
      where: `${account} · ${day(item.date)}`,
      what: (
        <span className="what">
          <strong>{item.description}</strong>
          <span className="caption">
            {possibleMatches(item.candidates.length, where)}
          </span>
        </span>
      ),
      amount: (
        <span className={item.amount > 0 ? "amount income" : "amount"}>
          {formatAmount(item.amount, item.currency, { signed: true })}
        </span>
      ),
      acts: (
        <span className="acts">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={`Pick the other side of ${item.description}`}
            onClick={() => setDialog({ kind: "link", item })}
          >
            <Icon name="transfer" />
            Pick the other side
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`${item.description} isn't a transfer`}
            disabled={notATransfer.isPending}
            onClick={() => dismiss(item)}
          >
            Not a transfer
          </button>
        </span>
      ),
    };
  };

  // A pair across currencies: the side going out, with the other side.
  const exchangeRow = (item: ReviewExchange): Row => {
    const account = accountNames.get(item.accountId) ?? "";
    const other = accounts.data.find((a) => a.id === item.other.accountId);
    return {
      key: `${item.id} ${item.other.id}`,
      date: item.date,
      account,
      where: `${account} · ${day(item.date)}`,
      what: (
        <span className="what">
          <strong>{item.description}</strong>
          <span className="caption">
            ⇄ {item.other.description} · {other?.name} ·{" "}
            {other &&
              formatAmount(item.other.amount, other.currency, {
                signed: true,
              })}{" "}
            on {day(item.other.date)}
          </span>
        </span>
      ),
      amount: (
        <span className="amount">
          {formatAmount(item.amount, item.currency, { signed: true })}
        </span>
      ),
      acts: (
        <span className="acts">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            aria-label={`Link ${item.description} with ${item.other.description}`}
            disabled={link.isPending}
            onClick={() => linkExchange(item)}
          >
            Link
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={`${item.description} and ${item.other.description} aren't a transfer`}
            disabled={notATransfer.isPending}
            onClick={() => dismissExchange(item)}
          >
            Not a transfer
          </button>
        </span>
      ),
    };
  };

  const mismatchRow = (m: ReviewMismatch): Row => {
    const money = (minor: number) => formatAmount(minor, m.currency);
    const account = accountNames.get(m.accountId) ?? "";
    const end = shownEnd(m);
    return {
      key: `${m.accountId}-${m.index}`,
      date: end.date,
      account,
      where: account,
      what: (
        <span className="what">
          <strong>
            App {money(end.app)} · bank {money(end.bank)}
          </strong>
          <span className="caption">{mismatchText(m, money)}</span>
        </span>
      ),
      amount: (
        <span className="amount">
          <span className="tag tone-warning">
            Off by {money(Math.abs(end.bank - end.app))}
          </span>
        </span>
      ),
      acts: (
        <span className="acts">
          <Link
            className="btn btn-secondary btn-sm"
            to={`/accounts/${m.accountId}?gap=${m.index}`}
          >
            Open {account}
          </Link>
        </span>
      ),
    };
  };

  const unsettled = (items: Item[]) =>
    items.filter((t) => !settled.has(keyOf(t))).map(transactionRow);
  const groups = (
    [
      {
        key: "uncategorized",
        title: "Uncategorized",
        icon: "tag",
        rows: unsettled(review.data.uncategorized),
      },
      {
        key: "conflicts",
        title: "Rule conflicts",
        icon: "rules",
        rows: unsettled(review.data.conflicts),
      },
      {
        key: "transfers",
        title: "Transfers to confirm",
        icon: "transfer",
        // Newest first, whichever kind.
        rows: [
          ...review.data.transfers
            .filter((t) => !settled.has(transferKey(t)))
            .map(transferRow),
          ...review.data.exchanges
            .filter((x) => !settled.has(exchangeKey(x)))
            .map(exchangeRow),
        ].sort((a, b) => b.date.localeCompare(a.date)),
      },
      {
        key: "mismatches",
        title: "Balance mismatches",
        icon: "scale",
        rows: review.data.mismatches.map(mismatchRow),
      },
    ] satisfies {
      key: GroupKey;
      title: string;
      icon: IconName;
      rows: Row[];
    }[]
  ).filter((g) => g.rows.length > 0);
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  const summary =
    count === 0
      ? "Nothing needs your decision"
      : `${plural(count, "item")} ${count === 1 ? "needs" : "need"} your decision`;

  return (
    <Page {...page} subtitle={summary}>
      {isMobile && <p className="muted">{summary}</p>}
      <FormError
        error={
          setCategory.error ??
          applyRules.error ??
          link.error ??
          notATransfer.error ??
          undoTransfer.error
        }
      />

      {count === 0 ? (
        <EmptyState
          icon="check"
          tone="success"
          title="All caught up"
          action={
            <Link className="btn btn-secondary" to="/">
              Back to Dashboard
            </Link>
          }
        >
          Every transaction is categorized, every transfer is linked and every
          balance matches the bank. New items show up here after your next
          import.
        </EmptyState>
      ) : (
        groups.map(({ key, title, icon, rows }) => {
          const shown = expanded.has(key) ? rows : rows.slice(0, SHOWN);
          const more = rows.length - shown.length;
          const showMore = more > 0 && (
            <button
              type="button"
              className="link"
              onClick={() => setExpanded(new Set(expanded).add(key))}
            >
              Show {more} more {title.toLowerCase()}
            </button>
          );
          const badge = <span className="badge neutral">{rows.length}</span>;
          return isMobile ? (
            <details key={key} className="m-group" open>
              <summary>
                <Icon name={icon} />
                {title}
                {badge}
                <Icon name="chevron" className="icon chev" />
              </summary>
              <div className="m-group-body">
                {shown.map((row) => (
                  <div key={row.key} className="card m-item">
                    <span className="where">{row.where}</span>
                    {row.amount}
                    {row.what}
                    {row.acts}
                  </div>
                ))}
                {showMore}
              </div>
            </details>
          ) : (
            <section key={key} className="card group">
              <h2 className="group-head">
                <Icon name={icon} />
                {title}
                {badge}
              </h2>
              {shown.map((row) => (
                <div key={row.key} className="item">
                  <span className="date">{formatDate(row.date)}</span>
                  <span className="acct">{row.account}</span>
                  {row.what}
                  {row.amount}
                  {row.acts}
                </div>
              ))}
              {showMore && <div className="item-more">{showMore}</div>}
            </section>
          );
        })
      )}

      {dialog?.kind === "category" && (
        <CategoryForm
          type={dialog.item.amount > 0 ? "income" : "expense"}
          onClose={() => setDialog(null)}
          onSaved={(category) => pick(dialog.item, category.id, category.name)}
        />
      )}
      {dialog?.kind === "link" && (
        <LinkTransfer
          transaction={dialog.item}
          onClose={() => setDialog(null)}
          onLinked={(change, other) =>
            transferDone(
              transferKey(dialog.item),
              `${dialog.item.description} is now linked to ${accountNames.get(other.accountId)}.`,
              change,
              change.linked.length - 1,
            )
          }
        />
      )}
      {dialog?.kind === "rule" && (
        <RuleForm
          prefill={{ text: suggestText(dialog.item.description) }}
          onClose={() => setDialog(null)}
        />
      )}
      {toast && (
        <Toast
          key={toast.key}
          text={toast.text}
          onUndo={toast.undo}
          onDone={() => setToast(null)}
        />
      )}
    </Page>
  );
}

/**
 * Where a mismatch lies: the last day the balances match and the first day
 * they don't, in date order. Where an account has more than one gap, both
 * ends can differ, each by its own amount.
 */
function mismatchText(m: ReviewMismatch, money: (minor: number) => string) {
  if (m.after === m.until) {
    return `On ${formatDate(m.until)}, the bank's balance differs from the balance anchor`;
  }
  const off = ({ app, bank }: BothBalances) => bank - app;
  const [first, second] = [off(m.balances.after), off(m.balances.until)];
  const state = (difference: number, other: number) =>
    difference === 0
      ? "match"
      : other === 0
        ? "differ"
        : `differ by ${money(Math.abs(difference))}`;
  return `They ${state(first, second)} up to ${formatDate(m.after)} and ${state(second, first)} from ${formatDate(m.until)}`;
}

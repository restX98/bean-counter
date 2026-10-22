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
  useReview,
  useRules,
  useSetCategory,
  type ReviewList,
  type ReviewMismatch,
} from "../api.ts";
import { CategorySelect } from "../components/CategorySelect.tsx";
import { FormError } from "../components/Dialog.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/icons.ts";
import { Loading, Page } from "../components/Page.tsx";
import { Toast } from "../components/Toast.tsx";
import { CategoryForm } from "../dialogs/CategoryForm.tsx";
import { RuleForm } from "../dialogs/RuleForm.tsx";
import { plural, ruleText } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

/** Items shown in a group before "Show N more". */
const SHOWN = 5;

type Item =
  ReviewList["uncategorized"][number] | ReviewList["conflicts"][number];
type GroupKey = "uncategorized" | "conflicts" | "mismatches";

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
const day = (date: string) => formatDate(date).slice(0, 5);

/**
 * S2: what the app can't decide on its own. Transactions waiting for a
 * category: picking one takes the item off the list, with Undo; a rule's
 * category can be taken with one click. Places where an account's balances
 * and the bank's part ways: fixed on the account's page.
 */
export function Review() {
  const isMobile = useIsMobile();
  const review = useReview();
  const categories = useCategories();
  const accounts = useAccounts();
  const rules = useRules();
  const setCategory = useSetCategory();
  const applyRules = useApplyRules();
  // Items just settled, hidden before the list catches up; Undo brings them back.
  const [settled, setSettled] = useState<ReadonlySet<number>>(new Set());
  const [toast, setToast] = useState<{
    key: number;
    text: string;
    undo: () => void;
  } | null>(null);
  const [dialog, setDialog] = useState<{
    kind: "category" | "rule";
    item: Item;
  } | null>(null);
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

  const hide = (id: number, hidden: boolean) =>
    setSettled((current) => {
      const next = new Set(current);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });
  // A new key for each message, so its timer starts again.
  const done = (item: Item, category: string) =>
    setToast((previous) => ({
      key: (previous?.key ?? 0) + 1,
      text: `${item.description} is now in ${category}.`,
      undo: () => {
        setToast(null);
        setCategory.mutate(
          { id: item.id, categoryId: null },
          { onSuccess: () => hide(item.id, false) },
        );
      },
    }));
  const pick = (item: Item, categoryId: number, name: string) => {
    hide(item.id, true);
    setCategory.mutate(
      { id: item.id, categoryId },
      {
        onSuccess: () => done(item, name),
        onError: () => hide(item.id, false),
      },
    );
  };
  const takeSuggestion = (item: Item) => {
    hide(item.id, true);
    applyRules.mutate(item.id, {
      onSuccess: ({ categoryId }) => done(item, names.get(categoryId) ?? ""),
      onError: () => hide(item.id, false),
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
    items.filter((t) => !settled.has(t.id)).map(transactionRow);
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
      <FormError error={setCategory.error ?? applyRules.error} />

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
          Every transaction has a category and every balance matches the bank.
          New items show up here after your next import.
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

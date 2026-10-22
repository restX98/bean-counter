import { useState } from "react";
import type { Account } from "../../domain/accounts.ts";
import {
  useAccounts,
  useCategories,
  useRules,
  type RuleListItem,
} from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { DeleteRule } from "../dialogs/DeleteRule.tsx";
import { RuleForm } from "../dialogs/RuleForm.tsx";
import { plural, ruleNarrowing, ruleTest, ruleText } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

type Open =
  | { kind: "add" }
  | { kind: "edit"; rule: RuleListItem }
  | { kind: "delete"; rule: RuleListItem }
  | null;

/** S17: every rule, the category it gives and how many it categorized. */
export function Rules() {
  const isMobile = useIsMobile();
  const rules = useRules();
  const categories = useCategories();
  const accounts = useAccounts();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  const add = (
    <button
      type="button"
      className={isMobile ? "btn btn-primary btn-sm" : "btn btn-primary"}
      onClick={() => setOpen({ kind: "add" })}
    >
      <Icon name="plus" />
      {isMobile ? "Add" : "Add rule"}
    </button>
  );
  const page = { title: "Rules", back: { to: "/more", label: "Back to More" } };

  if (!rules.data || !categories.data || !accounts.data) {
    return (
      <Page {...page}>
        <Loading error={rules.error ?? categories.error ?? accounts.error} />
      </Page>
    );
  }

  const list = rules.data.rules;
  const names = new Map(categories.data.categories.map((c) => [c.id, c.name]));
  const List = isMobile ? MobileList : DesktopList;

  return (
    <Page {...page} actions={list.length > 0 && add} mobileActions={add}>
      <p className="muted">
        Rules run on every import. They have no order: when the rules that match
        a transaction give different categories, it goes to Review.
      </p>
      {list.length === 0 ? (
        <EmptyState
          icon="rules"
          title="No rules yet"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setOpen({ kind: "add" })}
            >
              <Icon name="plus" />
              Add rule
            </button>
          }
        >
          A rule categorizes matching transactions on every import. The quickest
          way to make one is “Create rule from this” on a transaction.
        </EmptyState>
      ) : (
        <>
          <Overlaps rules={list} conflicts={rules.data.conflicts} />
          <List
            rules={list}
            category={(rule) => names.get(rule.categoryId) ?? ""}
            accounts={accounts.data}
            onEdit={(rule) => setOpen({ kind: "edit", rule })}
            onDelete={(rule) => setOpen({ kind: "delete", rule })}
          />
          <p className="caption">
            {isMobile
              ? "The number is how many transactions each rule categorized."
              : "Matches = transactions this rule categorized. Deleting a rule doesn't change categories already set."}
          </p>
        </>
      )}

      {open?.kind === "add" && <RuleForm onClose={close} />}
      {open?.kind === "edit" && (
        <RuleForm
          rule={open.rule}
          onClose={close}
          onDelete={() => setOpen({ kind: "delete", rule: open.rule })}
        />
      )}
      {open?.kind === "delete" && (
        <DeleteRule rule={open.rule} onClose={close} />
      )}
    </Page>
  );
}

/** Warns that some rules overlap, and what that has cost so far. */
function Overlaps({
  rules,
  conflicts,
}: {
  rules: RuleListItem[];
  conflicts: number;
}) {
  const overlapping = rules.filter((r) => r.overlaps.length > 0);
  const [a, b] = overlapping;
  if (!a || !b) return null;
  const title =
    overlapping.length > 2
      ? `${overlapping.length} rules overlap`
      : // Matching ignores case, so AMAZON and amazon are the same text.
        ruleText(a).toLowerCase() === ruleText(b).toLowerCase()
        ? `The two ${ruleText(a)} rules overlap`
        : `${ruleText(a)} and ${ruleText(b)} overlap`;
  return (
    <div className="banner tone-warning">
      <Icon name="alert" />
      <span className="text">
        <strong>{title}</strong>
        {conflicts > 0
          ? `${plural(conflicts, "transaction")} ${conflicts === 1 ? "is" : "are"} waiting in Review as rule conflicts. Narrow one of the rules to stop new conflicts.`
          : `A transaction ${overlapping.length > 2 ? "two of them" : "they both"} match goes to Review instead of getting a category. Narrow one of the rules to avoid it.`}
      </span>
    </div>
  );
}

interface ListProps {
  rules: RuleListItem[];
  category: (rule: RuleListItem) => string;
  accounts: Account[];
  onEdit: (rule: RuleListItem) => void;
  onDelete: (rule: RuleListItem) => void;
}

const OverlapsTag = () => <span className="tag tone-warning">Overlaps</span>;

function DesktopList({
  rules,
  category,
  accounts,
  onEdit,
  onDelete,
}: ListProps) {
  return (
    <section className="card table">
      <div className="rule-row head" aria-hidden="true">
        <span>Description</span>
        <span>Also requires</span>
        <span>Category</span>
        <span className="r">Matches</span>
        <span />
      </div>
      {rules.map((rule) => {
        const name = ruleTest(rule);
        return (
          <div key={rule.id} className="rule-row">
            <span className="match">
              <span className="text">{name}</span>
              {rule.overlaps.length > 0 && <OverlapsTag />}
            </span>
            <span className="muted-cell">
              {ruleNarrowing(rule, accounts).join(" · ") || "—"}
            </span>
            <span>{category(rule)}</span>
            <span className="num">{rule.matches > 0 ? rule.matches : "—"}</span>
            <span className="acts">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Edit rule ${name}`}
                onClick={() => onEdit(rule)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Delete rule ${name}`}
                onClick={() => onDelete(rule)}
              >
                Delete
              </button>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function MobileList({ rules, category, accounts, onEdit }: ListProps) {
  return (
    <div className="card m-list">
      {rules.map((rule) => (
        <button
          key={rule.id}
          type="button"
          className="m-tx"
          onClick={() => onEdit(rule)}
        >
          <span className="desc">{ruleTest(rule)}</span>
          <span className="amount count">{rule.matches}</span>
          <span className="meta">
            <span>
              {[`→ ${category(rule)}`, ...ruleNarrowing(rule, accounts)].join(
                " · ",
              )}
            </span>
            {rule.overlaps.length > 0 && <OverlapsTag />}
          </span>
        </button>
      ))}
    </div>
  );
}

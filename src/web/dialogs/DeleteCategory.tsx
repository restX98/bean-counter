import { useId, useState } from "react";
import { limitIn } from "../../domain/budgets.ts";
import { groupCategories, type Category } from "../../domain/categories.ts";
import { formatMonth } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import {
  useAccounts,
  useBudget,
  useCategories,
  useDeleteCategory,
  useRules,
} from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { plural, ruleName } from "../labels.ts";

const GROUP_TITLES = { income: "Income", expense: "Expenses" };

/**
 * D5's delete variant. A category in use asks where its transactions go: to
 * another category, or back to uncategorized. The rules that give it follow
 * them, or are deleted, and its budget is deleted with its history; the
 * dialog lists them.
 */
export function DeleteCategory({
  category,
  onClose,
}: {
  category: Category;
  onClose: () => void;
}) {
  const id = useId();
  const remove = useDeleteCategory();
  const { data } = useCategories();
  const rules = useRules(category.ruleCount > 0);
  const { data: accounts = [] } = useAccounts();
  const used = category.transactionCount;
  const inUse = used > 0 || category.ruleCount > 0;
  // The question is about its transactions, or its rules if it has none.
  const count = used > 0 ? used : category.ruleCount;
  const them = count === 1 ? "it" : "them";
  const itsRules = (rules.data?.rules ?? []).filter(
    (r) => r.categoryId === category.id,
  );
  const budget = useBudget(
    category.budgetId ?? 0,
    category.budgetId !== null,
  ).data;
  // The others, its own type first, as the place to move them to.
  const groups = groupCategories(
    (data?.categories ?? []).filter((c) => c.id !== category.id),
  ).toSorted(
    (a, b) =>
      Number(b.type === category.type) - Number(a.type === category.type),
  );
  const first = groups[0]?.categories[0];
  const [mode, setMode] = useState<"move" | "uncategorize">("move");
  const [moveTo, setMoveTo] = useState<number | undefined>(undefined);
  const target = moveTo ?? first?.id;
  const canMove = target !== undefined;
  const moving = mode === "move" && canMove;
  const targetName = groups
    .flatMap((g) => g.categories)
    .find((c) => c.id === target)?.name;

  // What else goes: its rules follow its transactions or are deleted; its
  // budget is deleted.
  const changes = (itsRules.length > 0 || category.budgetId !== null) && (
    <div className="banner tone-warning" role="status">
      <Icon name="alert" />
      <span className="text">
        <strong>{used > 0 ? "This also changes" : "This changes"}</strong>
        <span className="change-list">
          {itsRules.map((r) => (
            <span key={r.id}>
              Rule {ruleName(r, accounts)} →{" "}
              {moving ? `now gives ${targetName}` : "deleted"}
            </span>
          ))}
          {category.budgetId !== null && (
            <span>
              Budget
              {budget &&
                ` (${formatAmount(
                  limitIn(budget.plan, budget.thisMonth) ??
                    budget.plan.limits[0]!.amount,
                  budget.currency,
                )} a month since ${formatMonth(budget.plan.start)})`}{" "}
              → deleted, with its history
            </span>
          )}
        </span>
      </span>
    </div>
  );

  const submit = () =>
    remove.mutate(
      inUse
        ? { id: category.id, moveTo: moving ? target : null }
        : { id: category.id },
      { onSuccess: onClose },
    );

  return (
    <Dialog
      title={`Delete “${category.name}”?`}
      size={inUse ? undefined : "sm"}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={remove.isPending || (inUse && !data)}
            data-autofocus={!inUse || undefined}
          >
            Delete category
          </button>
        </>
      }
    >
      <FormError error={remove.error} />
      {!inUse ? (
        <>
          <p className="muted">No transactions use this category.</p>
          {changes}
        </>
      ) : (
        <div className="form">
          <p className="muted">
            {used > 0
              ? `${plural(used, "transaction")} ${used === 1 ? "uses" : "use"} this category.`
              : `${plural(count, "rule")} ${count === 1 ? "gives" : "give"} this category.`}{" "}
            What should happen to {them}?
          </p>
          <div
            className="choices"
            role="radiogroup"
            aria-label={
              used > 0
                ? "Where its transactions go"
                : "What happens to its rules"
            }
          >
            <label
              className={moving ? "choice is-selected" : "choice"}
              data-disabled={!canMove || undefined}
            >
              <input
                type="radio"
                className="visually-hidden"
                name={`${id}-mode`}
                checked={moving}
                disabled={!canMove}
                onChange={() => setMode("move")}
                data-autofocus={moving || undefined}
              />
              <span className="radio" aria-hidden="true" />
              <span className="what">
                <strong>Move {them} to</strong>
                {!canMove && (
                  <span className="caption">There's no other category.</span>
                )}
              </span>
              {canMove && (
                <span className="select-wrap">
                  <select
                    className="select sm"
                    aria-label="Category to move them to"
                    value={target}
                    onFocus={() => setMode("move")}
                    onChange={(e) => {
                      setMoveTo(Number(e.target.value));
                      setMode("move");
                    }}
                  >
                    {groups.map((group) => (
                      <optgroup
                        key={group.type}
                        label={GROUP_TITLES[group.type]}
                      >
                        {group.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <Icon name="chevron" />
                </span>
              )}
            </label>
            <label className={moving ? "choice" : "choice is-selected"}>
              <input
                type="radio"
                className="visually-hidden"
                name={`${id}-mode`}
                checked={!moving}
                onChange={() => setMode("uncategorize")}
                data-autofocus={!moving || undefined}
              />
              <span className="radio" aria-hidden="true" />
              <span className="what">
                <strong>
                  {used > 0 ? `Leave ${them} uncategorized` : `Delete ${them}`}
                </strong>
              </span>
            </label>
          </div>
          {changes}
        </div>
      )}
    </Dialog>
  );
}

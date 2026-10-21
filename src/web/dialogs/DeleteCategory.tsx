import { useId, useState } from "react";
import { groupCategories, type Category } from "../../domain/categories.ts";
import { useCategories, useDeleteCategory } from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { plural } from "../labels.ts";

const GROUP_TITLES = { income: "Income", expense: "Expenses" };

/**
 * D5's delete variant. A category in use asks where its transactions go: to
 * another category, or back to uncategorized.
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
  const used = category.transactionCount;
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

  const submit = () =>
    remove.mutate(
      used === 0
        ? { id: category.id }
        : { id: category.id, moveTo: moving ? target : null },
      { onSuccess: onClose },
    );

  return (
    <Dialog
      title={`Delete “${category.name}”?`}
      size={used === 0 ? "sm" : undefined}
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
            disabled={remove.isPending || (used > 0 && !data)}
            data-autofocus={used === 0 || undefined}
          >
            Delete category
          </button>
        </>
      }
    >
      <FormError error={remove.error} />
      {used === 0 ? (
        <p className="muted">No transactions use this category.</p>
      ) : (
        <div className="form">
          <p className="muted">
            {plural(used, "transaction")} {used === 1 ? "uses" : "use"} this
            category. What should happen to {used === 1 ? "it" : "them"}?
          </p>
          <div
            className="choices"
            role="radiogroup"
            aria-label="Where its transactions go"
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
                <strong>Move {used === 1 ? "it" : "them"} to</strong>
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
                  Leave {used === 1 ? "it" : "them"} uncategorized
                </strong>
              </span>
            </label>
          </div>
        </div>
      )}
    </Dialog>
  );
}

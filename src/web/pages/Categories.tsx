import { useState } from "react";
import {
  groupCategories,
  type Category,
  type CategoryGroup,
} from "../../domain/categories.ts";
import { useCategories } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { CategoryForm } from "../dialogs/CategoryForm.tsx";
import { DeleteCategory } from "../dialogs/DeleteCategory.tsx";
import { plural } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

type Open =
  | { kind: "add" }
  | { kind: "edit"; category: Category }
  | { kind: "delete"; category: Category }
  | null;

const GROUP_TITLES = { income: "Income", expense: "Expenses" };

/** S16: income and expense categories, with how many transactions use each. */
export function Categories() {
  const isMobile = useIsMobile();
  const { data, error } = useCategories();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  const add = (
    <button
      type="button"
      className={isMobile ? "btn btn-primary btn-sm" : "btn btn-primary"}
      onClick={() => setOpen({ kind: "add" })}
    >
      <Icon name="plus" />
      {isMobile ? "Add" : "Add category"}
    </button>
  );
  const page = {
    title: "Categories",
    back: { to: "/more", label: "Back to More" },
  };

  if (!data) {
    return (
      <Page {...page}>
        <Loading error={error} />
      </Page>
    );
  }

  const { categories, uncategorized } = data;
  const groups = groupCategories(categories);
  const count = (type: Category["type"]) =>
    categories.filter((c) => c.type === type).length;
  const List = isMobile ? MobileGroup : DesktopGroup;

  return (
    <Page
      {...page}
      subtitle={
        categories.length > 0 &&
        `${count("income")} income and ${plural(count("expense"), "expense category", "expense categories")}`
      }
      actions={categories.length > 0 && add}
      mobileActions={add}
    >
      {categories.length === 0 ? (
        <EmptyState
          icon="tag"
          title="No categories yet"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setOpen({ kind: "add" })}
            >
              <Icon name="plus" />
              Add category
            </button>
          }
        >
          Categories group your income and expenses in reports and budgets. Add
          the ones you need, like Groceries or Salary.
        </EmptyState>
      ) : (
        groups.map((group) => (
          <List
            key={group.type}
            group={group}
            onEdit={(category) => setOpen({ kind: "edit", category })}
            onDelete={(category) => setOpen({ kind: "delete", category })}
          />
        ))
      )}
      {categories.length > 0 && uncategorized > 0 && (
        <p className="caption">
          {uncategorized === 1
            ? "1 transaction has no category yet."
            : `${uncategorized} transactions have no category yet.`}
        </p>
      )}

      {open?.kind === "add" && <CategoryForm onClose={close} />}
      {open?.kind === "edit" && (
        <CategoryForm
          category={open.category}
          onClose={close}
          onDelete={() => setOpen({ kind: "delete", category: open.category })}
        />
      )}
      {open?.kind === "delete" && (
        <DeleteCategory category={open.category} onClose={close} />
      )}
    </Page>
  );
}

interface GroupProps {
  group: CategoryGroup;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}

function DesktopGroup({ group, onEdit, onDelete }: GroupProps) {
  return (
    <section className="card group">
      <h2 className="group-head">{GROUP_TITLES[group.type]}</h2>
      <div className="cat-row head" aria-hidden="true">
        <span>Category</span>
        <span className="r">Transactions</span>
        <span />
      </div>
      {group.categories.map((c) => (
        <div key={c.id} className="cat-row">
          <span className="name">{c.name}</span>
          <span className="num">
            {c.transactionCount > 0 ? c.transactionCount : "—"}
          </span>
          <span className="acts">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Edit ${c.name}`}
              onClick={() => onEdit(c)}
            >
              Edit
            </button>
            {c.transactionCount === 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Delete ${c.name}`}
                onClick={() => onDelete(c)}
              >
                Delete
              </button>
            )}
          </span>
        </div>
      ))}
    </section>
  );
}

function MobileGroup({ group, onEdit }: GroupProps) {
  return (
    <section className="day">
      <h2 className="day-head">{GROUP_TITLES[group.type]}</h2>
      <div className="card m-list">
        {group.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="m-tx"
            onClick={() => onEdit(c)}
          >
            <span className="desc">{c.name}</span>
            <span className="amount count">
              {plural(c.transactionCount, "transaction")}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

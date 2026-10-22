import type { SelectHTMLAttributes } from "react";
import { groupCategories } from "../../domain/categories.ts";
import { useCategories } from "../api.ts";
import { Icon } from "./Icon.tsx";

/** The option that opens the category form. */
const NEW = "new";
const GROUP_TITLES = { income: "Income", expense: "Expenses" };

interface Props extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange"
> {
  value: number | null;
  /** The transaction's amount: the type that matches it comes first. */
  amount: number;
  /** The first option, for no category: "Uncategorized", "Pick category". */
  none: string;
  onPick: (categoryId: number | null) => void;
  /** "New category…" was picked. */
  onNew: () => void;
}

/** A transaction's category picker, with a way to add a category. */
export function CategorySelect({
  value,
  amount,
  none,
  onPick,
  onNew,
  disabled,
  className = "select",
  ...rest
}: Props) {
  const categories = useCategories();
  // Money in is more likely income, money out an expense.
  const first = amount > 0 ? "income" : "expense";
  const groups = groupCategories(categories.data?.categories ?? []).toSorted(
    (a, b) => Number(b.type === first) - Number(a.type === first),
  );
  return (
    <span className="select-wrap">
      <select
        {...rest}
        className={className}
        value={value ?? ""}
        disabled={disabled || !categories.data}
        onChange={(e) => {
          const picked = e.target.value;
          if (picked === NEW) onNew();
          else onPick(picked === "" ? null : Number(picked));
        }}
      >
        <option value="">{none}</option>
        {groups.map((group) => (
          <optgroup key={group.type} label={GROUP_TITLES[group.type]}>
            {group.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={NEW}>New category…</option>
      </select>
      <Icon name="chevron" />
    </span>
  );
}

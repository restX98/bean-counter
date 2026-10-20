import { tidy, type FieldErrors, type Validated } from "./accounts.ts";

export const CATEGORY_TYPES = ["income", "expense"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

/** Groups income or expenses, such as Salary or Groceries. */
export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  /** Transactions with this category, excluded ones too. */
  transactionCount: number;
}

/** The category form's fields, as typed. */
export interface CategoryFields {
  name: string;
  type: string;
}

const MAX_LENGTH = 40;

function isCategoryType(type: string): type is CategoryType {
  return (CATEGORY_TYPES as readonly string[]).includes(type);
}

/**
 * Checks the category form. `takenNames` are the other categories' names:
 * two categories can't share a name, ignoring case, even of different types,
 * since lists and pickers show only the name.
 */
export function validateCategory(
  fields: CategoryFields,
  takenNames: string[],
): Validated<{ name: string; type: CategoryType }> {
  const errors: FieldErrors = {};
  const name = tidy(fields.name);

  if (!name) errors.name = "Give the category a name.";
  else if (name.length > MAX_LENGTH)
    errors.name = `Keep it under ${MAX_LENGTH} characters.`;
  else if (takenNames.some((n) => n.toLowerCase() === name.toLowerCase()))
    errors.name = `You already have a category called ${name}.`;

  const type = fields.type;
  if (!isCategoryType(type)) errors.type = "Pick income or expense.";

  if (Object.keys(errors).length > 0 || !isCategoryType(type)) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, type } };
}

export interface CategoryGroup {
  type: CategoryType;
  categories: Category[];
}

/** Income first, then expenses, each by name. Empty groups are left out. */
export function groupCategories(categories: Category[]): CategoryGroup[] {
  return CATEGORY_TYPES.map((type) => ({
    type,
    categories: categories
      .filter((c) => c.type === type)
      .sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      ),
  })).filter((group) => group.categories.length > 0);
}

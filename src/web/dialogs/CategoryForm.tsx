import { useId, useState } from "react";
import {
  CATEGORY_TYPES,
  type Category,
  type CategoryFields,
  type CategoryType,
} from "../../domain/categories.ts";
import {
  useAccounts,
  useCreateCategory,
  useRules,
  useUpdateCategory,
} from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { CATEGORY_TYPE_LABELS, plural, ruleName } from "../labels.ts";

interface Props {
  /** The category to edit; left out to add one. */
  category?: Category;
  onClose: () => void;
  onSaved?: (category: Category) => void;
  /** Edit mode: opens the delete dialog. */
  onDelete?: () => void;
  /** Adding: the type to start with, such as a transaction's. */
  type?: CategoryType;
}

/** D5: add a category or edit one. */
export function CategoryForm({
  category,
  onClose,
  onSaved,
  onDelete,
  type = "expense",
}: Props) {
  const id = useId();
  const create = useCreateCategory();
  const update = useUpdateCategory(category?.id ?? 0);
  const saving = category ? update : create;
  const errors = fieldErrors(saving.error);
  const [fields, setFields] = useState<CategoryFields>(() =>
    category
      ? { name: category.name, type: category.type }
      : { name: "", type },
  );
  const used = category?.transactionCount ?? 0;
  const ruleCount = category?.ruleCount ?? 0;
  const rules = useRules(ruleCount > 0);
  const { data: accounts = [] } = useAccounts();
  const itsRules = (rules.data?.rules ?? []).filter(
    (r) => r.categoryId === category?.id,
  );
  // "3 transactions · 1 rule (“SATISPAY”, amount under 10.00 €)"
  const uses = [
    used > 0 && plural(used, "transaction"),
    ruleCount > 0 &&
      plural(ruleCount, "rule") +
        (itsRules.length > 0
          ? ` (${itsRules.map((r) => ruleName(r, accounts)).join("; ")})`
          : ""),
  ].filter(Boolean);

  const save = () =>
    saving.mutate(fields, {
      onSuccess: (saved) => {
        onClose();
        onSaved?.(saved);
      },
    });

  return (
    <Dialog
      title={category ? "Edit category" : "Add category"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving.isPending}
          >
            Save category
          </button>
        </>
      }
    >
      <FormError error={saving.error} />
      <div className="form">
        <Field id={`${id}-name`} label="Name" error={errors.name}>
          <input
            id={`${id}-name`}
            className="input"
            value={fields.name}
            onChange={(e) => setFields({ ...fields, name: e.target.value })}
            placeholder="e.g. Groceries"
            autoComplete="off"
            data-autofocus
            {...describedBy(`${id}-name`, errors.name)}
          />
        </Field>

        <Field id={`${id}-type`} label="Type" error={errors.type} group>
          <div
            className="seg fill"
            role="radiogroup"
            aria-labelledby={`${id}-type-label`}
          >
            {CATEGORY_TYPES.map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  className="visually-hidden"
                  name={`${id}-type`}
                  value={type}
                  checked={fields.type === type}
                  onChange={() => setFields({ ...fields, type })}
                />
                {CATEGORY_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </Field>

        {uses.length > 0 && (
          <div className="banner tone-neutral">
            <Icon name="info" />
            <span className="text">
              <strong>Used by</strong>
              {uses.join(" · ")}. Renaming the category or changing its type
              keeps {used + ruleCount === 1 ? "it" : "them all"}.
            </span>
          </div>
        )}
        {category && onDelete && (
          <button type="button" className="link danger-link" onClick={onDelete}>
            Delete this category…
          </button>
        )}
      </div>
    </Dialog>
  );
}

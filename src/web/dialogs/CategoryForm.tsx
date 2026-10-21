import { useId, useState } from "react";
import {
  CATEGORY_TYPES,
  type Category,
  type CategoryFields,
  type CategoryType,
} from "../../domain/categories.ts";
import { useCreateCategory, useUpdateCategory } from "../api.ts";
import { Dialog, FormError, fieldErrors } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { CATEGORY_TYPE_LABELS, plural } from "../labels.ts";

interface Props {
  /** The category to edit; left out to add one. */
  category?: Category;
  onClose: () => void;
  onSaved?: (category: Category) => void;
  /** Edit mode, for a category nothing uses yet. */
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

        {used > 0 && (
          <div className="banner tone-neutral">
            <Icon name="info" />
            <span className="text">
              <strong>Used by {plural(used, "transaction")}</strong>
              Renaming the category or changing its type doesn't move{" "}
              {used === 1 ? "it" : "them"}.
            </span>
          </div>
        )}
        {category && used === 0 && onDelete && (
          <button type="button" className="link danger-link" onClick={onDelete}>
            Delete this category…
          </button>
        )}
      </div>
    </Dialog>
  );
}

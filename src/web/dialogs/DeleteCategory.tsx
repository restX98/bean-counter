import type { Category } from "../../domain/categories.ts";
import { useDeleteCategory } from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";

/** D5's delete variant, for now only for a category nothing uses. */
export function DeleteCategory({
  category,
  onClose,
}: {
  category: Category;
  onClose: () => void;
}) {
  const remove = useDeleteCategory();
  return (
    <Dialog
      title={`Delete “${category.name}”?`}
      size="sm"
      onClose={onClose}
      onSubmit={() => remove.mutate(category.id, { onSuccess: onClose })}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={remove.isPending}
            data-autofocus
          >
            Delete category
          </button>
        </>
      }
    >
      <FormError error={remove.error} />
      <p className="muted">No transactions use this category.</p>
    </Dialog>
  );
}

import {
  useAccounts,
  useCategories,
  useDeleteRule,
  type RuleListItem,
} from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";
import { ruleName } from "../labels.ts";

/** S17: deletes a rule once I confirm. The categories it gave stay. */
export function DeleteRule({
  rule,
  onClose,
}: {
  rule: RuleListItem;
  onClose: () => void;
}) {
  const remove = useDeleteRule();
  const { data: accounts = [] } = useAccounts();
  const { data } = useCategories();
  const category = data?.categories.find((c) => c.id === rule.categoryId);

  return (
    <Dialog
      title="Delete rule?"
      size="sm"
      onClose={onClose}
      onSubmit={() => remove.mutate(rule.id, { onSuccess: onClose })}
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
            Delete rule
          </button>
        </>
      }
    >
      <FormError error={remove.error} />
      <p className="muted">
        {ruleName(rule, accounts)} → {category?.name}.{" "}
        {rule.matches === 0
          ? "It hasn't categorized any transactions."
          : rule.matches === 1
            ? "The transaction it categorized keeps its category."
            : `The ${rule.matches} transactions it categorized keep their category.`}
      </p>
    </Dialog>
  );
}

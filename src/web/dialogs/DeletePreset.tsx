import { type Preset, useDeletePreset } from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";

/** S18 and a preset's edit page: deletes it once I confirm. */
export function DeletePreset({
  preset,
  onClose,
  onDeleted = onClose,
}: {
  preset: Pick<Preset, "id" | "name">;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const remove = useDeletePreset();
  return (
    <Dialog
      title="Delete preset?"
      size="sm"
      onClose={onClose}
      onSubmit={() => remove.mutate(preset.id, { onSuccess: onDeleted })}
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
            Delete preset
          </button>
        </>
      }
    >
      <FormError error={remove.error} />
      <p className="muted">
        {preset.name}. What was imported with it stays as it is. The next file
        in this format asks for its columns again.
      </p>
    </Dialog>
  );
}

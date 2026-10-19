import type { Account } from "../../domain/accounts.ts";
import { useArchive } from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";

/** D3: confirm archiving. */
export function ArchiveAccount({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const archive = useArchive(account.id);
  return (
    <Dialog
      title={`Archive ${account.name}?`}
      size="sm"
      onClose={onClose}
      onSubmit={() => archive.mutate(true, { onSuccess: onClose })}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={archive.isPending}
            data-autofocus
          >
            Archive
          </button>
        </>
      }
    >
      <FormError error={archive.error} />
      <p className="muted">
        Archived accounts are hidden from lists and become read-only. You can
        unarchive them any time.
      </p>
    </Dialog>
  );
}

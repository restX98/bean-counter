import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { ApiError } from "../api.ts";
import { Icon } from "./Icon.tsx";

interface DialogProps {
  title: string;
  onClose: () => void;
  /** Runs when the form is submitted: the submit button, or Enter in a field. */
  onSubmit: () => void;
  /** The buttons at the bottom. The main one is type="submit". */
  actions: ReactNode;
  /** "sm" for short confirmations. */
  size?: "sm";
  children: ReactNode;
}

/**
 * A modal dialog over the page on desktop; a full-screen sheet on mobile
 * (the layout is in CSS). Render it to open it, unmount it to close it.
 * The field marked data-autofocus gets the focus.
 */
export function Dialog({
  title,
  onClose,
  onSubmit,
  actions,
  size,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // A layout effect, so the dialog closes (and gives the focus back) before
  // React removes it.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={size ? `dialog ${size}` : "dialog"}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: let React decide, by unmounting.
        e.preventDefault();
        onClose();
      }}
    >
      <form
        className="dialog-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-actions">{actions}</footer>
      </form>
    </dialog>
  );
}

/** A request's error that no field shows: a lost connection, an archived account. */
export function FormError({ error }: { error: Error | null }) {
  if (!error) return null;
  if (error instanceof ApiError && Object.keys(error.errors).length > 0) {
    return null;
  }
  return (
    <div className="banner tone-danger" role="alert">
      <Icon name="alert" />
      <span className="text">
        {error instanceof ApiError
          ? error.message
          : "Something went wrong. Try again."}
      </span>
    </div>
  );
}

/** The field errors of a failed request, by field name. */
export function fieldErrors(error: Error | null): Record<string, string> {
  return error instanceof ApiError ? error.errors : {};
}

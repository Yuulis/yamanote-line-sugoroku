import { type MouseEvent, type SyntheticEvent, useId, useLayoutEffect, useRef } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-page confirmation (not window.confirm) on a native modal <dialog>: the
 * browser keeps focus inside, makes the page behind inert, closes on Escape
 * and returns focus to the opener. A click on the backdrop also cancels.
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  // Layout effect: open before paint, and on unmount close and refocus the
  // opener while the node is still attached (a detached dialog restores nothing).
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const onDialogCancel = (event: SyntheticEvent) => {
    // Escape: let React unmount the dialog instead of the browser closing it.
    event.preventDefault();
    onCancel();
  };
  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={onDialogCancel}
      onClick={onBackdropClick}
    >
      <div className="dialog__body">
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <p id={messageId}>{message}</p>
        <div className="dialog__actions">
          {/* Focus the safe choice first. */}
          <button type="button" onClick={onCancel} autoFocus>
            キャンセル
          </button>
          <button type="button" className="dialog__confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

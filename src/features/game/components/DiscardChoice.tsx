import { useId, useLayoutEffect, useRef, type SyntheticEvent } from "react";
import type { ItemSessionView } from "../itemSession";
import { ItemCard } from "./ItemCard";

export interface DiscardChoiceProps {
  announcement?: string;
  decision: Extract<NonNullable<ItemSessionView["decision"]>, { kind: "discard" }>;
  onDiscard: (instanceId: string) => void;
}

export function DiscardChoice({ decision, onDiscard, announcement }: DiscardChoiceProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;

  const releasedRef = useRef<boolean>(false);

  const showDialog = (): void => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    releasedRef.current = false;
    showDialog();
    return () => {
      releasedRef.current = true;
      dialog?.close();
    };
  }, []);

  const preventClose = (event: SyntheticEvent) => event.preventDefault();
  // The choice is mandatory. Browsers may force a close request past a prevented `cancel`
  // (Chromium does on a quick second Escape without user activation), so reopen while mounted.
  const reopenUnlessReleased = (): void => {
    if (releasedRef.current) return;
    showDialog();
  };
  const candidateItems = decision.candidates;

  return (
    <dialog ref={dialogRef} className="dialog item-dialog item-discard" aria-labelledby={titleId} onCancel={preventClose} onClose={reopenUnlessReleased}>
      <div className="dialog__body">
        {announcement !== undefined && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>}
        <h2 id={titleId} ref={headingRef} className="dialog__title" tabIndex={-1}>捨てるアイテムを選ぶ</h2>
        <p className="item-dialog__hint">持ち物がいっぱいです。4つのうち1つを選んでください。</p>
        <ul className="item-discard__list">
          {candidateItems.map((item, index) => {
            const headingId = `${baseId}-card-${index}`;
            return <li key={item.id} className="item-discard__item">
              <div role="group" aria-labelledby={headingId} className="item-discard__group">
                <ItemCard kind={item.kind} headingId={headingId} isNew={item.id === decision.newItemInstanceId}
                  action={{ label: "このアイテムを捨てる", disabled: false, onActivate: () => onDiscard(item.id) }} />
              </div>
            </li>;
          })}
        </ul>
        <p className="item-dialog__hint">選ぶまでターンは確定しません。</p>
      </div>
    </dialog>
  );
}

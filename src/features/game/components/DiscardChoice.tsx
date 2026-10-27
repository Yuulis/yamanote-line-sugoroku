import { useId, useLayoutEffect, useRef, type SyntheticEvent } from "react";
import type { ItemSessionView } from "../itemSession";
import { ITEM_DESCRIPTIONS } from "../itemPresentation";

interface DiscardChoiceProps {
  decision: Extract<NonNullable<ItemSessionView["decision"]>, { kind: "discard" }>;
  onDiscard: (instanceId: string) => void;
}

export function DiscardChoice({ decision, onDiscard }: DiscardChoiceProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  const preventClose = (event: SyntheticEvent) => event.preventDefault();
  const candidateItems = decision.candidates;

  return (
    <dialog ref={dialogRef} className="dialog item-dialog item-discard" aria-labelledby={titleId} onCancel={preventClose}>
      <div className="dialog__body">
        <h2 id={titleId} ref={headingRef} className="dialog__title" tabIndex={-1}>捨てるアイテムを選ぶ</h2>
        <p className="item-dialog__hint">持ち物がいっぱいです。4つのうち1つを選んでください。</p>
        <ul className="item-discard__list">
          {candidateItems.map((item) => {
            const description = ITEM_DESCRIPTIONS[item.kind];
            const isNew = item.id === decision.newItemInstanceId;
            return <li key={item.id}>
              <button type="button" className="item-discard__choice" onClick={() => onDiscard(item.id)}>
                <span className="item-discard__name">{description.name}{isNew && <strong className="item-discard__new">新しく拾った</strong>}</span>
                <span className="item-discard__effect">{description.effect}</span>
                <span className="item-discard__action">このアイテムを捨てる</span>
              </button>
            </li>;
          })}
        </ul>
        <p className="item-dialog__hint">選ぶまでターンは確定しません。</p>
      </div>
    </dialog>
  );
}

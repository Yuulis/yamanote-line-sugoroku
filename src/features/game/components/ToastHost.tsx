import type { ToastInput } from "../toastQueue";
import { ItemIcon } from "./ItemIcon";
import { PhraseText } from "./PhraseText";

interface ToastHostProps {
  toasts: readonly ToastInput[];
  reducedMotion: boolean;
}

export function ToastHost({ toasts, reducedMotion }: ToastHostProps): React.JSX.Element {
  return (
    <div className="toast-host" aria-hidden="true">
      {toasts.map((toast) => (
        <div
          className={`toast-host__toast toast-host__toast--${toast.tone}${toast.kind === "notice" ? " toast-host__toast--notice" : ""}${toast.sticky ? " toast-host__toast--sticky" : ""}${reducedMotion ? "" : " toast-host__toast--motion"}`}
          key={toast.key}
        >
          {toast.itemKind ? <span className="toast-host__icon"><ItemIcon kind={toast.itemKind} size={26} /></span> : null}
          <span className="toast-host__text">
            <span>{toast.kind === "notice" ? <PhraseText text={toast.text} /> : toast.text}</span>
            {toast.detail ? <span className="toast-host__detail"><PhraseText text={toast.detail} /></span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

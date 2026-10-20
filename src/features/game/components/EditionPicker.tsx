import { useEffect, useId, useRef } from "react";
import type { EditionRegistry, EditionId } from "../../editions/types";

interface EditionPickerProps {
  editions: EditionRegistry;
  value: EditionId;
  onChange: (id: EditionId) => void;
  focusOnMount?: boolean;
  onFocusRestored?: () => void;
}

/** Edition selector; omitted entirely while only one edition is registered. */
export function EditionPicker({
  editions,
  value,
  onChange,
  focusOnMount = false,
  onFocusRestored,
}: EditionPickerProps) {
  const id = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    selectRef.current?.focus({ preventScroll: true });
    onFocusRestored?.();
  }, [focusOnMount, onFocusRestored]);
  if (editions.length < 2) return null;
  return (
    <div className="edition-picker">
      <label htmlFor={id}>遊ぶ版</label>
      <select
        ref={selectRef}
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {editions.map((edition) => (
          <option key={edition.id} value={edition.id}>{edition.display.subtitle}</option>
        ))}
      </select>
    </div>
  );
}

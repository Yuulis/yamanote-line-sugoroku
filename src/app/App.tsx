import { useCallback, useEffect, useState } from "react";
import { EDITIONS, getEdition } from "../features/editions/registry";
import type { EditionId, EditionRegistry } from "../features/editions/types";
import { setVisibleLineGroupIds } from "../features/map/lineVisibilityStore";
import { EditionApp } from "./EditionApp";

interface AppProps {
  editions?: EditionRegistry;
}

export function App({ editions = EDITIONS }: AppProps) {
  const [editionId, setEditionId] = useState<EditionId>(editions[0].id);
  const [focusPicker, setFocusPicker] = useState(false);
  const edition = getEdition(editionId, editions) ?? editions[0];
  useEffect(() => {
    document.title = edition.display.documentTitle;
  }, [edition]);
  const changeEdition = useCallback((id: EditionId) => {
    if (id === editionId || !getEdition(id, editions)) return;
    setVisibleLineGroupIds(null);
    setFocusPicker(true);
    setEditionId(id);
  }, [editionId, editions]);
  const onPickerFocusRestored = useCallback(() => setFocusPicker(false), []);

  return <EditionApp
    key={edition.id}
    edition={edition}
    editions={editions}
    onEditionChange={changeEdition}
    focusPicker={focusPicker}
    onPickerFocusRestored={onPickerFocusRestored}
  />;
}

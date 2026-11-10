import { createElement } from "react";
import type { ReactNode } from "react";

const OPENING_DELIMITERS: ReadonlySet<string> = new Set(["(", "（", "[", "［", "「", "『"]);
const CLOSING_DELIMITERS: ReadonlySet<string> = new Set([")", "）", "]", "］", "」", "』"]);
const PUNCTUATION_DELIMITERS: ReadonlySet<string> = new Set(["・", "–", "—", "、", "。", "："]);
const SPACE_CHARACTERS: ReadonlySet<string> = new Set([" ", "　"]);
const DIRECTION_PHRASE: string = "方面";
const GRAPHEME_SEGMENTER: Intl.Segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

export interface PhraseTextProps {
  text: string;
}

export function phraseBreakOffsets(text: string): number[] {
  if (text.length === 0) return [];

  const candidates: Set<number> = new Set();
  for (let offset = 0; offset < text.length;) {
    const codePoint: number | undefined = text.codePointAt(offset);
    if (codePoint === undefined) break;

    const character: string = String.fromCodePoint(codePoint);
    const characterEnd: number = offset + character.length;
    if (SPACE_CHARACTERS.has(character)) {
      let runEnd: number = characterEnd;
      while (runEnd < text.length) {
        const nextCodePoint: number | undefined = text.codePointAt(runEnd);
        if (nextCodePoint === undefined) break;
        const nextCharacter: string = String.fromCodePoint(nextCodePoint);
        if (!SPACE_CHARACTERS.has(nextCharacter)) break;
        runEnd += nextCharacter.length;
      }
      candidates.add(runEnd);
      offset = runEnd;
      continue;
    }

    if (OPENING_DELIMITERS.has(character)) candidates.add(offset);
    if (CLOSING_DELIMITERS.has(character) || PUNCTUATION_DELIMITERS.has(character)) {
      candidates.add(characterEnd);
    }
    offset = characterEnd;
  }

  let directionIndex: number = text.indexOf(DIRECTION_PHRASE);
  while (directionIndex !== -1) {
    candidates.add(directionIndex);
    directionIndex = text.indexOf(DIRECTION_PHRASE, directionIndex + DIRECTION_PHRASE.length);
  }

  const graphemeBoundaries: Set<number> = new Set([0, text.length]);
  for (const segment of GRAPHEME_SEGMENTER.segment(text)) {
    graphemeBoundaries.add(segment.index);
  }

  return [...candidates]
    .filter((offset: number) => {
      if (offset <= 0 || offset >= text.length || !graphemeBoundaries.has(offset)) return false;

      const previousCharacter: string = text[offset - 1] ?? "";
      const nextCodePoint: number | undefined = text.codePointAt(offset);
      if (nextCodePoint === undefined) return false;
      const nextCharacter: string = String.fromCodePoint(nextCodePoint);

      return !OPENING_DELIMITERS.has(previousCharacter)
        && !CLOSING_DELIMITERS.has(nextCharacter)
        && !PUNCTUATION_DELIMITERS.has(nextCharacter);
    })
    .sort((first: number, second: number) => first - second);
}

export function PhraseText({ text }: PhraseTextProps): React.JSX.Element {
  const children: ReactNode[] = [];
  let sliceStart: number = 0;
  for (const offset of phraseBreakOffsets(text)) {
    children.push(text.slice(sliceStart, offset));
    children.push(createElement("wbr", { key: offset }));
    sliceStart = offset;
  }
  children.push(text.slice(sliceStart));

  return <>{children}</>;
}

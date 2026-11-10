// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PhraseText, phraseBreakOffsets } from "../../src/features/game/components/PhraseText";
import { mountReact } from "./helpers/reactDom";

interface PhraseCase {
  readonly name: string;
  readonly text: string;
  readonly offsets: readonly number[];
}

const PHRASE_CASES: readonly PhraseCase[] = [
  { name: "empty", text: "", offsets: [] },
  { name: "delimiter-free text", text: "山手線🚉", offsets: [] },
  { name: "opening and closing endpoints are suppressed", text: "（線）", offsets: [] },
  { name: "consecutive ASCII and full-width spaces", text: "山手 　線", offsets: [4] },
  { name: "space hint immediately before a closer is suppressed", text: "山手　）", offsets: [] },
  { name: "consecutive punctuation", text: "新宿、、東京", offsets: [4] },
  { name: "bracket adjacency and the 方面 hint", text: "山手（線）[方面]", offsets: [2, 5] },
  {
    name: "all supported bracket pairs",
    text: "a(b)c（d）e[f]g［h］i「j」k『l』m",
    offsets: [1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24],
  },
  { name: "punctuation and direction phrase", text: "新宿・東京方面", offsets: [3, 5] },
  { name: "all supported punctuation hints", text: "a・b–c—d、e。f：g", offsets: [2, 4, 6, 8, 10, 12] },
  { name: "HTML-like text stays inert", text: "<script>alert(1)</script>", offsets: [13, 16] },
  { name: "surrogate pair stays intact", text: "🚉山手（線）へ", offsets: [4, 7] },
  { name: "combining mark stays intact", text: "e\u0301（線）へ", offsets: [2, 5] },
  { name: "ZWJ family stays intact", text: "👨‍👩‍👧‍👦（山手）へ", offsets: [11, 15] },
  { name: "punctuation plus combining mark stays intact", text: "線・\u0301語", offsets: [] },
];

describe("PhraseText", () => {
  it.each(PHRASE_CASES)("preserves $name with only the expected hints", ({ text, offsets }) => {
    expect(phraseBreakOffsets(text)).toEqual(offsets);

    const mounted = mountReact(createElement(PhraseText, { text }));
    try {
      expect(mounted.container.textContent).toBe(text);
      expect(mounted.container.querySelector("script")).toBeNull();
      expect([...mounted.container.querySelectorAll("*")].every((element) => element.tagName === "WBR")).toBe(true);

      const renderedOffsets: number[] = [];
      let textOffset = 0;
      for (const node of mounted.container.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          textOffset += node.textContent?.length ?? 0;
          continue;
        }
        expect(node.nodeName).toBe("WBR");
        renderedOffsets.push(textOffset);
      }
      expect(renderedOffsets).toEqual(offsets);
    } finally {
      mounted.cleanup();
    }
  });
});

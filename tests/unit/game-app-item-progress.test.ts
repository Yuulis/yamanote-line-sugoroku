// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { createItemGame, serializeGame } from "../../src/features/game/engine";
import { networkFromData } from "../../src/features/game/networkFromData";
import type { ItemGameState } from "../../src/types/network";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: () => createElement("div") }));

const data = await loadRailwayData("", async (file) =>
  JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const result = networkFromData(data);
if (!result.ok) throw new Error(result.reason);
const network = result.network;
const edition = EDITIONS[0];
let mounted: MountedReact | undefined;

afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function click(label: string): void {
  const button = [...mounted!.container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
}

function stat(label: string): string | null {
  return [...mounted!.container.querySelectorAll("dt")]
    .find((term) => term.textContent === label)?.nextElementSibling?.textContent ?? null;
}

describe("item progress in GameApp", () => {
  it.each(["saved", "failed"] as const)("keeps the origin visible until the %s movement save attempt", (outcome) => {
    const game = createItemGame(edition.config, "review-order", network);
    localStorage.setItem(edition.saveKey, serializeGame(game));
    // Hold the first frame so the post-save animation start is observable.
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mounted = mountReact(createElement(StrictMode, null, createElement(GameApp, {
      data, network, edition, picker: {
        editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(),
        focusPicker: false, onPickerFocusRestored: vi.fn(),
      },
    })));
    click("つづきから");
    expect(stat("現在駅")).toBe("新橋");
    const duringSave: { station: string | null; progress: string | null }[] = [];
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      const saved = JSON.parse(value) as ItemGameState;
      if (saved.turn === 1 && saved.pending === null) {
        expect(saved.currentStationId).not.toBe(game.currentStationId);
        duringSave.push({ station: stat("現在駅"), progress: stat("踏破区間") });
        if (outcome === "failed") throw new Error("quota");
      }
      write.call(this, key, value);
    });

    click("サイコロを振る");

    expect(duringSave).toEqual([{ station: "新橋", progress: "0/30" }]);
    expect(stat("現在駅")).toBe("新橋");
    expect(stat("踏破区間")).toBe("0/30");
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    click("スキップ");
    expect(stat("現在駅")).toBe("浜松町");
    expect(stat("踏破区間")).toBe("1/30");
  });
});

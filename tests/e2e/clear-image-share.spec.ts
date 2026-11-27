import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openClearHistory } from "./support/app";
import { readShareLog, stubShareApis, type ShareLogEntry } from "./support/shareStubs";
import { IMAGE_READY_TIMEOUT_MS, type RouteImageEncodingWindow } from "./clear-replay-share-support";
import {
  DESKTOP, PHONE_MEDIUM, PHONE_SMALL, PHONE_SHEET_MAX_HEIGHT_RATIO, SCREENSHOT_DIR,
  clearWithOneRoll, expectNoHorizontalOverflow, expectReachable,
  expectWithinFirstScreen, holdRouteImageEncoding, measurePhoneSheet, readClearRoute, startReplay,
} from "./clear-replay-share-support";

// Issue #69 result-history and image-share presentation cases.
test.use({ dataset: "real" });

const PINNED_HISTORY_LITERALS: readonly {
  readonly page: number;
  readonly recordIndex: number;
  readonly turn: string;
  readonly roll: string;
  readonly move: string;
  readonly line: string;
  readonly notes: readonly (readonly [kind: string, text: string])[];
}[] = [
  {
    page: 1, recordIndex: 0, turn: "1ターン目", roll: "出目2", move: "新橋 → 田町・三田（2駅）", line: "山手線・外回り",
    notes: [["landing", "到着田町・三田：山手線・京浜東北線・都営浅草線 各停・都営三田線 各停から抽選 → 山手線 ／ 外回りに固定"]],
  },
  {
    page: 1, recordIndex: 3, turn: "4ターン目", roll: "出目6", move: "浜松町・大門 → 蒲田（6駅）", line: "京浜東北線・大船方面",
    notes: [
      ["landing", "到着蒲田：京浜東北線・東急池上線 各停・東急多摩川線 各停から抽選 → 京浜東北線 ／ 方向抽選 → 大船方面"],
      ["item", "アイテム出目調整券±3を拾いました。出目を見てから、出目に3を足すか引くかできる（1より小さくはできない）"],
    ],
  },
  {
    page: 1, recordIndex: 16, turn: "17ターン目", roll: "出目4", move: "東白楽 → 横浜（2駅）", line: "東急東横線 各停・横浜方面",
    notes: [
      ["landing", "到着横浜：10系統から抽選 → 横須賀線 ／ 方向抽選 → 東京方面"],
      ["truncation", "途中停止横浜で終了〔系統の端〕、残り2を使わず"],
      ["item", "アイテム方向指定券を拾いました。山手線以外の路線で進む向きを選べる"],
    ],
  },
  {
    page: 5, recordIndex: 82, turn: "83ターン目", roll: "出目4", move: "有楽町・日比谷 → 新橋（1駅）", line: "山手線・外回り",
    notes: [["truncation", "途中停止新橋で終了、残り3を使わず"], ["goal", "ゴールに到着しました"]],
  },
];

test("renders literal history rows for the pinned clear, independent of production formatting", async ({ page }) => {
  const clear = await clearWithOneRoll(page);
  const dialog = await openClearHistory(clear);
  let currentPage = 1;
  for (const expected of PINNED_HISTORY_LITERALS) {
    while (currentPage < expected.page) {
      await dialog.getByRole("button", { name: "次のページ" }).click();
      currentPage += 1;
    }
    const row = dialog.locator(`[data-record-index="${expected.recordIndex}"]`);
    await expect(row.locator(".clear-history__turn")).toHaveText(expected.turn);
    await expect(row.locator(".clear-history__roll")).toHaveText(expected.roll);
    await expect(row.locator(".clear-history__move")).toHaveText(expected.move);
    await expect(row.locator(".clear-history__line")).toHaveText(expected.line);
    const notes = row.locator(".clear-history__note");
    await expect(notes).toHaveText(expected.notes.map(([, text]) => text));
    for (const [index, [kind]] of expected.notes.entries()) {
      await expect(notes.nth(index)).toHaveAttribute("data-note", kind);
    }
  }
});

// Issue #69, S7: image share, save and the text fallbacks. Every platform API is stubbed (see support/shareStubs.ts),
// so no click can reach x.com; the fixture's blocked-request guard and the request spy below prove it.
const IMAGE_FILE_NAME = "yamanote-sugoroku-route.png";
const PASTE_HINT = "Xの投稿画面に画像を貼り付けてください";
const SCREENSHOTS_S7_ENABLED = Boolean(process.env.ISSUE69_S7_SCREENSHOTS) && !process.env.CI;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPORT_WIDTH = 1200;
const EXPORT_HEIGHT = 675;

/** Records requests to hosts the test must never reach. */
function spyOnForbiddenRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (/(^|\.)x\.com$|twitter\.com|google-analytics|googletagmanager/.test(new URL(request.url()).hostname)) seen.push(request.url());
  });
  return seen;
}

async function waitForImageActions(clear: Locator): Promise<void> {
  await expect(clear.getByRole("button", { name: "Xでシェア" })).toBeEnabled({ timeout: IMAGE_READY_TIMEOUT_MS });
  await expect(clear.getByRole("button", { name: "画像を保存" })).toBeEnabled();
}

/** The share text, rebuilt literally from the numbers the card shows (never from production code). */
async function expectedShareText(clear: Locator): Promise<string> {
  const [turns, moves, transfers] = (await clear.locator(".clear-screen__stats dd").allTextContents())
    .slice(0, 3).map((text) => text.replace(/\D/g, ""));
  return `山手線すごろく 東京近郊版をクリア！\n所要ターン数 ${turns}・移動回数 ${moves}・乗換回数 ${transfers}\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app`;
}

function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** Calls other than the repeated capability probe, in order. */
async function shareCalls(page: Page): Promise<ShareLogEntry[]> {
  return (await readShareLog(page)).filter((entry) => entry.call !== "canShare");
}

async function readPngSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), "the saved file is a PNG").toBe(true);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe("image share and save", () => {
  test("copies the image first and opens X in the same click on desktop, even when the browser offers file share", async ({ page }) => {
    const forbidden = spyOnForbiddenRequests(page);
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    const text = await expectedShareText(clear);

    await clear.getByRole("button", { name: "Xでシェア" }).click();
    expect((await shareCalls(page)).slice(0, 5)).toEqual([
      { call: "ClipboardItem", types: ["image/png"], promiseValued: true },
      { call: "clipboard.write", items: 1 },
      { call: "open", url: "about:blank", target: "_blank" },
      { call: "popup.opener", value: "null" },
      { call: "popup.location", href: intentUrl(text) },
    ]);
    await expect.poll(() => shareCalls(page)).toContainEqual({ call: "clipboard.blob", type: "image/png", nonEmpty: true });
    expect((await shareCalls(page)).map((entry) => entry.call)).not.toContain("share");
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(PASTE_HINT);
    await expect(clear.getByRole("status")).toHaveText(PASTE_HINT);
    expect(forbidden, "no request reached x.com or analytics").toEqual([]);
  });

  test("saves a 1200x675 PNG through the product 画像を保存 download", async ({ page }) => {
    await stubShareApis(page);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);

    const downloadPromise = page.waitForEvent("download");
    await clear.getByRole("button", { name: "画像を保存" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(IMAGE_FILE_NAME);
    const savedPath = test.info().outputPath("saved-route.png");
    mkdirSync(dirname(savedPath), { recursive: true });
    await download.saveAs(savedPath);
    const bytes = readFileSync(savedPath);
    expect(await readPngSize(bytes)).toEqual({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT });
    const decoded = await page.evaluate(async (base64) => {
      const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([binary], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("decoder canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      const corner = context.getImageData(4, 4, 1, 1).data;
      const size = { width: bitmap.width, height: bitmap.height, cornerAlpha: corner[3] };
      bitmap.close();
      return size;
    }, bytes.toString("base64"));
    expect(decoded).toEqual({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT, cornerAlpha: 255 });
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("画像の保存を始めました");
  });

  test("keeps the text-only X link available with the exact intent and counts no request", async ({ page }) => {
    const forbidden = spyOnForbiddenRequests(page);
    await stubShareApis(page);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    const text = await expectedShareText(clear);
    const link = clear.getByRole("link", { name: "文面だけXに投稿" });
    // Available straight away, before the PNG is ready.
    await expect(link).toHaveAttribute("href", intentUrl(text));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    expect(new URL((await link.getAttribute("href"))!).searchParams.get("text")).toBe(text);
    // Cancel the navigation the click would start; the app's own handler still runs first.
    await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault(), { capture: true }));
    await link.click();
    expect(forbidden).toEqual([]);
    expect(await shareCalls(page)).toEqual([]);
  });

  test("reports a clipboard rejection and a blocked popup separately, never with the paste hint", async ({ page }) => {
    await stubShareApis(page, { clipboard: "reject" });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(
      "Xを開きましたが、画像をコピーできませんでした。「画像を保存」して投稿に添付してください。",
    );
    await expect(clear.getByRole("button", { name: "画像を保存" })).toBeEnabled();
    await expect(clear.getByRole("link", { name: "文面だけXに投稿" })).toBeVisible();
  });

  test("guides to the text link when the popup is blocked after a successful copy", async ({ page }) => {
    await stubShareApis(page, { open: "null" });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(
      "画像をコピーしましたが、Xを開けませんでした。「文面だけXに投稿」から開いて貼り付けるか、「画像を保存」を使ってください。",
    );
    expect((await shareCalls(page)).map((entry) => entry.call)).not.toContain("popup.location");
  });

  test.describe("while the replay runs", () => {
    test.use({ reducedMotion: "no-preference" });

    test("shows results from the strip before sharing the full route", async ({ page }) => {
      await stubShareApis(page);
      await page.setViewportSize(DESKTOP);
      const clear = await clearWithOneRoll(page);
      await waitForImageActions(clear);
      await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBeGreaterThan(0);
      const fullFeatureCount = (await readClearRoute(page))?.featureCount ?? 0;
      await startReplay(clear);
      await expect(page.locator(".clear-replay-caption")).toBeVisible();
      await clear.getByRole("button", { name: "一時停止" }).click();
      await expect(clear.getByRole("button", { name: "結果を表示" })).toBeVisible();
      await clear.getByRole("button", { name: "結果を表示" }).click();
      await expect(clear.getByRole("button", { name: "Xでシェア" })).toBeVisible();

      await clear.getByRole("button", { name: "Xでシェア" }).click();
      await expect(page.locator(".clear-replay-caption")).toHaveCount(0);
      await expect(clear.getByRole("button", { name: "一時停止" })).toHaveCount(0);
      await expect(clear.getByRole("button", { name: "軌跡を再生" })).toBeVisible();
      await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
      expect((await shareCalls(page)).map((entry) => entry.call)).toContain("popup.location");
    });
  });

  test("shares the real PNG file with the full text natively on a phone", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    const text = await expectedShareText(clear);
    // The native text-only 共有 would repeat what Xでシェア already shares with the image.
    await expect(clear.getByRole("button", { name: "共有", exact: true })).toHaveCount(0);

    await clear.getByRole("button", { name: "Xでシェア" }).click();
    expect(await shareCalls(page)).toEqual([
      { call: "clipboard.writeText", text },
      { call: "share", keys: ["files", "text"], files: [`${IMAGE_FILE_NAME}:image/png:true`], text },
    ]);
    expect((await readShareLog(page)).find((entry) => entry.call === "canShare" && (entry.files as string[]).length > 0)).toEqual({
      call: "canShare", files: [`${IMAGE_FILE_NAME}:image/png:true`],
    });
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("");
    await expect(clear.getByRole("alert")).toHaveCount(0);
  });

  test("stays silent when the phone share is cancelled", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true, share: "abort" });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    // The live region still holds the goal announcement; a cancel must leave it untouched.
    const announced = await clear.getByRole("status").textContent();
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect.poll(async () => (await shareCalls(page)).map((entry) => entry.call)).toContain("share");
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("");
    await expect(clear.getByRole("status")).toHaveText(announced ?? "");
    await expect(clear.getByRole("alert")).toHaveCount(0);
    await expect(clear.getByRole("button", { name: "Xでシェア" })).toBeEnabled();
  });

  test("guides to saving the image and the text link when the phone share is refused", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true, share: "reject" });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(
      "共有できませんでした。「画像を保存」してXの投稿に添付するか、「文面だけXに投稿」を使ってください。",
    );
    await expect(clear.getByRole("button", { name: "画像を保存" })).toBeEnabled();
    await expect(clear.getByRole("link", { name: "文面だけXに投稿" })).toBeVisible();
  });

  test("falls back to the copy-and-open path on a phone when file share is not offered", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: false });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    const calls = (await shareCalls(page)).map((entry) => entry.call);
    expect(calls.slice(0, 3)).toEqual(["ClipboardItem", "clipboard.write", "open"]);
    expect(calls).not.toContain("share");
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(PASTE_HINT);
  });

  test("keeps the image and replay button rectangles fixed from pending to ready at 320x568", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.addInitScript(holdRouteImageEncoding);
    await page.setViewportSize(PHONE_SMALL);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const clear = await clearWithOneRoll(page);
    await expect.poll(
      () => page.evaluate(() => (window as RouteImageEncodingWindow).__routeImageEncodeReleases?.length ?? 0),
      { timeout: IMAGE_READY_TIMEOUT_MS },
    ).toBe(1);
    await expect(clear.getByText("画像を準備中…", { exact: true })).toBeVisible();
    await expect(clear.getByRole("button", { name: "Xでシェア" })).toBeDisabled();
    await expect(clear.getByRole("button", { name: "画像を保存" })).toBeDisabled();

    const buttonNames = ["結果をコピー", "Xでシェア", "画像を保存", "軌跡を再生", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"] as const;
    const pendingLayout = await measurePhoneSheet(clear, buttonNames);
    expect(pendingLayout.scrollTop, "the pending sheet stays at the top").toBe(0);
    expect(pendingLayout.sheet.height, "the pending sheet stays within its 65% cap")
      .toBeLessThanOrEqual(PHONE_SMALL.height * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
    await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats"), "the three numbers");
    for (const name of buttonNames) await expectWithinFirstScreen(clear, clear.getByRole("button", { name, exact: true }), name);
    await expectNoHorizontalOverflow(page, clear);

    await page.evaluate(() => (window as RouteImageEncodingWindow).__releaseRouteImageEncoding?.());
    await waitForImageActions(clear);
    await expect(clear.getByText("画像を準備中…", { exact: true })).toBeHidden();
    const readyLayout = await measurePhoneSheet(clear, buttonNames);
    expect(readyLayout.scrollTop, "the ready sheet stays at the top").toBe(0);
    expect(readyLayout.sheet.height, "the ready sheet stays within its 65% cap")
      .toBeLessThanOrEqual(PHONE_SMALL.height * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
    await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats"), "the three numbers");
    for (const name of buttonNames) await expectWithinFirstScreen(clear, clear.getByRole("button", { name, exact: true }), name);
    await expectNoHorizontalOverflow(page, clear);

    for (const name of ["軌跡を再生", "Xでシェア", "画像を保存"] as const) {
      for (const edge of ["top", "bottom", "left", "right"] as const) {
        expect(
          Math.abs(readyLayout.targets[name]![edge] - pendingLayout.targets[name]![edge]),
          `${name} ${edge} stays within one pixel while the image becomes ready`,
        ).toBeLessThanOrEqual(1);
      }
    }
    console.log(`[S7 pending layout 320x568] ${JSON.stringify(pendingLayout)}`);
    console.log(`[S7 ready layout 320x568] ${JSON.stringify(readyLayout)}`);
  });

  test("keeps the share row, numbers and main actions inside the 320px sheet and reports the rectangles", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await expectNoHorizontalOverflow(page, clear);
    await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three numbers");
    for (const name of ["結果をコピー", "Xでシェア", "画像を保存", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"]) {
      await expectWithinFirstScreen(clear, clear.getByRole("button", { name }), name);
    }
    await expectWithinFirstScreen(clear, clear.getByRole("button", { name: /^(軌跡を再生|全経路を表示)$/ }), "軌跡を再生");
    // Single-line labels: the narrowest button (タイトルへ) must not clip its own text.
    for (const button of await clear.locator("button").all()) {
      const clipped = await button.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(clipped, `${await button.textContent()} must not clip its label`).toBe(false);
    }
    const rects = await clear.evaluate((element) => {
      const sheet = element.getBoundingClientRect();
      const round = (value: number): number => Math.round(value * 10) / 10;
      const rect = (target: Element): number[] => {
        const box = target.getBoundingClientRect();
        return [round(box.top - sheet.top), round(box.bottom - sheet.top), round(box.left - sheet.left), round(box.right - sheet.left)];
      };
      const report: Record<string, unknown> = { sheet: [round(sheet.height), round(sheet.width)], scrollTop: element.scrollTop };
      for (const target of element.querySelectorAll("button, a")) report[(target.textContent ?? "").trim()] = rect(target);
      report["三つの数値(dd3)"] = rect(element.querySelectorAll(".clear-screen__stats dd")[2]!);
      return report;
    });
    console.log(`S7-RECTS 320x568 ${JSON.stringify(rects)}`);
  });

  test("keeps the share row reachable at 320px when the clear could not be saved", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page, { failSave: true });
    await waitForImageActions(clear);
    await expect(clear.getByRole("alert")).toContainText("再読み込みするとこのクリアは残りません");
    for (const name of ["結果をコピー", "Xでシェア", "画像を保存", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"]) {
      await expectReachable(clear, clear.getByRole("button", { name }), name);
    }
    await expectReachable(clear, clear.getByRole("link", { name: "文面だけXに投稿" }), "文面だけXに投稿");
    await expectNoHorizontalOverflow(page, clear);
    await clear.getByRole("button", { name: "画像を保存" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("画像の保存を始めました");
    await expectNoHorizontalOverflow(page, clear);
  });

  test("saves the S7 review screenshots on request", async ({ page }) => {
    test.skip(!SCREENSHOTS_S7_ENABLED, "set ISSUE69_S7_SCREENSHOTS=1 (outside CI) to write the review screenshots");
    await stubShareApis(page);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    const cards: readonly [string, { width: number; height: number }][] = [
      ["issue69-s7-desktop.png", DESKTOP],
      ["issue69-s7-phone390.png", PHONE_MEDIUM],
      ["issue69-s7-phone320.png", PHONE_SMALL],
    ];
    for (const [file, viewport] of cards) {
      await test.step(file, async () => {
        await page.setViewportSize(viewport);
        await expect(clear).toBeVisible();
        await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
      });
    }
    await page.setViewportSize(DESKTOP);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(PASTE_HINT);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s7-paste-hint.png") });
  });
});

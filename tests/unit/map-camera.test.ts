import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "../../src/features/map/attribution";
import { isUserCameraEvent, needsRecentre, USER_CAMERA_EVENTS } from "../../src/features/map/camera";

describe("isUserCameraEvent", () => {
  it("treats events carrying a DOM event as user-made", () => {
    expect(isUserCameraEvent({ originalEvent: { type: "mousedown" } })).toBe(true);
  });

  it("treats programmatic camera moves as not user-made", () => {
    expect(isUserCameraEvent({})).toBe(false);
    expect(isUserCameraEvent({ originalEvent: undefined })).toBe(false);
    expect(isUserCameraEvent({ originalEvent: null })).toBe(false);
  });

  it("listens to the start of every kind of camera change", () => {
    expect(USER_CAMERA_EVENTS).toEqual(
      expect.arrayContaining(["movestart", "dragstart", "zoomstart", "rotatestart", "pitchstart"]),
    );
  });
});

describe("needsRecentre", () => {
  it("skips a camera move onto the current centre", () => {
    expect(needsRecentre([139.7, 35.6], [139.7, 35.6])).toBe(false);
    expect(needsRecentre([139.7, 35.6], [139.7 + 1e-9, 35.6])).toBe(false);
  });

  it("moves when the marker is elsewhere", () => {
    expect(needsRecentre([139.7, 35.6], [139.701, 35.6])).toBe(true);
    expect(needsRecentre([139.7, 35.6], [139.7, 35.601])).toBe(true);
  });
});

describe("safeExternalUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(safeExternalUrl("https://nlftp.mlit.go.jp/ksj/")).toBe("https://nlftp.mlit.go.jp/ksj/");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "/relative", "", "not a url"])(
    "rejects %j",
    (url) => {
      expect(safeExternalUrl(url)).toBeNull();
    },
  );
});

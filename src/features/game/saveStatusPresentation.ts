import type { SaveWriteResult } from "./store/persistence";

export type SaveStatusTone = "saved" | "warning" | "unsaved";

export interface SaveStatusPresentation {
  readonly tone: SaveStatusTone;
  readonly explanation: string;
}

const SAVE_STATUS_PRESENTATIONS: Record<SaveWriteResult, SaveStatusPresentation> = {
  saved: {
    tone: "saved",
    explanation: "自動保存済みです。ページを閉じても、タイトルの「つづきから」で再開できます。",
  },
  failed: { tone: "warning", explanation: "保存に失敗しました。この進行は未保存です。" },
  unavailable: {
    tone: "warning",
    explanation: "この環境では保存できません。ページを閉じると進行は失われます。",
  },
};

const UNCONFIRMED_PRESENTATION: SaveStatusPresentation = {
  tone: "unsaved",
  explanation: "未保存です。まだ保存の完了を確認できていません。",
};

/** `null` means no save has been confirmed yet. */
export function saveStatusPresentation(status: SaveWriteResult | null): SaveStatusPresentation {
  return status === null ? UNCONFIRMED_PRESENTATION : SAVE_STATUS_PRESENTATIONS[status];
}

import { useEffect, useState } from "react";
import type { LastMove } from "../gameSession";
import type { ItemSessionView } from "../itemSession";
import type { RailwayNetwork } from "../engine";
import type { PresentationResolver } from "../presentationResolver";
import { activeItemEffectTexts, itemEventTexts } from "../presentation";

interface ItemEventNoticeProps {
  view: ItemSessionView;
  lastMove: LastMove | null;
  turn: number;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  /** The clearing turn is presented inside the result sheet after its mount. */
  completionAnnouncement?: string;
}

/** Visible transcript and current countdowns share copy with the announcer. */
export function ItemEventNotice({ view, lastMove, turn, network, presentation, completionAnnouncement }: ItemEventNoticeProps) {
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => { setAnnouncement(completionAnnouncement ?? ""); }, [completionAnnouncement]);
  const record = lastMove?.itemRecord;
  const outcomes = itemEventTexts(record?.itemEvents ?? [], record?.turn ?? turn, network, presentation);
  const effects = activeItemEffectTexts(view.effects, record?.turn ?? turn, network, presentation);
  return <section className="item-event-notice" aria-label="アイテムのお知らせ">
    {completionAnnouncement !== undefined && <p role="status" aria-live="polite" aria-atomic="true">{announcement}</p>}
    {outcomes.length > 0 && <div aria-label="前のターンの結果">
      <h2>{record?.turn}ターン目のアイテム</h2>
      <ul>{outcomes.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </div>}
    {record?.landingSnapshot?.suspensionIgnored && <p>この駅では候補がすべて運休のため、運休を無視して抽選しました。</p>}
    {effects.length > 0 && <div aria-label="続いている効果">
      <h2>続いている効果</h2>
      <ul>{effects.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </div>}
  </section>;
}

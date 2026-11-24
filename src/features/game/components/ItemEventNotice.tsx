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
  showEffects?: boolean;
}

/** Visible transcript and current countdowns share copy with the announcer; it is never a live region itself. */
export function ItemEventNotice({ view, lastMove, turn, network, presentation, showEffects = true }: ItemEventNoticeProps) {
  const record = lastMove?.itemRecord;
  const outcomes = itemEventTexts(record?.itemEvents ?? [], record?.turn ?? turn, network, presentation);
  const effects = activeItemEffectTexts(view.effects, record?.turn ?? turn, network, presentation);
  const suspensionIgnored = record?.landingSnapshot?.suspensionIgnored === true;
  if (outcomes.length === 0 && !suspensionIgnored && !(showEffects && effects.length > 0)) return null;
  return <section className="item-event-notice" aria-label="アイテムのお知らせ">
    {outcomes.length > 0 && <div aria-label="前のターンの結果">
      <h2>{record?.turn}ターン目のアイテム</h2>
      <ul>{outcomes.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </div>}
    {suspensionIgnored && <p>この駅では候補がすべて運休のため、運休を無視して抽選しました。</p>}
    {showEffects && effects.length > 0 && <div aria-label="続いている効果">
      <h2>続いている効果</h2>
      <ul>{effects.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </div>}
  </section>;
}

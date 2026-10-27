import type { ItemKind } from "../../../types/network";
import type { ItemSessionView } from "../itemSession";
import { ITEM_DESCRIPTIONS, itemTiming, itemUnavailableLabel } from "../itemPresentation";

const INVENTORY_SLOT_COUNT = 3;

interface InventoryPanelProps {
  view: ItemSessionView;
  onSelect: (instanceId: string, kind: ItemKind) => void;
}

export function InventoryPanel({ view, onSelect }: InventoryPanelProps) {
  return (
    <section className="item-inventory" aria-labelledby="item-inventory-heading">
      <h2 id="item-inventory-heading" className="item-inventory__heading">アイテム（3枠）</h2>
      <ol className="item-inventory__slots">
        {Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => {
          const item = view.inventory[index];
          if (!item) {
            return <li key={`empty-${index}`} className="item-slot item-slot--empty">
              <span className="item-slot__number">{index + 1}</span>
              <span>空き枠</span>
            </li>;
          }
          const action = view.usableItems.find((candidate) => candidate.instanceId === item.id);
          const description = ITEM_DESCRIPTIONS[item.kind];
          const passive = item.kind === "delay-certificate";
          const disabledReason = action?.reason ? itemUnavailableLabel(action.reason) : null;
          const selected = action?.selected ?? false;
          const reasonId = `item-reason-${index}`;
          return <li key={item.id} className={`item-slot${selected ? " item-slot--selected" : ""}`}>
            <span className="item-slot__number">{index + 1}</span>
            <div className="item-slot__body">
              <h3 className="item-slot__name">{description.name}</h3>
              <p className="item-slot__effect">{description.effect}</p>
              <p className="item-slot__timing">{itemTiming(item.kind)}</p>
              {item.kind === "rapid" && <p className={`item-slot__hint${view.hints.rapidHeadsTowardYamanote ? "" : " item-slot__hint--caution"}`}>
                {view.hints.rapidHeadsTowardYamanote
                  ? "おすすめ：現在の向きは山手線に近づきます"
                  : "注意：現在の向きは山手線から遠ざかります"}
              </p>}
              {item.kind === "deadhead" && !view.hints.deadheadRecommended && <p className="item-slot__hint item-slot__hint--caution">
                おすすめしない：山手線の駅にいるため、同じ駅にとどまり1ターン使います
              </p>}
              {!selected && action?.usable && view.draft.items.length > 0 && <p className="item-slot__availability">
                ほかのアイテムを選択中です。使うと置き換わります。
              </p>}
              {!passive && (
                <button
                  type="button"
                  className="item-slot__select"
                  disabled={!action?.usable}
                  aria-pressed={selected}
                  aria-describedby={disabledReason ? reasonId : undefined}
                  onClick={() => onSelect(item.id, item.kind)}
                >
                  {selected ? "選択中・変更する" : "このアイテムを使う"}
                </button>
              )}
              {disabledReason && <p id={reasonId} className="item-slot__reason">{disabledReason}</p>}
            </div>
          </li>;
        })}
      </ol>
    </section>
  );
}

import { useId, useLayoutEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import type { Direction, ItemKind, PreRollItemCommand } from "../../../types/network";
import type { ItemSessionView } from "../itemSession";
import type { RailwayNetwork } from "../engine";
import { directionGuidance } from "../itemPresentation";
import { directionLabel, serviceName, stationName } from "../presentation";
import type { PresentationResolver } from "../presentationResolver";

interface ItemUseDialogProps {
  kind: Extract<ItemKind, "route-ticket" | "direction-ticket">;
  instanceId: string;
  view: ItemSessionView;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  onChoose: (command: PreRollItemCommand) => void;
  onClose: () => void;
}

function useOpenDialog(ref: RefObject<HTMLDialogElement | null>): void {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    (dialog.querySelector<HTMLInputElement>("input:checked")
      ?? dialog.querySelector<HTMLInputElement>("input")
      ?? dialog.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
    return () => dialog.close();
  }, [ref]);
}

function handleCancel(event: SyntheticEvent, onClose: () => void): void {
  event.preventDefault();
  onClose();
}

function closerText(
  directions: ItemSessionView["hints"]["direction"]["directions"],
  closerDirection: Direction | null,
  direction: Direction,
): string {
  const option = directions.find((candidate) => candidate.direction === direction);
  if (!option) return "";
  if (directions.length < 2) {
    const distance = Number.isFinite(option.targetHops)
      ? `次の駅から山手線まで${option.targetHops}駅`
      : "次の駅から山手線へ到達できません";
    return `${distance}。向きは固定です`;
  }
  return directionGuidance(option.targetHops, closerDirection === direction, closerDirection !== null);
}

export function ItemUseDialog({
  kind, instanceId, view, network, presentation, onChoose, onClose,
}: ItemUseDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const groupId = useId();
  useOpenDialog(dialogRef);

  const existing = view.draft.items[0];
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    existing?.kind === "route-ticket" && existing.instanceId === instanceId ? existing.serviceId : null,
  );
  const [selectedDirection, setSelectedDirection] = useState<Direction | null>(
    existing?.kind === "direction-ticket" && existing.instanceId === instanceId ? existing.direction : null,
  );
  const confirmChoice = () => {
    if (kind === "route-ticket" && selectedServiceId) {
      onChoose({ kind: "route-ticket", instanceId, serviceId: selectedServiceId });
    } else if (kind === "direction-ticket" && selectedDirection !== null) {
      onChoose({ kind: "direction-ticket", instanceId, direction: selectedDirection });
    }
  };
  const routes = view.hints.routes.filter((route) => route.selectable);
  const routeGroups = presentation.candidateRows(routes.map((route) => route.serviceId));
  const routeById = new Map(view.hints.routes.map((route) => [route.serviceId, route]));
  const suspendedServices = !view.hints.suspensionIgnored
    ? view.hints.suspendedServiceIds.filter((serviceId) =>
      network.servicesByStation.get(view.position.currentStationId)?.includes(serviceId) && !routeById.has(serviceId))
    : [];

  return (
    <dialog
      ref={dialogRef}
      className="dialog item-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => handleCancel(event, onClose)}
    >
      <div className="dialog__body">
        <h2 id={titleId} className="dialog__title">
          {kind === "route-ticket" ? "乗る路線を選ぶ" : "進む向きを選ぶ"}
        </h2>
        {kind === "route-ticket" ? (
          <>
            {routes.some((route) => route.isYamanote) && <p className="item-dialog__hint item-dialog__hint--target">
              路線指定券で山手線に乗れます
            </p>}
            <p className="item-dialog__hint">路線を決めた後の向きは抽選です。次の駅までの距離は乗車時間ではなく、山手線までの駅数の目安です。</p>
            {routeGroups.map((group) => {
              const duplicates = group.serviceIds.length > 1;
              return <fieldset className="item-dialog__group" key={group.groupId}>
                <legend>{group.name}</legend>
                {group.serviceIds.map((serviceId, index) => {
                  const route = routeById.get(serviceId)!;
                  const service = network.servicesById.get(serviceId);
                  const title = serviceName(network, serviceId, presentation);
                  const specific = service && service.name !== group.name ? service.name
                    : duplicates ? `系統${index + 1}` : title;
                  const details = route.direction.directions.map((option) => {
                    const nextStation = stationName(network, option.nextStationId, presentation);
                    return `${directionLabel(network, serviceId, option.direction)}：${nextStation}、${closerText(route.direction.directions, route.direction.closerDirection, option.direction)}`;
                  }).join("。 ");
                  return <label
                    key={serviceId}
                    className={`item-route-option${route.isYamanote ? " item-route-option--target" : ""}`}
                  >
                    <input
                      type="radio"
                      name={groupId}
                      value={serviceId}
                      checked={selectedServiceId === serviceId}
                      onChange={() => setSelectedServiceId(serviceId)}
                    />
                    <span className="item-route-option__copy">
                      <span className="item-route-option__name">{group.name}{specific !== group.name ? ` — ${specific}` : ""}{route.isYamanote ? "（山手線）" : ""}</span>
                      <span className="item-route-option__guidance">{details}</span>
                    </span>
                  </label>;
                })}
              </fieldset>;
            })}
            {suspendedServices.length > 0 && <section className="item-dialog__group" aria-label="運休中の路線">
              <h3>運休中で選べない</h3>
              <ul>{suspendedServices.map((serviceId) => <li key={serviceId} aria-disabled="true">
                {serviceName(network, serviceId, presentation)} — 運休中で選べない
              </li>)}</ul>
            </section>}
            {routes.length === 0 && <p>この駅では路線を選べません。</p>}
          </>
        ) : (
          <>
            <p className="item-dialog__hint">方向指定券で選ぶ路線：{serviceName(network, view.position.currentServiceId, presentation)}</p>
            <p className="item-dialog__hint">距離は山手線までの駅数の目安で、乗車時間ではありません。</p>
            {view.hints.direction.closerDirection === null && view.hints.direction.directions.length > 1 && (
              <p className="item-dialog__hint">どちらの方向にも短い方向はありません。</p>
            )}
            <fieldset className="item-dialog__group">
              <legend>進む方向</legend>
              {view.hints.direction.directions.map((option) => (
                <label className="item-direction-option" key={option.direction}>
                  <input
                    type="radio"
                    name={groupId}
                    value={option.direction}
                    checked={selectedDirection === option.direction}
                    onChange={() => setSelectedDirection(option.direction)}
                  />
                  <span>
                    <strong>{directionLabel(network, view.position.currentServiceId, option.direction)}</strong>
                    <span className="item-route-option__guidance">
                      {stationName(network, option.nextStationId, presentation)}。{closerText(
                        view.hints.direction.directions,
                        view.hints.direction.closerDirection,
                        option.direction,
                      )}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>キャンセル</button>
          <button
            type="button"
            className="button-primary"
            disabled={kind === "route-ticket" ? selectedServiceId === null : selectedDirection === null}
            onClick={confirmChoice}
          >
            {kind === "route-ticket" ? "この路線に決める" : "この方向に決める"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

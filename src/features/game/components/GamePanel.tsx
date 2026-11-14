import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ItemKind, ItemRollAdjustment, ItemTurnCommand, LineMetadata, PreRollItemCommand } from "../../../types/network";
import { nextStationId, targetSegmentIds, type RailwayNetwork } from "../engine";
import type { PresentationLevel } from "../gameSettings";
import type { GameSession } from "../gameSession";
import { createPresentationResolver, type PresentationResolver } from "../presentationResolver";
import {
  directionLabel,
  LOTTERY_INLINE_LIMIT,
  serviceName,
  stationName,
} from "../presentation";
import { type SaveWriteResult, saveStatusMessage } from "../store/persistence";
import { buildMapPresentationGroups } from "../../map/mapPresentation";
import {
  setVisibleLineGroupIds,
  updateLineGroupSelection,
  useVisibleLineGroupIds,
} from "../../map/lineVisibilityStore";
import { GameMenu, modalDialogOpen } from "./GameMenu";
import { EDITIONS } from "../../editions/registry";
import type { EditionDisplay } from "../../editions/types";
import { ITEM_DESCRIPTIONS } from "../itemPresentation";
import type { TurnMomentDisplay } from "../turnMomentPresentation";
import { lineBadgeFor } from "../lineBadge";
import { InventoryPanel } from "./InventoryPanel";
import { GameHud } from "./GameHud";
import type { TurnMomentTargets } from "./TurnMomentHost";
import { ItemUseDialog } from "./ItemUseDialog";
import { RollAdjustment } from "./RollAdjustment";
import { ItemEventNotice } from "./ItemEventNotice";
import { DiscardChoice } from "./DiscardChoice";
import { TurnLogDrawer } from "./TurnLogDrawer";
import { useGameShortcuts } from "../useGameShortcuts";
import { useAutoRoll } from "../useAutoRoll";
import { PhraseText } from "./PhraseText";
import { TurnResultCard } from "./TurnResultCard";

const UPCOMING_STATION_COUNT = 5;

export interface GamePanelProps {
  session: GameSession;
  turnDisplay: TurnMomentDisplay;
  network: RailwayNetwork;
  presentation?: PresentationResolver;
  display?: EditionDisplay;
  lines: readonly LineMetadata[];
  requiredCount: number;
  saveStatus: SaveWriteResult | null;
  follow: boolean;
  speedLabel: string;
  presentationLevel: PresentationLevel;
  reducedMotion: boolean;
  confirmationOpen?: boolean;
  onRoll: () => void;
  onSkip: () => void;
  onToggleFollow: () => void;
  onCycleSpeed: () => void;
  onCyclePresentation: () => void;
  onNewGame: () => void;
  onShowTitle: () => void;
  onEditItemDraft?: (command: ItemTurnCommand) => void;
  onAdjustItemRoll?: (adjustment: ItemRollAdjustment | null) => void;
  onDiscardItem?: (instanceId: string) => void;
  onItemDialogOpenChange?: (open: boolean) => void;
  /** Optional animation target refs for the turn moments; absent = today's markup. */
  turnMomentTargets?: TurnMomentTargets;
}

/** Short-landscape wording of the goal guidance, built from the same reveal-gated station name. */
function goalGuidanceShortText(stationName: string): string {
  return `あとは${stationName}へ`;
}

function showAllLineGroups(): void {
  setVisibleLineGroupIds(null);
}

/** Memoised: re-renders when a hop finishes or a control changes, not on animation frames. */
export const GamePanel = memo(function GamePanel(props: GamePanelProps) {
  const { session, network, saveStatus, follow, reducedMotion, lines, turnDisplay } = props;
  const presentation = useMemo(
    () => props.presentation ?? createPresentationResolver(network),
    [props.presentation, network],
  );
  const { game, phase } = session;
  const itemView = turnDisplay.itemView;
  const display = props.display ?? EDITIONS[0]!.display;
  const animating = phase === "animating";
  const canRoll = turnDisplay.canRoll;
  const ride = turnDisplay.ride;
  const currentService = network.servicesById.get(ride.serviceId);
  const currentRideName = serviceName(network, ride.serviceId, presentation);
  const lineBadge = lineBadgeFor(ride.serviceId, presentation, currentService?.color);
  const effectModels = turnDisplay.effectModels;
  const selectedGroupIds = useVisibleLineGroupIds();
  const targetColor = presentation.lineGroupColor(game.config.targetServiceId)
    ?? network.servicesById.get(game.config.targetServiceId)?.color;
  const candidates = turnDisplay.candidateRows;
  const legendGroups = useMemo(
    () => buildMapPresentationGroups(
      [...network.servicesById.values()],
      lines,
      presentation.lineGroups(),
    ).map((group) => ({
      id: group.id,
      name: group.name,
      operatorId: group.operatorId,
      color: presentation.lineGroupColor(group.serviceIds[0] ?? "") ?? group.color,
      serviceIds: group.serviceIds,
    })),
    [network, lines, presentation],
  );
  const allGroupIds = useMemo(() => legendGroups.map((group) => group.id), [legendGroups]);
  const requiredTargetIds = useMemo(() => targetSegmentIds(game.config, network), [game.config, network]);
  const remainingSections = useMemo(() => {
    const completed = new Set(turnDisplay.progress.completedSegmentIds);
    return requiredTargetIds.flatMap((id) => {
      if (completed.has(id)) return [];
      const segment = network.segmentsById.get(id);
      if (!segment) return [];
      return [{
        id,
        from: presentation.serviceStationName(game.config.targetServiceId, segment.from),
        to: presentation.serviceStationName(game.config.targetServiceId, segment.to),
      }];
    });
  }, [turnDisplay.progress.completedSegmentIds, game.config, network, presentation, requiredTargetIds]);
  const upcomingStations = useMemo(() => {
    const ids: string[] = [];
    let current = turnDisplay.progress.stationId;
    for (let index = 0; index < UPCOMING_STATION_COUNT; index += 1) {
      const next = nextStationId(network, ride.serviceId, current, ride.direction);
      if (!next) break;
      ids.push(next);
      current = next;
    }
    return ids;
  }, [network, turnDisplay.progress.stationId, ride.direction, ride.serviceId]);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const toggleGroup = useCallback((groupId: string, checked: boolean) => {
    setVisibleLineGroupIds(updateLineGroupSelection(selectedGroupIds, allGroupIds, [groupId], checked));
  }, [selectedGroupIds, allGroupIds]);
  const setOperator = useCallback((operatorId: string, checked: boolean) => {
    const groupIds = legendGroups.filter((group) => group.operatorId === operatorId).map((group) => group.id);
    setVisibleLineGroupIds(updateLineGroupSelection(selectedGroupIds, allGroupIds, groupIds, checked));
  }, [legendGroups, selectedGroupIds, allGroupIds]);
  const [itemDialog, setItemDialog] = useState<{
    kind: "route-ticket" | "direction-ticket";
    instanceId: string;
  } | null>(null);
  // One disclosure surface at a time; both disclosures start closed.
  const [activeSurface, setActiveSurface] = useState<"log" | "menu" | "card" | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const itemDialogOpenerRef = useRef<HTMLElement | null>(null);
  const setOpenItemCard = useCallback((id: string | null) => {
    setOpenCardId(id);
    setActiveSurface(id ? "card" : (current => current === "card" ? null : current));
  }, []);
  const setLogExpanded = useCallback((expanded: boolean) => {
    if (expanded) { setOpenCardId(null); setActiveSurface("log"); }
    else setActiveSurface((current) => current === "log" ? null : current);
  }, []);
  const setMenuExpanded = useCallback((expanded: boolean) => {
    if (expanded) { setOpenCardId(null); setActiveSurface("menu"); }
    else setActiveSurface((current) => current === "menu" ? null : current);
  }, []);
  const itemDialogOpen = Boolean(itemView && itemDialog);
  const autoRoll = useAutoRoll({
    session,
    turnDisplay,
    surfaceOpen: activeSurface !== null,
    itemDialogOpen,
    confirmationOpen: props.confirmationOpen ?? false,
    onRoll: props.onRoll,
  });
  useGameShortcuts({
    canRoll: turnDisplay.canRoll,
    canSkip: turnDisplay.canSkip,
    surfaceOpen: activeSurface !== null,
    itemDialogOpen,
  }, { onRoll: autoRoll.requestRoll, onSkip: props.onSkip });
  useEffect(() => {
    if (!props.onItemDialogOpenChange) return;
    props.onItemDialogOpenChange(itemDialogOpen);
    return () => props.onItemDialogOpenChange?.(false);
  }, [itemDialogOpen, props.onItemDialogOpenChange]);
  const rollButtonRef = useRef<HTMLButtonElement>(null);
  const restoreRollFocusRef = useRef(false);
  const draftItem = itemView?.draft.items[0];
  const presentedDecision = turnDisplay.decision;
  // Always read the latest presentation lock, so a callback captured earlier is a no-op once a lock starts.
  const itemUseLockedRef = useRef<boolean>(turnDisplay.itemUseLocked);
  itemUseLockedRef.current = turnDisplay.itemUseLocked;

  const selectItem = useCallback((instanceId: string, kind: ItemKind) => {
    if (!itemView || itemView.phase !== "idle" || itemUseLockedRef.current) return;
    if (kind === "route-ticket" || kind === "direction-ticket") {
      setItemDialog({ kind, instanceId });
      return;
    }
    if (kind === "double" || kind === "rapid" || kind === "deadhead") {
      props.onEditItemDraft?.({ items: [{ kind, instanceId }] });
    }
  }, [itemView, props.onEditItemDraft]);

  const activateInventoryItem = useCallback((instanceId: string, kind: ItemKind, opener: HTMLElement) => {
    const current = itemView;
    const usable = current?.usableItems.find((item) => item.instanceId === instanceId);
    if (!current || current.phase !== "idle" || current.decision || usable?.usable !== true || itemUseLockedRef.current) return;
    setOpenItemCard(null);
    itemDialogOpenerRef.current = opener;
    opener.focus({ preventScroll: true });
    selectItem(instanceId, kind);
  }, [itemView, selectItem, setOpenItemCard]);
  const restoreItemDialogFocus = useCallback(() => {
    const opener = itemDialogOpenerRef.current;
    itemDialogOpenerRef.current = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }, []);
  const chooseItemDialogCommand = useCallback((command: PreRollItemCommand) => {
    if (itemUseLockedRef.current) return;
    props.onEditItemDraft?.({ items: [command] });
    setItemDialog(null);
    restoreItemDialogFocus();
  }, [props.onEditItemDraft, restoreItemDialogFocus]);

  // The presented decision (not the raw session decision) closes any open item card.
  useEffect(() => {
    if (!presentedDecision || !openCardId) return;
    setOpenCardId(null);
    setActiveSurface((current) => current === "card" ? null : current);
  }, [presentedDecision, openCardId]);

  const clearDraft = useCallback(() => {
    if (itemView?.phase === "idle" && !itemUseLockedRef.current) props.onEditItemDraft?.({ items: [] });
  }, [itemView?.phase, props.onEditItemDraft]);

  useEffect(() => {
    if (!itemView || itemView.phase !== "idle" || !draftItem || itemDialog || turnDisplay.itemUseLocked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || itemUseLockedRef.current) return;
      // e.g. the 新規 confirmation: its Escape must close it, not clear the draft behind it.
      if (modalDialogOpen()) return;
      event.preventDefault();
      clearDraft();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [itemView, draftItem, itemDialog, clearDraft, turnDisplay.itemUseLocked]);

  // A presented decision arms the final dice focus. It is spent only once interaction is available; while the
  // presentation still runs, a modal teardown that would drop focus on <body> parks it on the aria-disabled dice.
  useEffect(() => {
    if (presentedDecision) {
      restoreRollFocusRef.current = true;
      return;
    }
    if (!restoreRollFocusRef.current) return;
    const dice = rollButtonRef.current;
    if (!dice) return;
    if (turnDisplay.canRoll) {
      restoreRollFocusRef.current = false;
      dice.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body) dice.focus({ preventScroll: true });
  }, [presentedDecision, turnDisplay.canRoll]);

  useLayoutEffect(() => {
    if (!panelRef.current || !headingRef.current) return;
    panelRef.current.scrollTop = 0;
    if (!presentedDecision) headingRef.current.focus({ preventScroll: true });
  }, []);

  return (
    <main ref={panelRef} className="game-panel" aria-label="ゲーム操作">
      <GameHud
        turnResult={<TurnResultCard model={turnDisplay.turnResult} />}
        inventory={<>
          {itemView && <InventoryPanel
            view={itemView} openItemId={openCardId} onOpenItemChange={setOpenItemCard} onUse={activateInventoryItem}
            itemUseLocked={turnDisplay.itemUseLocked} decisionOpen={presentedDecision !== null}
            slotTargetRefs={props.turnMomentTargets?.slots} headerTargetRef={props.turnMomentTargets?.inventoryHeader}
          />}
          {draftItem && itemView && <div className="item-staged-summary">
            <span className="item-staged-summary__label">選択中：</span>
            <strong><PhraseText text={ITEM_DESCRIPTIONS[draftItem.kind].name} /></strong>
            {draftItem.kind === "route-ticket" && <span><PhraseText text={`（${serviceName(network, draftItem.serviceId, presentation)}。向きは抽選）`} /></span>}
            {draftItem.kind === "direction-ticket" && <span><PhraseText text={`（${directionLabel(network, itemView.position.currentServiceId, draftItem.direction)}）`} /></span>}
            <button type="button" onClick={clearDraft} disabled={phase !== "idle" || turnDisplay.itemUseLocked}>選択を解除</button>
            <span className="visually-hidden">Escapeキーで選択を解除できます。</span>
          </div>}
        </>}
        title={display.title}
        subtitle={display.subtitle}
        headingRef={headingRef}
        station={stationName(network, turnDisplay.progress.stationId, presentation)}
        ride={currentRideName}
        lineBadge={lineBadge}
        direction={directionLabel(network, ride.serviceId, ride.direction)}
        turn={turnDisplay.turn}
        completed={turnDisplay.progress.completedSegmentIds.filter((id) => requiredTargetIds.includes(id)).length}
        required={props.requiredCount}
        goalGuidanceText={turnDisplay.goalGuidance?.text ?? null}
        goalGuidanceShortText={turnDisplay.goalGuidance ? goalGuidanceShortText(turnDisplay.goalGuidance.stationName) : null}
        compactRoll={turnDisplay.compactRoll}
        saveStatus={saveStatus}
        saveStatusMessage={saveStatusMessage(saveStatus)}
        canRoll={canRoll}
        autoRollEnabled={autoRoll.enabled}
        animating={animating}
        draftSelected={Boolean(draftItem)}
        rollButtonRef={rollButtonRef}
        onRoll={autoRoll.requestRoll}
        onSkip={props.onSkip}
        onToggleAutoRoll={autoRoll.toggle}
        effects={effectModels}
        canSkip={turnDisplay.canSkip}
        rideTargetRef={props.turnMomentTargets?.ride}
        directionTargetRef={props.turnMomentTargets?.direction}
      />
      <div className="game-panel__disclosures">
        <TurnLogDrawer
          expanded={activeSurface === "log"}
          onExpandedChange={setLogExpanded}
          arrival={itemView ? turnDisplay.arrivalText : null}
          roll={turnDisplay.rollText}
          lottery={<p className="game-panel__lottery"><span>抽選: </span><PhraseText text={turnDisplay.lotteryDisplayText} /></p>}
          notice={itemView && turnDisplay.itemNoticePublished ? <ItemEventNotice
            view={itemView} lastMove={turnDisplay.itemNoticeMove} turn={turnDisplay.turn} network={network} presentation={presentation} showEffects={false}
          /> : null}
          effectTexts={effectModels.map((model) => model.text)}
          routeSummary={<details className="game-panel__route-summary">
            <summary>地図なしで確認</summary>
            <section aria-label="山手線の未踏破区間">
              <h2>山手線の未踏破区間（{remainingSections.length}）</h2>
              {remainingSections.length > 0 ? (
                <ol>{remainingSections.map((section) => <li key={section.id}><PhraseText text={`${section.from} → ${section.to}`} /></li>)}</ol>
              ) : <p>未踏破区間はありません。</p>}
            </section>
            <section aria-label="乗車中の次の駅">
              <h2>乗車中の次の駅</h2>
              <p><PhraseText text={`${serviceName(network, ride.serviceId, presentation)}・${directionLabel(network, ride.serviceId, ride.direction)}`} /></p>
              {upcomingStations.length > 0 ? (
                <ol>{upcomingStations.map((stationId) => <li key={stationId}><PhraseText text={stationName(network, stationId, presentation)} /></li>)}</ol>
              ) : <p>この路線に次の駅はありません。</p>}
            </section>
          </details>}
          candidates={turnDisplay.candidateDrawSlotCount > LOTTERY_INLINE_LIMIT ? (
            <details className="game-panel__candidates" key={game.turn}>
              <summary>抽選候補をすべて表示（{turnDisplay.candidateDrawSlotCount}抽選枠）</summary>
              <ul>{candidates.map((row) => <li key={row.groupId}><PhraseText text={row.label} /></li>)}</ul>
            </details>
          ) : null}
        />
        <GameMenu
          expanded={activeSurface === "menu"}
          onExpandedChange={setMenuExpanded}
          follow={follow}
          reducedMotion={reducedMotion}
          speedLabel={props.speedLabel}
          presentationLevel={props.presentationLevel}
          lines={legendGroups}
          targetColor={targetColor}
          selectedGroupIds={selectedGroupIds}
          onToggleFollow={props.onToggleFollow}
          onCycleSpeed={props.onCycleSpeed}
          onCyclePresentation={props.onCyclePresentation}
          onNewGame={props.onNewGame}
          onShowTitle={props.onShowTitle}
          onToggleGroup={toggleGroup}
          onSetOperator={setOperator}
          onShowAll={showAllLineGroups}
        />
      </div>
      {!turnDisplay.decision && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{autoRoll.announcement}</p>}
      {itemView && itemDialog && (
        <ItemUseDialog
          kind={itemDialog.kind}
          instanceId={itemDialog.instanceId}
          view={itemView}
          network={network}
          presentation={presentation}
          onChoose={chooseItemDialogCommand}
          onClose={() => { setItemDialog(null); restoreItemDialogFocus(); }}
        />
      )}
      {turnDisplay.decision?.kind === "adjust" && <RollAdjustment
        announcement={turnDisplay.announcement}
        decision={turnDisplay.decision}
        landings={turnDisplay.adjustmentLandings}
        onContinue={(adjustment) => props.onAdjustItemRoll?.(adjustment)}
        onSkip={props.onSkip}
        canSkip={turnDisplay.canSkip}
      />}
      {turnDisplay.decision?.kind === "discard" && <DiscardChoice
        announcement={turnDisplay.announcement}
        decision={turnDisplay.decision}
        onDiscard={(instanceId) => props.onDiscardItem?.(instanceId)}
      />}
    </main>
  );
});

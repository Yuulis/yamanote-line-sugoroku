import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ItemKind, ItemRollAdjustment, ItemTurnCommand, LineMetadata } from "../../../types/network";
import { nextStationId, targetSegmentIds, type RailwayNetwork } from "../engine";
import type { GameSession } from "../gameSession";
import { createPresentationResolver, type PresentationResolver } from "../presentationResolver";
import {
  arrivalLogText,
  arrivalSummary,
  itemTurnAnnouncement,
  directionLabel,
  displayedRide,
  landingText,
  LOTTERY_INLINE_LIMIT,
  lastRollText,
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
import type { ItemSessionView } from "../itemSession";
import { ITEM_DESCRIPTIONS } from "../itemPresentation";
import { compactRollFor, compactRollText, effectChipModels } from "../hudPresentation";
import { lineBadgeFor } from "../lineBadge";
import { InventoryPanel } from "./InventoryPanel";
import { GameHud } from "./GameHud";
import { ItemUseDialog } from "./ItemUseDialog";
import { RollAdjustment } from "./RollAdjustment";
import { ItemEventNotice } from "./ItemEventNotice";
import { DiscardChoice } from "./DiscardChoice";
import { TurnLogDrawer } from "./TurnLogDrawer";

const UPCOMING_STATION_COUNT = 5;

export interface GamePanelProps {
  session: GameSession;
  network: RailwayNetwork;
  presentation?: PresentationResolver;
  display?: EditionDisplay;
  lines: readonly LineMetadata[];
  /** Station the marker has reached (follows the animation). */
  displayedStationId: string;
  displayedCompletedCount: number;
  requiredCount: number;
  saveStatus: SaveWriteResult | null;
  follow: boolean;
  speedLabel: string;
  reducedMotion: boolean;
  onRoll: () => void;
  onSkip: () => void;
  onToggleFollow: () => void;
  onCycleSpeed: () => void;
  onNewGame: () => void;
  onShowTitle: () => void;
  itemView?: ItemSessionView | null;
  onEditItemDraft?: (command: ItemTurnCommand) => void;
  onAdjustItemRoll?: (adjustment: ItemRollAdjustment | null) => void;
  onDiscardItem?: (instanceId: string) => void;
  onItemDialogOpenChange?: (open: boolean) => void;
}

function showAllLineGroups(): void {
  setVisibleLineGroupIds(null);
}

/** Memoised: re-renders when a hop finishes or a control changes, not on animation frames. */
export const GamePanel = memo(function GamePanel(props: GamePanelProps) {
  const { session, network, saveStatus, follow, reducedMotion, lines } = props;
  const presentation = useMemo(
    () => props.presentation ?? createPresentationResolver(network),
    [props.presentation, network],
  );
  const { game, phase } = session;
  const arrived = "pending" in game && game.pending?.kind === "discard" && phase === "awaiting-discard"
    ? game.pending.position : game;
  const display = props.display ?? EDITIONS[0]!.display;
  const animating = phase === "animating";
  const canRoll = game.status === "playing" && phase === "idle";
  const ride = displayedRide(session);
  const currentService = network.servicesById.get(ride.serviceId);
  const currentRideName = serviceName(network, ride.serviceId, presentation);
  const lineBadge = lineBadgeFor(ride.serviceId, presentation, currentService?.color);
  const effectsVisible = Boolean(props.itemView && (phase === "idle" || phase === "awaiting-discard"));
  const effectTurn: number = session.lastMove?.itemRecord?.turn ?? game.turn;
  const effectModels = effectsVisible && props.itemView
    ? effectChipModels(props.itemView.effects, effectTurn, network, presentation)
    : [];
  const selectedGroupIds = useVisibleLineGroupIds();
  const targetColor = presentation.lineGroupColor(game.config.targetServiceId)
    ?? network.servicesById.get(game.config.targetServiceId)?.color;
  const candidates = session.lastMove?.landing?.serviceCandidates ?? [];
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
    const completed = new Set(arrived.completedSegmentIds);
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
  }, [arrived.completedSegmentIds, game.config, network, presentation, requiredTargetIds]);
  const upcomingStations = useMemo(() => {
    const ids: string[] = [];
    let current = props.displayedStationId;
    for (let index = 0; index < UPCOMING_STATION_COUNT; index += 1) {
      const next = nextStationId(network, ride.serviceId, current, ride.direction);
      if (!next) break;
      ids.push(next);
      current = next;
    }
    return ids;
  }, [network, props.displayedStationId, ride.direction, ride.serviceId]);
  const knownTurn = useRef(game.turn);
  const [turnSummary, setTurnSummary] = useState("");
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
  const [activeSurface, setActiveSurface] = useState<"log" | "menu" | null>(null);
  const setLogExpanded = useCallback((expanded: boolean) => setActiveSurface(expanded ? "log" : null), []);
  const setMenuExpanded = useCallback((expanded: boolean) => setActiveSurface(expanded ? "menu" : null), []);
  const itemDialogOpen = Boolean(props.itemView && itemDialog);
  useEffect(() => {
    if (!props.onItemDialogOpenChange) return;
    props.onItemDialogOpenChange(itemDialogOpen);
    return () => props.onItemDialogOpenChange?.(false);
  }, [itemDialogOpen, props.onItemDialogOpenChange]);
  const rollButtonRef = useRef<HTMLButtonElement>(null);
  const restoreRollFocusRef = useRef(false);
  const draftItem = props.itemView?.draft.items[0];

  const selectItem = useCallback((instanceId: string, kind: ItemKind) => {
    if (!props.itemView || props.itemView.phase !== "idle") return;
    if (kind === "route-ticket" || kind === "direction-ticket") {
      setItemDialog({ kind, instanceId });
      return;
    }
    if (kind === "double" || kind === "rapid" || kind === "deadhead") {
      props.onEditItemDraft?.({ items: [{ kind, instanceId }] });
    }
  }, [props.itemView, props.onEditItemDraft]);

  const clearDraft = useCallback(() => {
    if (props.itemView?.phase === "idle") props.onEditItemDraft?.({ items: [] });
  }, [props.itemView?.phase, props.onEditItemDraft]);

  useEffect(() => {
    if (!props.itemView || props.itemView.phase !== "idle" || !draftItem || itemDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // e.g. the 新規 confirmation: its Escape must close it, not clear the draft behind it.
      if (modalDialogOpen()) return;
      event.preventDefault();
      clearDraft();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.itemView, draftItem, itemDialog, clearDraft]);

  useEffect(() => {
    if (props.itemView?.decision) {
      restoreRollFocusRef.current = true;
      return;
    }
    if (restoreRollFocusRef.current && props.itemView?.phase === "idle") {
      restoreRollFocusRef.current = false;
      rollButtonRef.current?.focus({ preventScroll: true });
    }
  }, [props.itemView?.decision, props.itemView?.phase]);

  useEffect(() => {
    if (props.itemView) return;
    if (phase !== "idle" || !session.lastMove || game.turn <= knownTurn.current) return;
    knownTurn.current = game.turn;
    setTurnSummary(arrivalSummary(game.turn, session.lastMove, props.displayedCompletedCount,
      props.requiredCount, network, presentation));
  }, [game.turn, network, phase, presentation, props.itemView,
    props.displayedCompletedCount, props.requiredCount, session.lastMove]);

  const announcement = props.itemView
    ? itemTurnAnnouncement(session, props.itemView, props.displayedCompletedCount, props.requiredCount, network, presentation)
    : turnSummary;

  useLayoutEffect(() => {
    if (!panelRef.current || !headingRef.current) return;
    panelRef.current.scrollTop = 0;
    if (!props.itemView?.decision) headingRef.current.focus({ preventScroll: true });
  }, []);

  return (
    <main ref={panelRef} className="game-panel" aria-label="ゲーム操作">
      <GameHud
        title={display.title}
        subtitle={display.subtitle}
        headingRef={headingRef}
        station={stationName(network, props.displayedStationId, presentation)}
        ride={currentRideName}
        lineBadge={lineBadge}
        direction={directionLabel(network, ride.serviceId, ride.direction)}
        turn={arrived.turn}
        completed={props.displayedCompletedCount}
        required={props.requiredCount}
        compactRoll={compactRollText(compactRollFor(session.lastMove))}
        saveStatus={saveStatus}
        saveStatusMessage={saveStatusMessage(saveStatus)}
        canRoll={canRoll}
        animating={animating}
        draftSelected={Boolean(draftItem)}
        rollButtonRef={rollButtonRef}
        onRoll={props.onRoll}
        onSkip={props.onSkip}
        effects={effectModels}
      />
      {draftItem && props.itemView && <div className="item-staged-summary">
        <span className="item-staged-summary__label">選択中：</span>
        <strong>{ITEM_DESCRIPTIONS[draftItem.kind].name}</strong>
        {draftItem.kind === "route-ticket" && <span>（{serviceName(network, draftItem.serviceId, presentation)}。向きは抽選）</span>}
        {draftItem.kind === "direction-ticket" && <span>（{directionLabel(network, props.itemView.position.currentServiceId, draftItem.direction)}）</span>}
        <button type="button" onClick={clearDraft} disabled={phase !== "idle"}>選択を解除</button>
        <span className="visually-hidden">Escapeキーで選択を解除できます。</span>
      </div>}
      {props.itemView && <InventoryPanel view={props.itemView} onSelect={selectItem} />}
      <div className="game-panel__disclosures">
        <TurnLogDrawer
          expanded={activeSurface === "log"}
          onExpandedChange={setLogExpanded}
          arrival={props.itemView && session.lastMove && phase === "idle" ? arrivalLogText(
            session.lastMove.itemRecord?.turn ?? game.turn, session.lastMove, props.displayedCompletedCount,
            props.requiredCount, network, presentation) : null}
          roll={lastRollText(session.lastMove, network, presentation)}
          lottery={<p className="game-panel__lottery"><span>抽選: </span>{animating ? "移動中…" : landingText(session.lastMove, network, presentation)}</p>}
          notice={props.itemView && (phase === "idle" || phase === "awaiting-discard") ? <ItemEventNotice
            view={props.itemView} lastMove={session.lastMove} turn={game.turn} network={network} presentation={presentation} showEffects={false}
          /> : null}
          effectTexts={effectModels.map((model) => model.text)}
          routeSummary={<details className="game-panel__route-summary">
            <summary>地図なしで確認</summary>
            <section aria-label="山手線の未踏破区間">
              <h2>山手線の未踏破区間（{remainingSections.length}）</h2>
              {remainingSections.length > 0 ? (
                <ol>{remainingSections.map((section) => <li key={section.id}>{section.from} → {section.to}</li>)}</ol>
              ) : <p>未踏破区間はありません。</p>}
            </section>
            <section aria-label="乗車中の次の駅">
              <h2>乗車中の次の駅</h2>
              <p>{serviceName(network, ride.serviceId, presentation)}・{directionLabel(network, ride.serviceId, ride.direction)}</p>
              {upcomingStations.length > 0 ? (
                <ol>{upcomingStations.map((stationId) => <li key={stationId}>{stationName(network, stationId, presentation)}</li>)}</ol>
              ) : <p>この路線に次の駅はありません。</p>}
            </section>
          </details>}
          candidates={!animating && candidates.length > LOTTERY_INLINE_LIMIT ? (
            <details className="game-panel__candidates" key={game.turn}>
              <summary>抽選候補をすべて表示（{candidates.length}抽選枠）</summary>
              <ul>{presentation.candidateRows(candidates).map((row) => <li key={row.groupId}>{row.label}</li>)}</ul>
            </details>
          ) : null}
        />
        <GameMenu
          expanded={activeSurface === "menu"}
          onExpandedChange={setMenuExpanded}
          follow={follow}
          reducedMotion={reducedMotion}
          speedLabel={props.speedLabel}
          lines={legendGroups}
          targetColor={targetColor}
          selectedGroupIds={selectedGroupIds}
          onToggleFollow={props.onToggleFollow}
          onCycleSpeed={props.onCycleSpeed}
          onNewGame={props.onNewGame}
          onShowTitle={props.onShowTitle}
          onToggleGroup={toggleGroup}
          onSetOperator={setOperator}
          onShowAll={showAllLineGroups}
        />
      </div>
      {!props.itemView?.decision && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>}
      {props.itemView && itemDialog && (
        <ItemUseDialog
          kind={itemDialog.kind}
          instanceId={itemDialog.instanceId}
          view={props.itemView}
          network={network}
          presentation={presentation}
          onChoose={(command) => {
            props.onEditItemDraft?.({ items: [command] });
            setItemDialog(null);
          }}
          onClose={() => setItemDialog(null)}
        />
      )}
      {props.itemView?.decision?.kind === "adjust" && <RollAdjustment
        announcement={announcement}
        decision={props.itemView.decision}
        onContinue={(adjustment) => props.onAdjustItemRoll?.(adjustment)}
      />}
      {props.itemView?.decision?.kind === "discard" && <DiscardChoice
        announcement={announcement}
        decision={props.itemView.decision}
        onDiscard={(instanceId) => props.onDiscardItem?.(instanceId)}
      />}
    </main>
  );
});

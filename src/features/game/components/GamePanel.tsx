import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ItemKind, ItemRollAdjustment, ItemTurnCommand, LineMetadata } from "../../../types/network";
import { nextStationId, targetSegmentIds, type RailwayNetwork } from "../engine";
import type { GameSession } from "../gameSession";
import { createPresentationResolver, type PresentationResolver } from "../presentationResolver";
import {
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
import { GameLegend } from "./GameLegend";
import { EDITIONS } from "../../editions/registry";
import type { EditionDisplay } from "../../editions/types";
import type { ItemSessionView } from "../itemSession";
import { ITEM_DESCRIPTIONS } from "../itemPresentation";
import { InventoryPanel } from "./InventoryPanel";
import { ItemUseDialog } from "./ItemUseDialog";
import { RollAdjustment } from "./RollAdjustment";
import { ItemEventNotice } from "./ItemEventNotice";
import { DiscardChoice } from "./DiscardChoice";

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
  const saveFailed = saveStatus === "failed" || saveStatus === "unavailable";
  const [itemDialog, setItemDialog] = useState<{
    kind: "route-ticket" | "direction-ticket";
    instanceId: string;
  } | null>(null);
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
      <h1 ref={headingRef} className="game-panel__title" tabIndex={-1}>{display.title}</h1>
      <p className="game-panel__subtitle">{display.subtitle}</p>
      <dl className="game-panel__stats">
        <dt>現在駅</dt>
        <dd><span className="hud-stat__value" data-stat="station">{stationName(network, props.displayedStationId, presentation)}</span></dd>
        <dt>乗車中</dt>
        <dd>
          <span className="service-swatch" style={{ backgroundColor: presentation.lineGroupColor(ride.serviceId) ?? currentService?.color }} aria-hidden="true" />
          <span className="hud-stat__value" data-stat="ride">{serviceName(network, ride.serviceId, presentation)}</span>
        </dd>
        <dt>進行方向</dt>
        <dd><span className="hud-stat__value" data-stat="direction">{directionLabel(network, ride.serviceId, ride.direction)}</span></dd>
        <dt>ターン数</dt>
        <dd><span className="hud-stat__value" data-stat="turn">{arrived.turn}</span></dd>
        <dt>踏破区間</dt>
        <dd>
          <span className="hud-stat__value" data-stat="progress">{props.displayedCompletedCount}/{props.requiredCount}</span>
        </dd>
        <dt>出目</dt>
        <dd><span className="hud-stat__value" data-stat="roll">{lastRollText(session.lastMove, network, presentation)}</span></dd>
      </dl>
      <div className="game-panel__actions">
        <button
          ref={rollButtonRef}
          type="button"
          className="game-panel__roll"
          onClick={() => { if (canRoll) props.onRoll(); }}
          aria-disabled={!canRoll}
        >
          {animating ? "移動中…" : draftItem ? "この内容でサイコロを振る" : "サイコロを振る"}
        </button>
        <button type="button" onClick={props.onSkip} disabled={!animating}>
          スキップ
        </button>
      </div>
      {draftItem && props.itemView && <div className="item-staged-summary">
        <span className="item-staged-summary__label">選択中：</span>
        <strong>{ITEM_DESCRIPTIONS[draftItem.kind].name}</strong>
        {draftItem.kind === "route-ticket" && <span>（{serviceName(network, draftItem.serviceId, presentation)}。向きは抽選）</span>}
        {draftItem.kind === "direction-ticket" && <span>（{directionLabel(network, props.itemView.position.currentServiceId, draftItem.direction)}）</span>}
        <button type="button" onClick={clearDraft} disabled={phase !== "idle"}>選択を解除</button>
        <span className="visually-hidden">Escapeキーで選択を解除できます。</span>
      </div>}
      {props.itemView && <InventoryPanel view={props.itemView} onSelect={selectItem} />}
      <div className="game-panel__options">
        <button type="button" aria-pressed={follow} onClick={props.onToggleFollow}>
          追尾: {follow ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={props.onCycleSpeed}
          disabled={reducedMotion}
          aria-label={`アニメーション速度: ${props.speedLabel}（押すと切り替え）`}
          title={reducedMotion ? "視差効果を減らす設定のためアニメーションは省略されます" : undefined}
        >
          速度: {reducedMotion ? "省略" : props.speedLabel}
        </button>
        <button type="button" onClick={props.onNewGame}>
          新規
        </button>
        <button type="button" onClick={props.onShowTitle}>
          タイトル
        </button>
      </div>
      {props.itemView && session.lastMove && phase === "idle" && <p className="item-arrival">{arrivalSummary(
        session.lastMove.itemRecord?.turn ?? game.turn, session.lastMove, props.displayedCompletedCount,
        props.requiredCount, network, presentation)}</p>}
      {props.itemView && (phase === "idle" || phase === "awaiting-discard") && <ItemEventNotice
        view={props.itemView} lastMove={session.lastMove} turn={game.turn} network={network} presentation={presentation}
      />}
      <p className="game-panel__lottery">
        <span>抽選: </span>{animating ? "移動中…" : landingText(session.lastMove, network, presentation)}
      </p>
      {!props.itemView?.decision && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>}
      <details className="game-panel__route-summary">
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
      </details>
      {!animating && candidates.length > LOTTERY_INLINE_LIMIT && (
        <details className="game-panel__candidates" key={game.turn}>
          <summary>抽選候補をすべて表示（{candidates.length}抽選枠）</summary>
          <ul>{presentation.candidateRows(candidates).map((row) => <li key={row.groupId}>{row.label}</li>)}</ul>
        </details>
      )}
      <p
        className={`game-panel__save${saveFailed ? " game-panel__save--warning" : ""}`}
        role={props.itemView ? undefined : "status"}
      >
        セーブ: {saveStatusMessage(saveStatus)}
      </p>
      <GameLegend
        lines={legendGroups}
        targetColor={targetColor}
        selectedGroupIds={selectedGroupIds}
        onToggleGroup={toggleGroup}
        onSetOperator={setOperator}
        onShowAll={showAllLineGroups}
      />
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

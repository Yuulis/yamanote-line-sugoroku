import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { PhoneGameMenu, type PhoneMenuSection } from "./PhoneGameMenu";
import { EDITIONS } from "../../editions/registry";
import type { EditionDisplay } from "../../editions/types";
import { ITEM_DESCRIPTIONS } from "../itemPresentation";
import type { TurnMomentDisplay } from "../turnMomentPresentation";
import type { OpenRules, RulesSectionId } from "../rulesGuide";
import { isFocusRestorable } from "./RulesDialog";
import { lineBadgeFor } from "../lineBadge";
import { InventoryPanel } from "./InventoryPanel";
import { GameHud } from "./GameHud";
import type { TurnMomentTargets } from "./TurnMomentHost";
import { ItemUseDialog } from "./ItemUseDialog";
import { RollAdjustment } from "./RollAdjustment";
import { ItemEventNotice } from "./ItemEventNotice";
import { DiscardChoice } from "./DiscardChoice";
import { LOG_REVEAL_PADDING_PX, TurnLogDrawer } from "./TurnLogDrawer";
import { useGameShortcuts } from "../useGameShortcuts";
import { useAutoRoll } from "../useAutoRoll";
import { PhraseText } from "./PhraseText";
import { TurnResultCard, TurnResultPill } from "./TurnResultCard";
import { PHONE_MEDIA_QUERY } from "../../map/mapConfig";
import { useTurnResultPillLayout } from "../useTurnResultPillLayout";
import { TARGET_PROXIMITY_COPY } from "../targetProximity";
import { selectAnnouncement, type NoticeAnnouncementState } from "../saveNotice";

const UPCOMING_STATION_COUNT = 5;
const LOTTERY_RULES_LABEL = "抽選のルールを詳しく見る";

/** The opener comes from the activating event (Safari does not focus a clicked button); the panel adds its fallback. */
export type PanelOpenRules = (
  sectionId: RulesSectionId | undefined, opener: HTMLElement, getFallbackFocus: () => HTMLElement | null,
) => void;

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
  /** The in-game rules dialog is open: suspends auto-roll and shortcuts and defers the decision modals. */
  rulesOpen?: boolean;
  onOpenRules?: PanelOpenRules;
  /** Key requested by ToastHost after the notice is actually displayed. */
  noticeAnnouncementKey?: string | null;
  /** Acknowledges a notice after the existing status region commits it. */
  onNoticeAnnounced?: (key: string) => void;
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

type DisclosureSurface = "log" | "menu" | "card" | "phone-menu";
type BreakpointFocusTarget =
  | { kind: "log-region" }
  | { kind: "settings-control" }
  | { kind: "surface-trigger"; section: PhoneMenuSection };

interface BreakpointLayoutContext {
  isPhone: boolean;
  activeSurface: DisclosureSurface | null;
  phoneSection: PhoneMenuSection;
}

interface PendingBreakpointFocus {
  target: BreakpointFocusTarget;
  phone: boolean;
  surface: DisclosureSurface | null;
  section: PhoneMenuSection;
}

/** Maps the open disclosure to its equivalent on the other side of the phone breakpoint. */
export function translateSurfaceForLayout(
  current: DisclosureSurface | null,
  phone: boolean,
  section: PhoneMenuSection,
): { surface: DisclosureSurface | null; section: PhoneMenuSection } {
  if (phone) {
    if (current === "log") return { surface: "phone-menu", section: "log" };
    if (current === "menu") return { surface: "phone-menu", section: "settings" };
    return { surface: current, section };
  }
  if (current !== "phone-menu") return { surface: current, section };
  return { surface: section === "settings" ? "menu" : "log", section };
}

function captureBreakpointFocusTarget(activeElement: Element | null, context: BreakpointLayoutContext): BreakpointFocusTarget | null {
  if (!(activeElement instanceof HTMLElement)) return null;
  if (activeElement.closest(".game-panel__log")) return { kind: "log-region" };
  if (activeElement.closest(".game-panel__menu")) return { kind: "settings-control" };

  const phoneSectionButton = activeElement.closest<HTMLButtonElement>(".phone-menu__sections button");
  if (phoneSectionButton) {
    return { kind: "surface-trigger", section: phoneSectionButton.textContent?.trim() === "設定" ? "settings" : "log" };
  }
  if (activeElement.closest(".phone-menu__trigger")) {
    return { kind: "surface-trigger", section: context.phoneSection };
  }
  if (activeElement.closest(".game-panel__log-trigger")) return { kind: "surface-trigger", section: "log" };
  if (activeElement.closest(".game-panel__menu-trigger")) return { kind: "surface-trigger", section: "settings" };
  return null;
}

function showAllLineGroups(): void {
  setVisibleLineGroupIds(null);
}

function phoneMediaQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_MEDIA_QUERY)
    : null;
}

function getPhoneLayoutSnapshot(): boolean {
  return phoneMediaQuery()?.matches ?? false;
}

/**
 * `matches` is live, but the MQL `change` event arrives only at the next rendering update (WebKit can lag
 * a resize by many ms). The snapshot therefore advances only from the change handler, after
 * `onBreakpointChange` has captured focus, so no unrelated render can flip the layout first.
 */
function usePhoneLayout(onBreakpointChange: (phone: boolean) => void): boolean {
  const onBreakpointChangeRef = useRef(onBreakpointChange);
  onBreakpointChangeRef.current = onBreakpointChange;
  const deliveredRef = useRef<boolean | null>(null);
  if (deliveredRef.current === null) deliveredRef.current = getPhoneLayoutSnapshot();
  const subscribe = useCallback((onChange: () => void) => {
    const query = phoneMediaQuery();
    const handleChange = (): void => {
      const next = query?.matches ?? false;
      if (next === deliveredRef.current) return;
      onBreakpointChangeRef.current(next);
      deliveredRef.current = next;
      onChange();
    };
    query?.addEventListener("change", handleChange);
    handleChange(); // a flip between the first render and this subscription has no event of its own
    return () => query?.removeEventListener("change", handleChange);
  }, []);
  const getSnapshot = useCallback(() => deliveredRef.current ?? false, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
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
  const logRegionId = useId();
  const logOpenerRef = useRef<HTMLElement | null>(null);
  const [logRevealRequest, setLogRevealRequest] = useState(0);
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
  const [activeSurface, setActiveSurface] = useState<DisclosureSurface | null>(null);
  const [phoneSection, setPhoneSection] = useState<PhoneMenuSection>("log");
  const phoneTriggerRef = useRef<HTMLButtonElement>(null);
  const layoutContextRef = useRef<BreakpointLayoutContext>({ isPhone: false, activeSurface: null, phoneSection: "log" });
  const pendingBreakpointFocusRef = useRef<PendingBreakpointFocus | null>(null);
  const isPhone = usePhoneLayout((phone) => {
    const context = layoutContextRef.current;
    if (phone === context.isPhone) return;
    const focusTarget = captureBreakpointFocusTarget(document.activeElement, context);
    const next = translateSurfaceForLayout(context.activeSurface, phone, context.phoneSection);
    pendingBreakpointFocusRef.current = focusTarget ? { target: focusTarget, phone, surface: next.surface, section: next.section } : null;
    logOpenerRef.current = null;
  });
  layoutContextRef.current = { isPhone, activeSurface, phoneSection };
  const pillActive = isPhone && turnDisplay.turnResult !== null;
  const pillPosition = useTurnResultPillLayout(panelRef, pillActive);
  const phoneLogOpen = activeSurface === "phone-menu" && phoneSection === "log";
  const phoneSettingsOpen = activeSurface === "phone-menu" && phoneSection === "settings";
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const itemDialogOpenerRef = useRef<HTMLElement | null>(null);
  const setOpenItemCard = useCallback((id: string | null) => {
    if (id) logOpenerRef.current = null;
    setOpenCardId(id);
    setActiveSurface(id ? "card" : (current => current === "card" ? null : current));
  }, []);
  const setLogExpanded = useCallback((expanded: boolean) => {
    if (expanded) { setOpenCardId(null); setActiveSurface("log"); }
    else setActiveSurface((current) => current === "log" ? null : current);
  }, []);
  const setPhoneMenuExpanded = useCallback((expanded: boolean) => {
    if (!expanded) {
      setActiveSurface((current) => current === "phone-menu" ? null : current);
      return;
    }
    logOpenerRef.current = null;
    setOpenCardId(null);
    setPhoneSection("log");
    setActiveSurface("phone-menu");
  }, []);
  const activateLogPill = useCallback((opener: HTMLButtonElement) => {
    logOpenerRef.current = opener;
    setOpenCardId(null);
    setPhoneSection("log");
    setActiveSurface("phone-menu");
    setLogRevealRequest((request) => request + 1);
  }, []);
  const wasPhoneRef = useRef(isPhone);
  useLayoutEffect(() => {
    if (wasPhoneRef.current === isPhone) return;
    wasPhoneRef.current = isPhone;
    const next = translateSurfaceForLayout(activeSurface, isPhone, phoneSection);
    logOpenerRef.current = null;
    setActiveSurface(next.surface);
    setPhoneSection(next.section);
  }, [isPhone, activeSurface, phoneSection]);
  useLayoutEffect(() => {
    const pending = pendingBreakpointFocusRef.current;
    if (!pending || pending.phone !== isPhone || pending.surface !== activeSurface || pending.section !== phoneSection) return;
    pendingBreakpointFocusRef.current = null;

    const focusTrigger = (): void => {
      if (isPhone) {
        phoneTriggerRef.current?.focus({ preventScroll: true });
        return;
      }
      const section = pending.target.kind === "surface-trigger" ? pending.target.section : pending.section;
      const triggerSelector = section === "settings" ? ".game-panel__menu-trigger" : ".game-panel__log-trigger";
      panelRef.current?.querySelector<HTMLButtonElement>(triggerSelector)?.focus({ preventScroll: true });
    };

    if (pending.target.kind === "log-region") {
      const logRegion = document.getElementById(logRegionId);
      if (logRegion && !logRegion.hidden) logRegion.focus({ preventScroll: true });
      return;
    }
    if (pending.target.kind === "settings-control") {
      const settingsRegion = panelRef.current?.querySelector<HTMLElement>(".game-panel__menu");
      const firstControl = settingsRegion?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (firstControl && firstControl.getClientRects().length > 0) firstControl.focus({ preventScroll: true });
      else focusTrigger();
      return;
    }
    focusTrigger();
  }, [isPhone, activeSurface, phoneSection, logRegionId]);
  const setMenuExpanded = useCallback((expanded: boolean) => {
    if (expanded) logOpenerRef.current = null;
    if (expanded) { setOpenCardId(null); setActiveSurface("menu"); }
    else setActiveSurface((current) => current === "menu" ? null : current);
  }, []);
  const itemDialogOpen = Boolean(itemView && itemDialog);
  // Render-time state, so the suspension holds before the dialog's own layout effect opens it.
  const rulesOpen = props.rulesOpen ?? false;
  const autoRoll = useAutoRoll({
    session,
    turnDisplay,
    surfaceOpen: activeSurface !== null,
    itemDialogOpen,
    confirmationOpen: (props.confirmationOpen ?? false) || rulesOpen,
    onRoll: props.onRoll,
  });
  const [noticeAnnouncementState, setNoticeAnnouncementState] = useState<NoticeAnnouncementState>({
    pendingKey: null,
    announcedKey: null,
    coveredOrdinary: null,
  });
  const [previousOrdinary, setPreviousOrdinary] = useState<string | null>(null);
  const committedNoticeKeyRef = useRef<string | null>(null);
  const requestedNoticeKey = props.noticeAnnouncementKey ?? noticeAnnouncementState.pendingKey;
  const announcementState = requestedNoticeKey !== null && requestedNoticeKey !== noticeAnnouncementState.pendingKey
    ? { pendingKey: requestedNoticeKey, announcedKey: null, coveredOrdinary: null }
    : { ...noticeAnnouncementState, pendingKey: requestedNoticeKey };
  const decisionOwned = turnDisplay.decision !== null || rulesOpen || (props.confirmationOpen ?? false);
  const announcement = selectAnnouncement({
    state: announcementState,
    ordinaryAnnouncement: autoRoll.announcement,
    previousOrdinary,
    decisionOwned,
  });
  useEffect(() => {
    setPreviousOrdinary(autoRoll.announcement);
    const key = announcementState.pendingKey;
    if (announcement.announcesNotice && key !== null && committedNoticeKeyRef.current !== key) {
      committedNoticeKeyRef.current = key;
      setNoticeAnnouncementState({ pendingKey: key, announcedKey: key, coveredOrdinary: autoRoll.announcement });
      props.onNoticeAnnounced?.(key);
      return;
    }
    if (noticeAnnouncementState.announcedKey !== null
      && (decisionOwned || autoRoll.announcement !== noticeAnnouncementState.coveredOrdinary)) {
      setNoticeAnnouncementState({ pendingKey: null, announcedKey: null, coveredOrdinary: null });
    }
  }, [announcement.announcesNotice, announcementState.pendingKey, autoRoll.announcement,
    decisionOwned, noticeAnnouncementState.announcedKey, noticeAnnouncementState.coveredOrdinary, props.onNoticeAnnounced]);
  useGameShortcuts({
    canRoll: turnDisplay.canRoll,
    canSkip: turnDisplay.canSkip,
    surfaceOpen: activeSurface !== null,
    itemDialogOpen: itemDialogOpen || rulesOpen,
  }, { onRoll: autoRoll.requestRoll, onSkip: props.onSkip });
  useEffect(() => {
    if (!props.onItemDialogOpenChange) return;
    props.onItemDialogOpenChange(itemDialogOpen);
    return () => props.onItemDialogOpenChange?.(false);
  }, [itemDialogOpen, props.onItemDialogOpenChange]);
  const rollButtonRef = useRef<HTMLButtonElement>(null);
  const restoreRollFocusRef = useRef(false);
  // Rules fallback when the opener is gone: the menu trigger (the phone one on phones), the dice, the heading.
  const getRulesFallbackFocus = useCallback((): HTMLElement | null => {
    const menuTrigger = phoneTriggerRef.current ?? panelRef.current?.querySelector<HTMLElement>(".game-panel__menu-trigger");
    return [menuTrigger, rollButtonRef.current, headingRef.current]
      .find((candidate) => isFocusRestorable(candidate ?? null, { allowAriaDisabled: true })) ?? null;
  }, []);
  // The one child-facing opener (menu, lottery, and the item card in 6B); the panel binds its fallback.
  const onOpenRules = props.onOpenRules;
  const openRules = useCallback<OpenRules>((sectionId, opener) => {
    onOpenRules?.(sectionId, opener, getRulesFallbackFocus);
  }, [onOpenRules, getRulesFallbackFocus]);
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
    if (logRevealRequest === 0) return;
    const panel = panelRef.current;
    const region = document.getElementById(logRegionId);
    if (!panel || !region || region.hidden) return;
    const panelRect = panel.getBoundingClientRect();
    const regionRect = region.getBoundingClientRect();
    if (regionRect.top < panelRect.top || regionRect.top >= panelRect.bottom) panel.scrollTop += regionRect.top - panelRect.top - LOG_REVEAL_PADDING_PX;
    region.focus({ preventScroll: true });
  }, [logRevealRequest, logRegionId]);

  useLayoutEffect(() => {
    if (!panelRef.current || !headingRef.current) return;
    panelRef.current.scrollTop = 0;
    if (!presentedDecision) headingRef.current.focus({ preventScroll: true });
  }, []);

  const turnLog = (
    <TurnLogDrawer
      embedded={isPhone}
      expanded={isPhone ? phoneLogOpen : activeSurface === "log"}
      onExpandedChange={isPhone ? setPhoneMenuExpanded : setLogExpanded}
      logRegionId={logRegionId}
      logOpenerRef={logOpenerRef}
      arrival={itemView ? turnDisplay.arrivalText : null}
      roll={turnDisplay.rollText}
      progress={<div className="hud-progress--log">
        <div className="hud-progress__proximity">
          <span>{turnDisplay.proximity && <PhraseText text={`${TARGET_PROXIMITY_COPY.prefix}${turnDisplay.proximity.hops}${TARGET_PROXIMITY_COPY.stationSuffix}`} />}</span>
          <span>{turnDisplay.proximity?.trend && <PhraseText text={TARGET_PROXIMITY_COPY[turnDisplay.proximity.trend]} />}</span>
        </div>
        <div className="hud-progress__collection">
          <span className="hud-progress--log__stations"><PhraseText text={turnDisplay.collection.stationsText} /></span>
          <span className="hud-progress--log__lines"><PhraseText text={turnDisplay.collection.linesText} /></span>
        </div>
      </div>}
      lottery={<div className="game-panel__lottery-row">
        <p className="game-panel__lottery"><span>抽選: </span><PhraseText text={turnDisplay.lotteryDisplayText} /></p>
        {onOpenRules && <button type="button" className="rules-opener" aria-label={LOTTERY_RULES_LABEL}
          onClick={(event) => openRules("lottery", event.currentTarget)}>詳しく</button>}
      </div>}
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
  );
  const gameMenu = (
    <GameMenu
      embedded={isPhone}
      parentTriggerRef={phoneTriggerRef}
      expanded={isPhone ? phoneSettingsOpen : activeSurface === "menu"}
      onExpandedChange={isPhone ? setPhoneMenuExpanded : setMenuExpanded}
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
      onOpenRules={onOpenRules ? openRules : undefined}
    />
  );

  return (
    <>
    <main ref={panelRef} className="game-panel" aria-label="ゲーム操作">
      <GameHud
        turnResult={<TurnResultCard model={turnDisplay.turnResult} />}
        milestoneFlash={turnDisplay.milestoneFlash}
        proximity={turnDisplay.proximity}
        collection={turnDisplay.collection}
        inventory={<>
          {itemView && <InventoryPanel
            view={itemView} openItemId={openCardId} onOpenItemChange={setOpenItemCard} onUse={activateInventoryItem}
            itemUseLocked={turnDisplay.itemUseLocked} decisionOpen={presentedDecision !== null}
            slotTargetRefs={props.turnMomentTargets?.slots} headerTargetRef={props.turnMomentTargets?.inventoryHeader}
            onOpenRules={onOpenRules ? openRules : undefined}
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
        {isPhone ? <PhoneGameMenu expanded={activeSurface === "phone-menu"} section={phoneSection} collection={turnDisplay.collection}
          openerRef={logOpenerRef} triggerRef={phoneTriggerRef} onExpandedChange={setPhoneMenuExpanded}
          onSectionChange={setPhoneSection} log={turnLog} settings={gameMenu} /> : <>{turnLog}{gameMenu}</>}
      </div>
      {!turnDisplay.decision && <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement.text}
      </p>}
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
      {/* Deferred under the rules (state retained); they mount in the same commit that unmounts the rules. */}
      {!rulesOpen && turnDisplay.decision?.kind === "adjust" && <RollAdjustment
        announcement={turnDisplay.announcement}
        decision={turnDisplay.decision}
        landings={turnDisplay.adjustmentLandings}
        onContinue={(adjustment) => props.onAdjustItemRoll?.(adjustment)}
        onSkip={props.onSkip}
        canSkip={turnDisplay.canSkip}
      />}
      {!rulesOpen && turnDisplay.decision?.kind === "discard" && <DiscardChoice
        announcement={turnDisplay.announcement}
        decision={turnDisplay.decision}
        onDiscard={(instanceId) => props.onDiscardItem?.(instanceId)}
      />}
    </main>
    <TurnResultPill model={turnDisplay.turnResult} active={pillActive} position={pillPosition}
      logRegionId={logRegionId} expanded={phoneLogOpen} onActivate={activateLogPill} />
    </>
  );
});

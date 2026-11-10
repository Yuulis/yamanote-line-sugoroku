import { createItemGame, nextStationId, playItemTurn, resolveItemDiscard, type RailwayNetwork } from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { directionLabel } from "../../../src/features/game/presentation";
import { createPresentationResolver, type PresentationResolver } from "../../../src/features/game/presentationResolver";
import type { ItemGameState, Direction } from "../../../src/types/network";
import type { RailwayBundle } from "../fixtures/bundle";

const TRAJECTORY_SEED_LIMIT = 512;
const TRAJECTORY_TURN_LIMIT = 120;
const DIRECTIONS: readonly Direction[] = [-1, 1];

function compareServiceIds(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

interface RideCandidate {
  serviceId: string;
  serviceName: string;
}

interface DirectionCandidate {
  serviceId: string;
  direction: Direction;
  directionLabel: string;
}

export interface TextWrappingState {
  readonly kind: "longest-ride" | "longest-direction";
  readonly game: ItemGameState;
  readonly serviceId: string;
  readonly direction: Direction;
  readonly serviceName: string;
  readonly directionLabel: string;
}

const rideCandidatesByVersion = new Map<string, RideCandidate>();
const directionCandidatesByVersion = new Map<string, DirectionCandidate>();
const longestRideStatesByVersion = new Map<string, TextWrappingState>();
const longestDirectionStatesByVersion = new Map<string, TextWrappingState>();
const lotteryStatesByVersion = new Map<string, ItemGameState>();

function presentationFor(bundle: RailwayBundle): PresentationResolver {
  const metadata = bundle.data.manifest.ok ? bundle.data.manifest.value.uiPresentation : undefined;
  return createPresentationResolver(bundle.network, metadata);
}

function rideCandidate(bundle: RailwayBundle): RideCandidate {
  const cached = rideCandidatesByVersion.get(bundle.network.dataVersion);
  if (cached) return cached;

  const presentation = presentationFor(bundle);
  const candidates: RideCandidate[] = [...bundle.network.servicesById.keys()]
    .map((serviceId) => ({ serviceId, serviceName: presentation.serviceName(serviceId) }))
    .filter(({ serviceId }) => DIRECTIONS.some((direction) => {
      const service = bundle.network.servicesById.get(serviceId);
      return service?.stationIds.some((stationId) => nextStopExists(bundle.network, serviceId, stationId, direction)) ?? false;
    }))
    .sort((first, second) => second.serviceName.length - first.serviceName.length
      || compareServiceIds(first.serviceId, second.serviceId));
  const selected = candidates[0];
  if (!selected) throw new Error("No real-data service has a valid next stop for the longest ride state");
  rideCandidatesByVersion.set(bundle.network.dataVersion, selected);
  return selected;
}

function directionCandidate(bundle: RailwayBundle): DirectionCandidate {
  const cached = directionCandidatesByVersion.get(bundle.network.dataVersion);
  if (cached) return cached;

  const candidates: DirectionCandidate[] = [...bundle.network.servicesById.values()]
    .flatMap((service) => DIRECTIONS.flatMap((direction): DirectionCandidate[] => {
      const hasNextStop = service.stationIds.some((stationId) => nextStopExists(bundle.network, service.id, stationId, direction));
      return hasNextStop
        ? [{ serviceId: service.id, direction, directionLabel: directionLabel(bundle.network, service.id, direction) }]
        : [];
    }))
    .sort((first, second) => second.directionLabel.length - first.directionLabel.length
      || compareServiceIds(first.serviceId, second.serviceId)
      || first.direction - second.direction);
  const selected = candidates[0];
  if (!selected) throw new Error("No real-data direction has a valid next stop for the longest direction state");
  directionCandidatesByVersion.set(bundle.network.dataVersion, selected);
  return selected;
}

function nextStopExists(network: RailwayNetwork, serviceId: string, stationId: string, direction: Direction): boolean {
  return nextStationId(network, serviceId, stationId, direction) !== undefined;
}

function playAndResolveDiscard(game: ItemGameState, network: RailwayNetwork): ItemGameState {
  const result = playItemTurn(game, {}, network);
  if (result.state.pending?.kind !== "discard") return result.state;
  return resolveItemDiscard(result.state, result.state.pending.item.id).state;
}

function findReachedState(
  bundle: RailwayBundle,
  matches: (game: ItemGameState) => boolean,
  label: string,
): ItemGameState {
  for (let seedValue = 0; seedValue < TRAJECTORY_SEED_LIMIT; seedValue += 1) {
    const seed = seedValue.toString(16).padStart(32, "0");
    let game = createItemGame(ITEM_GAME_CONFIG, seed, bundle.network);
    for (let turnIndex = 0; turnIndex < TRAJECTORY_TURN_LIMIT && game.status === "playing"; turnIndex += 1) {
      if (game.turn > 0 && matches(game)) return game;
      game = playAndResolveDiscard(game, bundle.network);
    }
  }
  throw new Error(`No seeded real-data game reached ${label}; no shorter-state fallback is allowed`);
}

function stateFor(
  bundle: RailwayBundle,
  kind: TextWrappingState["kind"],
  serviceId: string,
  direction: Direction,
  serviceName: string,
  displayDirection: string,
): TextWrappingState {
  const game = findReachedState(bundle, (candidate) => candidate.currentServiceId === serviceId
    && candidate.direction === direction, `${kind} ${serviceId} / ${displayDirection}`);
  if (nextStationId(bundle.network, game.currentServiceId, game.currentStationId, game.direction) === undefined) {
    throw new Error(`Selected ${kind} state has no next stop from ${game.currentStationId}`);
  }
  return { kind, game, serviceId, direction, serviceName, directionLabel: displayDirection };
}

export function longestRideState(bundle: RailwayBundle): TextWrappingState {
  const cached = longestRideStatesByVersion.get(bundle.network.dataVersion);
  if (cached) return cached;

  const selected = rideCandidate(bundle);
  const game = findReachedState(bundle, (candidate) => candidate.currentServiceId === selected.serviceId,
    `longest-ride ${selected.serviceId}`);
  if (nextStationId(bundle.network, game.currentServiceId, game.currentStationId, game.direction) === undefined) {
    throw new Error(`Selected longest ride state has no next stop from ${game.currentStationId}`);
  }
  const displayDirection = directionLabel(bundle.network, selected.serviceId, game.direction);
  const state: TextWrappingState = {
    kind: "longest-ride",
    game,
    serviceId: selected.serviceId,
    direction: game.direction,
    serviceName: selected.serviceName,
    directionLabel: displayDirection,
  };
  longestRideStatesByVersion.set(bundle.network.dataVersion, state);
  return state;
}

export function longestDirectionState(bundle: RailwayBundle): TextWrappingState {
  const cached = longestDirectionStatesByVersion.get(bundle.network.dataVersion);
  if (cached) return cached;

  const selected = directionCandidate(bundle);
  const serviceName = presentationFor(bundle).serviceName(selected.serviceId);
  const state = stateFor(bundle, "longest-direction", selected.serviceId, selected.direction, serviceName, selected.directionLabel);
  longestDirectionStatesByVersion.set(bundle.network.dataVersion, state);
  return state;
}

export function longLineLotteryState(bundle: RailwayBundle): ItemGameState {
  const cached = lotteryStatesByVersion.get(bundle.network.dataVersion);
  if (cached) return cached;

  const selectedServiceId = rideCandidate(bundle).serviceId;
  for (let seedValue = 0; seedValue < TRAJECTORY_SEED_LIMIT; seedValue += 1) {
    const seed = seedValue.toString(16).padStart(32, "0");
    let game = createItemGame(ITEM_GAME_CONFIG, seed, bundle.network);
    for (let turnIndex = 0; turnIndex < TRAJECTORY_TURN_LIMIT && game.status === "playing"; turnIndex += 1) {
      const result = playItemTurn(game, {}, bundle.network);
      const record = result.record;
      const selectedOptions = record?.landingSnapshot?.services.find(({ serviceId }) => serviceId === selectedServiceId);
      const hasLottery = (record?.landingSnapshot?.services.length ?? 0) > 1
        || (selectedOptions?.directions.length ?? 0) > 1;
      if (record?.landing?.serviceId === selectedServiceId && hasLottery) {
        lotteryStatesByVersion.set(bundle.network.dataVersion, game);
        return game;
      }
      game = result.state.pending?.kind === "discard"
        ? resolveItemDiscard(result.state, result.state.pending.item.id).state
        : result.state;
    }
  }
  throw new Error("No seeded real-data lottery revealed the longest display name; no shorter-state fallback is allowed");
}

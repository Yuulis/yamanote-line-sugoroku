export type GameEngineErrorCode =
  | "INVALID_ROLL"
  | "GAME_NOT_PLAYING"
  | "INVALID_STATE"
  | "INVALID_NETWORK"
  | "INVALID_CONFIG"
  | "INVALID_SEED"
  | "INVALID_SAVE"
  | "UNSUPPORTED_SAVE_VERSION"
  | "DATA_VERSION_MISMATCH"
  | "INVALID_RNG_STATE";

/** The single error type thrown by the game engine; branch on `code`. */
export class GameEngineError extends Error {
  readonly code: GameEngineErrorCode;

  constructor(code: GameEngineErrorCode, message: string) {
    super(message);
    this.name = "GameEngineError";
    this.code = code;
  }
}

export function isGameEngineError(
  error: unknown,
  code?: GameEngineErrorCode,
): error is GameEngineError {
  if (!(error instanceof GameEngineError)) return false;
  return code === undefined || error.code === code;
}

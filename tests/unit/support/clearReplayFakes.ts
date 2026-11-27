import type { FrameScheduler } from "../../../src/features/game/animation/runner";
import type { ReplayVisibility } from "../../../src/features/game/clearReplayStore";

export class FakeScheduler implements FrameScheduler {
  private nextHandle = 1;
  private callbacks = new Map<number, (now: number) => void>();
  readonly staleCallbacks = new Map<number, (now: number) => void>();
  time = 0;

  request(callback: (now: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    const callback = this.callbacks.get(handle);
    if (callback) this.staleCallbacks.set(handle, callback);
    this.callbacks.delete(handle);
  }

  now(): number { return this.time; }

  frameAt(time: number): void {
    this.time = time;
    const entry = this.callbacks.entries().next().value as [number, (now: number) => void] | undefined;
    if (!entry) return;
    this.callbacks.delete(entry[0]);
    entry[1](time);
  }

  advance(milliseconds: number): void { this.frameAt(this.time + milliseconds); }

  get liveFrameCount(): number { return this.callbacks.size; }

  fireStale(time: number): void {
    this.time = time;
    const callback = this.staleCallbacks.values().next().value as ((now: number) => void) | undefined;
    callback?.(time);
  }
}

export class FakeVisibility implements ReplayVisibility {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "visibilitychange", listener: () => void): void { this.listeners.delete(listener); }
  change(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
  get listenerCount(): number { return this.listeners.size; }
}

/**
 * SyncQueue — Priority queue ordered by scheduled audio time.
 *
 * Commands are inserted with a `scheduledTime` (in AudioContext seconds)
 * and drained in order when the audio clock reaches their time.
 * Uses binary search for O(log n) insertion into a sorted array.
 *
 * Thread Safety Note:
 * This queue is single-threaded (main thread JS). The rAF loop is the
 * only consumer, and producers (WebSocket/DataChannel handlers) enqueue
 * synchronously. No locking needed.
 */
import type { DrawCommand } from '../types';

export class SyncQueue {
  private queue: DrawCommand[] = [];
  private _flushedCount = 0;
  private _drainedCount = 0;

  /**
   * Inserts a command in sorted order by scheduledTime.
   * O(log n) via binary search.
   */
  enqueue(command: DrawCommand): void {
    const idx = this.findInsertIndex(command.scheduledTime);
    this.queue.splice(idx, 0, command);
  }

  /**
   * Inserts multiple commands efficiently.
   * Sorts the batch first, then merges with the existing queue.
   */
  enqueueBatch(commands: DrawCommand[]): void {
    if (commands.length === 0) return;
    for (const cmd of commands) {
      this.enqueue(cmd);
    }
  }

  /**
   * Returns and removes all commands whose scheduledTime <= currentAudioTime.
   * Returns them in chronological order.
   */
  drain(currentAudioTime: number): DrawCommand[] {
    const ready: DrawCommand[] = [];
    while (this.queue.length > 0 && this.queue[0].scheduledTime <= currentAudioTime) {
      ready.push(this.queue.shift()!);
    }
    this._drainedCount += ready.length;
    return ready;
  }

  /**
   * Peeks at the next command without removing it.
   * Returns null if the queue is empty.
   */
  peek(): DrawCommand | null {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  /**
   * Returns the time of the next scheduled command (or Infinity if empty).
   * Useful for the scheduler to know when the next event will fire.
   */
  get nextEventTime(): number {
    return this.queue.length > 0 ? this.queue[0].scheduledTime : Infinity;
  }

  /**
   * Removes all commands belonging to a specific commit group.
   * Used during barge-in to remove uncommitted commands.
   */
  removeByCommitGroup(commitGroup: string): DrawCommand[] {
    const removed: DrawCommand[] = [];
    this.queue = this.queue.filter((cmd) => {
      if (cmd.commitGroup === commitGroup) {
        removed.push(cmd);
        return false;
      }
      return true;
    });
    return removed;
  }

  /**
   * Clears all pending commands.
   */
  flush(): void {
    this._flushedCount += this.queue.length;
    this.queue = [];
  }

  get length(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** Total commands drained since creation (for telemetry) */
  get totalDrained(): number {
    return this._drainedCount;
  }

  /** Total commands flushed/discarded since creation (for telemetry) */
  get totalFlushed(): number {
    return this._flushedCount;
  }

  /**
   * Binary search for the insertion index to maintain sorted order.
   */
  private findInsertIndex(time: number): number {
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.queue[mid].scheduledTime < time) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}

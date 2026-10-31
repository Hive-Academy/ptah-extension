/**
 * Tracks the effective host-routing configuration by its live value, so a
 * change counts from the first read that sees it rather than from its change
 * event (TASK_2026_857, phase B fix round 2).
 *
 * Electron applies a settings write in memory, persists it, and only then
 * fires the change event, so the event can trail the value it announces. The
 * coordinator calls `observe` on every admission and settlement: a live value
 * that differs from the last observed one is a configuration change. When the
 * change event arrives, `onEvent` decides whether it still needs a reset:
 *  - the live value differs from the last observed one: reset;
 *  - an earlier read already saw an unannounced change: no reset, because
 *    this event announces that change and work admitted under the current
 *    value must be kept;
 *  - otherwise reset: an off and an on both landed before any read, so the
 *    value reads the same but earlier work must still be cancelled.
 *
 * A change that never fires an event (a write through the settings store, or
 * a failed persist that restores the old value) leaves its count behind, so
 * a later coalesced off/on pair is then announced without a reset.
 */
export class HostRoutingConfigTracker {
  /** `null` until the first read. */
  private stamp: string | null = null;
  private unannounced = 0;

  constructor(private readonly read: () => string) {}

  /** True when the live configuration differs from the last observed one. */
  observe(): boolean {
    if (!this.update()) return false;
    this.unannounced += 1;
    return true;
  }

  /** True when an arriving change event must reset routing work. */
  onEvent(): boolean {
    if (this.update() || this.unannounced === 0) return true;
    this.unannounced -= 1;
    return false;
  }

  /** Reads the live value; true when it differs from a known earlier one. */
  private update(): boolean {
    const live = this.read();
    const previous = this.stamp;
    this.stamp = live;
    return previous !== null && previous !== live;
  }
}

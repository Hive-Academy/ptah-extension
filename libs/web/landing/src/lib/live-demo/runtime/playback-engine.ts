import type { ReplayControls, ReplayMessage, ReplayMiss, ReplayScenarioData, ReplayState } from './types';
import { shiftRecordedTimes } from './time-shift';

export class PlaybackEngine implements ReplayControls {
  readonly misses: ReplayMiss[] = [];
  readonly state: ReplayState;
  private scenarioData: ReplayScenarioData | null = null;
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pulse: ReturnType<typeof setInterval> | null = null;
  private started = 0;
  private startElapsed = 0;
  private playRequested = false;

  constructor(id: string, speed: number, private readonly inject: (message: ReplayMessage) => void,
    private readonly changed: (state: ReplayState) => void) {
    this.state = { scenario: id, ready: false, waitingForSend: false, booted: false, paused: false, readyAt: null, playing: false, complete: false,
      elapsed: 0, duration: 0, speed: Math.min(8, Math.max(0.25, Number.isFinite(speed) ? speed : 1)) };
  }
  load(scenario: ReplayScenarioData): void {
    this.scenarioData = scenario;
    this.state.waitingForSend = scenario.start?.mode === 'on-send';
    this.state.duration = scenario.timeline.at(-1)?.at ?? 0;
    this.changed(this.state);
  }
  ready(at: number): void { this.state.readyAt = at; this.changed(this.state); }
  boot(autoplay: boolean): void {
    if (this.state.booted || this.state.error) return;
    this.state.booted = true;
    this.state.ready = true;
    this.changed(this.state);
    if ((autoplay || this.playRequested) && !this.state.paused) this.play();
  }
  fail(code: string, message: string): void {
    if (this.state.playing) this.pause();
    this.state.error = `${code}: ${message}`;
    this.changed(this.state);
  }
  report(kind: ReplayMiss['kind'], value: string): void {
    this.misses.push({ kind, value, at: Date.now() });
    this.changed(this.state);
  }
  private currentElapsed(): number {
    return this.state.playing ? Math.min(this.state.duration, this.startElapsed + (performance.now() - this.started) * this.state.speed) : this.state.elapsed;
  }
  private schedule(): void {
    const item = this.scenarioData?.timeline[this.index];
    if (!item) { this.finish(); return; }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.state.elapsed = item.at;
      this.index++;
      this.inject(item.message);
      if (this.index >= (this.scenarioData?.timeline.length ?? 0)) this.finish();
      else { this.changed(this.state); this.schedule(); }
    }, Math.max(0, (item.at - this.currentElapsed()) / this.state.speed));
  }
  private finish(): void {
    this.state.elapsed = this.state.duration;
    this.state.playing = false;
    this.state.complete = true;
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = null;
    this.changed(this.state);
  }
  sent(): void {
    if (!this.state.waitingForSend || !this.scenarioData) return;
    const { timeBase, timeline } = this.scenarioData;
    const sentAt = Date.now();
    this.scenarioData.timeline = timeline.map((entry) => ({
      ...entry, message: shiftRecordedTimes(entry.message, timeBase, sentAt),
    }));
    this.state.waitingForSend = false;
    this.changed(this.state);
    this.play();
  }
  play(): void {
    if (this.state.waitingForSend) return;
    if (!this.state.booted) {
      this.playRequested = true;
      this.state.paused = false;
      this.changed(this.state);
      return;
    }
    if (!this.state.ready || !this.scenarioData || this.state.error || this.state.playing || this.state.complete) return;
    this.state.paused = false;
    this.started = performance.now(); this.startElapsed = this.state.elapsed;
    this.state.playing = true;
    this.pulse = setInterval(() => { this.state.elapsed = this.currentElapsed(); this.changed(this.state); }, 250);
    this.changed(this.state);
    this.schedule();
  }
  pause(): void {
    if (!this.state.booted) {
      this.playRequested = false;
      this.state.paused = true;
      this.changed(this.state);
      return;
    }
    if (!this.state.playing) return;
    this.state.elapsed = this.currentElapsed();
    this.state.playing = false;
    this.state.paused = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pulse) clearInterval(this.pulse);
    this.timer = null; this.pulse = null;
    this.changed(this.state);
  }
  setSpeed(value: number): void {
    if (!Number.isFinite(value)) return;
    const playing = this.state.playing;
    if (playing) this.pause();
    this.state.speed = Math.min(8, Math.max(0.25, value));
    this.changed(this.state);
    if (playing) this.play();
  }
  restart(): void { location.reload(); }
}

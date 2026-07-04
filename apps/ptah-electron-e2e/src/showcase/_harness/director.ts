import type { ElectronApplication, Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Beat,
  SceneManifest,
  Shot,
  ShotFocusRect,
  ShotsFile,
} from '@ptah-extension/showcase-manifest';

/**
 * Director — cinematic helper for recording marketing scenes.
 *
 * Playwright drives Electron through CDP, which means real OS-level cursor
 * motion and human typing cadence are absent by default — fine for assertions,
 * bad for video. The Director adds the polish a viewer expects:
 *
 * - a synthetic cursor overlay that follows dispatched mouse events,
 * - smooth, eased pointer travel to a target before clicking,
 * - human-paced typing (characters-per-second, not instant fill),
 * - lower-third caption overlays for narration beats,
 * - generous "hold" beats so the eye can keep up,
 * - long waits for real agent turns to finish (LLM inference is slow).
 *
 * All overlays are injected into the page DOM with `pointer-events: none` so
 * they never intercept clicks, and they are re-injected after navigation via
 * `installOverlays()`.
 */
export interface DirectorOptions {
  /** Typing speed in characters per second. Default 22 (natural, readable). */
  cps?: number;
  /** Default hold duration in ms between beats. Default 900. */
  beatMs?: number;
  /** Max time to wait for a single agent turn to finish, ms. Default 6 min. */
  agentTimeoutMs?: number;
  /** Scene slug (e.g. "editor-tour") stamped onto every recorded beat. */
  scene?: string;
  /** Playwright test title, surfaced in the manifest for intro-card copy. */
  title?: string;
  /** Capture resolution, threaded in from the launcher for the manifest. */
  res?: { width: number; height: number };
  /**
   * Ordered narration lines from `scripts/<scene>.json` — the audio-first VO
   * source of truth `say()` speaks from.
   */
  script?: string[];
  /**
   * Real per-line clip durations (ms) from a pre-capture `narrate` run
   * (durations.json), indexed like `script`. When present, `say()` holds for
   * the ACTUAL audio length instead of a chars-per-ms estimate — this is what
   * kills the silent gaps / clipped lines of the capture-first flow.
   */
  clipDurationsMs?: (number | null)[];
}

const OVERLAY_INIT = `
(() => {
  if (window.__ptahDirector) return;
  const cursor = document.createElement('div');
  cursor.id = 'ptah-director-cursor';
  Object.assign(cursor.style, {
    position: 'fixed', left: '0px', top: '0px', width: '22px', height: '22px',
    zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-3px, -3px)',
    transition: 'opacity 120ms ease', opacity: '1',
    background: 'no-repeat center/contain',
    backgroundImage: "url(\\"data:image/svg+xml;utf8," +
      encodeURIComponent('<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'22\\' height=\\'22\\' viewBox=\\'0 0 22 22\\'><path d=\\'M2 2 L2 17 L6 13 L9 20 L12 19 L9 12 L15 12 Z\\' fill=\\'white\\' stroke=\\'black\\' stroke-width=\\'1.2\\'/></svg>') + "\\")",
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
  });
  document.body.appendChild(cursor);

  const ring = document.createElement('div');
  ring.id = 'ptah-director-ring';
  Object.assign(ring.style, {
    position: 'fixed', left: '0px', top: '0px', width: '10px', height: '10px',
    borderRadius: '50%', border: '2px solid rgba(99,102,241,0.9)',
    zIndex: '2147483646', pointerEvents: 'none', opacity: '0',
    transform: 'translate(-50%, -50%) scale(1)',
  });
  document.body.appendChild(ring);

  const caption = document.createElement('div');
  caption.id = 'ptah-director-caption';
  Object.assign(caption.style, {
    position: 'fixed', left: '50%', bottom: '6%', transform: 'translateX(-50%) translateY(20px)',
    maxWidth: '70%', padding: '14px 26px', borderRadius: '14px',
    font: '600 26px/1.3 Inter, system-ui, -apple-system, sans-serif',
    color: 'white', textAlign: 'center', background: 'rgba(17,18,28,0.82)',
    backdropFilter: 'blur(8px)', boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
    zIndex: '2147483645', pointerEvents: 'none', opacity: '0',
    transition: 'opacity 280ms ease, transform 280ms ease',
  });
  document.body.appendChild(caption);

  const spot = document.createElement('div');
  spot.id = 'ptah-director-spotlight';
  Object.assign(spot.style, {
    position: 'fixed', left: '0px', top: '0px', width: '0px', height: '0px',
    borderRadius: '12px', border: '2px solid rgba(129,140,248,0.95)',
    boxShadow: '0 0 0 3px rgba(99,102,241,0.35), 0 0 22px 6px rgba(99,102,241,0.55)',
    zIndex: '2147483644', pointerEvents: 'none', opacity: '0',
    transition: 'opacity 220ms ease, left 320ms ease, top 320ms ease, width 320ms ease, height 320ms ease',
  });
  document.body.appendChild(spot);

  const move = (x, y) => {
    cursor.style.left = x + 'px';
    cursor.style.top = y + 'px';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
  };
  document.addEventListener('mousemove', (e) => move(e.clientX, e.clientY), true);

  window.__ptahDirector = {
    pulse: () => {
      ring.style.transition = 'none';
      ring.style.opacity = '0.9';
      ring.style.transform = 'translate(-50%, -50%) scale(1)';
      requestAnimationFrame(() => {
        ring.style.transition = 'opacity 450ms ease, transform 450ms ease';
        ring.style.opacity = '0';
        ring.style.transform = 'translate(-50%, -50%) scale(3.4)';
      });
    },
    caption: (text) => {
      caption.textContent = text;
      caption.style.opacity = '1';
      caption.style.transform = 'translateX(-50%) translateY(0)';
    },
    clearCaption: () => {
      caption.style.opacity = '0';
      caption.style.transform = 'translateX(-50%) translateY(20px)';
    },
    spotlight: (r) => {
      spot.style.left = r.x - 6 + 'px';
      spot.style.top = r.y - 6 + 'px';
      spot.style.width = r.width + 12 + 'px';
      spot.style.height = r.height + 12 + 'px';
      spot.style.opacity = '1';
    },
    clearSpotlight: () => {
      spot.style.opacity = '0';
    },
  };
})();
`;

export class Director {
  private readonly cps: number;
  private readonly beatMs: number;
  private readonly agentTimeoutMs: number;
  private cursorX = -50;
  private cursorY = -50;

  /** Wall-clock baseline (Date.now()) captured at construction. */
  private readonly recordStartMs = Date.now();
  /**
   * When set (via `PTAH_SHOWCASE_SILENT_CAPTIONS=1`), beats are still recorded
   * but the baked lower-third overlay is never drawn — Remotion owns captions.
   */
  private readonly silentCaptions =
    process.env['PTAH_SHOWCASE_SILENT_CAPTIONS'] === '1';
  /** Machine-readable timeline, one entry per non-clear caption() call. */
  private readonly beats: Beat[] = [];
  /**
   * Virtual-camera track, auto-emitted from every targeted interaction
   * (spotlight/hover/click and element-targeted caption). Flushed to
   * `shots.json` iff at least one shot was recorded (see `flushShots`).
   */
  private readonly shots: Shot[] = [];
  /**
   * Center (in capture px) + wall-clock time of the last recorded shot, used to
   * debounce consecutive interactions that target essentially the same region.
   */
  private lastShotAt: { x: number; y: number; tMs: number } | null = null;
  private readonly scene: string;
  private readonly title: string;
  private readonly res: { width: number; height: number };
  private readonly script: string[];
  private readonly clipDurationsMs: (number | null)[];

  constructor(
    private readonly app: ElectronApplication,
    public readonly page: Page,
    opts: DirectorOptions = {},
  ) {
    this.cps = opts.cps ?? 22;
    this.beatMs = opts.beatMs ?? 900;
    this.agentTimeoutMs = opts.agentTimeoutMs ?? 6 * 60_000;
    this.scene = opts.scene ?? 'unknown';
    this.title = opts.title ?? '';
    this.res = opts.res ?? { width: 1920, height: 1080 };
    this.script = opts.script ?? [];
    this.clipDurationsMs = opts.clipDurationsMs ?? [];
  }

  /** Inject (or re-inject after navigation) the cursor + caption overlays. */
  async installOverlays(): Promise<void> {
    await this.page.evaluate(OVERLAY_INIT);
    await this.page.mouse.move(this.cursorX, this.cursorY, { steps: 1 });
  }

  /** Hold on a frame so the viewer can read/absorb. */
  async hold(ms = this.beatMs): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Show a lower-third caption. Pass empty/undefined to clear.
   *
   * A non-clear call ALWAYS records a beat into the machine-readable timeline
   * (regardless of `silentCaptions`). The baked overlay is only drawn when
   * captions are not silenced, so `PTAH_SHOWCASE_SILENT_CAPTIONS=1` produces
   * footage with no lower-third text while still emitting `beats.json`.
   *
   * When `target` is supplied the caption also records a virtual-camera shot
   * from that element's box (same as spotlight/hover/click), so a narration
   * beat that refers to a control auto-punches the camera onto it. The base
   * `caption(text)` signature keeps working unchanged.
   */
  async caption(
    text?: string,
    target?: Locator,
    scriptIndex?: number,
  ): Promise<void> {
    if (!text) {
      await this.page.evaluate(() => window.__ptahDirector?.clearCaption());
      return;
    }
    if (target) {
      const box = await this.boxOf(target);
      if (box) this.recordShot(box);
    }
    this.beats.push({
      tMs: Date.now() - this.recordStartMs,
      text,
      scene: this.scene,
      ...(scriptIndex !== undefined ? { scriptIndex } : {}),
    });
    if (!this.silentCaptions) {
      await this.page.evaluate((t) => window.__ptahDirector?.caption(t), text);
    }
  }

  /**
   * Speak script line `index` with audio-locked pacing — the audio-first
   * replacement for the `caption(text); hold(voHold(text)); caption()`
   * pattern (whose chars-per-ms guess is what produced silent gaps and
   * clipped lines).
   *
   * Captions the line (recording a beat tagged with `scriptIndex`, so the
   * render maps this beat to `wav/{index+1}.wav` even when earlier
   * conditional beats were skipped), runs the optional `during` interaction,
   * then holds until the line's REAL narration clip (pre-generated by
   * `narrate.mjs` from `scripts/<scene>.json`) has fully played plus a
   * breath. Falls back to the legacy estimate when no durations.json exists
   * (e.g. a dry capture before narration).
   *
   * `target` punches the virtual camera onto an element for this beat, same
   * as `caption(text, target)`.
   */
  async say(
    index: number,
    opts: {
      during?: () => Promise<void>;
      target?: Locator;
      breathMs?: number;
    } = {},
  ): Promise<void> {
    const line = this.script[index];
    if (!line) {
      throw new Error(
        `[Director] say(${index}): scene "${this.scene}" has no script line ` +
          `${index} (script has ${this.script.length} lines).`,
      );
    }
    await this.caption(line, opts.target, index);
    // Clock starts AT the beat stamp — the render places this line's audio at
    // beat.tMs, so elapsed must be measured from there. Measuring earlier
    // (before caption's target lookup) silently shortens the hold and lets the
    // next beat start before this clip has finished.
    const startedMs = Date.now();
    if (opts.during) await opts.during();
    const clipMs =
      this.clipDurationsMs[index] ?? Math.round(line.length * 65) + 500;
    const breathMs = opts.breathMs ?? 350;
    const elapsedMs = Date.now() - startedMs;
    await this.hold(Math.max(0, clipMs + breathMs - elapsedMs));
    await this.caption();
  }

  /**
   * Write the recorded timeline to `outPath` as pretty JSON. Called from the
   * `director` fixture teardown while the page is still alive (before the app
   * closes and Playwright flushes the `.webm`).
   */
  async flushBeats(outPath: string): Promise<void> {
    const manifest: SceneManifest = {
      scene: this.scene,
      title: this.title,
      recordStartMs: this.recordStartMs,
      durationMs: Date.now() - this.recordStartMs,
      res: this.res,
      beats: this.beats,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  /**
   * Write the auto-emitted virtual-camera track to `outPath` as `shots.json`.
   * Mirrors `flushBeats` and is wired into the same fixture teardown.
   *
   * Guards against clobbering hand-authored tracks:
   *   - If THIS run recorded no shots, do nothing (a reverse-engineered scene's
   *     hand-authored shots.json must survive).
   *   - Even with recorded shots, never overwrite an existing shots.json unless
   *     this run captured ≥1 shot (the check above already guarantees that, so
   *     an existing file is only replaced by a fresh designed capture).
   * `render-all.mjs` reads this file's `shots` array with no render changes.
   */
  async flushShots(outPath: string): Promise<void> {
    if (this.shots.length === 0) return;
    const file: ShotsFile = {
      scene: this.scene,
      shots: this.shots,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(file, null, 2), 'utf8');
  }

  /**
   * Dismiss any blocking startup dialogs (e.g. the license / trial-ended modal)
   * so they stay out of frame. Best-effort: clicks the first visible match from
   * a list of known dismiss affordances, repeating until none remain.
   */
  async dismissDialogs(): Promise<void> {
    const labels = ['Maybe Later', 'Dismiss', 'Not now', 'Close', 'close'];
    for (let pass = 0; pass < 4; pass++) {
      let dismissed = false;
      for (const label of labels) {
        const btn = this.page.getByRole('button', { name: label, exact: true });
        if (
          await btn
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          await btn
            .first()
            .click({ timeout: 5_000 })
            .catch(() => undefined);
          await this.hold(250);
          dismissed = true;
          break;
        }
      }
      if (!dismissed) return;
    }
  }

  /**
   * Resolve a target's on-screen box, retrying briefly while it animates/mounts
   * in. Returns null if the element never gains a non-zero box (hidden, zero-
   * area, or detached) — callers decide whether that's fatal.
   */
  private async boxOf(
    target: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    for (let i = 0; i < 6; i++) {
      const box = await target.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) return box;
      await this.hold(150);
    }
    return null;
  }

  /**
   * Record a virtual-camera shot from an element's on-screen box.
   *
   * Coordinate model — this MUST match the render side exactly:
   *   - `fromMs` uses the SAME clock as `Beat.tMs`: `Date.now() - recordStartMs`
   *     (wall-clock ms from record start). Remotion places the body footage,
   *     the VO/beats, and the camera all inside one rebased `<Series.Sequence>`,
   *     where the footage's frame 0 aligns with body-local 0. Footage time,
   *     beat time, and shot `fromMs` are therefore one and the same coordinate.
   *     (See `render-all.mjs`, `ShowcaseVideo.tsx` <Series>, and
   *     `BodyScene`/`DeviceFrame` where `nowMs = frame/fps*1000` is body-local.)
   *   - x,w are normalized over the capture WIDTH; y,h over the CONTENT HEIGHT.
   *     With Task 1's exact-viewport fix content height == full frame height, but
   *     we normalize against the measured viewport height (`this.res.height`)
   *     defensively so a residual gray band never skews the rects — DeviceFrame
   *     maps 0..1 over the CROPPED content card, which is that measured height.
   *
   * Heuristics per the roadmap:
   *   - focus = element box padded ~13% each side, clamped to 0..1.
   *   - ring  = tight element box, ~5px pad.
   *   - captionPos = 'top' when the element center is in the lower half.
   *   - boxes covering >70% of the frame → a full-frame shot (no focus) so the
   *     camera eases back out (no point zooming into ~everything).
   *   - debounce: consecutive shots on essentially the same region within
   *     <1200ms keep the first (drop the later duplicate).
   */
  private recordShot(box: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    const capW = this.res.width;
    const capH = this.res.height;
    const tMs = Date.now() - this.recordStartMs;

    // Degenerate boxes (scrollbars, dividers, collapsed rails — under ~3% of
    // the frame on either axis) are never a real camera subject: skip them so
    // the virtual camera doesn't punch onto a sliver.
    if (box.width < capW * 0.03 || box.height < capH * 0.03) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Debounce: same region (within a quarter of the frame) fired recently.
    if (this.lastShotAt) {
      const near =
        Math.abs(centerX - this.lastShotAt.x) < capW * 0.25 &&
        Math.abs(centerY - this.lastShotAt.y) < capH * 0.25;
      if (near && tMs - this.lastShotAt.tMs < 1200) return;
    }

    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

    // Fraction of the frame the raw element box covers.
    const coverage = (box.width / capW) * (box.height / capH);

    let shot: Shot;
    if (coverage > 0.7) {
      // Element ~fills the frame — ease the camera back out instead of zooming.
      shot = { fromMs: tMs };
    } else {
      const padX = box.width * 0.13;
      const padY = box.height * 0.13;
      const focus: ShotFocusRect = {
        x: clamp01((box.x - padX) / capW),
        y: clamp01((box.y - padY) / capH),
        w: clamp01((box.width + padX * 2) / capW),
        h: clamp01((box.height + padY * 2) / capH),
      };
      const ringPad = 5;
      const ring: ShotFocusRect = {
        x: clamp01((box.x - ringPad) / capW),
        y: clamp01((box.y - ringPad) / capH),
        w: clamp01((box.width + ringPad * 2) / capW),
        h: clamp01((box.height + ringPad * 2) / capH),
      };
      shot = { fromMs: tMs, focus, ring };
      // Lift the caption off a close-up sitting in the lower half of the frame.
      if (centerY > capH / 2) shot.captionPos = 'top';
    }

    this.shots.push(shot);
    this.lastShotAt = { x: centerX, y: centerY, tMs };
  }

  /** Smoothly ease the synthetic cursor to the center of a target. */
  async moveTo(target: Locator): Promise<void> {
    const box = await this.boxOf(target);
    if (!box) throw new Error('[Director] moveTo: target has no bounding box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const dist = Math.hypot(x - this.cursorX, y - this.cursorY);
    const steps = Math.max(12, Math.min(60, Math.round(dist / 14)));
    await this.page.mouse.move(x, y, { steps });
    this.cursorX = x;
    this.cursorY = y;
  }

  /** Move to a target, pulse a click ring, then click it. */
  async click(target: Locator): Promise<void> {
    await this.moveTo(target);
    const box = await this.boxOf(target);
    if (box) this.recordShot(box);
    await this.hold(250);
    await this.page.evaluate(() => window.__ptahDirector?.pulse());
    await target.click();
    await this.hold(300);
  }

  /**
   * Type into a field at a human cadence. Focuses via a click first so the
   * caret is visible, then emits characters one at a time.
   */
  async type(target: Locator, text: string): Promise<void> {
    await this.click(target);
    const delay = Math.round(1000 / this.cps);
    await target.pressSequentially(text, { delay });
    await this.hold(400);
  }

  /**
   * Ease the cursor onto a target and dwell, without clicking. Decorative — if
   * the target has no on-screen box it degrades to a plain hold rather than
   * throwing, so a missing flourish never kills a scene.
   */
  async hover(target: Locator, dwellMs = 600): Promise<void> {
    const box = await this.boxOf(target);
    if (box) {
      this.recordShot(box);
      await this.page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2,
        { steps: 24 },
      );
      this.cursorX = box.x + box.width / 2;
      this.cursorY = box.y + box.height / 2;
    }
    await this.hold(dwellMs);
  }

  /**
   * Draw a glowing spotlight ring around a target for `ms`, then clear it.
   * Great for drawing the eye to a control on social-media footage.
   */
  async spotlight(target: Locator, ms = 1600): Promise<void> {
    const box = await this.boxOf(target);
    if (!box) return;
    this.recordShot(box);
    await this.page.evaluate((r) => window.__ptahDirector?.spotlight(r), box);
    await this.hold(ms);
    await this.page.evaluate(() => window.__ptahDirector?.clearSpotlight());
    await this.hold(180);
  }

  /**
   * Smoothly pan a scrollable region top→bottom (and optionally back) so the
   * camera reveals long content. Resolves the best scroll container from the
   * target: the element or a scrollable ancestor, else the tallest scrollable
   * descendant, else the document. With no target, scrolls the page.
   */
  async scrollThrough(
    target?: Locator,
    opts: { steps?: number; dwellMs?: number; andBack?: boolean } = {},
  ): Promise<void> {
    const steps = opts.steps ?? 6;
    const dwellMs = opts.dwellMs ?? 650;
    const andBack = opts.andBack ?? true;
    const handle = target ?? this.page.locator('body');

    const setFrac = (frac: number) =>
      handle.evaluate((el: Element, f: number) => {
        const scrollable = (node: Element): Element => {
          let cur: Element | null = node;
          while (cur) {
            const cs = getComputedStyle(cur);
            if (
              /(auto|scroll)/.test(cs.overflowY) &&
              cur.scrollHeight > cur.clientHeight + 4
            ) {
              return cur;
            }
            cur = cur.parentElement;
          }
          let best: Element = document.scrollingElement ?? document.body;
          let bestDelta = best.scrollHeight - best.clientHeight;
          node.querySelectorAll('*').forEach((d) => {
            const delta = d.scrollHeight - d.clientHeight;
            if (
              delta > bestDelta &&
              /(auto|scroll)/.test(getComputedStyle(d).overflowY)
            ) {
              best = d;
              bestDelta = delta;
            }
          });
          return best;
        };
        const sc = scrollable(el);
        const max = sc.scrollHeight - sc.clientHeight;
        sc.scrollTo({ top: max * f, behavior: 'smooth' });
      }, frac);

    for (let i = 1; i <= steps; i++) {
      await setFrac(i / steps);
      await this.hold(dwellMs);
    }
    if (andBack) {
      await setFrac(0);
      await this.hold(dwellMs);
    }
  }

  /** Mouse-wheel at the current cursor position (positive dy scrolls down). */
  async wheel(dy: number): Promise<void> {
    await this.page.mouse.wheel(0, dy);
    await this.hold(400);
  }

  /**
   * Wait for a single real agent turn to finish within a scope (a tile or the
   * whole page). The chat input swaps the send button for a stop button while
   * streaming, then back — so we wait for the stop button to appear (turn
   * started) and then detach (turn complete). Tolerates a turn that finishes
   * faster than we can observe the stop button.
   */
  async waitForAgentTurn(scope?: Locator): Promise<void> {
    const root = scope ?? this.page.locator('body');
    const stop = root.locator('[data-testid="chat-stop-btn"]');
    await stop
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => undefined);
    await stop
      .first()
      .waitFor({ state: 'detached', timeout: this.agentTimeoutMs });
  }
}

declare global {
  interface Window {
    __ptahDirector?: {
      pulse: () => void;
      caption: (text: string) => void;
      clearCaption: () => void;
      spotlight: (rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => void;
      clearSpotlight: () => void;
    };
  }
}

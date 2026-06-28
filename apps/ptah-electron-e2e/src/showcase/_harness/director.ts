import type { ElectronApplication, Locator, Page } from '@playwright/test';

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
  };
})();
`;

export class Director {
  private readonly cps: number;
  private readonly beatMs: number;
  private readonly agentTimeoutMs: number;
  private cursorX = -50;
  private cursorY = -50;

  constructor(
    private readonly app: ElectronApplication,
    public readonly page: Page,
    opts: DirectorOptions = {},
  ) {
    this.cps = opts.cps ?? 22;
    this.beatMs = opts.beatMs ?? 900;
    this.agentTimeoutMs = opts.agentTimeoutMs ?? 6 * 60_000;
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

  /** Show a lower-third caption. Pass empty/undefined to clear. */
  async caption(text?: string): Promise<void> {
    if (!text) {
      await this.page.evaluate(() => window.__ptahDirector?.clearCaption());
      return;
    }
    await this.page.evaluate((t) => window.__ptahDirector?.caption(t), text);
  }

  /** Smoothly ease the synthetic cursor to the center of a target. */
  async moveTo(target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await target.boundingBox();
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
    };
  }
}

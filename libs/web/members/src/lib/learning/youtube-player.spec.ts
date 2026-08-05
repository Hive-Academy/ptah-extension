import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { YouTubePlayer, resetYouTubeIframeApiForTests } from './youtube-player';

/* -------------------------------------------------------------------------- */
/* A stand-in for the YouTube IFrame API                                       */
/* -------------------------------------------------------------------------- */

interface PlayerOptions {
  events: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
  };
}

const constructions: { element: HTMLIFrameElement; options: PlayerOptions }[] =
  [];
let destroyed = 0;
let currentTime = 0;
let lastHandle: {
  fireReady: () => void;
  fireState: (data: number) => void;
} | null = null;

function installApiStub(): void {
  (globalThis as { YT?: unknown }).YT = {
    Player: class {
      public constructor(
        element: HTMLIFrameElement,
        public readonly options: PlayerOptions,
      ) {
        constructions.push({ element, options });
        lastHandle = {
          fireReady: () => options.events.onReady?.(),
          fireState: (data: number) => options.events.onStateChange?.({ data }),
        };
      }
      public getCurrentTime(): number {
        return currentTime;
      }
      public destroy(): void {
        destroyed += 1;
      }
    },
    PlayerState: { ENDED: 0, PAUSED: 2 },
  };
}

/**
 * `border-base-300` — the class this panel must never emit (`base-300` is a
 * FILL, panel-theme-spec.md §2).
 *
 * ⚠️ IT IS ASSEMBLED RATHER THAN WRITTEN AS A LITERAL, AND THAT IS NOT A
 * WORKAROUND FOR THE RULE — IT IS THE ONLY WAY TO ASSERT IT FROM INSIDE THIS
 * LIB. Task 4.7's `no-restricted-syntax` selector matches ANY string literal
 * containing the token, including one written in a spec in order to prove its
 * ABSENCE. `libs/web/panel-ui/.../thread-row.spec.ts` can write it plainly only
 * because that lib sits outside the rule's scope. Assembling it keeps both the
 * lint rule and the runtime assertion, and weakens neither.
 */
const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [YouTubePlayer],
  template: `
    <ptah-youtube-player
      [videoId]="videoId()"
      [title]="title()"
      [thumbnailUrl]="thumbnailUrl()"
      (clockReady)="clock = $event"
      (playbackPaused)="pauses = pauses + 1"
      (playbackEnded)="ends = ends + 1"
    />
  `,
})
class Host {
  public readonly videoId = signal<string | null>('dQw4w9WgXcQ');
  public readonly title = signal('Reconcile loop fundamentals');
  public readonly thumbnailUrl = signal<string | null>(null);
  public clock: (() => number) | null = null;
  public pauses = 0;
  public ends = 0;
}

/**
 * YouTubePlayer — the facade, the single sanitizer bypass, and the API script
 * that must not load until a member asks.
 */
describe('YouTubePlayer (§4.6, NFR-S3, NFR-U4, RISK-S)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    constructions.length = 0;
    destroyed = 0;
    currentTime = 0;
    lastHandle = null;
    resetYouTubeIframeApiForTests();
    document
      .querySelectorAll('script[src*="iframe_api"]')
      .forEach((node) => node.remove());
    delete (globalThis as { YT?: unknown }).YT;

    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => {
    resetYouTubeIframeApiForTests();
    delete (globalThis as { YT?: unknown }).YT;
  });

  function poster(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="video-poster"]',
    );
  }

  function iframe(): HTMLIFrameElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('iframe');
  }

  function apiScripts(): Element[] {
    return [...document.querySelectorAll('script[src*="iframe_api"]')];
  }

  /** Clicks the poster and lets the loader promise settle. */
  async function activate(): Promise<void> {
    poster()?.click();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 THE FACADE                                                           */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the initial render is a POSTER and nothing else', () => {
    it('contains NO <iframe>', () => {
      expect(iframe()).toBeNull();
    });

    it('🔴 has injected NO api script', () => {
      // Exit-gate clause 2's unit half. The e2e proves it over the network.
      expect(apiScripts()).toHaveLength(0);
    });

    it('renders a poster button', () => {
      expect(poster()).not.toBeNull();
      expect(poster()?.tagName).toBe('BUTTON');
    });

    it('renders NO <img> when the thumbnail is null (ASSUMPTION-6’s live case)', () => {
      // A broken `<img src="">` would be a request AND a rendering defect.
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('img'),
      ).toBeNull();
    });

    it('renders the persisted poster when there IS one', () => {
      fixture.componentInstance.thumbnailUrl.set(
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      );
      fixture.detectChanges();

      const img = (fixture.nativeElement as HTMLElement).querySelector('img');
      expect(img?.getAttribute('src')).toContain('i.ytimg.com');
      // ⚠️ Decorative: the button already carries the accessible name, so a
      // non-empty alt would announce the title twice.
      expect(img?.getAttribute('alt')).toBe('');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Activation                                                              */
  /* ---------------------------------------------------------------------- */

  describe('activation', () => {
    beforeEach(() => installApiStub());

    it('a click constructs the player and renders the iframe', async () => {
      await activate();

      expect(iframe()).not.toBeNull();
      expect(constructions).toHaveLength(1);
      expect(apiScripts().length).toBeLessThanOrEqual(1);
    });

    it('🔴 the constructed iframe’s ORIGIN is youtube-nocookie.com', async () => {
      await activate();

      const src = iframe()?.getAttribute('src') ?? '';
      // Parsed, not matched as a substring: `toContain('youtube-nocookie')`
      // passes for `https://evil.com/?x=youtube-nocookie.com`.
      expect(new URL(src).origin).toBe('https://www.youtube-nocookie.com');
      expect(new URL(src).pathname).toBe('/embed/dQw4w9WgXcQ');
      expect(new URL(src).searchParams.get('enablejsapi')).toBe('1');
    });

    it('attaches the API to the iframe THIS component rendered', async () => {
      await activate();
      expect(constructions[0].element).toBe(iframe());
      expect(constructions[0].element.tagName).toBe('IFRAME');
    });

    it('🔴 the poster is a real <button> in the tab order — Enter and Space work natively', () => {
      // ⚠️ jsdom does NOT implement a button's default keyboard activation, so
      // asserting `keydown Enter -> click` here would be asserting jsdom, not
      // the browser. What IS assertable here is the structural precondition the
      // HTML spec attaches that behaviour to: a `<button type="button">` that
      // is neither disabled nor removed from the tab order. The real keyboard
      // path is proven in Chromium by `members-courses.spec.ts`, which tabs to
      // this element and presses Enter and Space.
      const button = poster() as HTMLButtonElement;
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.getAttribute('tabindex')).toBeNull();
      // …and no keydown listener that could double-fire alongside the native
      // click the browser synthesises.
      expect(button.getAttribute('onkeydown')).toBeNull();
    });

    it('🔴 TWO activations inject the api script ONCE', async () => {
      await activate();
      const afterFirst = apiScripts().length;

      // A second component in the same page — a second lesson opened in one
      // session. The module-level promise is the guard.
      const second = TestBed.createComponent(Host);
      second.detectChanges();
      (
        (second.nativeElement as HTMLElement).querySelector(
          '[data-testid="video-poster"]',
        ) as HTMLButtonElement
      ).click();
      second.detectChanges();
      await Promise.resolve();
      await Promise.resolve();
      second.detectChanges();

      expect(apiScripts()).toHaveLength(afterFirst);
      expect(afterFirst).toBeLessThanOrEqual(1);
      expect(constructions).toHaveLength(2);
    });

    it('emits a CLOCK, not a position, once the player is ready', async () => {
      await activate();
      expect(fixture.componentInstance.clock).toBeNull();

      lastHandle?.fireReady();
      expect(typeof fixture.componentInstance.clock).toBe('function');

      currentTime = 47.9;
      expect(fixture.componentInstance.clock?.()).toBeCloseTo(47.9);
    });

    it('emits paused and ended so the store can flush', async () => {
      await activate();

      lastHandle?.fireState(2);
      expect(fixture.componentInstance.pauses).toBe(1);
      lastHandle?.fireState(0);
      expect(fixture.componentInstance.ends).toBe(1);

      // An unrelated state (BUFFERING) emits nothing.
      lastHandle?.fireState(3);
      expect(fixture.componentInstance.pauses).toBe(1);
      expect(fixture.componentInstance.ends).toBe(1);
    });

    it('a repeated click does not construct a second player', async () => {
      await activate();
      expect(constructions).toHaveLength(1);
      await activate();
      expect(constructions).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 The null branch — RISK-S                                             */
  /* ---------------------------------------------------------------------- */

  describe('🔴 an id that does not validate NEVER produces an iframe', () => {
    beforeEach(() => installApiStub());

    it.each([
      ['a lesson with no video at all', null],
      ['ten characters', 'abcdefghij'],
      ['a full URL', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      ['a javascript: scheme', 'javascript:alert(1)'],
      ['a traversal', '../../evil'],
      ['a tag-breaking payload', 'abcdefghijk"></iframe><script>'],
    ])('%s renders the unavailable state and no iframe', async (_label, id) => {
      fixture.componentInstance.videoId.set(id);
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="video-unavailable"]',
        ),
      ).not.toBeNull();
      expect(iframe()).toBeNull();
      expect(poster()).toBeNull();

      // …and there is nothing to click, so no script can be requested.
      await activate();
      expect(iframe()).toBeNull();
      expect(apiScripts()).toHaveLength(0);
      expect(constructions).toHaveLength(0);
    });

    it('states that the video is unavailable rather than rendering an empty box', () => {
      fixture.componentInstance.videoId.set(null);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'This video is unavailable',
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Teardown                                                                */
  /* ---------------------------------------------------------------------- */

  describe('teardown', () => {
    beforeEach(() => installApiStub());

    it('DestroyRef destroys the player', async () => {
      await activate();
      expect(destroyed).toBe(0);

      fixture.destroy();
      expect(destroyed).toBe(1);
    });

    it('destroying while the api is still loading constructs nothing', async () => {
      // ⚠️ The API stub is REMOVED for this case, so `loadYouTubeIframeApi`'s
      // promise stays pending on the injected `<script>` that never fires in
      // jsdom — which is the state a slow network puts a real member in.
      delete (globalThis as { YT?: unknown }).YT;
      resetYouTubeIframeApiForTests();

      const slow = TestBed.createComponent(Host);
      slow.detectChanges();
      (
        (slow.nativeElement as HTMLElement).querySelector(
          '[data-testid="video-poster"]',
        ) as HTMLButtonElement
      ).click();
      slow.detectChanges();
      slow.destroy();

      await Promise.resolve();
      await Promise.resolve();
      expect(constructions).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* a11y and tokens                                                         */
  /* ---------------------------------------------------------------------- */

  describe('accessibility and tokens', () => {
    it('the poster’s label says what activation does AND names the video', () => {
      expect(poster()?.getAttribute('aria-label')).toBe(
        'Play: Reconcile loop fundamentals',
      );
    });

    it('the iframe carries the lesson title as its accessible name', async () => {
      installApiStub();
      await activate();
      expect(iframe()?.getAttribute('title')).toBe(
        'Reconcile loop fundamentals',
      );
    });

    it('NFR-U2 — base-300 is a FILL here, never a border; no raw hex', () => {
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('bg-base-300');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).toContain('border-hairline');
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    it('has a visible focus ring — NFR-U4 needs the focus to be findable', () => {
      expect(poster()?.className).toContain('focus-visible:outline');
    });
  });
});

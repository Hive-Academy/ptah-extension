import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { LucideAngularModule, PlayCircle, VideoOff } from 'lucide-angular';

import { buildYoutubeEmbedUrl } from './youtube-embed-url';

/**
 * The YouTube IFrame API bootstrap script.
 *
 * ⚠️ IT IS ON `youtube.com`, NOT `youtube-nocookie.com`, AND THAT IS THE ONLY
 * ADDRESS THE API IS SERVED FROM. It is fetched ONLY on activation — never
 * while the facade is showing — which is the whole of NFR-S3's concern: the
 * script and cookie surface, not the poster.
 *
 * This literal and the embed origin in `youtube-embed-url.ts` are the ONLY two
 * YouTube hostnames anywhere in `libs/web/members`;
 * `youtube-embed-chokepoint.spec.ts` asserts that by name.
 */
const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

/** The subset of the YouTube IFrame API this component uses. */
interface YouTubePlayerHandle {
  getCurrentTime(): number;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayerHandle;
  PlayerState: { ENDED: number; PAUSED: number };
}

/**
 * The two globals the IFrame API installs, reached through a locally-typed view
 * of `globalThis`.
 *
 * ⚠️ 🔴 NOT `declare global { var YT }`, AND THAT IS NOT A STYLE CHOICE. This
 * workspace resolves `@types/youtube` transitively (something else in the tree
 * carries a `/// <reference types="youtube" />`, which `types: []` in the
 * tsconfig does not suppress), and that package declares `namespace YT`. A
 * global `var YT` here is `TS2300: Duplicate identifier 'YT'` — it broke
 * `nx typecheck ptah-landing-page` and nothing else, because the lib's own
 * typecheck did not pull the reference in. A local structural view collides
 * with nothing and asks for exactly the two members this component uses.
 */
interface YouTubeGlobals {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: (() => void) | undefined;
}

const youtubeGlobals = globalThis as unknown as YouTubeGlobals;

/**
 * The module-level guard that makes the API script load ONCE PER PAGE.
 *
 * ⚠️ ONCE PER PAGE, NOT ONCE PER COMPONENT. A member who opens five lessons in
 * one session must not append five `<script>` tags — and the second one would
 * re-run the API's global bootstrap while the first player is live.
 */
let apiPromise: Promise<YouTubeApi> | null = null;

/**
 * Loads the IFrame API, injecting its `<script>` at most once.
 *
 * ⚠️ CALLED ONLY FROM {@link YouTubePlayer.activate}. Calling it at module load,
 * in a constructor, or in an `effect` would defeat the facade entirely — that
 * is the single line that turns exit-gate clause 2 from true to false.
 */
export function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  if (apiPromise !== null) return apiPromise;

  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    if (youtubeGlobals.YT?.Player) {
      resolve(youtubeGlobals.YT);
      return;
    }

    // The API calls this global when it is ready. Chaining rather than
    // replacing keeps any other consumer on the page working.
    const previous = youtubeGlobals.onYouTubeIframeAPIReady;
    youtubeGlobals.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (youtubeGlobals.YT) resolve(youtubeGlobals.YT);
    };

    const script = document.createElement('script');
    script.src = YOUTUBE_IFRAME_API_SRC;
    script.async = true;
    script.onerror = () =>
      reject(new Error('The video player could not be loaded.'));
    document.head.appendChild(script);
  });

  return apiPromise;
}

/**
 * TEST SEAM — clears the module-level guard.
 *
 * ⚠️ EXPORTED FROM PRODUCTION CODE DELIBERATELY, and it is the smaller evil. The
 * property under test IS the module-level guard, so a spec that could not reset
 * it would be able to run exactly one activation case per process. The
 * alternative — an injection token wrapping the loader — would put a provider
 * in every consumer's TestBed to protect a single `let`.
 */
export function resetYouTubeIframeApiForTests(): void {
  apiPromise = null;
  youtubeGlobals.onYouTubeIframeAPIReady = undefined;
}

/**
 * YouTubePlayer — a POSTER first, a player only when the member asks (§4.6.1–
 * §4.6.4, R2.2.7, NFR-S3, NFR-P6, NFR-U4, RISK-S).
 *
 * ⚠️ 🔴 THIS COMPONENT IS THE WORKSPACE'S ONLY CALL SITE OF
 * `bypassSecurityTrustResourceUrl`, AND IT CALLS IT ONLY ON A NON-`null` RETURN
 * FROM `buildYoutubeEmbedUrl()`. That function validates the id against an
 * anchored, exact-length pattern and interpolates it into a literal host and a
 * literal query; if it returns `null` this component renders the unavailable
 * state and NEVER CONSTRUCTS AN IFRAME. `youtube-embed-chokepoint.spec.ts`
 * asserts the call appears in exactly one file, by name, and that its argument
 * expression references that function.
 *
 * ⚠️ 🔴 HOW §4.6.2 AND §4.6.3 ARE RECONCILED, BECAUSE THEY LOOK LIKE
 * ALTERNATIVES. §4.6.2 says "construct a player whose `host` is
 * youtube-nocookie.com"; §4.6.3 says "the iframe `src` comes from
 * `buildYoutubeEmbedUrl()` and this is the single bypass call site". Letting
 * `new YT.Player(divElement, …)` build its own iframe would satisfy the first
 * and make the second impossible — the URL would be YouTube's, unvalidated by
 * us and unassertable. So this component renders the `<iframe [src]>` ITSELF
 * from the validated URL, then ATTACHES the API to that existing element
 * (`new YT.Player(iframeElement, …)`, which the API supports precisely for
 * pre-rendered iframes carrying `enablejsapi=1` — which is why that parameter
 * is in the literal query string). The `host` option is then moot: our own URL
 * is already on the nocookie origin, and that origin is asserted by parsing it
 * rather than by trusting an option we passed.
 *
 * ⚠️ ⚠️ THE POSTER IMAGE IS THE TRAP THAT MAKES "ZERO NETWORK ACTIVITY" FALSE.
 * `MemberLessonDetail.videoThumbnailUrl` is served by `i.ytimg.com`, so a page
 * rendering it HAS contacted Google before any activation. **Task 10.4's
 * option (a) is taken**: the claim asserted is the narrower, true one — no
 * request to `youtube.com`, `youtube-nocookie.com`, `googleapis.com` or
 * `googlevideo.com` before activation — and `i.ytimg.com` is named as a
 * documented exception in the Playwright allowlist and here. NFR-S3's actual
 * concern is the script and cookie surface, not an image. Option (b), proxying
 * the thumbnail, needs a backend image route nobody specified (RK-1).
 *
 * ⚠️ AND IN THIS WORKSPACE THE EXCEPTION IS CURRENTLY MOOT: `YOUTUBE_API_KEY` is
 * unset (ASSUMPTION-6), so no thumbnail is ever fetched and
 * `videoThumbnailUrl` is `null` on every lesson — measured live. The poster
 * then renders a token-styled placeholder and NO `<img>` at all. That makes the
 * facade genuinely request-free here, which is a fact about the environment
 * rather than about the code, and it is why the exception is documented anyway.
 *
 * ⚠️ NFR-U4 — THE POSTER IS A REAL `<button>`, NOT A `<div>` WITH A CLICK
 * HANDLER. A button is in the tab order and the browser synthesises a click for
 * `Enter` and `Space`, so both work without a keydown listener that could
 * double-fire. Its `aria-label` says what activation does AND names the video
 * ("Play: Reconcile loop fundamentals"), not "Play".
 *
 * ⚠️ NFR-S2 IS IN FORCE HERE EVEN THOUGH THIS RENDERS NO MARKDOWN. No
 * `[innerHTML]`, no `bypassSecurityTrustHtml`, no `marked`/`dompurify` import.
 * `markdown-chokepoint.spec.ts` globs `libs/web/members/**` and this file is in
 * its scope from the moment it exists.
 *
 * ⚠️ `DestroyRef` DESTROYS THE PLAYER. The 1 s poll belongs to
 * `CoursePlayerStore`, which clears its own interval; this clears the iframe
 * API's.
 */
@Component({
  selector: 'ptah-youtube-player',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './youtube-player.html',
})
export class YouTubePlayer {
  private readonly sanitizer = inject(DomSanitizer);

  /** The persisted 11-character id, or `null` for a lesson with no video. */
  public readonly videoId = input.required<string | null>();

  /** The lesson title — the accessible name of the activation button. */
  public readonly title = input.required<string>();

  /**
   * The persisted poster.
   *
   * ⚠️ `null` IS THE COMMON CASE IN THIS WORKSPACE (ASSUMPTION-6) and renders a
   * token-styled placeholder rather than a broken `<img src="">`.
   */
  public readonly thumbnailUrl = input<string | null>(null);

  /**
   * Emitted once, when the player is ready, carrying a getter for the current
   * playback position IN SECONDS.
   *
   * ⚠️ THE STORE OWNS THE TIMING (§4.6.4). This component hands over a clock and
   * never decides when it is read; two things owning a cadence is how a write
   * ends up firing per change-detection cycle.
   */
  public readonly clockReady = output<() => number>();

  /**
   * The member paused. The store flushes.
   *
   * ⚠️ NAMED `playbackPaused`, NOT `paused`. `@angular-eslint/no-output-native`
   * refuses an output whose name shadows a standard DOM event, and it is right
   * to: `(paused)` on a host element is ambiguous between this output and the
   * media event of the same name, and the two would be indistinguishable in a
   * template. Same for {@link playbackEnded}.
   */
  public readonly playbackPaused = output<void>();

  /** Playback finished. The store flushes. */
  public readonly playbackEnded = output<void>();

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  private player: YouTubePlayerHandle | null = null;

  /**
   * The loaded IFrame API, or `null` until the member activates and the script
   * resolves.
   *
   * ⚠️ 🔴 IT IS A SIGNAL BECAUSE THE ATTACH MUST WAIT FOR THE VIEW, AND THAT IS
   * A REAL DEFECT THIS SHAPE FIXES RATHER THAN A STYLE CHOICE. The first
   * implementation attached inside the loader's `.then`. Under Zone.js — which
   * the landing app uses — the zone drains its microtask queue when the CLICK
   * TASK ENDS, which is BEFORE Angular re-renders the template. So the `.then`
   * ran while `activated()` was already `true` but the `<iframe>` did not exist
   * yet, `viewChild` returned `undefined`, and the player was silently never
   * constructed. It failed in the spec first; it would have failed identically
   * in a browser on every second lesson, once the script was cached and the
   * promise resolved synchronously. Driving the attach from an `effect` that
   * READS the view query makes the ordering the framework's problem.
   */
  private readonly api = signal<YouTubeApi | null>(null);

  /** The member has asked for the player. Until then: poster only. */
  protected readonly activated = signal(false);

  /** The API script failed to load, or the id did not validate. */
  protected readonly failed = signal(false);

  protected readonly PlayIcon = PlayCircle;
  protected readonly VideoOffIcon = VideoOff;

  /**
   * The validated embed URL, or `null`.
   *
   * ⚠️ COMPUTED FROM THE ID ALONE, AND `null` HERE MEANS NO IFRAME IS EVER
   * RENDERED — not an iframe pointed at a fallback.
   */
  private readonly embedUrl = computed<string | null>(() => {
    const id = this.videoId();
    return id === null ? null : buildYoutubeEmbedUrl(id);
  });

  /**
   * 🔴 THE ONE CALL. Reached only when {@link embedUrl} is non-`null`, i.e.
   * only when the id passed `YOUTUBE_VIDEO_ID_PATTERN`.
   */
  protected readonly trustedUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.embedUrl();
    if (url === null) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  /** No video at all, or an id this client refuses to trust. */
  protected readonly unavailable = computed<boolean>(
    () => this.embedUrl() === null || this.failed(),
  );

  /** "Play: Reconcile loop fundamentals" — the action AND the subject. */
  protected readonly activateLabel = computed<string>(
    () => `Play: ${this.title()}`,
  );

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.teardown());

    // Attaches exactly once, as soon as BOTH the API and the iframe exist, in
    // whichever order they arrive. `untracked` keeps the attach from taking a
    // dependency on anything it touches.
    effect(() => {
      const api = this.api();
      const element = this.frame()?.nativeElement;
      if (api === null || !element || this.player !== null) return;
      untracked(() => this.attach(api, element));
    });
  }

  /**
   * The member's first activation — click, `Enter` or `Space`.
   *
   * ⚠️ THIS IS THE ONLY PLACE THE API SCRIPT IS EVER REQUESTED. Everything
   * before it is a poster and a button.
   */
  protected activate(): void {
    if (this.activated() || this.embedUrl() === null) return;
    this.activated.set(true);

    void loadYouTubeIframeApi()
      .then((api) => this.api.set(api))
      .catch(() => {
        this.failed.set(true);
        this.activated.set(false);
      });
  }

  /**
   * Binds the IFrame API to the iframe THIS COMPONENT already rendered.
   *
   * Called only from the constructor's effect, which guarantees both arguments
   * exist. Attaching to a pre-rendered iframe — rather than letting the API
   * build its own — is what keeps `buildYoutubeEmbedUrl` the only producer of
   * the embed URL. See the class docblock.
   */
  private attach(api: YouTubeApi, element: HTMLIFrameElement): void {
    this.player = new api.Player(element, {
      events: {
        onReady: () => {
          const handle = this.player;
          if (handle === null) return;
          this.clockReady.emit(() => handle.getCurrentTime());
        },
        onStateChange: (event) => {
          if (event.data === api.PlayerState.PAUSED) {
            this.playbackPaused.emit();
          }
          if (event.data === api.PlayerState.ENDED) this.playbackEnded.emit();
        },
      },
    });
  }

  private teardown(): void {
    this.player?.destroy();
    this.player = null;
  }
}

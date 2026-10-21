import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, computed, effect, inject, untracked } from '@angular/core';
import { ThemeService } from '@ptah-extension/core';
import {
  ARTIFACT_THEME_VAR_ALLOWLIST,
  ArtifactThemeMessageSchema,
  type ArtifactThemeMessage,
  type ArtifactThemeVarName,
} from '@ptah-extension/shared/mcp-apps-contracts';

/** [A-Za-z0-9] — the alphabet a bridge nonce is drawn from. */
const NONCE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 62 alphabet characters times 4 is 248: a uniform byte below 248 lands on
 * each character exactly four times, so `byte % 62` stays uniform. Bytes at
 * or above it are dropped instead of folded, which keeps the draw unbiased.
 */
const UNBIASED_BYTE_MAX = 248;

/** Bytes drawn per round so a dropped byte rarely costs another round. */
const NONCE_DRAW_MARGIN = 8;

/** The schema floor is 16 (`artifact.schemas.ts`); 24 keeps a wide margin. */
const NONCE_LENGTH = 24;

/**
 * One per-frame nonce, at least 16 characters, drawn from
 * `crypto.getRandomValues`. There is exactly one nonce per frame session (one
 * per `load`), and the frame must echo it back in every message, so a stale
 * or forged frame cannot reach the host even though its opaque origin cannot
 * be named in `targetOrigin`.
 */
export function generateArtifactNonce(): string {
  let nonce = '';
  while (nonce.length < NONCE_LENGTH) {
    const bytes = new Uint8Array(
      NONCE_LENGTH - nonce.length + NONCE_DRAW_MARGIN,
    );
    globalThis.crypto.getRandomValues(bytes);
    for (
      let index = 0;
      index < bytes.length && nonce.length < NONCE_LENGTH;
      index += 1
    ) {
      const byte = bytes[index];
      if (byte < UNBIASED_BYTE_MAX) {
        nonce += NONCE_ALPHABET[byte % NONCE_ALPHABET.length];
      }
    }
  }
  return nonce;
}

/**
 * ArtifactThemeBridgeService — the outgoing half of one artifact frame's
 * bridge (TASK_2026_710, batch 7).
 *
 * The service is provided BY the viewer component, so its lifecycle is the
 * viewer's lifecycle and only the one live frame ever holds a nonce:
 * `attach` mints a fresh nonce and sends the theme tokens at once, `detach`
 * clears both, and every theme flip re-sends while a frame is attached.
 * The incoming half (height, open-link) stays in the viewer, which checks
 * `event.source`, the schema and this service's nonce.
 */
@Injectable()
export class ArtifactThemeBridgeService implements OnDestroy {
  private readonly theme = inject(ThemeService);
  private readonly document = inject(DOCUMENT);

  /** `light` or `dark`, derived from the host's theme signal. */
  readonly mode = computed<'light' | 'dark'>(() =>
    this.theme.isDarkMode() ? 'dark' : 'light',
  );

  /** The frame's content window; `null` while no frame is attached. */
  private target: Window | null = null;
  /** The nonce the attached frame must echo; `null` while detached. */
  private currentNonce: string | null = null;

  constructor() {
    // Fixed decision: re-send the theme tokens on every theme change while a
    // frame is attached. The frame cannot read the host DOM (opaque origin),
    // so a flip would otherwise leave it on the old palette forever.
    effect(() => {
      this.mode();
      if (this.target !== null) untracked(() => this.sendTheme());
    });
  }

  /** The nonce a page message must carry; `null` while detached. */
  nonce(): string | null {
    return this.currentNonce;
  }

  /**
   * Bind to a freshly loaded frame: mint the session nonce, then push the
   * theme tokens immediately so the first paint is never unthemed.
   */
  attach(contentWindow: Window): void {
    this.target = contentWindow;
    this.currentNonce = generateArtifactNonce();
    this.sendTheme();
  }

  /**
   * Drop the frame. Clearing the nonce is the security point: any message
   * the old frame still sends no longer matches, so it is ignored.
   */
  detach(): void {
    this.target = null;
    this.currentNonce = null;
  }

  /**
   * Post the allowlisted theme variables to the frame.
   *
   * The vars are read live from `getComputedStyle(document.documentElement)`
   * and restricted to `ARTIFACT_THEME_VAR_ALLOWLIST`, so a token outside the
   * allowlist can never cross the bridge. The message is validated with its
   * own schema before it is sent — the host never posts an unvalidated
   * payload either.
   */
  sendTheme(): void {
    const target = this.target;
    const nonce = this.currentNonce;
    if (target === null || nonce === null) return;
    const vars: Partial<Record<ArtifactThemeVarName, string>> = {};
    const styles = this.document.defaultView?.getComputedStyle(
      this.document.documentElement,
    );
    if (styles !== undefined && styles !== null) {
      for (const name of ARTIFACT_THEME_VAR_ALLOWLIST) {
        const value = styles.getPropertyValue(name).trim();
        if (value !== '' && value.length <= 200) vars[name] = value;
      }
    }
    const message: ArtifactThemeMessage = {
      type: 'theme',
      mode: this.mode(),
      vars,
      nonce,
    };
    const parsed = ArtifactThemeMessageSchema.safeParse(message);
    if (!parsed.success) return;
    // `targetOrigin` must be '*': the frame runs under
    // sandbox="allow-scripts" without allow-same-origin, so its origin is
    // opaque and no origin string can be named for it. Authentication is the
    // per-frame nonce instead, which the viewer checks on every message.
    target.postMessage(parsed.data, '*');
  }

  ngOnDestroy(): void {
    this.detach();
  }
}

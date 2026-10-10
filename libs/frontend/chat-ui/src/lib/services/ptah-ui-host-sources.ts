import { InjectionToken } from '@angular/core';
import type { Signal } from '@angular/core';
import type { ContextCapacity } from '@ptah-extension/shared';
import type { TurnAgentFacts } from '@ptah-extension/shared/mcp-apps-contracts/surface';

/**
 * Per-tab live facts that the transcript owns and lazy `ptah-ui` code reads
 * (TASK_2026_623, component 9). Lets chat-ui reach them without importing
 * the `chat` library.
 *
 * Eager-light: this file sits in the main `@ptah-extension/chat-ui` barrel, so
 * every `mcp-apps-contracts` import here is type-only and erased at build.
 */
export interface PtahUiHostSources {
  /** The chat tab the transcript renders. */
  readonly tabId: Signal<string>;
  /** The tab's session; `null` before the session exists. */
  readonly sessionId: Signal<string | null>;
  /** One entry per transcript turn, in turn order (allow-listed facts only). */
  readonly turnFacts: Signal<readonly TurnAgentFacts[]>;
  /** Index into `turnFacts` of the turn that owns a message; `null` if none. */
  turnIndexOf(messageId: string): number | null;
  /** Context capacity evidence of the session; the only source of a limit. */
  readonly capacities: Signal<readonly ContextCapacity[]>;
}

/**
 * Provided by the transcript. Optional in every consumer: when it is absent,
 * the `$agents` input is `null` and the source renders "unavailable".
 */
export const PTAH_UI_HOST_SOURCES = new InjectionToken<PtahUiHostSources>(
  'PTAH_UI_HOST_SOURCES',
);

import { InjectionToken, type Type } from '@angular/core';
import type { TabState } from '@ptah-extension/chat-types';

/**
 * Where a workflow add-on renders: a section of the session inspector, or a
 * chip / action in the session header.
 */
export type SessionAddonSlot =
  | 'inspectorSection'
  | 'sessionHeaderChip'
  | 'sessionHeaderAction';

/**
 * One workflow add-on. Hosts render every entry whose `workflowKind` equals
 * the tab's `sessionWorkflowKind(tab)` and whose `slot` matches, through
 * `*ngComponentOutlet="a.component; inputs: { tabId }"`.
 */
export interface SessionWorkflowAddon {
  /** The workflow kind the add-on belongs to. */
  readonly workflowKind: string;
  readonly slot: SessionAddonSlot;
  /** Must declare `tabId = input.required<string>()`. */
  readonly component: Type<unknown>;
}

/**
 * Multi-provider registry of workflow add-ons. Register in the webview
 * `app.config.ts` with
 * `{ provide: SESSION_WORKFLOW_ADDONS, multi: true, useValue: addon }`.
 * Inject with `{ optional: true }`: no registration means no outlet.
 *
 * Multi-providers resolve to an array of the provided values, so each
 * registration contributes one `SessionWorkflowAddon`.
 */
export const SESSION_WORKFLOW_ADDONS = new InjectionToken<
  readonly SessionWorkflowAddon[]
>('SESSION_WORKFLOW_ADDONS');

/**
 * The workflow kind of a tab, or `null` when it runs no workflow. `TabState`
 * carries no workflow field on this branch, so every tab resolves to `null`:
 * no initial-open default from a workflow and no add-on lookup match.
 */
export function sessionWorkflowKind(
  _tab: TabState | null | undefined,
): string | null {
  return null;
}

/** The add-ons registered for `kind` in `slot`; empty for a `null` kind. */
export function workflowAddonsFor(
  addons: readonly SessionWorkflowAddon[] | null,
  kind: string | null,
  slot: SessionAddonSlot,
): readonly SessionWorkflowAddon[] {
  if (!addons || kind === null) return [];
  return addons.filter(
    (addon) => addon.workflowKind === kind && addon.slot === slot,
  );
}

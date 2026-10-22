/**
 * `organisms/artifacts` — the TASK_2026_710 artifact surface.
 *
 * The card is metadata only and transcript-safe, so the main
 * `@ptah-extension/chat-ui` barrel value-exports it for the transcript. The
 * sandboxed viewer and the theme bridge carry the `ptah-artifact://` iframe
 * and its postMessage channel, so they stay behind the lazy display-panel
 * chunk (the display panel imports them from here) — the same split
 * `organisms/display-panel` already uses. Do not value-export the viewer or
 * the bridge from the main barrel.
 */
export { ArtifactCardComponent } from './artifact-card.component';
export { ArtifactViewerComponent } from './artifact-viewer.component';
export { ArtifactThemeBridgeService } from './artifact-theme-bridge.service';
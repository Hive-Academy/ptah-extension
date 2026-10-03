/**
 * @ptah-extension/git-ui — the Electron git dock's review surface.
 *
 * Depends on core, shared, ui and markdown — never on chat.
 *
 * This main entry carries the review shell (and, behind it, the review canvas
 * and spot editor), so every consumer reaches it by dynamic `import()` only.
 * Push-message services that must be eager live in the services-only entry
 * (`@ptah-extension/git-ui/services`); the Pierre renderer hosts live in
 * `@ptah-extension/git-ui/diff-renderer`.
 */

// Services
export { GitReviewService } from './lib/services/git-review.service';
export { ReviewNavigationService } from './lib/services/review-navigation.service';

// Components
export { ReviewShellComponent } from './lib/review-shell/review-shell.component';

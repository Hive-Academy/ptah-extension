/**
 * Jest stand-in for `@ptah-extension/editor`.
 *
 * `LazyDiffViewComponent` reaches the real editor through a runtime
 * `import('@ptah-extension/editor')`, whose barrel pulls Monaco, xterm and the
 * node-pty terminal bridge — none of which load under jsdom, and none of which
 * this library's behaviour depends on. Mapping the specifier here keeps the
 * lazy boundary exercised (the dynamic import really runs, the component is
 * really instantiated) without dragging the editor bundle into the test
 * environment. Same pattern as the `ngx-markdown` mock in this folder.
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="mock-diff-view"></div>`,
})
export class DiffViewComponent {
  public readonly diffTab = input<unknown>(null);
  public readonly openDiffKeys = input<readonly string[]>([]);
  public readonly showHeader = input<boolean>(true);
}

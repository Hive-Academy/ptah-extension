/**
 * Jest stand-in for `@ptah-extension/git-ui/diff-renderer`.
 *
 * `LazyDiffViewComponent` reaches the real renderer through a runtime
 * `import('@ptah-extension/git-ui/diff-renderer')`, whose entry pulls
 * `@pierre/diffs` (ESM-only, custom elements, Shiki grammars) — none of which
 * this library's behaviour depends on. Mapping the specifier here keeps the
 * lazy boundary exercised (the dynamic import really runs, the component is
 * really instantiated) without dragging the renderer into jsdom. Same pattern
 * as the `ngx-markdown` mock in this folder.
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'ptah-text-diff-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="mock-text-diff-view"></div>`,
})
export class TextDiffViewComponent {
  public readonly oldText = input<string | null>(null);
  public readonly newText = input<string | null>(null);
  public readonly fileName = input('');
  public readonly language = input('');
  public readonly themeType = input<'light' | 'dark'>('dark');
}

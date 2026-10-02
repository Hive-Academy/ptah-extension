import {
  Component,
  signal,
  type Signal,
  type TemplateRef,
  type Type,
  viewChild,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { GitHunkRef } from '@ptah-extension/shared';
import type { PierreDiffHostComponent } from './pierre-diff-host.component';

/**
 * `@pierre/diffs` is ESM-only and is not transformed by this project's Jest
 * config, so the renderer is replaced by a double that reproduces the
 * 1.5.1 contract the host depends on (A1, read at tag `diffs-v1.5.1`):
 *
 * - `getLineAnnotationName`: `annotation-<side>-<lineNumber>`, and every line
 *   annotation is rendered as `<slot name=…>` inside the shadow tree
 *   (`createAnnotationElement.ts`).
 * - `getHunkSeparatorSlotName`: `hunk-separator-<type>-<hunkIndex>`. A
 *   separator is pushed only when `collapsedBefore > 0`
 *   (`DiffHunksRenderer.ts:2406-2408`), and under `'line-info'` it carries no
 *   `<slot>` (`createSeparator.ts`: only the deprecated `'custom'` type does).
 *   `separatorSlots` switches the double to the slot-bearing variant so the
 *   host's separator branch is covered too.
 *
 * Pierre's real parse is exercised against real git output in
 * `pierre-hunk-mapping.real-git.spec.ts`.
 */
interface FakeHunk {
  additionStart: number;
  additionCount: number;
  deletionStart: number;
  deletionCount: number;
  collapsedBefore: number;
}

const pierre = {
  instances: [] as FakeFileDiff[],
  parsedPatches: [] as string[],
  separatorSlots: false,
  parseThrows: false,
  constructorThrows: false,
  renderThrows: false,
};

class FakeFileDiff {
  cleanedUp = false;
  cleanUpCalls = 0;
  themeTypes: string[] = [];
  rendered: {
    fileDiff: { hunks: FakeHunk[] };
    fileContainer: HTMLElement;
    lineAnnotations: { side: string; lineNumber: number }[];
  } | null = null;

  constructor(
    public options: Record<string, unknown> & {
      onPostRender?: (
        node: HTMLElement,
        instance: unknown,
        phase: string,
      ) => void;
    },
    public workerManager: unknown,
    public isContainerManaged: boolean,
  ) {
    if (pierre.constructorThrows) throw new Error('FileDiff: bad options');
    pierre.instances.push(this);
  }

  render(props: NonNullable<FakeFileDiff['rendered']>): boolean {
    this.rendered = props;
    const container = props.fileContainer;
    const root =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const pre = document.createElement('pre');
    props.fileDiff.hunks.forEach((hunk, index) => {
      if (hunk.collapsedBefore > 0) {
        const separator = document.createElement('div');
        separator.setAttribute('data-separator', 'line-info');
        if (pierre.separatorSlots) {
          const slot = document.createElement('slot');
          slot.setAttribute(
            'name',
            `hunk-separator-${this.options['diffStyle'] === 'unified' ? 'unified' : 'additions'}-${index}`,
          );
          separator.appendChild(slot);
        }
        pre.appendChild(separator);
      }
    });
    for (const annotation of props.lineAnnotations) {
      const slot = document.createElement('slot');
      slot.setAttribute(
        'name',
        `annotation-${annotation.side}-${annotation.lineNumber}`,
      );
      pre.appendChild(slot);
    }
    root.appendChild(pre);
    // Fails after partial content is in the shadow tree, as a highlighter
    // error mid-render would.
    if (pierre.renderThrows) throw new Error('render: highlighter failed');
    this.options.onPostRender?.(container, this, 'mount');
    return true;
  }

  setThemeType(mode: string): void {
    this.themeTypes.push(mode);
  }

  cleanUp(): void {
    this.cleanedUp = true;
    this.cleanUpCalls++;
    this.options.onPostRender?.(
      this.rendered?.fileContainer as HTMLElement,
      this,
      'unmount',
    );
  }
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

jest.mock('@pierre/diffs', () => ({
  DEFAULT_THEMES: { dark: 'pierre-dark', light: 'pierre-light' },
  FileDiff: FakeFileDiff,
  registerCustomLanguage: jest.fn(),
  getLineAnnotationName: (a: { side?: string; lineNumber: number }) =>
    `annotation-${a.side ? `${a.side}-` : ''}${a.lineNumber}`,
  getHunkSeparatorSlotName: (type: string, index: number) =>
    `hunk-separator-${type}-${index}`,
  parseDiffFromFile: () => ({ hunks: [] }),
  parsePatchFiles: (patch: string) => {
    pierre.parsedPatches.push(patch);
    if (pierre.parseThrows) throw new Error('parsePatchContent: broken');
    let lastEnd = 0;
    const hunks: FakeHunk[] = [...patch.matchAll(HUNK_RE)].map((m) => {
      const additionStart = Number(m[3]);
      const additionCount = m[4] === undefined ? 1 : Number(m[4]);
      const start = additionCount === 0 ? additionStart : additionStart - 1;
      const hunk = {
        deletionStart: Number(m[1]),
        deletionCount: m[2] === undefined ? 1 : Number(m[2]),
        additionStart,
        additionCount,
        collapsedBefore: Math.max(start - lastEnd, 0),
      };
      lastEnd = start + additionCount;
      return hunk;
    });
    const files = (patch.match(/^diff --git /gm) ?? []).map(() => ({ hunks }));
    return [{ files }];
  },
}));

function ref(
  index: number,
  originalStart: number,
  originalLines: number,
  modifiedStart: number,
  modifiedLines: number,
): GitHunkRef {
  return {
    index,
    originalStart,
    originalLines,
    modifiedStart,
    modifiedLines,
    header: `@@ -${originalStart},${originalLines} +${modifiedStart},${modifiedLines} @@`,
  };
}

function patchOf(hunks: readonly GitHunkRef[], eol = '\n'): string {
  return [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    ...hunks.flatMap((h) => [h.header, ' context']),
  ]
    .map((line) => line + eol)
    .join('');
}

/** Hunk at line 1, an adjacent hunk (no gap), and one after a gap. */
const LINE_ONE_AND_ADJACENT: GitHunkRef[] = [
  ref(0, 1, 2, 1, 3),
  ref(1, 3, 2, 4, 2),
  ref(2, 10, 3, 11, 3),
];

interface HostShape {
  readonly patch: ReturnType<typeof signal<string | null>>;
  readonly hunks: ReturnType<typeof signal<readonly GitHunkRef[]>>;
  readonly diffStyle: ReturnType<typeof signal<'unified' | 'split'>>;
  readonly theme: ReturnType<typeof signal<'light' | 'dark'>>;
  readonly host: Signal<PierreDiffHostComponent>;
}

/**
 * Built after the `@pierre/diffs` mock is registered. A static import of the
 * component is not used: in this file ts-jest does not hoist `jest.mock` above
 * it once the decorated test host is present, and the real ESM package loads.
 */
async function createHostComponent(): Promise<Type<HostShape>> {
  const { PierreDiffHostComponent: DiffHost } =
    await import('./pierre-diff-host.component');

  @Component({
    standalone: true,
    imports: [DiffHost],
    template: `
      <ng-template #toolbar let-hunk let-i="index">
        <button type="button" data-testid="hunk-action">
          Stage hunk {{ i }} at {{ hunk.modifiedStart }}
        </button>
      </ng-template>
      <ptah-pierre-diff-host
        [patch]="patch()"
        [hunks]="hunks()"
        [diffStyle]="diffStyle()"
        [themeType]="theme()"
        [hunkToolbar]="toolbar"
      />
    `,
  })
  class HostComponent implements HostShape {
    readonly patch = signal<string | null>(patchOf(LINE_ONE_AND_ADJACENT));
    readonly hunks = signal<readonly GitHunkRef[]>(LINE_ONE_AND_ADJACENT);
    readonly diffStyle = signal<'unified' | 'split'>('split');
    readonly theme = signal<'light' | 'dark'>('dark');
    readonly host = viewChild.required(DiffHost);
    readonly toolbarRef = viewChild<TemplateRef<unknown>>('toolbar');
  }
  return HostComponent;
}

describe('PierreDiffHostComponent', () => {
  let fixture: ComponentFixture<HostShape>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function hostElements(): HTMLElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="pierre-hunk-host"]',
      ),
    );
  }

  function renderedSlotNames(): string[] {
    const container: HTMLElement =
      fixture.nativeElement.querySelector('diffs-container');
    return Array.from(
      container.shadowRoot?.querySelectorAll('slot[name]') ?? [],
      (slot) => slot.getAttribute('name') as string,
    );
  }

  beforeEach(async () => {
    pierre.instances = [];
    pierre.parsedPatches = [];
    pierre.separatorSlots = false;
    pierre.parseThrows = false;
    pierre.constructorThrows = false;
    pierre.renderThrows = false;
    const HostComponent = await createHostComponent();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await settle();
  });

  it('configures one host-managed FileDiff with word-level inline diff', () => {
    expect(pierre.instances).toHaveLength(1);
    const [instance] = pierre.instances;
    expect(instance.isContainerManaged).toBe(true);
    expect(instance.options).toMatchObject({
      lineDiffType: 'word',
      preferredHighlighter: 'shiki-js',
      hunkSeparators: 'line-info',
      expandUnchanged: false,
      diffStyle: 'split',
      themeType: 'dark',
    });
    expect(instance.rendered?.fileContainer.tagName.toLowerCase()).toBe(
      'diffs-container',
    );
  });

  it('renders exactly one toolbar host per hunk for a hunk at line 1 and adjacent hunks', () => {
    const hosts = hostElements();
    expect(hosts.map((h) => h.getAttribute('slot'))).toEqual([
      'annotation-additions-1',
      'annotation-additions-4',
      'annotation-additions-11',
    ]);
    expect(hosts.map((h) => h.getAttribute('data-hunk-index'))).toEqual([
      '0',
      '1',
      '2',
    ]);
    // Every host fills a slot the renderer actually rendered, exactly once.
    const rendered = renderedSlotNames();
    for (const host of hosts) {
      expect(
        rendered.filter((name) => name === host.getAttribute('slot')),
      ).toHaveLength(1);
    }
    expect(fixture.componentInstance.host().hunkHosts()).toEqual([
      { index: 0, slotName: 'annotation-additions-1' },
      { index: 1, slotName: 'annotation-additions-4' },
      { index: 2, slotName: 'annotation-additions-11' },
    ]);
    expect(fixture.componentInstance.host().mappingError()).toBeNull();
  });

  it('keeps the hosts in the light DOM with an accessible group and the projected toolbar', () => {
    const hosts = hostElements();
    const container: HTMLElement =
      fixture.nativeElement.querySelector('diffs-container');
    for (const host of hosts) {
      expect(host.parentElement).toBe(container);
      expect(host.getAttribute('role')).toBe('group');
    }
    expect(hosts[1].getAttribute('aria-label')).toBe('Hunk 2 actions');
    expect(hosts[1].textContent).toContain('Stage hunk 1 at 4');
  });

  it('uses the separator slot when the renderer rendered one, else the annotation slot', async () => {
    pierre.separatorSlots = true;
    fixture.componentInstance.diffStyle.set('unified');
    await settle();
    expect(hostElements().map((h) => h.getAttribute('slot'))).toEqual([
      'annotation-additions-1',
      'annotation-additions-4',
      'hunk-separator-unified-2',
    ]);
  });

  it('anchors a pure-deletion hunk on the deletions side', async () => {
    const hunks = [ref(0, 5, 2, 4, 0)];
    fixture.componentInstance.patch.set(patchOf(hunks));
    fixture.componentInstance.hunks.set(hunks);
    await settle();
    expect(hostElements().map((h) => h.getAttribute('slot'))).toEqual([
      'annotation-deletions-5',
    ]);
  });

  it('goes read-only on a hunk position mismatch and never guesses', async () => {
    fixture.componentInstance.hunks.set([
      ref(0, 1, 2, 1, 3),
      ref(1, 3, 2, 5, 2),
      ref(2, 10, 3, 11, 3),
    ]);
    await settle();
    const host = fixture.componentInstance.host();
    expect(host.mappingError()?.reason).toBe('hunk-position');
    expect(host.hunkHosts()).toEqual([]);
    expect(hostElements()).toHaveLength(0);
    // The diff is still rendered, without hunk annotations.
    expect(pierre.instances.at(-1)?.rendered?.lineAnnotations).toEqual([]);
    const note = fixture.nativeElement.querySelector(
      '[data-testid="pierre-mapping-error"]',
    );
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toContain('Hunk actions are unavailable');
  });

  it('goes read-only on a hunk count mismatch', async () => {
    fixture.componentInstance.hunks.set(LINE_ONE_AND_ADJACENT.slice(0, 2));
    await settle();
    expect(fixture.componentInstance.host().mappingError()?.reason).toBe(
      'hunk-count',
    );
    expect(hostElements()).toHaveLength(0);
  });

  it('reports a parse failure without creating a renderer', async () => {
    const before = pierre.instances.length;
    pierre.parseThrows = true;
    fixture.componentInstance.patch.set(patchOf(LINE_ONE_AND_ADJACENT) + 'x');
    await settle();
    expect(pierre.instances).toHaveLength(before);
    expect(fixture.componentInstance.host().mappingError()?.reason).toBe(
      'parse-failed',
    );
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="pierre-mapping-error"]',
      ).textContent,
    ).toContain('could not be displayed');
  });

  it('reports parse-failed and keeps no renderer when the FileDiff constructor throws', async () => {
    const [first] = pierre.instances;
    pierre.constructorThrows = true;
    fixture.componentInstance.patch.set(patchOf(LINE_ONE_AND_ADJACENT) + ' ');
    await settle();

    const host = fixture.componentInstance.host();
    expect(host.mappingError()).toEqual({
      reason: 'parse-failed',
      detail: 'FileDiff: bad options',
    });
    expect(host.hunkHosts()).toEqual([]);
    expect(hostElements()).toHaveLength(0);
    expect(renderedSlotNames()).toEqual([]);
    // The previous renderer was disposed and no new one is held: a theme
    // change reaches nothing.
    expect(first.cleanedUp).toBe(true);
    expect(pierre.instances).toEqual([first]);
    fixture.componentInstance.theme.set('light');
    await settle();
    expect(first.themeTypes).not.toContain('light');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="pierre-mapping-error"]',
      ).textContent,
    ).toContain('could not be displayed');
  });

  it('reports parse-failed, cleans up the instance and clears partial content when render throws', async () => {
    pierre.renderThrows = true;
    fixture.componentInstance.patch.set(patchOf(LINE_ONE_AND_ADJACENT) + ' ');
    await settle();

    const failed = pierre.instances.at(-1) as FakeFileDiff;
    expect(pierre.instances).toHaveLength(2);
    expect(failed.cleanUpCalls).toBe(1);
    const host = fixture.componentInstance.host();
    expect(host.mappingError()).toEqual({
      reason: 'parse-failed',
      detail: 'render: highlighter failed',
    });
    expect(host.hunkHosts()).toEqual([]);
    expect(renderedSlotNames()).toEqual([]);

    // No instance is kept: a theme change does not reach it, and the next
    // content change does not dispose it a second time.
    fixture.componentInstance.theme.set('light');
    await settle();
    expect(failed.themeTypes).toEqual([]);
    pierre.renderThrows = false;
    fixture.componentInstance.patch.set(patchOf(LINE_ONE_AND_ADJACENT));
    await settle();
    expect(failed.cleanUpCalls).toBe(1);
    expect(host.mappingError()).toBeNull();
    expect(hostElements()).toHaveLength(3);
  });

  it('reports a multi-file patch as not displayed, not as read-only hunks', async () => {
    const before = pierre.instances.length;
    const single = patchOf(LINE_ONE_AND_ADJACENT);
    fixture.componentInstance.patch.set(single + single);
    await settle();
    expect(pierre.instances).toHaveLength(before);
    expect(fixture.componentInstance.host().mappingError()?.reason).toBe(
      'file-count',
    );
    const note = fixture.nativeElement.querySelector(
      '[data-testid="pierre-mapping-error"]',
    );
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toContain('This diff could not be displayed.');
    expect(note.textContent).not.toContain('Hunk actions are unavailable');
  });

  it('offers no hosts and no error when no git hunks are supplied', async () => {
    fixture.componentInstance.hunks.set([]);
    await settle();
    expect(fixture.componentInstance.host().mappingError()).toBeNull();
    expect(hostElements()).toHaveLength(0);
  });

  it('passes CRLF patch bytes to the renderer untouched', async () => {
    const crlf = patchOf(LINE_ONE_AND_ADJACENT, '\r\n');
    fixture.componentInstance.patch.set(crlf);
    await settle();
    expect(pierre.parsedPatches.at(-1)).toBe(crlf);
    expect(hostElements()).toHaveLength(3);
  });

  it('disposes the previous FileDiff on a content input change and clears its shadow tree', async () => {
    const first = pierre.instances[0];
    fixture.componentInstance.patch.set(patchOf(LINE_ONE_AND_ADJACENT) + ' ');
    await settle();
    expect(first.cleanedUp).toBe(true);
    expect(pierre.instances).toHaveLength(2);
    expect(pierre.instances[1].cleanedUp).toBe(false);
    // One render's worth of slots, not two.
    expect(renderedSlotNames()).toHaveLength(3);
  });

  it('applies a theme change in place without recreating the renderer', async () => {
    fixture.componentInstance.theme.set('light');
    await settle();
    expect(pierre.instances).toHaveLength(1);
    expect(pierre.instances[0].themeTypes.at(-1)).toBe('light');
  });

  it('disposes the FileDiff on destroy', () => {
    const [instance] = pierre.instances;
    fixture.destroy();
    expect(instance.cleanedUp).toBe(true);
  });
});

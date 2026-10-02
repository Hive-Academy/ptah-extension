import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  type ElementRef,
  input,
  signal,
  type TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import {
  FileDiff,
  getHunkSeparatorSlotName,
  getLineAnnotationName,
  parseDiffFromFile,
  parsePatchFiles,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from '@pierre/diffs';
import type { GitHunkRef } from '@ptah-extension/shared';
import {
  createPierreDiffOptions,
  readDocumentThemeMode,
  registerPierreLanguages,
  type PierreDiffStyle,
  type PierreThemeMode,
} from './pierre-config';
import {
  hunkAnchor,
  resolveHunkHosts,
  verifyHunkMapping,
  type PierreHunkHost,
  type PierreHunkMappingError,
} from './pierre-hunk-mapping';

/** Template context for the per-hunk toolbar a consumer projects. */
export interface PierreHunkToolbarContext {
  $implicit: GitHunkRef;
  index: number;
}

type ParsedDiff =
  | { readonly fileDiff: FileDiffMetadata; readonly error: null }
  | { readonly fileDiff: null; readonly error: PierreHunkMappingError | null };

/**
 * Angular host for one `@pierre/diffs` `FileDiff` (implementation-plan
 * Component 17, Requirements 3.2 and 3.3).
 *
 * - The vanilla `FileDiff` is created imperatively against the
 *   `<diffs-container>` in this template and is disposed whenever a content
 *   input changes and when the component is destroyed (`afterRenderEffect`
 *   cleanup). The theme mode is applied in place instead.
 * - The container is passed as host-managed (`FileDiff`'s third constructor
 *   argument): Pierre then never removes it, and never appends its own
 *   light-DOM annotation/separator nodes — the hunk hosts below are the only
 *   light-DOM children, and Angular owns them.
 * - Each git hunk gets exactly one light-DOM `<div slot>`: the hunk's
 *   separator slot when Pierre rendered one, otherwise its line-annotation
 *   slot. Under `hunkSeparators: 'line-info'` at 1.5.1 Pierre renders no
 *   separator `<slot>` (only the deprecated `'custom'` mode does), so every
 *   hunk resolves to its annotation slot; the separator branch is decided from
 *   the rendered shadow tree, never assumed.
 * - The patch is handed to Pierre verbatim: CR bytes are never stripped.
 * - A hunk-mapping mismatch leaves the diff readable with no hunk hosts and a
 *   visible note; it never guesses an index.
 */
@Component({
  selector: 'ptah-pierre-diff-host',
  standalone: true,
  imports: [NgTemplateOutlet],
  // `<diffs-container>` is Pierre's custom element (registered by importing
  // `FileDiff`); it owns the shadow root and adopts Pierre's core stylesheet.
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mappingError(); as error) {
      <p
        class="px-2 py-1 text-xs text-base-content-muted"
        role="status"
        data-testid="pierre-mapping-error"
      >
        <!-- parse-failed and file-count render nothing; every other reason
             leaves the diff visible but read-only. -->
        {{
          error.reason === 'parse-failed' || error.reason === 'file-count'
            ? 'This diff could not be displayed.'
            : 'Hunk actions are unavailable for this file.'
        }}
      </p>
    }
    <diffs-container #container class="block">
      @for (host of hunkHosts(); track host.slotName) {
        <div
          [attr.slot]="host.slotName"
          role="group"
          [attr.aria-label]="'Hunk ' + (host.index + 1) + ' actions'"
          [attr.data-hunk-index]="host.index"
          data-testid="pierre-hunk-host"
        >
          @if (hunkToolbar(); as toolbar) {
            <ng-container
              *ngTemplateOutlet="
                toolbar;
                context: {
                  $implicit: hostedHunks()[host.index],
                  index: host.index,
                }
              "
            />
          }
        </div>
      }
    </diffs-container>
  `,
})
export class PierreDiffHostComponent {
  /** `GitDiffFileResult.patch`, verbatim. Takes precedence over the texts. */
  readonly patch = input<string | null>(null);
  /** In-memory diff sides, used only when `patch` is null. */
  readonly oldText = input<string | null>(null);
  readonly newText = input<string | null>(null);
  /** Display name and language hint for an in-memory diff. */
  readonly fileName = input('');
  /** `GitDiffFileResult.hunks`. Empty means no hunk actions are offered. */
  readonly hunks = input<readonly GitHunkRef[]>([]);
  readonly diffStyle = input<PierreDiffStyle>('split');
  readonly themeType = input<PierreThemeMode>(readDocumentThemeMode());
  readonly hunkToolbar = input<TemplateRef<PierreHunkToolbarContext> | null>(
    null,
  );

  private readonly _hunkHosts = signal<readonly PierreHunkHost[]>([]);
  private readonly _mappingError = signal<PierreHunkMappingError | null>(null);
  /**
   * The hunk list the current hosts were resolved against. The template reads
   * this, not the live `hunks` input, which can change one render before the
   * hosts are re-resolved.
   */
  protected readonly hostedHunks = signal<readonly GitHunkRef[]>([]);

  /** One host per git hunk, in hunk order; empty while read-only. */
  readonly hunkHosts = this._hunkHosts.asReadonly();
  /** Set when the file is shown read-only because hunks could not be mapped. */
  readonly mappingError = this._mappingError.asReadonly();

  private readonly container =
    viewChild.required<ElementRef<HTMLElement>>('container');
  private instance: FileDiff | null = null;

  constructor() {
    registerPierreLanguages();

    // Content inputs: a fresh FileDiff per change; the cleanup disposes the
    // previous one first and runs again on destroy.
    afterRenderEffect((onCleanup) => {
      const container = this.container().nativeElement;
      const patch = this.patch();
      const oldText = this.oldText();
      const newText = this.newText();
      const fileName = this.fileName();
      const hunks = this.hunks();
      const diffStyle = this.diffStyle();

      untracked(() =>
        this.mount(
          container,
          { patch, oldText, newText, fileName },
          hunks,
          diffStyle,
        ),
      );
      onCleanup(() => this.dispose(container));
    });

    // Theme: applied to the live instance, no re-parse.
    afterRenderEffect(() => {
      const mode = this.themeType();
      untracked(() => this.instance?.setThemeType(mode));
    });
  }

  private mount(
    container: HTMLElement,
    source: {
      patch: string | null;
      oldText: string | null;
      newText: string | null;
      fileName: string;
    },
    hunks: readonly GitHunkRef[],
    diffStyle: PierreDiffStyle,
  ): void {
    const parsed = this.parse(source);
    if (parsed.fileDiff === null) {
      this.publish([], parsed.error, []);
      return;
    }
    const fileDiff = parsed.fileDiff;

    const mappingError =
      hunks.length > 0 ? verifyHunkMapping(fileDiff.hunks, hunks) : null;
    const offerHunkHosts = hunks.length > 0 && mappingError === null;
    const annotations: DiffLineAnnotation[] = offerHunkHosts
      ? hunks.map((hunk) => hunkAnchor(hunk))
      : [];
    const annotationSlots = annotations.map((a) => getLineAnnotationName(a));
    const separatorTypes =
      diffStyle === 'unified'
        ? (['unified'] as const)
        : (['additions', 'deletions'] as const);

    const instance = new FileDiff(
      {
        ...createPierreDiffOptions(diffStyle, untracked(this.themeType)),
        onPostRender: (node, _instance, phase) => {
          if (phase === 'unmount') return;
          if (!offerHunkHosts) {
            this.publish([], mappingError, []);
            return;
          }
          const rendered = new Set(
            Array.from(
              node.shadowRoot?.querySelectorAll('slot[name]') ?? [],
              (slot) => slot.getAttribute('name') ?? '',
            ),
          );
          const result = resolveHunkHosts(
            hunks.length,
            (index) =>
              separatorTypes.map((type) =>
                getHunkSeparatorSlotName(type, index),
              ),
            (index) => annotationSlots[index],
            rendered,
          );
          this.publish(result.hosts, result.error, hunks);
        },
      },
      undefined,
      true,
    );
    this.instance = instance;
    instance.render({
      fileDiff,
      fileContainer: container,
      lineAnnotations: annotations,
    });
  }

  private parse(source: {
    patch: string | null;
    oldText: string | null;
    newText: string | null;
    fileName: string;
  }): ParsedDiff {
    try {
      if (source.patch !== null) {
        const files = parsePatchFiles(source.patch, undefined, true).flatMap(
          (parsed) => parsed.files,
        );
        if (files.length !== 1) {
          return {
            fileDiff: null,
            error: {
              reason: 'file-count',
              detail: `patch describes ${files.length} files, expected 1`,
            },
          };
        }
        return { fileDiff: files[0], error: null };
      }
      if (source.oldText === null && source.newText === null) {
        return { fileDiff: null, error: null };
      }
      const name = source.fileName;
      return {
        fileDiff: parseDiffFromFile(
          source.oldText === null ? null : { name, contents: source.oldText },
          source.newText === null ? null : { name, contents: source.newText },
          undefined,
          true,
        ),
        error: null,
      };
    } catch (error) {
      return {
        fileDiff: null,
        error: {
          reason: 'parse-failed',
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private publish(
    hosts: readonly PierreHunkHost[],
    error: PierreHunkMappingError | null,
    hunks: readonly GitHunkRef[],
  ): void {
    this.hostedHunks.set(hunks);
    if (!sameHosts(this._hunkHosts(), hosts)) this._hunkHosts.set(hosts);
    if (!sameError(this._mappingError(), error)) this._mappingError.set(error);
  }

  private dispose(container: HTMLElement): void {
    const instance = this.instance;
    this.instance = null;
    if (instance) {
      instance.cleanUp();
      // `cleanUp()` releases Pierre's listeners and observers but leaves the
      // rendered nodes in the shadow root; clear them so the next instance
      // starts from an empty tree. The adopted core stylesheet is not a child
      // node and survives.
      container.shadowRoot?.replaceChildren();
    }
    this.publish([], null, []);
  }
}

function sameHosts(
  a: readonly PierreHunkHost[],
  b: readonly PierreHunkHost[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (host, i) => host.index === b[i].index && host.slotName === b[i].slotName,
    )
  );
}

function sameError(
  a: PierreHunkMappingError | null,
  b: PierreHunkMappingError | null,
): boolean {
  return a === b || (a?.reason === b?.reason && a?.detail === b?.detail);
}

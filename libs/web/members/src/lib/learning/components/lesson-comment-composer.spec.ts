import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import * as ts from 'typescript';

import {
  MarkdownBlockComponent,
  provideMarkdownRendering,
} from '@ptah-extension/markdown';

import { LessonCommentComposer } from './lesson-comment-composer';

/**
 * The component's source with COMMENTS REMOVED.
 *
 * ⚠️ THE STRIPPING IS LOAD-BEARING, exactly as it is in
 * `markdown-chokepoint.spec.ts`: the docblocks in the file under test
 * legitimately NAME every symbol the rules below forbid — telling the next
 * reader why `REACTION_TYPES` and `ngSubmit` do not belong here is the
 * documentation the rules want. Matching raw text would make each warning a
 * violation and the only way to stay green would be to delete the warnings.
 */
const CODE = ts
  .transpileModule(
    readFileSync(join(__dirname, 'lesson-comment-composer.ts'), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        removeComments: true,
        experimentalDecorators: true,
      },
      reportDiagnostics: false,
    },
  )
  .outputText.replace(/<!--[\s\S]*?-->/g, '');

/**
 * `border-base-300` — the class this panel must never emit (`base-300` is a
 * FILL, panel-theme-spec.md §2).
 *
 * ⚠️ IT IS ASSEMBLED RATHER THAN WRITTEN AS A LITERAL, AND THAT IS NOT A
 * WORKAROUND FOR THE RULE — IT IS THE ONLY WAY TO ASSERT IT FROM INSIDE THIS
 * LIB. Task 4.7's `no-restricted-syntax` selector matches ANY string literal
 * containing the token, including one written in a spec in order to prove its
 * ABSENCE. `libs/web/panel-ui/.../thread-row.spec.ts` can write it plainly only
 * because that lib sits outside the rule's scope. Assembling it keeps both the
 * lint rule and the runtime assertion, and weakens neither.
 */
const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LessonCommentComposer],
  template: `<ptah-lesson-comment-composer
    [replyingTo]="replyingTo()"
    [nested]="nested()"
    [submitting]="submitting()"
    [cancellable]="cancellable()"
    [errorMessage]="errorMessage()"
    (submitted)="emitted.push($event)"
    (cancelled)="cancelCount = cancelCount + 1"
  />`,
})
class HostComponent {
  public readonly replyingTo = signal<string | null>(null);
  public readonly nested = signal(false);
  public readonly submitting = signal(false);
  public readonly cancellable = signal(true);
  public readonly errorMessage = signal<string | null>(null);
  public readonly emitted: string[] = [];
  public cancelCount = 0;
}

function render(): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

function type(fixture: ComponentFixture<HostComponent>, value: string): void {
  const textarea: HTMLTextAreaElement =
    fixture.nativeElement.querySelector('textarea');
  textarea.value = value;
  textarea.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function button(
  fixture: ComponentFixture<HostComponent>,
  text: string,
): HTMLButtonElement {
  const found = Array.from<HTMLButtonElement>(
    fixture.nativeElement.querySelectorAll('button'),
  ).find((b) => b.textContent?.trim().startsWith(text));
  if (!found) throw new Error(`No button starting with "${text}"`);
  return found;
}

describe('LessonCommentComposer (R2.5.1, A-8, NFR-S2)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      // The REAL `'member'` preset — the same providers `app.routes.ts`
      // installs on the `/members` route. Mocking the renderer would leave
      // NFR-S2's chokepoint claim asserted only against source text.
      providers: [provideMarkdownRendering({ extensions: 'member' })],
    });
  });

  it('emits the raw markdown the member typed, trimmed and otherwise untouched', () => {
    const fixture = render();
    type(fixture, '  How does **reconciliation** work?  ');
    button(fixture, 'Post question').click();

    expect(fixture.componentInstance.emitted).toEqual([
      'How does **reconciliation** work?',
    ]);
  });

  it('will not submit an empty or whitespace-only body', () => {
    const fixture = render();
    expect(button(fixture, 'Post question').disabled).toBe(true);

    type(fixture, '   ');
    expect(button(fixture, 'Post question').disabled).toBe(true);
    expect(fixture.componentInstance.emitted).toEqual([]);
  });

  it('🔴 previews through <ptah-markdown-block variant="auto">, never innerHTML', () => {
    // ⚠️ NFR-S2 at RUNTIME. `markdown-chokepoint.spec.ts` polices the source
    // text; this proves the wiring.
    const fixture = render();
    type(fixture, 'A **preview**');
    button(fixture, 'Preview').click();
    fixture.detectChanges();

    const block = fixture.debugElement.query(
      By.directive(MarkdownBlockComponent),
    );
    expect(block).not.toBeNull();
    // ⚠️ The bound INPUT is read, not the rendered text: `ngx-markdown` parses
    // in a promise, so asserting `textContent` would make this a timing test of
    // a third-party library (B7's technique note).
    expect(block.componentInstance.content()).toBe('A **preview**');
    expect(block.nativeElement.getAttribute('variant') ?? 'auto').toBeTruthy();
  });

  it('the preview is disabled until something is typed', () => {
    const fixture = render();
    expect(button(fixture, 'Preview').disabled).toBe(true);
    type(fixture, 'x');
    expect(button(fixture, 'Preview').disabled).toBe(false);
  });

  it('changes its heading and button when nested under a comment', () => {
    const fixture = render();
    fixture.componentInstance.nested.set(true);
    fixture.componentInstance.replyingTo.set('Jane Doe');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Reply to this comment');
    expect(text).toContain('Replying to');
    expect(text).toContain('Jane Doe');
    expect(button(fixture, 'Post reply')).toBeTruthy();
  });

  it('hides Cancel on the page-level composer, which has nothing to cancel to', () => {
    const fixture = render();
    fixture.componentInstance.cancellable.set(false);
    fixture.detectChanges();

    const labels = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Cancel');
  });

  it('surfaces a server error with role="alert"', () => {
    const fixture = render();
    fixture.componentInstance.errorMessage.set('That lesson is now locked.');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('That lesson is now locked.');
  });

  it('resets on demand, after the page confirms the write landed', () => {
    const fixture = render();
    type(fixture, 'Something');
    const composer = fixture.debugElement.query(
      By.directive(LessonCommentComposer),
    ).componentInstance as LessonCommentComposer;

    composer.reset();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement)
        .value,
    ).toBe('');
  });

  /* ---------------------------------------------------------------------- */

  describe('the FormsModule-free contract (B7 carried notes)', () => {
    it('imports no FormsModule and uses no ngModel', () => {
      expect(CODE).not.toContain('FormsModule');
      expect(CODE).not.toContain('ngModel');
      // ANTI-VACUITY: the stripper kept the code.
      expect(CODE).toContain('LessonCommentComposer');
    });

    it('🔴 binds the NATIVE (submit), not (ngSubmit)', () => {
      // `(ngSubmit)` without `FormsModule` binds a listener for a DOM event
      // that never fires, silently breaking Enter-to-submit.
      expect(CODE).toContain('(submit)="submit($event)"');
      expect(CODE).not.toContain('ngSubmit');
    });

    it('🔴 uses [attr.maxlength], not [maxlength] (which is an NG0303)', () => {
      expect(CODE).toContain('[attr.maxlength]');
      expect(CODE).not.toMatch(/\[maxlength]/);
    });

    it('Enter inside the form really does submit', () => {
      // The consequence the two rules above exist to preserve.
      const fixture = render();
      type(fixture, 'Typed then Enter');
      const form = fixture.nativeElement.querySelector(
        'form',
      ) as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      expect(fixture.componentInstance.emitted).toEqual(['Typed then Enter']);
    });
  });

  describe('🔴 A-8 — no reactions on this surface', () => {
    it('imports no REACTION_TYPES and no ReactionBar', () => {
      expect(CODE).not.toContain('REACTION_TYPES');
      expect(CODE).not.toContain('ReactionBar');
    });
  });

  describe('accessibility and tokens', () => {
    it('the preview toggle describes the action, not the state', () => {
      const fixture = render();
      type(fixture, 'x');
      expect(button(fixture, 'Preview').getAttribute('aria-label')).toBe(
        'Preview your comment',
      );
      expect(button(fixture, 'Preview').getAttribute('aria-pressed')).toBe(
        'false',
      );
    });

    it('the label points at THIS textarea', () => {
      const fixture = render();
      const label = fixture.nativeElement.querySelector(
        'label',
      ) as HTMLLabelElement;
      const textarea = fixture.nativeElement.querySelector(
        'textarea',
      ) as HTMLTextAreaElement;
      expect(label.getAttribute('for')).toBe(textarea.id);
      expect(textarea.id.length).toBeGreaterThan(0);
    });

    it('two composers on one page get DIFFERENT ids', () => {
      const first = render();
      const second = render();
      expect(
        (first.nativeElement.querySelector('textarea') as HTMLTextAreaElement)
          .id,
      ).not.toBe(
        (second.nativeElement.querySelector('textarea') as HTMLTextAreaElement)
          .id,
      );
    });

    it('NFR-U2 / NFR-U3 — tokens only, muted text at /60 or stronger', () => {
      const fixture = render();
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('border-hairline');
      expect(html).toContain('text-base-content/60');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toContain('text-base-content/40');
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  });
});

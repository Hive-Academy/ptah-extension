import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import * as ts from 'typescript';

import type { MemberLessonComment } from '@ptah-contracts/community';
import {
  MarkdownBlockComponent,
  provideMarkdownRendering,
} from '@ptah-extension/markdown';

import { lessonComment } from '../learning-fixtures';
import {
  LessonComments,
  type LessonCommentSubmission,
} from './lesson-comments';

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
    readFileSync(join(__dirname, 'lesson-comments.ts'), 'utf8'),
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
  imports: [LessonComments],
  template: `<ptah-lesson-comments
    [comments]="comments()"
    [submitting]="submitting()"
    [errorMessage]="errorMessage()"
    [busyOn]="busyOn()"
    [canSetAnswered]="canSetAnswered()"
    (submitted)="submissions.push($event)"
    (answeredToggled)="toggled.push($event)"
  />`,
})
class HostComponent {
  public readonly comments = signal<MemberLessonComment[]>([]);
  public readonly submitting = signal(false);
  public readonly errorMessage = signal<string | null>(null);
  public readonly busyOn = signal<string | null>(null);
  public readonly canSetAnswered = signal(true);
  public readonly submissions: LessonCommentSubmission[] = [];
  public readonly toggled: MemberLessonComment[] = [];
}

describe('LessonComments (R2.5, A-8, RK-12)', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideMarkdownRendering({ extensions: 'member' })],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  function render(comments: MemberLessonComment[]): void {
    fixture.componentInstance.comments.set(comments);
    fixture.detectChanges();
  }

  function rows(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-comment-id]',
      ),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 THE DEPTH GUARANTEE                                                  */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the indent is a BOOLEAN — never more than one level', () => {
    it('never indents past one level EVEN ON DEPTH-3 FIXTURE DATA', () => {
      // ⚠️ Deliberately malformed: the server repairs depth 3 to depth 2, so
      // this shape should never reach a browser. The renderer does not trust
      // that — it has no way to DRAW a third level.
      render([
        lessonComment({ id: 'a', parentId: null }),
        lessonComment({ id: 'b', parentId: 'a' }),
        lessonComment({ id: 'c', parentId: 'b' }),
        lessonComment({ id: 'd', parentId: 'c' }),
      ]);

      const indents = rows().map((row) => row.dataset['reply']);
      expect(indents).toEqual(['false', 'true', 'true', 'true']);
      expect(new Set(indents).size).toBeLessThanOrEqual(2);
    });

    it('🔴 the NEGATIVE CONTROL — a top-level and a nested row have DIFFERENT indents', () => {
      // A renderer that indented NOTHING would also satisfy "never more than
      // one level", so this is the half that gives the assertion above meaning.
      render([
        lessonComment({ id: 'a', parentId: null }),
        lessonComment({ id: 'b', parentId: 'a' }),
      ]);

      const [top, nested] = rows();
      expect(top.dataset['reply']).toBe('false');
      expect(nested.dataset['reply']).toBe('true');
      expect(top.className).not.toBe(nested.className);
      expect(nested.className).toContain('ml-6');
      expect(top.className).toContain('ml-0');
    });

    it('declares NO recursive component — the capability is absent, not clamped', () => {
      // The component does not render itself, and there is no depth counter.
      expect(CODE).not.toContain('<ptah-lesson-comments');
      expect(CODE).not.toContain('depth');
      expect(CODE).toContain('comment.parentId !== null');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 A-8                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('🔴 A-8 — no reactions anywhere on this surface', () => {
    it('imports no REACTION_TYPES and no ReactionBar', () => {
      expect(CODE).not.toContain('REACTION_TYPES');
      expect(CODE).not.toContain('ReactionBar');
      expect(CODE).not.toContain('reaction-bar');
    });

    it('renders no reaction affordance', () => {
      render([lessonComment()]);
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).not.toContain('ptah-reaction-bar');
      expect(html.toLowerCase()).not.toContain('insightful');
      expect(html.toLowerCase()).not.toContain('celebrate');
    });

    it('does NOT import AcceptedAnswerBadge — that is a forum concept', () => {
      // An accepted answer (chosen by a topic author) and an answered question
      // are different vocabularies; one component must not serve both.
      expect(CODE).not.toContain('AcceptedAnswerBadge');
      expect(CODE).toContain('StatusBadge');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('the "Answered" treatment', () => {
    it('renders a StatusBadge on an answered comment and none otherwise', () => {
      render([
        lessonComment({ id: 'a', answered: true }),
        lessonComment({ id: 'b', answered: false }),
      ]);

      const badges = (fixture.nativeElement as HTMLElement).querySelectorAll(
        'ptah-status-badge',
      );
      expect(badges).toHaveLength(1);
      expect(badges[0].textContent).toContain('Answered');
    });

    it('the toggle describes the ACTION, and flips with the state', () => {
      render([lessonComment({ id: 'a', answered: false })]);
      const toggle = Array.from<HTMLButtonElement>(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((b) =>
        b.textContent?.includes('Mark answered'),
      ) as HTMLButtonElement;

      expect(toggle.getAttribute('aria-label')).toBe(
        'Mark this question answered',
      );
      expect(toggle.getAttribute('aria-pressed')).toBe('false');

      toggle.click();
      expect(fixture.componentInstance.toggled.map((c) => c.id)).toEqual(['a']);

      render([lessonComment({ id: 'a', answered: true })]);
      const untoggle = Array.from<HTMLButtonElement>(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((b) =>
        b.textContent?.includes('Unmark answered'),
      ) as HTMLButtonElement;
      expect(untoggle.getAttribute('aria-label')).toBe(
        'Remove the answered mark from this question',
      );
      expect(untoggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('🔴 an ordinary member sees NO answered control at all (R2.5.3)', () => {
      // The e2e proved the alternative: `PUT …/answered` is
      // admin-or-course-author only, so leaving the button visible ships an
      // affordance that always answers 403.
      fixture.componentInstance.canSetAnswered.set(false);
      render([lessonComment({ id: 'a', answered: false })]);

      const labels = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).map((b) => b.textContent?.trim());
      expect(labels).not.toContain('Mark answered');
      // …and the Reply control is untouched, so the gate is specific.
      expect(labels).toContain('Reply');
    });

    it('an answered BADGE still renders for a member who cannot set it', () => {
      // Seeing that a question was resolved is not the same permission as
      // resolving one.
      fixture.componentInstance.canSetAnswered.set(false);
      render([lessonComment({ id: 'a', answered: true })]);
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          'ptah-status-badge',
        ),
      ).toHaveLength(1);
    });

    it('a REPLY carries no answered toggle — only a question can be answered', () => {
      render([
        lessonComment({ id: 'a', parentId: null }),
        lessonComment({ id: 'b', parentId: 'a' }),
      ]);
      const reply = rows()[1];
      expect(reply.querySelectorAll('button')).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('bodies reach the ONE renderer', () => {
    it('every live body goes through <ptah-markdown-block>', () => {
      render([
        lessonComment({ id: 'a', bodyMarkdown: 'First **body**' }),
        lessonComment({ id: 'b', parentId: 'a', bodyMarkdown: 'Second body' }),
      ]);

      // ⚠️ Read the bound INPUT, not the rendered text — `ngx-markdown` parses
      // in a promise (B7's technique note).
      const blocks = fixture.debugElement.queryAll(
        By.directive(MarkdownBlockComponent),
      );
      expect(blocks.map((b) => b.componentInstance.content())).toEqual([
        'First **body**',
        'Second body',
      ]);
    });

    it('🔴 a TOMBSTONE renders its placeholder and NEVER reaches the renderer', () => {
      // Passing the placeholder — or worse, `''` — to the markdown renderer is
      // how a removal reads as a rendering bug (B7's finding).
      render([
        lessonComment({
          id: 'a',
          deleted: true,
          authorName: null,
          bodyMarkdown: 'This comment was removed.',
        }),
      ]);

      expect(
        fixture.debugElement.queryAll(By.directive(MarkdownBlockComponent)),
      ).toHaveLength(0);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'This comment was removed.',
      );
    });

    it('a tombstone keeps its children attached beneath it', () => {
      render([
        lessonComment({ id: 'a', deleted: true, bodyMarkdown: 'removed' }),
        lessonComment({ id: 'b', parentId: 'a', bodyMarkdown: 'still here' }),
      ]);
      expect(rows()).toHaveLength(2);
      expect(rows()[1].dataset['reply']).toBe('true');
    });

    it('an unknown author renders a stated fallback, not an empty span', () => {
      render([lessonComment({ authorName: null })]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Unknown',
      );
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('composing', () => {
    it('emits a top-level submission with parentId null', () => {
      render([]);
      const textarea = (fixture.nativeElement as HTMLElement).querySelector(
        'textarea',
      ) as HTMLTextAreaElement;
      textarea.value = 'A question';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (
        (fixture.nativeElement as HTMLElement).querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement
      ).click();

      expect(fixture.componentInstance.submissions).toEqual([
        { bodyMarkdown: 'A question', parentId: null },
      ]);
    });

    it('emits a reply carrying the parent id, and only from a top-level row', () => {
      render([lessonComment({ id: 'a', parentId: null })]);
      (
        Array.from<HTMLButtonElement>(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
        ).find((b) => b.textContent?.trim() === 'Reply') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      const nested = rows()[0].querySelector('textarea') as HTMLTextAreaElement;
      nested.value = 'A reply';
      nested.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (
        rows()[0].querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement
      ).click();

      expect(fixture.componentInstance.submissions).toEqual([
        { bodyMarkdown: 'A reply', parentId: 'a' },
      ]);
    });

    it('opening an inline reply hides the page-level composer', () => {
      render([lessonComment({ id: 'a' })]);
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          'ptah-lesson-comment-composer',
        ),
      ).toHaveLength(1);

      (
        Array.from<HTMLButtonElement>(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
        ).find((b) => b.textContent?.trim() === 'Reply') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      // One composer, and it is the nested one — never two textareas competing
      // for the member's next keystroke.
      const composers = (fixture.nativeElement as HTMLElement).querySelectorAll(
        'ptah-lesson-comment-composer',
      );
      expect(composers).toHaveLength(1);
      expect(rows()[0].contains(composers[0])).toBe(true);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('headings, empty state and tokens', () => {
    it('counts what it rendered rather than recounting the rule', () => {
      render([lessonComment({ id: 'a' })]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        '1 question',
      );

      render([lessonComment({ id: 'a' }), lessonComment({ id: 'b' })]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        '2 questions',
      );
    });

    it('an empty thread invites the first question rather than reporting a zero', () => {
      render([]);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No questions on this lesson yet');
      expect(text).toContain('Discuss this lesson');
      expect(text).not.toContain('0 questions');
    });

    it('NFR-U2 / NFR-U3 — tokens only, muted text at /60 or stronger', () => {
      render([lessonComment()]);
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('border-hairline');
      expect(html).toContain('text-base-content-muted');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toMatch(/text-base-content\/\d+/);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/\bamber-\d{2,3}\b/);
    });
  });
});

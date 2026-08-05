import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import * as ts from 'typescript';

import { LOCK_REASONS, type LockReason } from '@ptah-contracts/community';

import { LockedModuleNotice } from './locked-module-notice';

/**
 * The component's source with COMMENTS REMOVED.
 *
 * ⚠️ THE STRIPPING IS LOAD-BEARING, exactly as it is in
 * `markdown-chokepoint.spec.ts`. This file's docblocks DISCUSS `releaseAt` and
 * `default:` — telling the next reader why neither belongs in the code is the
 * documentation the rule wants — so matching raw text would make every warning
 * a violation and the only way to stay green would be to delete the warnings.
 * `ts.transpileModule` is used rather than a regexp because a regexp cannot
 * tell a `//` inside a URL from a line comment.
 */
const CODE = ts
  .transpileModule(
    readFileSync(join(__dirname, 'locked-module-notice.ts'), 'utf8'),
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
  imports: [LockedModuleNotice],
  template: `
    <ptah-locked-module-notice
      [reason]="reason()"
      [unlocksAt]="unlocksAt()"
      [blockingModuleTitle]="blockingModuleTitle()"
    />
  `,
})
class Host {
  public readonly reason = signal<LockReason>('not_released');
  public readonly unlocksAt = signal<string | null>('2027-12-25T09:00:00.000Z');
  public readonly blockingModuleTitle = signal<string | null>(null);
}

describe('LockedModuleNotice (R2.4.1, R2.4.2, R2.4.5)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(
      /\s+/g,
      ' ',
    );
  }

  /* ---------------------------------------------------------------------- */

  describe("'not_released' — the DATE rule (R2.4.1)", () => {
    it('says when it unlocks, in plain language', () => {
      expect(text()).toContain('This module is not open yet');
      expect(text()).toContain('Unlocks on');
      expect(text()).toContain('December 25, 2027');
    });

    it('🔴 renders a real <time datetime> carrying the MACHINE value', () => {
      // A flattened string loses the `<time>` semantics entirely; the attribute
      // is what a screen reader and a scraper both read.
      const time = fixture.debugElement.query(By.css('time'))
        .nativeElement as HTMLElement;

      expect(time.getAttribute('datetime')).toBe('2027-12-25T09:00:00.000Z');
      expect(time.textContent?.trim()).toBe('December 25, 2027');
    });

    it('falls back to a dateless sentence when unlocksAt is null', () => {
      // Inventing a date because the field is empty is worse than saying less.
      fixture.componentInstance.unlocksAt.set(null);
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('time'))).toBeNull();
      expect(text()).toContain('opens later in the programme');
      expect(text()).not.toContain('Invalid');
      expect(text()).not.toContain('NaN');
    });
  });

  describe("'previous_module_incomplete' — the SEQUENTIAL rule (R2.4.2)", () => {
    beforeEach(() => {
      fixture.componentInstance.reason.set('previous_module_incomplete');
      fixture.componentInstance.unlocksAt.set(null);
      fixture.componentInstance.blockingModuleTitle.set('Foundations');
      fixture.detectChanges();
    });

    it('names the module that has to be finished', () => {
      expect(text()).toContain('Finish the previous module first');
      expect(text()).toContain(
        'Complete every lesson in Foundations to unlock this module.',
      );
    });

    it('🔴 renders NO date and NO <time> — it unlocks on an action, not a clock', () => {
      expect(fixture.debugElement.query(By.css('time'))).toBeNull();
      expect(text()).not.toContain('Unlocks on');
    });

    it('falls back to generic copy when the blocking title is unknown', () => {
      fixture.componentInstance.blockingModuleTitle.set(null);
      fixture.detectChanges();
      expect(text()).toContain(
        'Complete every lesson in the previous module to unlock this module.',
      );
    });

    it('IGNORES a stray unlocksAt on this reason', () => {
      // The contract says `null`, but a server that sent one anyway must not
      // produce a countdown to a moment that means nothing.
      fixture.componentInstance.unlocksAt.set('2027-12-25T09:00:00.000Z');
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('time'))).toBeNull();
      expect(text()).not.toContain('Unlocks on');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 the copy map is exhaustive over LOCK_REASONS', () => {
    it('every reason on the contract renders its OWN copy', () => {
      const seen = new Set<string>();

      for (const reason of LOCK_REASONS) {
        fixture.componentInstance.reason.set(reason);
        fixture.componentInstance.unlocksAt.set(
          reason === 'not_released' ? '2027-12-25T09:00:00.000Z' : null,
        );
        fixture.detectChanges();

        const rendered = text();
        expect(rendered.trim().length).toBeGreaterThan(20);
        expect(seen.has(rendered)).toBe(false);
        seen.add(rendered);
      }

      expect(seen.size).toBe(LOCK_REASONS.length);
    });

    it('a third reason would be a COMPILE error, not a blank notice', () => {
      // The device asserted as source text, because the compile error it
      // describes cannot be observed from inside a passing suite. A switch
      // statement with a fallthrough branch would ship an empty notice instead.
      const declaration = readFileSync(
        join(__dirname, 'locked-module-notice.ts'),
        'utf8',
      );
      expect(declaration).toContain('Record<LockReason,');
      // The transpiled code carries no `switch` at all, so there is no
      // fallthrough branch a new reason could land in.
      expect(CODE).not.toContain('switch');
      expect(CODE).not.toContain('default:');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('the lock is a SERVER fact', () => {
    it('never constructs a clock comparison against the release date', () => {
      // `Date.now()`, `new Date() <`, or a read of the raw `releaseAt` column
      // would each mean the browser re-deciding a question the server already
      // answered, and drifting from it (R2.4.5). Asserted against the
      // COMMENT-STRIPPED code — the docblock above legitimately names all
      // three while forbidding them.
      expect(CODE).not.toContain('Date.now()');
      expect(CODE).not.toMatch(/new Date\(\)\s*[<>]/);
      expect(CODE).not.toContain('releaseAt');
      // ANTI-VACUITY: the stripper kept the code it was meant to keep.
      expect(CODE).toContain('LockedModuleNotice');
      expect(CODE).toContain('not_released');
    });
  });

  describe('accessibility and tokens', () => {
    it('is announced as a state with its reason, not as loose text', () => {
      const note = fixture.debugElement.query(By.css('[role="note"]'))
        .nativeElement as HTMLElement;
      expect(note.getAttribute('aria-label')).toMatch(/^Locked\. /);
      expect(note.getAttribute('aria-label')).toContain('December 25, 2027');
    });

    it('🔴 is not colour-alone — a padlock icon plus text (WCAG 1.4.1)', () => {
      expect(
        fixture.debugElement.queryAll(By.css('lucide-angular')).length,
      ).toBeGreaterThanOrEqual(1);
      expect(text()).toContain('not open yet');
    });

    it('NFR-U2 — hairline borders, base-200 surface, base-300 never as a border', () => {
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('border-hairline');
      expect(html).toContain('bg-base-200');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    it('NFR-U3 — muted text is base-content/60 or stronger', () => {
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('text-base-content/60');
      expect(html).not.toContain('text-base-content/40');
    });
  });
});

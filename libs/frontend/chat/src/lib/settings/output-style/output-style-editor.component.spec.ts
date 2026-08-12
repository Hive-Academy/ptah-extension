/**
 * OutputStyleEditorComponent specs.
 *
 * The `jest.mock('ngx-markdown', …)` block below is copied from
 * `settings.component.spec.ts` and must stay first in the file — the editor
 * renders its preview through `ptah-markdown-block`, which pulls in the real
 * `ngx-markdown` ESM otherwise and the suite will not run.
 *
 * What is asserted here, and why each one is a requirement rather than taste:
 *
 *   - Req 3.5 — a blank or whitespace-only name blocks the submit with an
 *     inline error and never reaches the RPC surface.
 *   - Req 6.4 — the keep-coding-instructions toggle defaults ON.
 *   - Req 6.2 / 6.3 / G8 — the OFF warning states the SMALLER, Ptah-specific
 *     effect: the SDK's section goes, Ptah's own behaviour prompt stays. It may
 *     not claim the style replaces the agent's behaviour outright.
 *   - E7 / G7 — no `force-for-plugin` control and no `turn-reminder` control
 *     exist anywhere in this subtree.
 *   - The preview goes through `ptah-markdown-block` and no template in the
 *     subtree contains `[innerHTML]`.
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }

  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}

  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OutputStyleDetail } from '@ptah-extension/shared';
import { OutputStyleEditorComponent } from './output-style-editor.component';
import { OutputStyleStore } from './output-style.store';

const COMPONENT_FILES = [
  'output-style-editor.component.ts',
  'output-style-list.component.ts',
  'output-style-config.component.ts',
] as const;

const EXISTING_STYLE: OutputStyleDetail = {
  name: 'Simplified Technical English',
  tier: 'user',
  description: 'Short sentences, plain words.',
  keepCodingInstructions: false,
  editable: true,
  deletable: true,
  body: '# Style\n\nWrite short sentences.',
  fileName: 'simplified-technical-english.md',
  relativePath: '~/.claude/output-styles/simplified-technical-english.md',
  mtime: 1_700_000_000_000,
  byteLength: 42,
};

describe('OutputStyleEditorComponent', () => {
  let save: jest.Mock;
  let fixture: ComponentFixture<OutputStyleEditorComponent>;
  let component: OutputStyleEditorComponent;

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function setInputValue(selector: string, value: string): void {
    const element: HTMLInputElement =
      fixture.nativeElement.querySelector(selector);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    save = jest.fn().mockResolvedValue(null);

    TestBed.configureTestingModule({
      imports: [OutputStyleEditorComponent],
      providers: [
        {
          provide: OutputStyleStore,
          useValue: { saving: signal(false), save },
        },
      ],
    });

    fixture = TestBed.createComponent(OutputStyleEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('name validation (Req 3.5)', () => {
    it('blocks submit with an inline error when the name is blank', async () => {
      setInputValue('#output-style-description', 'Fewer words.');

      await component.submit();
      fixture.detectChanges();

      expect(save).not.toHaveBeenCalled();
      expect(component.showNameError()).toBe(true);
      expect(
        fixture.nativeElement.querySelector('#output-style-name-error'),
      ).not.toBeNull();
      expect(text()).toContain('Give the style a name');
    });

    it('blocks submit when the name is whitespace only', async () => {
      setInputValue('#output-style-name', '   ');
      setInputValue('#output-style-description', 'Fewer words.');

      await component.submit();
      fixture.detectChanges();

      expect(save).not.toHaveBeenCalled();
      expect(component.showNameError()).toBe(true);
    });

    it('marks the name field invalid for assistive technology', async () => {
      await component.submit();
      fixture.detectChanges();

      const input = fixture.nativeElement.querySelector('#output-style-name');
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('saves once both required fields carry text', async () => {
      setInputValue('#output-style-name', 'Brief');
      setInputValue('#output-style-description', 'Fewer words.');

      await component.submit();

      expect(save).toHaveBeenCalledWith({
        tier: 'user',
        name: 'Brief',
        description: 'Fewer words.',
        keepCodingInstructions: true,
        body: '',
      });
    });
  });

  describe('keep-coding-instructions toggle', () => {
    it('defaults ON for a new style (Req 6.4)', () => {
      expect(component.keepCodingInstructions()).toBe(true);

      const toggle = fixture.nativeElement.querySelector(
        'input[type="checkbox"]',
      );
      expect(toggle.checked).toBe(true);
    });

    it('states that the style is ADDED TO normal behaviour while ON (Req 6.2)', () => {
      const hint = fixture.nativeElement.querySelector(
        '[data-test="keep-instructions-on-hint"]',
      );

      expect(hint).not.toBeNull();
      expect(hint.textContent).toContain(
        "added to the agent's normal coding behaviour",
      );
      expect(
        fixture.nativeElement.querySelector(
          '[data-test="keep-instructions-off-warning"]',
        ),
      ).toBeNull();
    });

    it('shows a non-blocking OFF warning carrying the Ptah-specific qualifier (Req 6.3/6.5, G8)', () => {
      component.keepCodingInstructions.set(false);
      fixture.detectChanges();

      const warning = fixture.nativeElement.querySelector(
        '[data-test="keep-instructions-off-warning"]',
      );
      expect(warning).not.toBeNull();

      const copy = warning.textContent.replace(/\s+/g, ' ');

      // The true, smaller in-Ptah effect: the SDK section goes, Ptah's own
      // behaviour prompt is still appended unconditionally.
      expect(copy).toContain("removes the SDK's built-in coding instructions");
      expect(copy).toContain(
        "Ptah's own engineering behaviour is still appended to every session",
      );
      expect(copy).toContain('smaller than in the');
      expect(copy).toContain('redefine');

      // It must NOT make the unqualified CLI-strength claim.
      expect(copy).not.toMatch(/replaces the agent/i);
      expect(copy).not.toMatch(/replaces .*default coding instructions/i);

      // Non-blocking: the submit button stays enabled.
      const submit = fixture.nativeElement.querySelector(
        'button[type="submit"]',
      );
      expect(submit.disabled).toBe(false);
    });

    it('seeds the toggle from an existing style rather than forcing ON', () => {
      fixture.componentRef.setInput('draft', EXISTING_STYLE);
      fixture.detectChanges();

      expect(component.keepCodingInstructions()).toBe(false);
    });
  });

  describe('editing an existing style', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('draft', EXISTING_STYLE);
      fixture.detectChanges();
    });

    it('seeds every field and carries the E8 guard stamp into the save', async () => {
      expect(component.name()).toBe('Simplified Technical English');
      expect(component.body()).toBe('# Style\n\nWrite short sentences.');
      expect(component.tierLocked()).toBe(true);

      await component.submit();

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: 'user',
          originalName: 'Simplified Technical English',
          expectedMtime: 1_700_000_000_000,
          expectedByteLength: 42,
        }),
      );
    });

    it('warns that renaming the active style rebinds the selection (Req 4.4)', () => {
      fixture.componentRef.setInput(
        'activeName',
        'Simplified Technical English',
      );
      component.name.set('STE');
      fixture.detectChanges();

      expect(component.showRebindNote()).toBe(true);
      expect(text()).toContain('Renaming it updates the selection');
    });

    it('offers an explicit overwrite when the file already exists, and never overwrites silently', async () => {
      save.mockResolvedValueOnce({
        code: 'FILE_EXISTS',
        message: 'A style file with that name already exists in this tier.',
      });

      await component.submit();
      fixture.detectChanges();

      expect(component.conflict()?.code).toBe('FILE_EXISTS');
      expect(save.mock.calls[0][0].overwrite).toBeUndefined();
      expect(text()).toContain('Replace it');

      save.mockResolvedValueOnce(null);
      await component.confirmOverwrite();

      expect(save.mock.calls[1][0].overwrite).toBe(true);
    });
  });

  describe('markdown preview', () => {
    it('renders the body through ptah-markdown-block, never raw HTML', () => {
      component.body.set('# Heading');
      component.showPreview.set(true);
      fixture.detectChanges();

      const preview = fixture.nativeElement.querySelector(
        '[data-test="body-preview"]',
      );
      expect(preview.querySelector('ptah-markdown-block')).not.toBeNull();
      expect(
        preview.querySelector('[data-test="markdown-stub"]').textContent,
      ).toContain('# Heading');
    });

    it('shows a placeholder instead of an empty renderer', () => {
      component.showPreview.set(true);
      fixture.detectChanges();

      expect(text()).toContain('Nothing to preview yet');
    });
  });

  describe('controls that must not exist', () => {
    /**
     * Comments are stripped before scanning: the components document WHY these
     * keys are absent, and that prose must not be mistaken for a control.
     */
    const sources = COMPONENT_FILES.map((file) =>
      readFileSync(join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    );

    it('exposes no force-for-plugin control (E7)', () => {
      expect(text()).not.toMatch(/force.for.plugin/i);
      for (const source of sources) {
        expect(source).not.toMatch(/forceForPlugin|force-for-plugin/);
      }
    });

    it('exposes no turn-reminder field and promises no per-turn reinforcement (G7)', () => {
      expect(text()).not.toMatch(/turn.reminder/i);
      expect(text()).not.toMatch(/every turn/i);
      for (const source of sources) {
        expect(source).not.toMatch(/turnReminder|turn-reminder/);
      }
    });

    it('binds no template in this subtree with [innerHTML]', () => {
      for (const source of sources) {
        expect(source).not.toContain('[innerHTML]');
        expect(source).not.toContain('innerHTML');
      }
    });
  });

  describe('repair mode for an unreadable file (Req 7.5)', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('repair', {
        fileName: 'broken.md',
        relativePath: '.claude/output-styles/broken.md',
        tier: 'project',
        error: {
          code: 'YAML_PARSE',
          line: 3,
          message: 'The frontmatter is not valid YAML (line 3).',
        },
        openable: true,
      });
      fixture.detectChanges();
    });

    it('seeds the name from the file so the rewrite lands on the same file', () => {
      expect(component.name()).toBe('broken');
      expect(component.tier()).toBe('project');
      expect(component.tierLocked()).toBe(true);
    });

    it('says plainly that the original text is not shown and will be replaced', () => {
      const copy = text().replace(/\s+/g, ' ');
      expect(copy).toContain('The frontmatter is not valid YAML (line 3).');
      expect(copy).toContain('its text cannot be shown here');
      expect(copy).toContain('.claude/output-styles/broken.md');
    });

    it('saves with overwrite so the broken file is actually replaced', async () => {
      setInputValue('#output-style-description', 'Fixed.');

      await component.submit();

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'project', overwrite: true }),
      );
    });
  });
});

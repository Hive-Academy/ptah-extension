import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { FILE_LINK_OPENER, VSCodeService } from '@ptah-extension/core';
import type { ExecutionNode } from '@ptah-extension/shared';
import { ToolCallHeaderComponent } from './tool-call-header.component';

/**
 * Header parity (parity-inventory section 4) and R7.1-R7.3, R7.5. Both
 * webviews render the same header (decision #8), so every case runs with the
 * host flag true and false; file opening goes through `FILE_LINK_OPENER` in
 * both.
 */
describe.each([true, false])(
  'ToolCallHeaderComponent (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<ToolCallHeaderComponent>;
    let openMock: jest.Mock<Promise<void>, [unknown]>;
    let copyMock: jest.Mock<boolean, [string]>;

    function node(partial: Partial<ExecutionNode>): ExecutionNode {
      return {
        id: 'n1',
        type: 'tool',
        status: 'complete',
        content: null,
        children: [],
        startTime: 0,
        ...partial,
      } as ExecutionNode;
    }

    function render(
      partial: Partial<ExecutionNode>,
      isCollapsed = true,
    ): HTMLElement {
      fixture.componentRef.setInput('node', node(partial));
      fixture.componentRef.setInput('isCollapsed', isCollapsed);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    function toggle(host: HTMLElement): HTMLButtonElement {
      return host.querySelector('button[aria-expanded]') as HTMLButtonElement;
    }

    beforeEach(async () => {
      openMock = jest.fn().mockResolvedValue(undefined);
      copyMock = jest.fn().mockReturnValue(true);
      await TestBed.configureTestingModule({
        imports: [ToolCallHeaderComponent],
        providers: [
          { provide: FILE_LINK_OPENER, useValue: { open: openMock } },
          { provide: Clipboard, useValue: { copy: copyMock } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(ToolCallHeaderComponent);
    });

    afterEach(() => fixture.destroy());

    it('shows the gold "Ptah Superpower" and short tool-name badges for mcp__ptah tools', () => {
      const host = render({
        toolName: 'mcp__ptah__workspace_analyze',
        toolInput: {},
        toolOutput: 'ok',
      });
      expect(
        host.querySelector('.ptah-superpower-badge')?.textContent,
      ).toContain('Ptah Superpower');
      expect(
        host.querySelector('.ptah-tool-name-badge')?.textContent?.trim(),
      ).toBe('workspace analyze');
    });

    it('shows the tool-name badge with its status colour for other tools', () => {
      const host = render({
        toolName: 'Grep',
        toolInput: { pattern: 'needle' },
        status: 'error',
      });
      const badge = host.querySelector('.badge.badge-error') as HTMLElement;
      expect(badge.textContent?.trim()).toBe('Grep');
      expect(host.querySelector('.ptah-superpower-badge')).toBeNull();
    });

    it('reflects the collapse state in aria-expanded and emits on toggle click', () => {
      let host = render({ toolName: 'Grep', toolInput: { pattern: 'x' } });
      expect(toggle(host).getAttribute('aria-expanded')).toBe('false');
      expect(toggle(host).hasAttribute('aria-controls')).toBe(false);

      const emitted = jest.fn();
      fixture.componentInstance.toggleClicked.subscribe(emitted);
      toggle(host).click();
      expect(emitted).toHaveBeenCalledTimes(1);

      host = render({ toolName: 'Grep', toolInput: { pattern: 'x' } }, false);
      expect(toggle(host).getAttribute('aria-expanded')).toBe('true');
      expect(toggle(host).getAttribute('aria-controls')).toBe('tool-n1');
    });

    it('shows a file tool as bold name, muted directory, full path title and language label', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/app/main.ts' },
        toolOutput: 'x',
      });
      const path = host.querySelector(
        '[data-testid="tool-file-path"]',
      ) as HTMLElement;
      expect(path.getAttribute('title')).toBe('/repo/src/app/main.ts');
      expect(path.querySelector('.font-semibold')?.textContent?.trim()).toBe(
        'main.ts',
      );
      expect(
        path.querySelector('.text-base-content-muted')?.textContent?.trim(),
      ).toBe('/repo/src/app');
      expect(
        host
          .querySelector('[data-testid="tool-language"]')
          ?.textContent?.trim(),
      ).toBe('TypeScript');
    });

    it('labels an unknown extension as plain text', () => {
      const host = render({
        toolName: 'Write',
        toolInput: { file_path: 'notes.unknownext', content: 'x' },
      });
      expect(
        host
          .querySelector('[data-testid="tool-language"]')
          ?.textContent?.trim(),
      ).toBe('Plain text');
    });

    it('renders the open-file button as a sibling of the toggle and opens through FILE_LINK_OPENER', () => {
      const host = render({
        toolName: 'Edit',
        toolInput: {
          file_path: 'C:\\repo\\lib\\util.py',
          old_string: 'a',
          new_string: 'b',
        },
      });
      const open = host.querySelector(
        'button[aria-label="Open util.py"]',
      ) as HTMLButtonElement;
      expect(open).not.toBeNull();
      expect(toggle(host).contains(open)).toBe(false);
      expect(toggle(host).querySelector('button')).toBeNull();
      expect(open.getAttribute('title')).toBe('Open C:\\repo\\lib\\util.py');

      open.click();
      expect(openMock).toHaveBeenCalledWith({
        path: 'C:\\repo\\lib\\util.py',
        origin: host,
      });
    });

    it('logs an open-file rejection instead of throwing', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      openMock.mockRejectedValueOnce(new Error('blocked'));
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/a/b.md' },
      });
      (
        host.querySelector(
          'button[aria-label="Open b.md"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
      expect(errorSpy).toHaveBeenCalledWith(
        '[ToolCallHeader] Failed to open',
        '/a/b.md',
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });

    it('has no open-file button for tools without a file path', () => {
      const host = render({ toolName: 'Bash', toolInput: { command: 'ls' } });
      expect(host.querySelector('button[aria-label^="Open"]')).toBeNull();
    });

    it('shows the Bash description, with the full command in the title', () => {
      const host = render({
        toolName: 'Bash',
        toolInput: { command: 'npm test', description: 'Run the tests' },
      });
      const description = toggle(host).querySelector(
        'span.truncate[title]',
      ) as HTMLElement;
      expect(description.textContent?.trim()).toBe('Run the tests');
      expect(description.getAttribute('title')).toBe('npm test');
    });

    it('truncates a Bash command without description to 40 characters in the toggle', () => {
      const command = 'x'.repeat(55);
      const host = render({ toolName: 'Bash', toolInput: { command } });
      const description = toggle(host).querySelector(
        'span.truncate[title]',
      ) as HTMLElement;
      expect(description.textContent?.trim()).toBe('x'.repeat(40) + '...');
      expect(description.getAttribute('title')).toBe(command);
    });

    it('shows the full command row: one line while collapsed, wrapping when expanded', () => {
      const command =
        'npx nx test chat --testPathPattern=a/very/long/path/that/goes/on --maxWorkers=2';
      let host = render({ toolName: 'Bash', toolInput: { command } });
      let row = host.querySelector(
        '[data-testid="tool-command-row"]',
      ) as HTMLElement;
      let code = row.querySelector('code') as HTMLElement;
      expect(row.textContent).toContain('$');
      expect(code.textContent).toBe(command);
      expect(code.getAttribute('title')).toBe(command);
      expect(code.classList.contains('truncate')).toBe(true);
      expect(code.classList.contains('whitespace-pre-wrap')).toBe(false);

      host = render({ toolName: 'Bash', toolInput: { command } }, false);
      row = host.querySelector(
        '[data-testid="tool-command-row"]',
      ) as HTMLElement;
      code = row.querySelector('code') as HTMLElement;
      expect(code.classList.contains('truncate')).toBe(false);
      expect(code.classList.contains('whitespace-pre-wrap')).toBe(true);
      expect(code.classList.contains('break-all')).toBe(true);
    });

    it('copies the exact command with "Copy command"', () => {
      const command = 'git log --oneline -n 5 | cat';
      const host = render({ toolName: 'Bash', toolInput: { command } });
      const copy = host.querySelector(
        'button[aria-label="Copy command"]',
      ) as HTMLButtonElement;
      expect(toggle(host).contains(copy)).toBe(false);
      copy.click();
      expect(copyMock).toHaveBeenCalledWith(command);
    });

    it('never scrolls sideways: no horizontal-scroll class anywhere in the header', () => {
      const host = render(
        {
          toolName: 'Bash',
          toolInput: { command: 'y'.repeat(300) },
        },
        false,
      );
      expect(host.querySelector('[class*="overflow-x"]')).toBeNull();
      expect(host.querySelector('[class*="whitespace-nowrap"]')).toBeNull();
    });

    it.each([
      ['complete', 'succeeded', 'Command succeeded'],
      ['error', 'failed', 'Command failed'],
      ['streaming', 'running', 'Command running'],
    ] as const)(
      'shows a %s Bash call as "%s" with an icon named "%s" (no exit code, A9)',
      (status, text, label) => {
        const host = render({
          toolName: 'Bash',
          status,
          toolInput: { command: 'ls' },
        });
        const pill = host.querySelector(
          '[data-testid="command-outcome"]',
        ) as HTMLElement;
        expect(pill.textContent?.trim()).toBe(text);
        expect(
          pill.querySelector('[role="img"]')?.getAttribute('aria-label'),
        ).toBe(label);
        expect(pill.textContent).not.toContain('exit code');
      },
    );

    it('shows no outcome pill for a pending Bash call', () => {
      const host = render({
        toolName: 'Bash',
        status: 'pending',
        toolInput: { command: 'ls' },
      });
      expect(host.querySelector('[data-testid="command-outcome"]')).toBeNull();
    });

    it('names the complete and error status icons of other tools', () => {
      let host = render({
        toolName: 'Grep',
        toolInput: { pattern: 'x' },
        toolOutput: 'match',
      });
      expect(host.querySelector('[aria-label="Completed"]')).not.toBeNull();

      host = render({
        toolName: 'Grep',
        toolInput: { pattern: 'x' },
        status: 'error',
      });
      expect(host.querySelector('[aria-label="Failed"]')).not.toBeNull();
    });

    it('shows the streaming description with a named spinner and hides the target', () => {
      const host = render({
        toolName: 'Read',
        status: 'streaming',
        toolInput: { file_path: '/repo/src/app/main.ts' },
      });
      expect(host.textContent).toContain('Reading .../app/main.ts...');
      expect(host.querySelector('[aria-label="Running"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="tool-file-path"]')).toBeNull();
    });

    it('shows the Bash streaming description beside the running pill', () => {
      const host = render({
        toolName: 'Bash',
        status: 'streaming',
        toolInput: { command: 'npm ci', description: 'Install deps' },
      });
      expect(host.textContent).toContain('Install deps...');
      expect(host.querySelector('[aria-label="Running"]')).toBeNull();
      expect(
        host.querySelector('[aria-label="Command running"]'),
      ).not.toBeNull();
    });

    it('shows a parse-error warning with the message in the title', () => {
      const host = render({
        toolName: 'Write',
        toolInput: { __parseError: 'Unexpected end of JSON' },
      });
      const warning = host.querySelector(
        '[title="Parse Error: Unexpected end of JSON"]',
      ) as HTMLElement;
      expect(warning.textContent).toContain('Parse Error');
    });

    it('shows the duration badge when the call has a duration', () => {
      let host = render({
        toolName: 'Grep',
        toolInput: { pattern: 'x' },
        duration: 1500,
      });
      expect(host.querySelector('ptah-duration-badge')).not.toBeNull();

      host = render({ toolName: 'Grep', toolInput: { pattern: 'x' } });
      expect(host.querySelector('ptah-duration-badge')).toBeNull();
    });

    it('moves focus to the toggle with focusToggle()', () => {
      const host = render({ toolName: 'Grep', toolInput: { pattern: 'x' } });
      document.body.appendChild(host);
      fixture.componentInstance.focusToggle();
      expect(document.activeElement).toBe(toggle(host));
      host.remove();
    });
  },
);

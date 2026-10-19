import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { FILE_LINK_OPENER, VSCodeService } from '@ptah-extension/core';
import type { ExecutionNode } from '@ptah-extension/shared';
import { ToolCallHeaderComponent } from './tool-call-header.component';

/**
 * The one-line header (Direction A) and R7.1-R7.3, R7.5. Both webviews
 * render the same header (decision #8), so every case runs with the host
 * flag true and false; file opening goes through `FILE_LINK_OPENER` in both.
 */
describe.each([true, false])(
  'ToolCallHeaderComponent (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<ToolCallHeaderComponent>;
    let openMock: jest.Mock<Promise<void>, [unknown]>;

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

    function text(host: HTMLElement, testId: string): string | undefined {
      return host
        .querySelector(`[data-testid="${testId}"]`)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
    }

    function chips(host: HTMLElement): string[] {
      return Array.from(host.querySelectorAll('[data-testid="tool-chip"]')).map(
        (chip) => chip.textContent?.trim() ?? '',
      );
    }

    beforeEach(async () => {
      openMock = jest.fn().mockResolvedValue(undefined);
      await TestBed.configureTestingModule({
        imports: [ToolCallHeaderComponent],
        providers: [
          { provide: FILE_LINK_OPENER, useValue: { open: openMock } },
          { provide: Clipboard, useValue: { copy: jest.fn() } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(ToolCallHeaderComponent);
    });

    afterEach(() => fixture.destroy());

    it('shows one gold "Ptah" chip and the short tool name for mcp__ptah tools', () => {
      const host = render({
        toolName: 'mcp__ptah__workspace_analyze',
        toolInput: {},
        toolOutput: 'ok',
      });
      const chip = host.querySelector(
        '[data-testid="tool-ptah-chip"]',
      ) as HTMLElement;

      expect(chip.textContent?.trim()).toBe('Ptah');
      expect(chip.className).toContain('text-[color:var(--ptah-gold-strong)]');
      expect(text(host, 'tool-name')).toBe('workspace analyze');
      // The name is not repeated as the primary text.
      expect(host.querySelector('[data-testid="tool-target"]')).toBeNull();
    });

    it('shows a built-in tool name once, in muted mono', () => {
      const host = render({ toolName: 'Grep', toolInput: { pattern: 'x' } });
      const name = host.querySelector('[data-testid="tool-name"]');

      expect(name?.textContent?.trim()).toBe('Grep');
      expect(name?.classList).toContain('font-mono');
      expect(name?.classList).toContain('text-base-content-muted');
    });

    it('shows another MCP server as a muted prefix before the tool name', () => {
      const host = render({
        toolName: 'mcp__orchestrator__spawn',
        toolInput: { __summary: 'Spawn a lane' },
      });

      expect(text(host, 'tool-name')).toMatch(/^orchestrator\s*·\s*spawn$/);
      expect(text(host, 'tool-target')).toBe('Spawn a lane');
    });

    // Regression: `ListAgents` showed as both the badge and the description.
    it.each([
      ['ListAgents', {}],
      ['ListAgents', { __summary: 'ListAgents' }],
      ['mcp__orchestrator__ListAgents', { __summary: 'list agents' }],
    ] as const)(
      'does not repeat the tool name %s as the primary text',
      (toolName, toolInput) => {
        const host = render({ toolName, toolInput });

        expect(host.querySelector('[data-testid="tool-target"]')).toBeNull();
        expect(toggle(host).textContent?.match(/ListAgents/gi)).toHaveLength(1);
      },
    );

    it('keeps a summary that says more than the tool name', () => {
      const host = render({
        toolName: 'ListAgents',
        toolInput: { __summary: 'List the running agents' },
      });
      expect(text(host, 'tool-target')).toBe('List the running agents');
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

    it('keeps the toggle at least 28px tall with a visible focus ring', () => {
      const button = toggle(
        render({ toolName: 'Grep', toolInput: { pattern: 'x' } }),
      );
      expect(button.classList).toContain('min-h-7');
      expect(button.classList).toContain('focus-visible:outline');
    });

    it('keeps the chevron in the DOM, shown on hover and focus, with reduced motion respected', () => {
      const chevron = toggle(
        render({ toolName: 'Grep', toolInput: { pattern: 'x' } }),
      ).querySelector('lucide-angular') as HTMLElement;

      expect(chevron.classList).toContain('opacity-0');
      expect(chevron.classList).toContain('group-hover:opacity-100');
      expect(chevron.classList).toContain('group-focus-within:opacity-100');
      expect(chevron.classList).toContain('motion-reduce:transition-none');
    });

    // Visual review issue 2: at 360 px Grep chips hid the pattern and pushed
    // the chevron out of the row.
    describe('narrow layout', () => {
      const grep = {
        toolName: 'Grep',
        toolInput: {
          pattern: 'toolStatusPresentation',
          path: 'libs/frontend/chat-ui/src',
          glob: '*.ts',
          '-i': true,
          output_mode: 'content',
        },
      };

      it('wraps chips onto a second line instead of squeezing the target', () => {
        const host = render(grep);
        const content = host.querySelector(
          '[data-testid="tool-header-content"]',
        ) as HTMLElement;
        const lead = host.querySelector(
          '[data-testid="tool-header-lead"]',
        ) as HTMLElement;

        expect(content.classList).toContain('flex-wrap');
        expect(content.classList).toContain('min-w-0');
        expect(content.classList).toContain('flex-1');
        // The tool name and target claim up to 12rem before any chip.
        expect(lead.classList).toContain('basis-48');
        expect(lead.classList).toContain('grow');
        expect(lead.classList).toContain('min-w-0');
        expect(lead.classList).toContain('max-w-max');
        expect(
          lead.querySelector('[data-testid="tool-target"]')?.classList,
        ).toContain('min-w-0');
        expect(chips(host).length).toBeGreaterThan(0);
        for (const chip of Array.from(
          content.querySelectorAll('[data-testid="tool-chip"]'),
        )) {
          expect(chip.parentElement).toBe(content);
          expect(chip.classList).toContain('max-w-full');
        }
      });

      it('keeps the chevron and duration outside the wrapping content, unshrinkable', () => {
        const host = render({ ...grep, duration: 1200 });
        const chevron = host.querySelector(
          '[data-testid="tool-chevron"]',
        ) as HTMLElement;
        const duration = host.querySelector(
          'ptah-duration-badge',
        ) as HTMLElement;

        expect(chevron.parentElement).toBe(toggle(host));
        expect(chevron.classList).toContain('flex-shrink-0');
        expect(duration.parentElement).toBe(toggle(host));
        expect(duration.classList).toContain('flex-shrink-0');
      });

      it('keeps the Open-file button in the row and the file name in the lead group', () => {
        const host = render({
          toolName: 'Read',
          toolInput: {
            file_path: '/repo/src/app/main.ts',
            offset: 1,
            limit: 60,
          },
        });
        const open = host.querySelector(
          'button[aria-label="Open main.ts"]',
        ) as HTMLElement;
        const lead = host.querySelector('[data-testid="tool-header-lead"]');

        expect(open.classList).toContain('flex-shrink-0');
        expect(
          lead?.querySelector('[data-testid="tool-file-path"]'),
        ).not.toBeNull();
      });
    });

    // Visual review issue 1: muted text fell under 4.5:1 on the hover surface.
    it('brightens muted header text while the toggle is hovered or focused', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/app/main.ts' },
      });
      const button = toggle(host);
      const name = host.querySelector('[data-testid="tool-name"]');

      expect(button.classList).toContain('group/toggle');
      expect(name?.classList).toContain('group-hover/toggle:text-base-content');
      expect(name?.classList).toContain(
        'group-focus-visible/toggle:text-base-content',
      );
    });

    it('puts the light-theme Ptah chip on base-100 so its gold text stays readable', () => {
      const chip = render({
        toolName: 'mcp__ptah__workspace_analyze',
        toolInput: {},
      }).querySelector('[data-testid="tool-ptah-chip"]') as HTMLElement;
      expect(chip.classList).toContain(
        '[[data-theme-mode=light]_&]:bg-base-100',
      );
    });

    it('shows a file tool as the bold file name only, with the full path title', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/app/main.ts', offset: 1, limit: 60 },
        toolOutput: 'x',
      });
      const path = host.querySelector(
        '[data-testid="tool-file-path"]',
      ) as HTMLElement;

      expect(path.getAttribute('title')).toBe('/repo/src/app/main.ts');
      expect(path.classList).toContain('truncate');
      expect(path.classList).toContain('font-semibold');
      expect(path.textContent?.trim()).toBe('main.ts');
      expect(host.textContent).not.toContain('/repo/src/app');
      expect(
        host
          .querySelector('button[aria-label="Open main.ts"]')
          ?.getAttribute('title'),
      ).toBe('Open /repo/src/app/main.ts');
      expect(chips(host)).toEqual(['lines 1-60']);
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

    // Regression: the description and command each showed twice.
    it.each(['Bash', 'PowerShell'])(
      'shows the %s description once and leaves the command to the body',
      (toolName) => {
        const host = render({
          toolName,
          toolInput: {
            command: 'npx nx test chat-ui',
            description: 'Run the tests',
            run_in_background: true,
            timeout: 3_600_000,
          },
        });

        expect(text(host, 'tool-target')).toBe('Run the tests');
        expect(host.textContent?.match(/Run the tests/g)).toHaveLength(1);
        expect(host.textContent).not.toContain('npx nx test chat-ui');
        expect(
          host
            .querySelector('[data-testid="tool-target"]')
            ?.getAttribute('title'),
        ).toBe('npx nx test chat-ui');
        expect(chips(host)).toEqual(['background', '60 min']);
      },
    );

    it('shows the first command line only while collapsed when a command has no description', () => {
      const partial = {
        toolName: 'Bash',
        toolInput: { command: 'cd repo\nnpm test' },
      };
      expect(text(render(partial, true), 'tool-target')).toBe('cd repo');

      // Expanded: the body's "Command" block holds the command, so the header
      // shows no target and the command is not repeated.
      const expanded = render(partial, false);
      expect(expanded.querySelector('[data-testid="tool-target"]')).toBeNull();
      expect(expanded.textContent).not.toContain('cd repo');
    });

    it('keeps a description as the target while expanded', () => {
      const host = render(
        {
          toolName: 'Bash',
          toolInput: { command: 'npm test', description: 'Run tests' },
        },
        false,
      );
      expect(text(host, 'tool-target')).toBe('Run tests');
    });

    it('shows "started" after the chips once a background command completes', () => {
      const input = { command: 'npm run dev', run_in_background: true };
      const done = render({
        toolName: 'Bash',
        status: 'complete',
        toolInput: input,
      });
      expect(chips(done)).toEqual(['background']);
      expect(text(done, 'tool-started')).toBe('started');
      expect(
        done.querySelector('[data-testid="tool-started"]')?.classList,
      ).toContain('text-base-content-muted');

      const running = render({
        toolName: 'Bash',
        status: 'streaming',
        toolInput: input,
      });
      expect(running.querySelector('[data-testid="tool-started"]')).toBeNull();

      const foreground = render({
        toolName: 'Bash',
        status: 'complete',
        toolInput: { command: 'ls' },
      });
      expect(
        foreground.querySelector('[data-testid="tool-started"]'),
      ).toBeNull();
    });

    // Regression: a launched background command was announced as succeeded.
    it('says "Command started", not "Command succeeded", with the started word', () => {
      const done = render({
        toolName: 'Bash',
        status: 'complete',
        toolInput: { command: 'npm run dev', run_in_background: true },
      });
      expect(text(done, 'tool-status')).toBe('Command started');
      expect(text(done, 'tool-started')).toBe('started');

      const foreground = render({
        toolName: 'Bash',
        status: 'complete',
        toolInput: { command: 'ls' },
      });
      expect(text(foreground, 'tool-status')).toBe('Command succeeded');
      expect(
        foreground.querySelector('[data-testid="tool-started"]'),
      ).toBeNull();
    });

    it('shows a search pattern in mono with its path and glob as chips', () => {
      const host = render({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: 'src/', glob: '*.ts' },
      });

      expect(text(host, 'tool-target')).toBe('needle');
      expect(
        host.querySelector('[data-testid="tool-target"]')?.classList,
      ).toContain('font-mono');
      expect(chips(host)).toEqual(['in src/', '*.ts']);
    });

    it('shows TodoWrite progress as the primary text', () => {
      const host = render({
        toolName: 'TodoWrite',
        toolInput: {
          todos: [
            { content: 'a', status: 'completed', activeForm: 'A' },
            { content: 'b', status: 'pending', activeForm: 'B' },
          ],
        },
      });
      expect(text(host, 'tool-target')).toBe('1 of 2 done');
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
      ['Bash', 'complete', 'Command succeeded'],
      ['Bash', 'error', 'Command failed'],
      ['Bash', 'streaming', 'Command running'],
      ['Bash', 'pending', 'Pending'],
      ['Bash', 'interrupted', 'Interrupted'],
      ['Bash', 'resumed', 'Resumed'],
      ['Grep', 'complete', 'Completed'],
      ['Grep', 'interrupted', 'Interrupted'],
      ['Grep', 'resumed', 'Resumed'],
      ['Grep', 'pending', 'Pending'],
      ['Grep', 'error', 'Failed'],
      ['Grep', 'streaming', 'Running'],
    ] as const)(
      'names a %s call that is %s as "%s" in words (no exit code, A9)',
      (toolName, status, label) => {
        const host = render({
          toolName,
          status,
          toolInput: toolName === 'Bash' ? { command: 'ls' } : { pattern: 'x' },
        });
        const status_ = host.querySelector('[data-testid="tool-status"]');

        expect(status_?.textContent?.trim()).toBe(label);
        expect(status_?.classList).toContain('sr-only');
        expect(host.textContent).not.toContain('exit code');
      },
    );

    it('says "failed" in readable text for a failed call', () => {
      const host = render({
        toolName: 'Bash',
        status: 'error',
        toolInput: { command: 'false' },
      });
      const failed = host.querySelector('[data-testid="tool-failed"]');

      expect(failed?.textContent?.trim()).toBe('failed');
      expect(failed?.classList).toContain('text-base-content');
      expect(
        render({
          toolName: 'Bash',
          toolInput: { command: 'true' },
        }).querySelector('[data-testid="tool-failed"]'),
      ).toBeNull();
    });

    it('says "Awaiting permission" and no failed chip while a permission is pending, even with status error', () => {
      fixture.componentRef.setInput('awaitingPermission', true);
      const host = render({
        toolName: 'Bash',
        status: 'error',
        toolInput: { command: 'rm -rf build' },
      });

      expect(text(host, 'tool-status')).toBe('Awaiting permission');
      expect(host.querySelector('[data-testid="tool-failed"]')).toBeNull();
    });

    it('keeps the primary text while streaming (no second streaming sentence)', () => {
      const host = render({
        toolName: 'Bash',
        status: 'streaming',
        toolInput: { command: 'npm ci', description: 'Install deps' },
      });
      expect(text(host, 'tool-target')).toBe('Install deps');
      expect(host.textContent).not.toContain('Install deps...');
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
      expect(chips(host)).toEqual([]);
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

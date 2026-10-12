import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { FILE_LINK_OPENER, VSCodeService } from '@ptah-extension/core';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { createExecutionNode } from '@ptah-extension/shared';
import type { ExecutionNode, PermissionRequest } from '@ptah-extension/shared';
import { ToolCallItemComponent } from './tool-call-item.component';

describe('ToolCallItemComponent', () => {
  it('keeps the collapsed header text and status icon while using one separator element', async () => {
    await TestBed.configureTestingModule({
      imports: [ToolCallItemComponent],
      providers: [{ provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ToolCallItemComponent);
    fixture.componentRef.setInput(
      'node',
      createExecutionNode({
        id: 'tool-row-1',
        type: 'tool',
        status: 'complete',
        toolName: 'Read',
        toolInput: { file_path: '/workspace/readme.md' },
        toolOutput: 'contents',
      }),
    );
    fixture.detectChanges();

    const row = fixture.nativeElement as HTMLElement;
    expect(row.textContent).toContain('Read');
    expect(row.querySelector('lucide-angular')).not.toBeNull();
    const separator = row.querySelector(':scope > div:last-child') as HTMLElement;
    expect(separator.querySelectorAll('div')).toHaveLength(1);
  });
});

/**
 * Collapse, permission auto-expand and Escape (R9.1, decisions #120(b) and
 * #121(b)). Both webviews render the same item (decision #8), so every case
 * runs with the host flag true and false. The outer listener stands in for
 * the chat view's host Escape handler; the code-output child is real, so the
 * innermost-first contract is exercised end to end.
 */
describe.each([true, false])(
  'ToolCallItemComponent — collapse and Escape (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<ToolCallItemComponent>;
    let container: HTMLElement;
    let outerEscape: jest.Mock<void, [KeyboardEvent]>;

    /** Ten output lines: more than the code-output's six collapsed rows. */
    const LONG_OUTPUT = Array.from(
      { length: 10 },
      (_, i) => `line ${i + 1}`,
    ).join('\n');

    function bashNode(): ExecutionNode {
      return createExecutionNode({
        id: 'bash-1',
        type: 'tool',
        status: 'complete',
        toolName: 'Bash',
        toolInput: { command: 'seq 10' },
        toolOutput: LONG_OUTPUT,
      });
    }

    function permission(): PermissionRequest {
      return {
        id: 'perm-1',
        toolName: 'Bash',
        toolInput: { command: 'seq 10' },
        timestamp: Date.now(),
        description: 'Run seq 10',
        timeoutAt: 0,
      };
    }

    function host(): HTMLElement {
      return fixture.nativeElement as HTMLElement;
    }

    function headerToggle(): HTMLButtonElement {
      return host().querySelector(
        'ptah-tool-call-header button[aria-expanded]',
      ) as HTMLButtonElement;
    }

    function content(): HTMLElement | null {
      return host().querySelector('#tool-bash-1');
    }

    function codeOutputToggle(): HTMLButtonElement | null {
      return host().querySelector(
        'ptah-code-output button[aria-expanded]',
      ) as HTMLButtonElement | null;
    }

    function codeOutputBlock(): HTMLElement {
      return host().querySelector(
        'ptah-code-output [role="region"]',
      ) as HTMLElement;
    }

    function escape(target: Element): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    function expand(): void {
      headerToggle().click();
      fixture.detectChanges();
    }

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [ToolCallItemComponent],
        providers: [
          provideSurfaceActiveTesting(),
          provideMarkdown(),
          { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ToolCallItemComponent);
      fixture.componentRef.setInput('node', bashNode());

      container = document.createElement('div');
      outerEscape = jest.fn();
      container.addEventListener('keydown', (event) => outerEscape(event));
      container.appendChild(host());
      document.body.appendChild(container);
      fixture.detectChanges();
    });

    afterEach(() => {
      fixture.destroy();
      container.remove();
    });

    it('is collapsed by default', () => {
      expect(headerToggle().getAttribute('aria-expanded')).toBe('false');
      expect(content()).toBeNull();
    });

    it('auto-expands when a permission request arrives and shows the card', () => {
      fixture.componentRef.setInput('permission', permission());
      fixture.detectChanges();
      expect(content()).not.toBeNull();
      expect(
        host().querySelector('ptah-permission-request-card'),
      ).not.toBeNull();
    });

    it('collapses on Escape inside the expanded item, refocuses the toggle and claims the key', () => {
      expand();
      expect(content()).not.toBeNull();

      const event = escape(headerToggle());

      expect(content()).toBeNull();
      expect(headerToggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(headerToggle());
      expect(event.defaultPrevented).toBe(true);
      expect(outerEscape).not.toHaveBeenCalled();
    });

    it('leaves Escape alone when the item is collapsed', () => {
      const event = escape(headerToggle());
      expect(event.defaultPrevented).toBe(false);
      expect(outerEscape).toHaveBeenCalledTimes(1);
    });

    it('does nothing when an inner handler already prevented the default', () => {
      expand();
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      headerToggle().dispatchEvent(event);
      fixture.detectChanges();

      expect(content()).not.toBeNull();
      expect(outerEscape).toHaveBeenCalledTimes(1);
    });

    it('integration (1): collapsed inner code-output -> only the item collapses; the outer handler does not run', () => {
      expand();
      expect(codeOutputToggle()?.getAttribute('aria-expanded')).toBe('false');

      const event = escape(codeOutputBlock());

      expect(content()).toBeNull();
      expect(document.activeElement).toBe(headerToggle());
      expect(event.defaultPrevented).toBe(true);
      expect(outerEscape).not.toHaveBeenCalled();
    });

    it('integration (2): pending permission -> the item stays open and the outer handler does not run', () => {
      fixture.componentRef.setInput('permission', permission());
      fixture.detectChanges();
      expect(content()).not.toBeNull();

      const event = escape(codeOutputBlock());

      expect(content()).not.toBeNull();
      expect(headerToggle().getAttribute('aria-expanded')).toBe('true');
      expect(event.defaultPrevented).toBe(true);
      expect(outerEscape).not.toHaveBeenCalled();
    });

    it('integration (3): expanded inner code-output -> only it collapses; the item stays open', () => {
      expand();
      codeOutputToggle()?.click();
      fixture.detectChanges();
      expect(codeOutputToggle()?.getAttribute('aria-expanded')).toBe('true');

      const event = escape(codeOutputBlock());

      expect(codeOutputToggle()?.getAttribute('aria-expanded')).toBe('false');
      expect(codeOutputToggle()?.textContent?.trim()).toBe('Show full output');
      expect(document.activeElement).toBe(codeOutputToggle());
      expect(content()).not.toBeNull();
      expect(event.defaultPrevented).toBe(true);
      expect(outerEscape).not.toHaveBeenCalled();
    });
  },
);

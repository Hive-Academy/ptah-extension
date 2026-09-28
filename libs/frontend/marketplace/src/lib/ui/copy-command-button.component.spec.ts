/**
 * CopyCommandButtonComponent specs (plan C8, Task 9.2).
 *
 * The clipboard write, the "Copied" live region, and the select fallback
 * (`oauth-surface.component.ts:616-637`) when the clipboard rejects or is
 * missing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  COPIED_FEEDBACK_MS,
  CopyCommandButtonComponent,
} from './copy-command-button.component';

const COMMAND = 'claude mcp remove sentry';

@Component({
  standalone: true,
  imports: [CopyCommandButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <code #target data-testid="command">{{ command() }}</code>
    <ptah-copy-command-button [command]="command()" [selectTarget]="target" />
  `,
})
class HostComponent {
  public readonly command = signal(COMMAND);
}

/** Let the awaited clipboard promise and the handler after it settle. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('CopyCommandButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;
  let writeText: jest.Mock<Promise<void>, [string]>;
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard',
  );

  function setClipboard(value: unknown): void {
    Object.defineProperty(navigator, 'clipboard', {
      value,
      configurable: true,
    });
  }

  const button = (): HTMLButtonElement | null =>
    element.querySelector('[data-testid="copy-command-button"]');
  const status = (): HTMLElement =>
    element.querySelector('[data-testid="copy-command-status"]') as HTMLElement;
  const selectedText = (): string => {
    const selection = document.getSelection();
    return selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).toString()
      : '';
  };

  async function click(): Promise<void> {
    button()?.click();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  beforeEach(() => {
    writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    setClipboard({ writeText });
    document.getSelection()?.removeAllRanges();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('has a polite status live region, empty at rest', () => {
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().getAttribute('role')).toBe('status');
    expect(status().textContent?.trim()).toBe('');
  });

  it('names the button for assistive tech', () => {
    expect(button()?.getAttribute('aria-label')).toBe('Copy command');
    expect(button()?.getAttribute('type')).toBe('button');
  });

  it('copies the command and announces "Copied"', async () => {
    await click();
    expect(writeText).toHaveBeenCalledWith(COMMAND);
    expect(status().textContent?.trim()).toBe('Copied');
    expect(button()?.textContent).toContain('Copied');
    expect(selectedText()).toBe('');
  });

  it('resets the confirmation after the feedback delay', async () => {
    jest.useFakeTimers();
    await click();
    expect(status().textContent?.trim()).toBe('Copied');
    jest.advanceTimersByTime(COPIED_FEEDBACK_MS);
    fixture.detectChanges();
    expect(status().textContent?.trim()).toBe('');
    expect(button()?.textContent).toContain('Copy');
    expect(button()?.textContent).not.toContain('Copied');
  });

  it('selects the command text when the clipboard rejects', async () => {
    writeText.mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    await click();
    expect(selectedText()).toBe(COMMAND);
    expect(status().textContent).toContain('Clipboard access was denied');
    expect(status().textContent).toContain('selected');
    expect(button()?.textContent).not.toContain('Copied');
  });

  it('selects the command text when there is no clipboard API', async () => {
    setClipboard(undefined);
    await click();
    expect(selectedText()).toBe(COMMAND);
    expect(status().textContent).toContain('Clipboard is unavailable');
  });

  it('ignores a second click while a copy is pending', async () => {
    let resolveFirst: () => void = () => undefined;
    writeText
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockRejectedValueOnce(new Error('denied'));
    button()?.click();
    button()?.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    resolveFirst();
    await flushMicrotasks();
    fixture.detectChanges();
    expect(status().textContent?.trim()).toBe('Copied');
    expect(selectedText()).toBe('');
  });

  it('accepts a new click once the previous copy settled', async () => {
    await click();
    writeText.mockRejectedValueOnce(new Error('denied'));
    await click();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(selectedText()).toBe(COMMAND);
    expect(status().textContent).toContain('selected');
  });

  it('renders no button for a blank command', () => {
    fixture.componentInstance.command.set('   ');
    fixture.detectChanges();
    expect(button()).toBeNull();
  });

  it('leaves the selection alone when destroyed before a rejection settles', async () => {
    let rejectWrite: (error: unknown) => void = () => undefined;
    writeText.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
      }),
    );
    button()?.click();
    fixture.destroy();
    rejectWrite(new Error('late'));
    await flushMicrotasks();
    expect(selectedText()).toBe('');
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'copy-command-button.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});

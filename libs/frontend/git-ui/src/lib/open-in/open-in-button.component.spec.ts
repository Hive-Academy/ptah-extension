import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import type { EditorTarget } from '@ptah-extension/shared';
import { OpenInButtonComponent } from './open-in-button.component';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

const vscode: EditorTarget = {
  id: 'vscode',
  displayName: 'VS Code',
  executablePath: '/bin/code',
};
const cursor: EditorTarget = {
  id: 'cursor',
  displayName: 'Cursor',
  executablePath: '/bin/cursor',
};

const terminal: EditorTarget = { id: 'terminal', displayName: 'Terminal' };

describe('OpenInButtonComponent', () => {
  let fixture: ComponentFixture<OpenInButtonComponent>;

  beforeEach(async () => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({ success: true, data: { success: true } });
    await TestBed.configureTestingModule({
      imports: [OpenInButtonComponent],
      providers: [{ provide: VSCodeService, useValue: {} }],
    }).compileComponents();
    fixture = TestBed.createComponent(OpenInButtonComponent);
  });

  function render(targets: EditorTarget[], remembered: string | null = null) {
    fixture.componentRef.setInput('targets', targets);
    fixture.componentRef.setInput('remembered', remembered);
    fixture.detectChanges();
  }

  it('renders an explained disabled control when no editor is detected', () => {
    render([]);
    const primary = fixture.nativeElement.querySelector(
      '[data-testid="open-in-primary"]',
    ) as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toBe('No supported editor found on this machine');
    expect(
      fixture.nativeElement.querySelector('[data-testid="open-in-caret"]'),
    ).toBeNull();
  });

  it('opens the only detected editor directly and still offers the caret', () => {
    render([vscode]);
    const opened: unknown[] = [];
    fixture.componentInstance.open.subscribe((event) => opened.push(event));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-primary"]',
      ) as HTMLButtonElement
    ).click();
    expect(opened).toEqual([{ target: 'vscode' }]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="open-in-caret"]'),
    ).not.toBeNull();
  });

  it('shows brand icons per menu item and the selected target on the primary button', () => {
    render([vscode, cursor, terminal], 'cursor');
    const primary = fixture.nativeElement.querySelector(
      '[data-testid="open-in-primary"]',
    ) as HTMLElement;
    expect(primary.querySelector('[data-brand="cursor"]')).not.toBeNull();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-caret"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const items = Array.from(
      fixture.nativeElement.querySelectorAll('[role="menuitem"]'),
    ) as HTMLElement[];
    expect(
      items.map((item) =>
        item.querySelector('[data-brand]')?.getAttribute('data-brand'),
      ),
    ).toEqual(['vscode', 'cursor', 'terminal']);
    expect(items[2].textContent).toContain('Terminal');
  });

  it('opens the terminal target for a workspace', () => {
    render([vscode, terminal], 'terminal');
    const opened: unknown[] = [];
    fixture.componentInstance.open.subscribe((event) => opened.push(event));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-primary"]',
      ) as HTMLButtonElement
    ).click();
    expect(opened).toEqual([{ target: 'terminal' }]);
  });

  it('hides the terminal when a file path is bound', () => {
    fixture.componentRef.setInput('path', '/workspace/a.ts');
    render([vscode, terminal]);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-caret"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-target-id="terminal"]'),
    ).toBeNull();
  });

  it('closes the menu on an outside click and on Escape (focus back to the caret)', () => {
    render([vscode, cursor]);
    const caret = fixture.nativeElement.querySelector(
      '[data-testid="open-in-caret"]',
    ) as HTMLButtonElement;
    caret.click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();

    caret.click();
    fixture.detectChanges();
    const item = fixture.nativeElement.querySelector(
      '[role="menuitem"]',
    ) as HTMLButtonElement;
    item.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(caret);
  });

  it('opens the menu instead of guessing when many targets have no remembered choice', () => {
    render([vscode, cursor]);
    const opened = jest.fn();
    fixture.componentInstance.open.subscribe(opened);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-primary"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(opened).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('opens and persists the remembered target with file context', () => {
    fixture.componentRef.setInput('path', '/workspace/a.ts');
    fixture.componentRef.setInput('line', 5);
    render([vscode, cursor], 'cursor');
    const opened: unknown[] = [];
    fixture.componentInstance.open.subscribe((event) => opened.push(event));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-primary"]',
      ) as HTMLButtonElement
    ).click();
    expect(opened).toEqual([
      { target: 'cursor', path: '/workspace/a.ts', line: 5 },
    ]);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'settings:set',
      { key: 'editorLauncher.lastTarget', value: 'cursor' },
    );
  });

  it('loads a stored choice through settings:get', async () => {
    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { success: true, value: 'cursor' },
    });
    fixture.componentRef.setInput('targets', [vscode, cursor]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="open-in-primary"]',
        ) as HTMLElement
      ).textContent,
    ).toContain('Open in Cursor');
  });

  it('keeps a user choice made while settings:get is in flight and restores caret focus', async () => {
    let finishLoad: (value: unknown) => void = () => undefined;
    mockRpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (finishLoad = resolve)),
    );
    render([vscode, cursor]);
    const caret = fixture.nativeElement.querySelector(
      '[data-testid="open-in-caret"]',
    ) as HTMLButtonElement;
    caret.click();
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-target-id="cursor"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(caret);
    finishLoad({ success: true, data: { value: 'vscode' } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="open-in-primary"]',
        ) as HTMLElement
      ).textContent,
    ).toContain('Open in Cursor');
  });

  it('does not move focus to the caret when the primary button is clicked', () => {
    render([vscode, cursor]);
    const primary = fixture.nativeElement.querySelector(
      '[data-testid="open-in-primary"]',
    ) as HTMLButtonElement;
    const caret = fixture.nativeElement.querySelector(
      '[data-testid="open-in-caret"]',
    ) as HTMLButtonElement;
    primary.focus();
    primary.click();
    fixture.detectChanges();

    expect(document.activeElement).not.toBe(caret);
  });

  it('does not restore focus to the caret on mouse click of a menu item', () => {
    render([vscode, cursor]);
    const caret = fixture.nativeElement.querySelector(
      '[data-testid="open-in-caret"]',
    ) as HTMLButtonElement;
    caret.click();
    fixture.detectChanges();

    const menuItem = fixture.nativeElement.querySelector(
      '[data-target-id="cursor"]',
    ) as HTMLButtonElement;
    menuItem.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
    );
    fixture.detectChanges();

    expect(document.activeElement).not.toBe(caret);
  });
});

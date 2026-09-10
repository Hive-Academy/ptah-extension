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

  it('opens the only detected editor directly without a caret', () => {
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
    ).toBeNull();
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
});

import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import {
  DEFAULT_CODEX_SANDBOX_MODE,
  type AgentOrchestrationConfig,
  type CodexSandboxMode,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  CODEX_FULL_ACCESS_WARNING,
  CODEX_WINDOWS_WORKSPACE_WRITE_NOTE,
  CodexSandboxSettingComponent,
} from './codex-sandbox-setting.component';

const RAW_FIELD_ERROR = 'codexSandboxMode: Invalid enum value (host detail)';

describe('CodexSandboxSettingComponent', () => {
  let fixture: ComponentFixture<CodexSandboxSettingComponent>;
  let call: jest.Mock;
  let feedback: SettingsSaveFeedbackService;
  /** What the fake host reports as effective; a successful write changes it. */
  let effective: unknown;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const radio = (mode: CodexSandboxMode): HTMLInputElement =>
    byTestId<HTMLInputElement>(`codex-sandbox-${mode}`) as HTMLInputElement;
  const checkedMode = (): string | undefined =>
    host().querySelector<HTMLInputElement>(
      'input[name="codex-sandbox-mode"]:checked',
    )?.value;
  const settle = async (): Promise<void> => {
    // A macrotask drains the whole RPC promise chain (write, re-read, toast), as in host-routing-setting.
    for (let i = 0; i < 2; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const setConfigCalls = (): unknown[][] =>
    call.mock.calls.filter(([method]) => method === 'agent:setConfig');

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(CodexSandboxSettingComponent);
    fixture.detectChanges();
    await settle();
  }

  async function pick(mode: CodexSandboxMode): Promise<void> {
    radio(mode).click();
    fixture.detectChanges();
    await settle();
  }

  beforeEach(() => {
    // An install with no stored choice: the host reports the default, full access (TASK_2026_885).
    effective = 'danger-full-access';
    call = jest.fn(async (method: string, params?: unknown) => {
      if (method === 'agent:getConfig') {
        return rpcSuccess({
          codexSandboxMode: effective,
        } as unknown as AgentOrchestrationConfig);
      }
      if (method === 'agent:setConfig') {
        effective = (params as { codexSandboxMode: CodexSandboxMode })
          .codexSandboxMode;
        return rpcSuccess({ success: true });
      }
      return rpcError('unexpected');
    });
    TestBed.configureTestingModule({
      imports: [CodexSandboxSettingComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
  });

  afterEach(() => {
    feedback.dismiss();
    fixture?.destroy();
  });

  it('loads the effective mode (full access by default) with the scope, precedence and warning notes', async () => {
    await create();
    expect(DEFAULT_CODEX_SANDBOX_MODE).toBe('danger-full-access');
    expect(call).toHaveBeenCalledWith('agent:getConfig', undefined, {
      timeout: 5_000,
    });
    expect(checkedMode()).toBe('danger-full-access');
    expect(byTestId('codex-sandbox-effective')?.textContent?.trim()).toBe(
      'In effect: Full access (default)',
    );
    const labels = Array.from(
      host().querySelectorAll('[data-testid="codex-sandbox-choices"] label'),
    ).map((label) => label.querySelector('span span')?.textContent?.trim());
    expect(labels).toEqual([
      'Read only',
      'Workspace write, no network',
      'Workspace write with network',
      'Full access (default)',
    ]);
    expect(byTestId('codex-sandbox-scope')?.textContent?.trim()).toBe(
      'Applies to all new Codex chat turns and Codex CLI lanes.',
    );
    const precedence = byTestId('codex-sandbox-precedence')?.textContent ?? '';
    expect(precedence).toContain('takes precedence over');
    expect(precedence).toContain('~/.codex/config.toml');
    expect(precedence).toContain('applies from the next turn');
    // The default is full access, so its warning is always visible next to that option.
    expect(byTestId('codex-sandbox-warning')?.textContent?.trim()).toBe(
      CODEX_FULL_ACCESS_WARNING,
    );
    expect(radio('danger-full-access').getAttribute('aria-describedby')).toBe(
      'codex-sandbox-danger-full-access-help',
    );
    expect(byTestId('codex-sandbox-windows-note')?.textContent?.trim()).toBe(
      CODEX_WINDOWS_WORKSPACE_WRITE_NOTE,
    );
    const noNetworkHelp = host().querySelector('#codex-sandbox-workspace-write-no-network-help')?.textContent ?? '';
    expect(noNetworkHelp).toContain('on Windows, network blocking is incomplete');
    expect(noNetworkHelp).not.toContain('It cannot use the network');
    expect(byTestId('codex-sandbox-confirm')).toBeNull();
  });

  it('shows Retry when the read fails, then loads again', async () => {
    call.mockImplementationOnce(async () => rpcError('host offline'));
    await create();
    expect(byTestId('codex-sandbox-load-error')).not.toBeNull();
    expect(byTestId('codex-sandbox-choices')).toBeNull();
    expect(host().textContent).not.toContain('host offline');

    byTestId<HTMLButtonElement>('codex-sandbox-retry')?.click();
    await settle();
    expect(checkedMode()).toBe('danger-full-access');
  });

  it('treats an unknown reported mode as a read error, never as a choice', async () => {
    effective = 'yolo';
    await create();
    expect(byTestId('codex-sandbox-load-error')).not.toBeNull();
    expect(checkedMode()).toBeUndefined();
  });

  it('saves a workspace-write pick at once, re-reads the effective mode, and offers no Undo back to full access', async () => {
    await create();
    await pick('workspace-write-network');
    expect(byTestId('codex-sandbox-confirm')).toBeNull();
    expect(call).toHaveBeenCalledWith(
      'agent:setConfig',
      { codexSandboxMode: 'workspace-write-network' },
      { timeout: 5_000 },
    );
    expect(
      call.mock.calls.filter(([method]) => method === 'agent:getConfig'),
    ).toHaveLength(2);
    expect(checkedMode()).toBe('workspace-write-network');
    expect(byTestId('codex-sandbox-effective')?.textContent?.trim()).toBe(
      'In effect: Workspace write with network',
    );
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved Codex sandbox mode.',
      canUndo: false,
    });
  });

  it('asks for confirmation before switching to full access, and Cancel or Esc keeps the saved mode', async () => {
    effective = 'read-only';
    await create();
    await pick('danger-full-access');
    const confirm = byTestId('codex-sandbox-confirm');
    expect(confirm).not.toBeNull();
    expect(confirm?.getAttribute('aria-describedby')).toBe(
      'codex-sandbox-danger-full-access-help',
    );
    expect(document.activeElement).toBe(
      byTestId('codex-sandbox-cancel-button'),
    );
    expect(setConfigCalls()).toHaveLength(0);

    byTestId<HTMLButtonElement>('codex-sandbox-cancel-button')?.click();
    await settle();
    expect(byTestId('codex-sandbox-confirm')).toBeNull();
    expect(checkedMode()).toBe('read-only');
    expect(document.activeElement).toBe(radio('read-only'));

    await pick('danger-full-access');
    byTestId('codex-sandbox-confirm')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(byTestId('codex-sandbox-confirm')).toBeNull();
    expect(checkedMode()).toBe('read-only');
    expect(setConfigCalls()).toHaveLength(0);
  });

  it('writes full access only after the confirm, with Undo back to the previous mode', async () => {
    effective = 'workspace-write-no-network';
    await create();
    await pick('danger-full-access');
    byTestId<HTMLButtonElement>('codex-sandbox-confirm-button')?.click();
    await settle();
    expect(call).toHaveBeenCalledWith(
      'agent:setConfig',
      { codexSandboxMode: 'danger-full-access' },
      { timeout: 5_000 },
    );
    expect(checkedMode()).toBe('danger-full-access');
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved Codex sandbox mode.',
      canUndo: true,
    });

    await feedback.undo();
    await settle();
    expect(call).toHaveBeenLastCalledWith('agent:getConfig', undefined, {
      timeout: 5_000,
    });
    expect(setConfigCalls().at(-1)?.[1]).toEqual({
      codexSandboxMode: 'workspace-write-no-network',
    });
    expect(checkedMode()).toBe('workspace-write-no-network');
  });

  it('keeps the last confirmed mode on a refused save and never renders the host error', async () => {
    effective = 'workspace-write-network';
    await create();
    call.mockImplementation(async (method: string) =>
      method === 'agent:getConfig'
        ? rpcSuccess({
            codexSandboxMode: effective,
          } as unknown as AgentOrchestrationConfig)
        : rpcSuccess({ success: false, error: RAW_FIELD_ERROR }),
    );
    await pick('read-only');
    expect(checkedMode()).toBe('workspace-write-network');
    expect(byTestId('codex-sandbox-effective')?.textContent?.trim()).toBe(
      'In effect: Workspace write with network',
    );
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message:
        'Could not save Codex sandbox mode. The saved setting is unchanged.',
      canUndo: false,
    });
    expect(host().textContent).not.toContain('host detail');
    expect(radio('read-only').getAttribute('aria-disabled')).toBeNull();
  });

  it('reports an unconfirmed save when the write times out and the re-read fails', async () => {
    effective = 'workspace-write-network';
    await create();
    call.mockImplementation(async (method: string) => {
      if (method === 'agent:setConfig') throw new Error('RPC timeout');
      return rpcError('host offline');
    });
    await pick('read-only');
    expect(checkedMode()).toBeUndefined();
    expect(byTestId('codex-sandbox-effective')?.textContent?.trim()).toBe('Effective policy unknown.');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not confirm whether Codex sandbox mode was saved.',
      canUndo: false,
    });
  });

  it('shows an unknown effective policy after an acknowledged write with a failed read-back until reload succeeds', async () => {
    effective = 'read-only';
    await create();
    let failRead = true;
    call.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'agent:getConfig') {
        return failRead
          ? rpcError('host offline')
          : rpcSuccess({ codexSandboxMode: effective } as AgentOrchestrationConfig);
      }
      if (method === 'agent:setConfig') {
        effective = (params as { codexSandboxMode: CodexSandboxMode }).codexSandboxMode;
        return rpcSuccess({ success: true });
      }
      return rpcError('unexpected');
    });

    await pick('workspace-write-network');
    expect(checkedMode()).toBeUndefined();
    expect(byTestId('codex-sandbox-effective')?.textContent?.trim()).toBe('Effective policy unknown.');
    expect(feedback.toast()?.message).toBe('Could not confirm whether Codex sandbox mode was saved.');

    failRead = false;
    byTestId<HTMLButtonElement>('codex-sandbox-reload')?.click();
    await settle();
    expect(checkedMode()).toBe('workspace-write-network');
    expect(byTestId('codex-sandbox-effective')?.textContent?.trim()).toBe('In effect: Workspace write with network');
  });

  it('shows the mode the host reports when an acknowledged write does not take effect', async () => {
    effective = 'workspace-write-network';
    await create();
    call.mockImplementation(async (method: string) =>
      method === 'agent:getConfig'
        ? rpcSuccess({
            codexSandboxMode: 'read-only',
          } as unknown as AgentOrchestrationConfig)
        : rpcSuccess({ success: true }),
    );
    await pick('workspace-write-no-network');
    expect(checkedMode()).toBe('read-only');
    expect(byTestId('codex-sandbox-effective')?.textContent?.trim()).toBe(
      'In effect: Read only',
    );
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save Codex sandbox mode. In effect: Read only.',
      canUndo: false,
    });
  });
});

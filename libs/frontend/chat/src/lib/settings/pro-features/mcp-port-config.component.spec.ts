import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  McpPortConfigComponent,
  COULD_NOT_SAVE_PORT,
  COULD_NOT_UPDATE_NAMESPACES,
  COULD_NOT_UPDATE_LOCALHOST,
} from './mcp-port-config.component';

type Responder = () => RpcResult<unknown> | Promise<RpcResult<unknown>>;

const ok = <T>(data: T) => new RpcResult<T>(true, data);
const fail = (message: string) => new RpcResult<unknown>(false, undefined, message);

describe('McpPortConfigComponent', () => {
  let fixture: ComponentFixture<McpPortConfigComponent>;
  let component: McpPortConfigComponent;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;
  let responses: Record<string, Responder>;
  const call = jest.fn();

  beforeEach(() => {
    responses = {
      'agent:getConfig': () =>
        ok({
          mcpPort: 51820,
          disabledMcpNamespaces: [],
          browserAllowLocalhost: false,
        }),
      'agent:setConfig': () => ok({ success: true }),
    };
    call.mockReset();
    call.mockImplementation(async (method: string) => {
      const respond = responses[method];
      if (!respond) throw new Error(`unexpected RPC ${method}`);
      return respond();
    });
  });

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  async function settle(): Promise<void> {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      fixture.detectChanges();
    }
  }

  async function render(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [McpPortConfigComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        {
          provide: VSCodeService,
          useValue: { isElectron: false, config: signal({}) },
        },
        SettingsSaveFeedbackService,
      ],
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(McpPortConfigComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = element.querySelector<T>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`missing [data-testid="${id}"]`);
    return el;
  };

  const queryTestId = (id: string) =>
    element.querySelector(`[data-testid="${id}"]`);

  describe('Configuration Loading', () => {
    it('loads port, namespaces, and browserAllowLocalhost on init', async () => {
      responses['agent:getConfig'] = () =>
        ok({
          mcpPort: 52000,
          disabledMcpNamespaces: ['git'],
          browserAllowLocalhost: true,
        });

      await render();

      expect(component.portValue()).toBe(52000);
      expect(component.savedPort()).toBe(52000);
      expect(component.isNamespaceEnabled('git')).toBe(false);
      expect(component.isNamespaceEnabled('browser')).toBe(true);
      expect(component.browserAllowLocalhost()).toBe(true);
    });

    it('gracefully handles load failure leaving default configuration intact', async () => {
      responses['agent:getConfig'] = () => fail('load failed');
      await render();

      expect(component.portValue()).toBe(51820);
      expect(component.disabledNamespaces()).toEqual([]);
      expect(component.browserAllowLocalhost()).toBe(false);
    });
  });

  describe('MCP Port Policy Bar (A30, R4)', () => {
    it('validates integer range and enables save only when dirty and valid', async () => {
      await render();

      const saveBtn = byTestId<HTMLButtonElement>('mcp-port-save-btn');
      expect(saveBtn.disabled).toBe(true); // not dirty

      // Float input
      component.onPortInput(51820.5);
      fixture.detectChanges();
      expect(component.validationError()).toBe('Port must be a valid integer');
      expect(saveBtn.disabled).toBe(true);

      // Under range
      component.onPortInput(1000);
      fixture.detectChanges();
      expect(component.validationError()).toBe('Port must be between 1024 and 65535');
      expect(saveBtn.disabled).toBe(true);

      // Over range
      component.onPortInput(70000);
      fixture.detectChanges();
      expect(component.validationError()).toBe('Port must be between 1024 and 65535');
      expect(saveBtn.disabled).toBe(true);

      // Valid and dirty
      component.onPortInput(51999);
      fixture.detectChanges();
      expect(component.validationError()).toBeNull();
      expect(saveBtn.disabled).toBe(false);
    });

    it('saves port explicitly with persistent restart hint in row and supports Undo (R4)', async () => {
      await render();

      // Persistent restart hint is visible in the row before save
      expect(element.textContent).toContain(
        'Changes apply after the MCP server restarts.',
      );

      component.onPortInput(52000);
      fixture.detectChanges();
      const saveBtn = byTestId<HTMLButtonElement>('mcp-port-save-btn');
      saveBtn.click();
      await settle();

      expect(call).toHaveBeenCalledWith('agent:setConfig', { mcpPort: 52000 });
      expect(component.savedPort()).toBe(52000);
      expect(component.isDirty()).toBe(false);

      const toast = feedback.toast();
      expect(toast?.tone).toBe('status');
      expect(toast?.message).toBe('Saved MCP port.');
      expect(toast?.canUndo).toBe(true);

      // Trigger Undo
      await feedback.undo();
      await settle();

      expect(call).toHaveBeenCalledWith('agent:setConfig', { mcpPort: 51820 });
      expect(component.savedPort()).toBe(51820);
      expect(component.portValue()).toBe(51820);
    });

    it('handles port save failure (RPC failure, success:false, missing flag, throw) without leaking host error text (R5)', async () => {
      responses['agent:setConfig'] = () => fail('host detail error message');
      await render();

      component.onPortInput(52000);
      fixture.detectChanges();
      await component.savePort();
      await settle();

      expect(component.validationError()).toBe(COULD_NOT_SAVE_PORT);
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_SAVE_PORT);
      expect(feedback.toast()?.message).not.toContain('host detail');
      expect(component.savedPort()).toBe(51820);

      // Test success:false payload (strict R5)
      responses['agent:setConfig'] = () =>
        ok({ success: false, error: 'host detail in payload' });
      await component.savePort();
      await settle();

      expect(component.validationError()).toBe(COULD_NOT_SAVE_PORT);
      expect(feedback.toast()?.message).toBe(COULD_NOT_SAVE_PORT);
      expect(feedback.toast()?.message).not.toContain('host detail');

      // Test missing flag (success is not true)
      responses['agent:setConfig'] = () => ok({});
      await component.savePort();
      await settle();

      expect(component.validationError()).toBe(COULD_NOT_SAVE_PORT);
      expect(feedback.toast()?.message).toBe(COULD_NOT_SAVE_PORT);

      // Test thrown error
      responses['agent:setConfig'] = () => {
        throw new Error('host detail exception');
      };
      await component.savePort();
      await settle();

      expect(component.validationError()).toBe(COULD_NOT_SAVE_PORT);
      expect(feedback.toast()?.message).toBe(COULD_NOT_SAVE_PORT);
      expect(feedback.toast()?.message).not.toContain('host detail');
    });
  });

  describe('MCP Tool Namespaces Matrix (A31)', () => {
    it('renders all 5 namespaces with correct tool counts', async () => {
      await render();

      for (const ns of component.namespaceOptions) {
        const checkbox = byTestId<HTMLInputElement>(
          `settings-toggle-mcp-namespace-${ns.id}`,
        );
        expect(checkbox.checked).toBe(true);
      }
      expect(element.textContent).toContain('Browser Automation');
      expect(element.textContent).toContain('12');
      expect(element.textContent).toContain('CLI Agents');
      expect(element.textContent).toContain('6');
      expect(element.textContent).toContain('Git Worktree');
      expect(element.textContent).toContain('3');
      expect(element.textContent).toContain('IDE / LSP');
      expect(element.textContent).toContain('3');
      expect(element.textContent).toContain('JSON Validation');
      expect(element.textContent).toContain('1');
    });

    it('toggles namespace on selection with toast and Undo', async () => {
      await render();

      await component.toggleNamespace('browser');
      await settle();

      expect(call).toHaveBeenCalledWith('agent:setConfig', {
        disabledMcpNamespaces: ['browser'],
      });
      expect(component.isNamespaceEnabled('browser')).toBe(false);

      const toast = feedback.toast();
      expect(toast?.tone).toBe('status');
      expect(toast?.message).toBe('Saved Browser Automation namespace.');
      expect(toast?.canUndo).toBe(true);

      // Undo
      await feedback.undo();
      await settle();

      expect(call).toHaveBeenCalledWith('agent:setConfig', {
        disabledMcpNamespaces: [],
      });
      expect(component.isNamespaceEnabled('browser')).toBe(true);
    });

    it('reverts namespace and shows fixed error sentence on write failure without leaking host text', async () => {
      responses['agent:setConfig'] = () => fail('host detail error');
      await render();

      await component.toggleNamespace('git');
      await settle();

      expect(component.isNamespaceEnabled('git')).toBe(true);
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_UPDATE_NAMESPACES);
      expect(feedback.toast()?.message).not.toContain('host detail');
    });
  });

  describe('Allow Localhost (A32, R3)', () => {
    it('keeps checkbox unticked while confirm is open, when cancelled, and on failure (R3)', async () => {
      await render();

      const checkbox = byTestId<HTMLInputElement>(
        'settings-toggle-browser-allow-localhost',
      );
      expect(checkbox.checked).toBe(false);
      expect(component.browserAllowLocalhost()).toBe(false);

      // Trigger change on the checkbox
      checkbox.click();
      fixture.detectChanges();

      // Checkbox MUST remain unticked while confirmation is open!
      expect(checkbox.checked).toBe(false);
      expect(queryTestId('allow-localhost-confirm')).not.toBeNull();
      expect(call).not.toHaveBeenCalledWith('agent:setConfig', {
        browserAllowLocalhost: true,
      });

      // Cancel leaves it unticked
      byTestId<HTMLButtonElement>('allow-localhost-cancel-btn').click();
      fixture.detectChanges();
      expect(checkbox.checked).toBe(false);
      expect(queryTestId('allow-localhost-confirm')).toBeNull();

      // Re-open confirm and test failed write leaves it unticked
      responses['agent:setConfig'] = () =>
        ok({ success: false, error: 'host detail' });
      checkbox.click();
      fixture.detectChanges();
      expect(checkbox.checked).toBe(false);
      byTestId<HTMLButtonElement>('allow-localhost-confirm-btn').click();
      await settle();

      expect(checkbox.checked).toBe(false);
      expect(component.browserAllowLocalhost()).toBe(false);
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_UPDATE_LOCALHOST);
      expect(feedback.toast()?.message).not.toContain('host detail');

      // Now test successful confirm & write ticks the checkbox
      responses['agent:setConfig'] = () => ok({ success: true });
      checkbox.click();
      fixture.detectChanges();
      expect(checkbox.checked).toBe(false);
      byTestId<HTMLButtonElement>('allow-localhost-confirm-btn').click();
      await settle();

      expect(checkbox.checked).toBe(true);
      expect(component.browserAllowLocalhost()).toBe(true);
      expect(feedback.toast()?.tone).toBe('status');
      expect(feedback.toast()?.message).toBe('Saved Allow localhost.');
      expect(feedback.toast()?.canUndo).toBe(false); // S-confirm has NO Undo
    });

    it('opens the confirm with Cancel focused; Esc cancels, returns focus to the checkbox and stops there (Batch 49b)', async () => {
      await render();
      document.body.appendChild(element);
      const outer = jest.fn();
      document.body.addEventListener('keydown', outer);
      try {
        const checkbox = byTestId<HTMLInputElement>('settings-toggle-browser-allow-localhost');
        checkbox.click();
        fixture.detectChanges();
        fixture.detectChanges();
        expect(document.activeElement).toBe(byTestId('allow-localhost-cancel-btn'));

        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();
        await fixture.whenStable();

        expect(queryTestId('allow-localhost-confirm')).toBeNull();
        expect(checkbox.checked).toBe(false);
        expect(document.activeElement).toBe(checkbox);
        expect(outer).not.toHaveBeenCalled();
        expect(call).not.toHaveBeenCalledWith('agent:setConfig', { browserAllowLocalhost: true });
      } finally {
        document.body.removeEventListener('keydown', outer);
        element.remove();
      }
    });

    it('disabling saves immediately with Undo (S-sel)', async () => {
      responses['agent:getConfig'] = () =>
        ok({
          mcpPort: 51820,
          disabledMcpNamespaces: [],
          browserAllowLocalhost: true,
        });
      await render();

      const checkbox = byTestId<HTMLInputElement>(
        'settings-toggle-browser-allow-localhost',
      );
      expect(component.browserAllowLocalhost()).toBe(true);
      expect(checkbox.checked).toBe(true);

      // Click to disable
      checkbox.click();
      await settle();

      expect(call).toHaveBeenCalledWith('agent:setConfig', {
        browserAllowLocalhost: false,
      });
      expect(component.browserAllowLocalhost()).toBe(false);
      expect(checkbox.checked).toBe(false);
      expect(feedback.toast()?.tone).toBe('status');
      expect(feedback.toast()?.message).toBe('Saved Allow localhost.');
      expect(feedback.toast()?.canUndo).toBe(true);

      // Undo re-enables
      await feedback.undo();
      await settle();

      expect(call).toHaveBeenCalledWith('agent:setConfig', {
        browserAllowLocalhost: true,
      });
      expect(component.browserAllowLocalhost()).toBe(true);
      expect(checkbox.checked).toBe(true);
    });

    it('reverts allow localhost and displays fixed error on failure without leaking host text', async () => {
      responses['agent:setConfig'] = () => fail('host detail error message');
      await render();

      await component.confirmEnableLocalhost();
      await settle();

      expect(component.browserAllowLocalhost()).toBe(false);
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_UPDATE_LOCALHOST);
      expect(feedback.toast()?.message).not.toContain('host detail');
    });
  });
});

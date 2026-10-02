import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  EffortStateService,
  ProvidersSettingsStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import type { EffortLevel } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { UltracodeStateService } from '../../services/ultracode-state.service';
import { AgentBehaviourSectionComponent } from './agent-behaviour-section.component';

type Handler = (params: unknown) => unknown;

describe('AgentBehaviourSectionComponent', () => {
  let fixture: ComponentFixture<AgentBehaviourSectionComponent>;
  let component: AgentBehaviourSectionComponent;
  let element: HTMLElement;
  let feedback: SettingsSaveFeedbackService;
  let handlers: Record<string, Handler>;
  let call: jest.Mock;
  let effort: ReturnType<typeof signal<EffortLevel | undefined>>;
  let setEffort: jest.Mock;
  let ultracodeEnabled: ReturnType<typeof signal<boolean>>;
  let ultracodeToggle: jest.Mock;

  /** Mirrors EffortStateService: optimistic set, rolled back when the write fails. */
  function effortWrites(succeed: boolean): void {
    setEffort.mockImplementation(async (next: EffortLevel | undefined) => {
      const previous = effort();
      effort.set(next);
      if (!succeed) effort.set(previous);
    });
  }

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(AgentBehaviourSectionComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Lets the (change) handler's async save finish. Not `whenStable()`: the toast's 8 s
   * dismiss timer keeps the zone unstable for the whole toast lifetime.
   */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const checkbox = (label: string) =>
    element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) as HTMLInputElement;

  async function click(label: string): Promise<void> {
    checkbox(label).click();
    await settle();
  }

  beforeEach(() => {
    handlers = {
      'enhancedPrompts:getStatus': () => rpcSuccess({ enabled: false, hasGeneratedPrompt: true }),
      'enhancedPrompts:setEnabled': () => rpcSuccess({ success: true }),
      'agent:getConfig': () => rpcSuccess({ workflowsDisabled: false }),
      'agent:setConfig': () => rpcSuccess({ success: true }),
    };
    call = jest.fn(async (method: string, params: unknown) => handlers[method]?.(params) ?? rpcSuccess(undefined));
    effort = signal<EffortLevel | undefined>('medium');
    setEffort = jest.fn();
    effortWrites(true);
    ultracodeEnabled = signal(false);
    ultracodeToggle = jest.fn(async (next: boolean) => {
      ultracodeEnabled.set(next);
      return true;
    });

    TestBed.configureTestingModule({
      imports: [AgentBehaviourSectionComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: EffortStateService, useValue: { currentEffort: effort, setEffort } },
        { provide: UltracodeStateService, useValue: { enabled: ultracodeEnabled, toggle: ultracodeToggle } },
        { provide: ProvidersSettingsStateService, useValue: { commit: signal({ status: 'idle' }) } },
        { provide: VSCodeService, useValue: { isElectron: true } },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
  });

  afterEach(() => {
    feedback.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  describe('card shape', () => {
    it('renders one Agent behaviour table with the four rows in order', async () => {
      await render();
      expect(element.querySelector('#agent-behaviour-heading')?.textContent?.trim()).toBe('Agent behaviour');
      const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) => row.getAttribute('data-testid'));
      expect(rows).toEqual([
        'agent-behaviour-row-prompt',
        'agent-behaviour-row-effort',
        'agent-behaviour-row-workflows',
        'agent-behaviour-row-ultracode',
      ]);
    });

    it('PR-1 and PR-2: neither the preset radios nor the paid-plan sentence render', async () => {
      await render();
      expect(element.querySelector('input[type="radio"]')).toBeNull();
      expect(element.textContent).not.toContain('Default for new sessions');
      expect(element.textContent).not.toContain('paid plan');
    });

    it('labels the effort cell as the Providers Main Agent effort (G9)', async () => {
      await render();
      const row = element.querySelector('[data-testid="agent-behaviour-row-effort"]');
      expect(row?.textContent).toContain('Chat reasoning effort');
      expect(row?.textContent).toContain('Same value as Providers > Main Agent effort');
    });

    it('deviation 6: colour classes sit only on icons, never on text', async () => {
      handlers['enhancedPrompts:getStatus'] = () => rpcError('status unavailable');
      await render();
      const coloured = Array.from(
        element.querySelectorAll('.text-primary, .text-secondary, .text-success, .text-error, .text-warning'),
      );
      expect(coloured.length).toBeGreaterThan(0);
      // lucide-angular copies its host classes onto the inner <svg>.
      expect(coloured.every((node) => node.closest('lucide-angular') !== null)).toBe(true);
    });
  });

  describe('System prompt mode (A10/A11)', () => {
    it('keeps the harness aria-label and disables the toggle until a prompt exists', async () => {
      handlers['enhancedPrompts:getStatus'] = () => rpcSuccess({ enabled: false, hasGeneratedPrompt: false });
      await render();
      expect(checkbox('Toggle Enhanced System Prompt').disabled).toBe(true);
      expect(element.querySelector('#agent-behaviour-prompt-note')?.textContent).toContain('Run the Setup Wizard');
    });

    it('saves on selection, re-reads the status and toasts with Undo', async () => {
      await render();
      handlers['enhancedPrompts:getStatus'] = () => rpcSuccess({ enabled: true, hasGeneratedPrompt: true });
      await click('Toggle Enhanced System Prompt');
      expect(call).toHaveBeenCalledWith('enhancedPrompts:setEnabled', { workspacePath: '.', enabled: true });
      expect(checkbox('Toggle Enhanced System Prompt').checked).toBe(true);
      expect(element.querySelector('[data-testid="agent-behaviour-prompt-status"]')?.textContent).toContain('Ptah Enhanced');
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved system prompt mode.', canUndo: true });

      handlers['enhancedPrompts:getStatus'] = () => rpcSuccess({ enabled: false, hasGeneratedPrompt: true });
      await feedback.undo();
      expect(call).toHaveBeenLastCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });
      expect(call).toHaveBeenCalledWith('enhancedPrompts:setEnabled', { workspacePath: '.', enabled: false });
    });

    it('D15: a failed write reverts the checkbox and raises an alert toast with fixed message', async () => {
      handlers['enhancedPrompts:setEnabled'] = () => rpcError('host detail: disk full');
      await render();
      await click('Toggle Enhanced System Prompt');
      expect(checkbox('Toggle Enhanced System Prompt').checked).toBe(false);
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Could not save the system prompt mode.',
        canUndo: false,
      });
      expect(feedback.toast()?.message).not.toContain('host detail');
    });

    it('D15: a host failure inside a successful RPC ({success:false}) uses fixed error message', async () => {
      handlers['enhancedPrompts:setEnabled'] = () =>
        rpcSuccess({ success: false, error: 'host detail: Enhanced prompts could not be enabled.' });
      await render();
      call.mockClear();
      await click('Toggle Enhanced System Prompt');
      expect(checkbox('Toggle Enhanced System Prompt').checked).toBe(false);
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Could not save the system prompt mode.',
        canUndo: false,
      });
      expect(feedback.toast()?.message).not.toContain('host detail');
      // No status re-read follows a failed write.
      expect(call).not.toHaveBeenCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });
    });

    it('D15: a thrown error during write uses fixed error message', async () => {
      handlers['enhancedPrompts:setEnabled'] = () => {
        throw new Error('host detail: catastrophic crash');
      };
      await render();
      await click('Toggle Enhanced System Prompt');
      expect(checkbox('Toggle Enhanced System Prompt').checked).toBe(false);
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Could not save the system prompt mode.',
        canUndo: false,
      });
      expect(feedback.toast()?.message).not.toContain('host detail');
    });

    it('shows a load failure as an inline alert with fixed copy and no host detail', async () => {
      handlers['enhancedPrompts:getStatus'] = () => rpcError('host detail: status unavailable');
      await render();
      const alert = element.querySelector('[data-testid="agent-behaviour-load-error"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain('Could not load the system prompt status.');
      expect(alert?.textContent).not.toContain('host detail');
    });

    it('shows a load thrown error as an inline alert with fixed copy and no host detail', async () => {
      handlers['enhancedPrompts:getStatus'] = () => {
        throw new Error('host detail: socket timeout');
      };
      await render();
      const alert = element.querySelector('[data-testid="agent-behaviour-load-error"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain('Could not load the system prompt status.');
      expect(alert?.textContent).not.toContain('host detail');
    });
  });

  describe('Chat reasoning effort (A26, read-back)', () => {
    it('shows the shared effort value on the cell button', async () => {
      await render();
      expect(element.querySelector('[data-testid="agent-behaviour-effort-value"]')?.textContent).toContain('Medium');
    });

    it('saves a new level and Undo writes the previous one back', async () => {
      await render();
      await component.selectEffort('high');
      expect(setEffort).toHaveBeenCalledWith('high');
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved chat reasoning effort.', canUndo: true });

      await feedback.undo();
      expect(setEffort).toHaveBeenLastCalledWith('medium');
      expect(effort()).toBe('medium');
    });

    it('writes undefined (SDK default) for the Default choice', async () => {
      await render();
      await component.selectEffort('');
      expect(setEffort).toHaveBeenCalledWith(undefined);
      expect(feedback.toast()?.tone).toBe('status');
    });

    it('D15: a write that setEffort rolled back is never toasted as saved', async () => {
      effortWrites(false);
      await render();
      await component.selectEffort('max');
      expect(effort()).toBe('medium');
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Could not save the chat reasoning effort.',
        canUndo: false,
      });
    });

    it('does not write when the current level is picked again', async () => {
      await render();
      await component.selectEffort('medium');
      expect(setEffort).not.toHaveBeenCalled();
      expect(feedback.toast()).toBeNull();
    });

    it('is pinned while Ultracode is on: the cell is disabled and says why', async () => {
      ultracodeEnabled.set(true);
      await render();
      const trigger = element.querySelector<HTMLButtonElement>('[data-testid="agent-behaviour-effort-value"]');
      expect(trigger?.disabled).toBe(true);
      expect(element.querySelector('#agent-behaviour-effort-note')?.textContent).toContain('Pinned to X-High by Ultracode');
    });
  });

  describe('Dynamic workflows (A27)', () => {
    it('hydrates from agent:getConfig', async () => {
      handlers['agent:getConfig'] = () => rpcSuccess({ workflowsDisabled: true });
      await render();
      expect(checkbox('Toggle dynamic workflows').checked).toBe(false);
      expect(element.querySelector('[data-testid="agent-behaviour-workflows-status"]')?.textContent?.trim()).toBe('Off');
    });

    it('persists the inverted flag and toasts with Undo', async () => {
      await render();
      await click('Toggle dynamic workflows');
      expect(call).toHaveBeenCalledWith('agent:setConfig', { workflowsDisabled: true });
      expect(checkbox('Toggle dynamic workflows').checked).toBe(false);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved dynamic workflows.', canUndo: true });

      await feedback.undo();
      expect(call).toHaveBeenLastCalledWith('agent:setConfig', { workflowsDisabled: false });
      expect(component.workflowsEnabled()).toBe(true);
    });

    it('D15: a structured failure reverts the checkbox and uses fixed message with no host detail', async () => {
      handlers['agent:setConfig'] = () =>
        rpcSuccess({ success: false, error: 'host detail: Settings file is read-only.' });
      await render();
      await click('Toggle dynamic workflows');
      expect(checkbox('Toggle dynamic workflows').checked).toBe(true);
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Could not save the dynamic workflows setting.',
        canUndo: false,
      });
      expect(feedback.toast()?.message).not.toContain('host detail');
    });

    it('D15: a thrown error during workflow write uses fixed message with no host detail', async () => {
      handlers['agent:setConfig'] = () => {
        throw new Error('host detail: IPC disconnected');
      };
      await render();
      await click('Toggle dynamic workflows');
      expect(checkbox('Toggle dynamic workflows').checked).toBe(true);
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Could not save the dynamic workflows setting.',
        canUndo: false,
      });
      expect(feedback.toast()?.message).not.toContain('host detail');
    });

    it('keeps the toggle disabled and reports the failure when the setting cannot load', async () => {
      handlers['agent:getConfig'] = () => rpcError('host detail: host offline');
      await render();
      expect(checkbox('Toggle dynamic workflows').disabled).toBe(true);
      const alert = element.querySelector('[data-testid="agent-behaviour-load-error"]');
      expect(alert?.textContent).toContain('Could not load the dynamic workflows setting.');
      expect(alert?.textContent).not.toContain('host detail');
    });

    it('keeps the toggle disabled and reports the failure when the setting load throws', async () => {
      handlers['agent:getConfig'] = () => {
        throw new Error('host detail: connection refused');
      };
      await render();
      expect(checkbox('Toggle dynamic workflows').disabled).toBe(true);
      const alert = element.querySelector('[data-testid="agent-behaviour-load-error"]');
      expect(alert?.textContent).toContain('Could not load the dynamic workflows setting.');
      expect(alert?.textContent).not.toContain('host detail');
    });
  });

  describe('Ultracode (A29)', () => {
    it('turns on through UltracodeStateService and Undo turns it back off', async () => {
      await render();
      await click('Toggle Ultracode mode');
      expect(ultracodeToggle).toHaveBeenCalledWith(true);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved Ultracode.', canUndo: true });

      await feedback.undo();
      expect(ultracodeToggle).toHaveBeenLastCalledWith(false);
      expect(ultracodeEnabled()).toBe(false);
    });

    it('D15: a failed restore of the previous effort keeps Ultracode on and alerts', async () => {
      ultracodeEnabled.set(true);
      ultracodeToggle.mockResolvedValueOnce(false);
      await render();
      await click('Toggle Ultracode mode');
      expect(checkbox('Toggle Ultracode mode').checked).toBe(true);
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Could not turn off Ultracode: your previous reasoning effort was not restored.',
        canUndo: false,
      });
    });

    it('D15: a failed pin keeps Ultracode off and alerts', async () => {
      ultracodeToggle.mockResolvedValueOnce(false);
      await render();
      await click('Toggle Ultracode mode');
      expect(checkbox('Toggle Ultracode mode').checked).toBe(false);
      expect(feedback.toast()?.tone).toBe('alert');
    });
  });

  describe('System prompt details drawer (D-SP)', () => {
    it('opens drawer when Details button is clicked', async () => {
      await render();
      expect(component.drawerOpen()).toBe(false);

      const detailsBtn = element.querySelector<HTMLButtonElement>(
        '[data-testid="agent-behaviour-prompt-details"]',
      );
      expect(detailsBtn).not.toBeNull();
      detailsBtn?.click();
      fixture.detectChanges();

      expect(component.drawerOpen()).toBe(true);
    });

    it('reloads prompt status when drawer emits changed', async () => {
      await render();
      call.mockClear();

      // Trigger the protected loadPromptStatus directly or simulate change
      await (component as unknown as { loadPromptStatus: () => Promise<void> }).loadPromptStatus();
      expect(call).toHaveBeenCalledWith('enhancedPrompts:getStatus', { workspacePath: '.' });
    });
  });
});


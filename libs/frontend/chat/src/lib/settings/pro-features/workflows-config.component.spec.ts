/**
 * WorkflowsConfigComponent specs — the Advanced-tab section that surfaces
 * reasoning effort (via EffortStateService), the `workflows.disabled` config
 * key (via agent:getConfig / agent:setConfig), and the Ultracode toggle (via
 * UltracodeStateService).
 *
 * Coverage:
 *   - read: ngOnInit hydrates the workflows toggle from agent:getConfig
 *   - write: toggling persists the inverted `workflowsDisabled` flag and rolls
 *     back on failure
 *   - effort: segmented control reads/writes the shared EffortStateService
 *   - ultracode: the toggle delegates to UltracodeStateService.toggle
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ClaudeRpcService, EffortStateService } from '@ptah-extension/core';
import { WorkflowsConfigComponent } from './workflows-config.component';
import { UltracodeStateService } from '../../services/ultracode-state.service';

describe('WorkflowsConfigComponent', () => {
  let rpcCall: jest.Mock;
  let setEffort: jest.Mock;
  let ultracodeToggle: jest.Mock;
  let effortSignal: ReturnType<typeof signal<string | undefined>>;
  let ultracodeEnabled: ReturnType<typeof signal<boolean>>;

  function createComponent(): WorkflowsConfigComponent {
    return TestBed.createComponent(WorkflowsConfigComponent).componentInstance;
  }

  beforeEach(() => {
    rpcCall = jest.fn().mockResolvedValue({
      isSuccess: () => true,
      data: { workflowsDisabled: false, success: true },
    });
    setEffort = jest.fn().mockResolvedValue(undefined);
    ultracodeToggle = jest.fn().mockResolvedValue(undefined);
    effortSignal = signal<string | undefined>(undefined);
    ultracodeEnabled = signal(false);

    TestBed.configureTestingModule({
      imports: [WorkflowsConfigComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: EffortStateService,
          useValue: { currentEffort: effortSignal, setEffort },
        },
        {
          provide: UltracodeStateService,
          useValue: { enabled: ultracodeEnabled, toggle: ultracodeToggle },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('read (ngOnInit)', () => {
    it('hydrates the workflows toggle ON when workflowsDisabled is false', async () => {
      const component = createComponent();
      await component.ngOnInit();

      expect(rpcCall).toHaveBeenCalledWith('agent:getConfig', undefined);
      expect(component.workflowsEnabled()).toBe(true);
    });

    it('hydrates the workflows toggle OFF when workflowsDisabled is true', async () => {
      rpcCall.mockResolvedValue({
        isSuccess: () => true,
        data: { workflowsDisabled: true },
      });
      const component = createComponent();
      await component.ngOnInit();

      expect(component.workflowsEnabled()).toBe(false);
    });

    it('treats a missing workflowsDisabled field as workflows ON (default)', async () => {
      rpcCall.mockResolvedValue({ isSuccess: () => true, data: {} });
      const component = createComponent();
      await component.ngOnInit();

      expect(component.workflowsEnabled()).toBe(true);
    });
  });

  describe('write (toggleWorkflows)', () => {
    it('persists workflowsDisabled=true when the user turns workflows OFF', async () => {
      const component = createComponent();
      await component.ngOnInit();
      rpcCall.mockClear();

      await component.toggleWorkflows({
        target: { checked: false },
      } as unknown as Event);

      expect(rpcCall).toHaveBeenCalledWith('agent:setConfig', {
        workflowsDisabled: true,
      });
      expect(component.workflowsEnabled()).toBe(false);
    });

    it('persists workflowsDisabled=false when the user turns workflows ON', async () => {
      rpcCall.mockResolvedValue({
        isSuccess: () => true,
        data: { workflowsDisabled: true },
      });
      const component = createComponent();
      await component.ngOnInit();
      rpcCall.mockResolvedValue({
        isSuccess: () => true,
        data: { success: true },
      });

      await component.toggleWorkflows({
        target: { checked: true },
      } as unknown as Event);

      expect(rpcCall).toHaveBeenCalledWith('agent:setConfig', {
        workflowsDisabled: false,
      });
      expect(component.workflowsEnabled()).toBe(true);
    });

    it('rolls back the optimistic toggle when the save fails', async () => {
      const component = createComponent();
      await component.ngOnInit();
      // Starts ON (workflowsDisabled=false). Save reports structural failure.
      rpcCall.mockResolvedValue({
        isSuccess: () => true,
        data: { success: false },
      });

      await component.toggleWorkflows({
        target: { checked: false },
      } as unknown as Event);

      // Reverted back to the previous (ON) state.
      expect(component.workflowsEnabled()).toBe(true);
    });
  });

  describe('reasoning effort', () => {
    it('reflects the shared EffortStateService value', () => {
      effortSignal.set('high');
      const component = createComponent();
      expect(component.currentEffort()).toBe('high');
    });

    it('maps a missing effort to the empty (Default) choice', () => {
      const component = createComponent();
      expect(component.currentEffort()).toBe('');
    });

    it('writes a concrete level through EffortStateService', () => {
      const component = createComponent();
      component.selectEffort('xhigh');
      expect(setEffort).toHaveBeenCalledWith('xhigh');
    });

    it('writes undefined (SDK default) when the Default choice is picked', () => {
      const component = createComponent();
      component.selectEffort('');
      expect(setEffort).toHaveBeenCalledWith(undefined);
    });
  });

  describe('ultracode toggle', () => {
    it('delegates ON to UltracodeStateService.toggle(true)', () => {
      const component = createComponent();
      component.toggleUltracode({
        target: { checked: true },
      } as unknown as Event);
      expect(ultracodeToggle).toHaveBeenCalledWith(true);
    });

    it('delegates OFF to UltracodeStateService.toggle(false)', () => {
      const component = createComponent();
      component.toggleUltracode({
        target: { checked: false },
      } as unknown as Event);
      expect(ultracodeToggle).toHaveBeenCalledWith(false);
    });
  });
});

/**
 * AutopilotStateService specs — autopilot enabled + permission-level state
 * with optimistic RPC updates and agent-plan-mode bridge.
 *
 * Coverage:
 *   - Constructor triggers `config:autopilot-get` RPC and populates signals.
 *   - `toggleAutopilot` optimistically flips `enabled`, persists via RPC, and
 *     rolls back on failure.
 *   - `setPermissionLevel` optimistically mutates + rolls back on failure.
 *   - Concurrent-call guards via `_isPending` return early.
 *   - `setAgentPlanMode` updates `agentPlanMode` signal directly.
 *   - `handleMessage` for `session:plan-mode-changed` delegates to
 *     `setAgentPlanMode`.
 *   - `statusText` computed derives from enabled + permissionLevel + plan mode.
 *   - Invalid permission levels from backend fall back to 'ask'.
 */

import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_TYPES,
  PERMISSION_LEVEL_NAMES,
  type PermissionLevel,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { AutopilotStateService } from './autopilot-state.service';
import {
  createMockRpcService,
  makeSignalStoreHarness,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

interface AutopilotStoreState {
  enabled: boolean;
  isPending: boolean;
  permissionLevel: PermissionLevel;
  agentPlanMode: boolean;
  statusText: string;
}

describe('AutopilotStateService', () => {
  let rpc: MockRpcService;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  function createService(): AutopilotStateService {
    TestBed.configureTestingModule({
      providers: [
        AutopilotStateService,
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    return TestBed.inject(AutopilotStateService);
  }

  beforeEach(() => {
    rpc = createMockRpcService();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('initial load (config:autopilot-get)', () => {
    it('populates enabled + permissionLevel from the backend response', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: true, permissionLevel: 'auto-edit' }),
      );

      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      expect(rpc.call).toHaveBeenCalledWith('config:autopilot-get', {});
      expect(harness.read()).toMatchObject({
        enabled: true,
        permissionLevel: 'auto-edit',
      });
    });

    it('falls back to permissionLevel="ask" when the backend returns an invalid level', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          enabled: true,
          permissionLevel: 'bogus' as PermissionLevel,
        }),
      );

      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      expect(harness.signal('permissionLevel')).toBe('ask');
    });

    it('keeps defaults (enabled=false, permissionLevel="ask") on RPC failure', async () => {
      rpc.call.mockResolvedValueOnce(rpcError('no config'));

      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      expect(harness.read()).toMatchObject({
        enabled: false,
        permissionLevel: 'ask',
      });
    });
  });

  describe('toggleAutopilot()', () => {
    async function mkIdle(): Promise<{
      service: AutopilotStateService;
      harness: ReturnType<typeof makeSignalStoreHarness<AutopilotStoreState>>;
    }> {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: false, permissionLevel: 'ask' }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();
      return { service, harness };
    }

    it('optimistically flips enabled and persists via config:autopilot-toggle', async () => {
      const { service, harness } = await mkIdle();

      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));
      const pending = service.toggleAutopilot();

      // Optimistic: visible before RPC resolves.
      expect(harness.signal('enabled')).toBe(true);

      await pending;

      expect(rpc.call).toHaveBeenCalledWith(
        'config:autopilot-toggle',
        expect.objectContaining({
          enabled: true,
          permissionLevel: 'ask',
          sessionId: null,
        }),
      );
      expect(harness.signal('enabled')).toBe(true);
      expect(harness.signal('isPending')).toBe(false);
    });

    it('rolls back enabled when the RPC reports failure', async () => {
      const { service, harness } = await mkIdle();

      rpc.call.mockResolvedValueOnce(rpcError('persist failed'));
      await service.toggleAutopilot();

      expect(harness.signal('enabled')).toBe(false);
      expect(harness.signal('isPending')).toBe(false);
    });

    it('ignores duplicate toggles while isPending=true (concurrent guard)', async () => {
      const { service, harness } = await mkIdle();

      let resolveInflight: ((v: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

      const first = service.toggleAutopilot();
      expect(harness.signal('isPending')).toBe(true);

      // Duplicate call while pending — returns early, no new RPC.
      await service.toggleAutopilot();
      const toggleCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:autopilot-toggle',
      );
      expect(toggleCalls).toHaveLength(1);

      resolveInflight?.(rpcSuccess({ success: true }));
      await first;
      expect(harness.signal('isPending')).toBe(false);
    });

    it('forwards an explicit sessionId into the RPC params', async () => {
      const { service } = await mkIdle();
      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));

      await service.toggleAutopilot(
        'sess-42' as unknown as Parameters<
          AutopilotStateService['toggleAutopilot']
        >[0],
      );

      expect(rpc.call).toHaveBeenCalledWith(
        'config:autopilot-toggle',
        expect.objectContaining({ sessionId: 'sess-42' }),
      );
    });
  });

  describe('setPermissionLevel()', () => {
    it('optimistically updates permissionLevel and persists', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: true, permissionLevel: 'ask' }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));
      const pending = service.setPermissionLevel('yolo');
      expect(harness.signal('permissionLevel')).toBe('yolo');

      await pending;

      expect(rpc.call).toHaveBeenCalledWith(
        'config:autopilot-toggle',
        expect.objectContaining({
          enabled: true,
          permissionLevel: 'yolo',
        }),
      );
    });

    it('rolls back to the previous permission level when persistence fails', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: true, permissionLevel: 'auto-edit' }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      rpc.call.mockResolvedValueOnce(rpcError('conflict'));
      await service.setPermissionLevel('yolo');

      expect(harness.signal('permissionLevel')).toBe('auto-edit');
    });
  });

  describe('agent plan mode & message handling', () => {
    it('setAgentPlanMode updates the agentPlanMode signal directly', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: false, permissionLevel: 'ask' }),
      );
      const consoleLog = jest.spyOn(console, 'log').mockImplementation();
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      service.setAgentPlanMode(true);
      expect(harness.signal('agentPlanMode')).toBe(true);
      service.setAgentPlanMode(false);
      expect(harness.signal('agentPlanMode')).toBe(false);
      consoleLog.mockRestore();
    });

    it('handleMessage routes PLAN_MODE_CHANGED payload to setAgentPlanMode', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: false, permissionLevel: 'ask' }),
      );
      const consoleLog = jest.spyOn(console, 'log').mockImplementation();
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      service.handleMessage({
        type: MESSAGE_TYPES.PLAN_MODE_CHANGED,
        payload: { active: true },
      });
      expect(harness.signal('agentPlanMode')).toBe(true);

      service.handleMessage({
        type: MESSAGE_TYPES.PLAN_MODE_CHANGED,
        payload: { active: false },
      });
      expect(harness.signal('agentPlanMode')).toBe(false);
      consoleLog.mockRestore();
    });

    it('handleMessage ignores malformed payloads', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: false, permissionLevel: 'ask' }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      service.handleMessage({ type: MESSAGE_TYPES.PLAN_MODE_CHANGED });
      expect(harness.signal('agentPlanMode')).toBe(false);
    });

    it('exposes MESSAGE_TYPES.PLAN_MODE_CHANGED via handledMessageTypes', () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: false, permissionLevel: 'ask' }),
      );
      const service = createService();
      expect(service.handledMessageTypes).toContain(
        MESSAGE_TYPES.PLAN_MODE_CHANGED,
      );
    });
  });

  describe('statusText computed', () => {
    it('returns "Manual" when disabled', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: false, permissionLevel: 'yolo' }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      expect(harness.signal('statusText')).toBe('Manual');
    });

    it('returns the permission-level display name when enabled', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: true, permissionLevel: 'auto-edit' }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      expect(harness.signal('statusText')).toBe(
        PERMISSION_LEVEL_NAMES['auto-edit'],
      );
    });

    it('returns "Plan Mode" when agent-initiated plan mode is active (overrides enabled/level)', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ enabled: true, permissionLevel: 'yolo' }),
      );
      const consoleLog = jest.spyOn(console, 'log').mockImplementation();
      const service = createService();
      const harness = makeSignalStoreHarness<AutopilotStoreState>(service);
      await harness.flush();

      service.setAgentPlanMode(true);
      expect(harness.signal('statusText')).toBe('Plan Mode');
      consoleLog.mockRestore();
    });
  });
});

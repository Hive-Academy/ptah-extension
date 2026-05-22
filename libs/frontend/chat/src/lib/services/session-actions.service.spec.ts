import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';

import { ActionBannerService } from './action-banner.service';
import { SessionActionsService } from './session-actions.service';

describe('SessionActionsService', () => {
  let service: SessionActionsService;
  let rpcCall: jest.Mock;
  let activeTab: ReturnType<
    typeof signal<{ claudeSessionId: string | null } | null>
  >;
  let workspaceInfo: ReturnType<
    typeof signal<{ name: string; path: string; type: string } | null>
  >;
  let bannerError: jest.Mock;
  let bannerInfo: jest.Mock;

  const okResult = <T>(data: T) => ({
    success: true,
    isSuccess: () => true,
    data,
  });
  const errResult = (error: string) => ({
    success: false,
    isSuccess: () => false,
    error,
  });

  beforeEach(() => {
    activeTab = signal<{ claudeSessionId: string | null } | null>({
      claudeSessionId: 'sess-1',
    });
    workspaceInfo = signal<{
      name: string;
      path: string;
      type: string;
    } | null>({ name: 'w', path: '/ws', type: 'workspace' });
    rpcCall = jest.fn();
    bannerError = jest.fn();
    bannerInfo = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        SessionActionsService,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        { provide: TabManagerService, useValue: { activeTab } },
        { provide: AppStateManager, useValue: { workspaceInfo } },
        {
          provide: ActionBannerService,
          useValue: { showError: bannerError, showInfo: bannerInfo },
        },
      ],
    });
    service = TestBed.inject(SessionActionsService);
  });

  describe('saveToMemory()', () => {
    it('no-ops and surfaces banner when no active session', async () => {
      activeTab.set(null);
      const result = await service.saveToMemory();
      expect(result).toBeNull();
      expect(rpcCall).not.toHaveBeenCalled();
      expect(bannerError).toHaveBeenCalledWith('No active session to save.');
    });

    it('no-ops when active tab has null claudeSessionId', async () => {
      activeTab.set({ claudeSessionId: null });
      const result = await service.saveToMemory();
      expect(result).toBeNull();
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('dispatches memory:runNow with sessionId + workspaceRoot from TabManager', async () => {
      const data = {
        success: true,
        startedAt: 1,
        completedAt: 2,
        stats: null,
      };
      rpcCall.mockResolvedValue(okResult(data));

      const result = await service.saveToMemory();

      expect(rpcCall).toHaveBeenCalledWith(
        'memory:runNow',
        { sessionId: 'sess-1', workspaceRoot: '/ws' },
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(data);
      expect(bannerInfo).toHaveBeenCalled();
    });

    it('shows error banner when RPC fails', async () => {
      rpcCall.mockResolvedValue(errResult('boom'));
      const result = await service.saveToMemory();
      expect(result).toBeNull();
      expect(bannerError).toHaveBeenCalledWith('boom');
    });

    it('shows error banner when RPC throws', async () => {
      rpcCall.mockRejectedValue(new Error('disconnected'));
      const result = await service.saveToMemory();
      expect(result).toBeNull();
      expect(bannerError).toHaveBeenCalledWith('disconnected');
    });

    it('toggles actionInFlight signal around the dispatch', async () => {
      let inFlightDuring = false;
      rpcCall.mockImplementation(async () => {
        inFlightDuring = service.actionInFlight();
        return okResult({
          success: true,
          startedAt: 0,
          completedAt: 1,
          stats: null,
        });
      });
      await service.saveToMemory();
      expect(inFlightDuring).toBe(true);
      expect(service.actionInFlight()).toBe(false);
    });
  });

  describe('extractSkill()', () => {
    it('resolves sessionId from TabManager and dispatches with force=true', async () => {
      const data = {
        success: true,
        startedAt: 1,
        completedAt: 2,
        candidateId: 'cand-1',
        reason: null,
      };
      rpcCall.mockResolvedValue(okResult(data));

      const result = await service.extractSkill();

      expect(rpcCall).toHaveBeenCalledWith(
        'skillSynthesis:analyzeNow',
        { sessionId: 'sess-1', workspaceRoot: '/ws', force: true },
        expect.any(Object),
      );
      expect(result).toEqual(data);
      expect(bannerInfo).toHaveBeenCalledWith('Skill candidate extracted.');
    });

    it('surfaces ineligibility reason via info banner', async () => {
      const data = {
        success: true,
        startedAt: 1,
        completedAt: 2,
        candidateId: null,
        reason: 'too few turns',
      };
      rpcCall.mockResolvedValue(okResult(data));
      await service.extractSkill();
      expect(bannerInfo).toHaveBeenCalledWith(
        'Session ineligible: too few turns',
      );
    });

    it('no-ops without workspace path', async () => {
      workspaceInfo.set(null);
      const result = await service.extractSkill();
      expect(result).toBeNull();
      expect(rpcCall).not.toHaveBeenCalled();
      expect(bannerError).toHaveBeenCalled();
    });

    it('surfaces RPC failures through banner', async () => {
      rpcCall.mockResolvedValue(errResult('rpc died'));
      const result = await service.extractSkill();
      expect(result).toBeNull();
      expect(bannerError).toHaveBeenCalledWith('rpc died');
    });
  });

  describe('hasActiveSession()', () => {
    it('reflects whether the active tab has a claudeSessionId', () => {
      expect(service.hasActiveSession()).toBe(true);
      activeTab.set({ claudeSessionId: null });
      expect(service.hasActiveSession()).toBe(false);
      activeTab.set(null);
      expect(service.hasActiveSession()).toBe(false);
    });
  });
});

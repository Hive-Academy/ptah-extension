import { attentionRequestKey } from '@ptah-extension/shared';
import type { AttentionOpenTargetPayload } from '@ptah-extension/shared';
import type {
  IHostAttentionNotifications,
  SafeHostAttentionNotice,
} from '../../interfaces/host-attention-notifications.interface';

export interface HostAttentionContractSetup {
  createProvider(): IHostAttentionNotifications | Promise<IHostAttentionNotifications>;
  /** Records actual host issues, rather than calls to present. */
  presented(): readonly SafeHostAttentionNotice[];
  /** Logical pending generations; native UI need not be physically retractable. */
  active(): ReadonlyArray<{ readonly key: string; readonly generation: number }>;
  /** Records successful routes requested by open. */
  opened(): readonly AttentionOpenTargetPayload[];
  setEligible(eligible: boolean): void;
  teardown?(): void | Promise<void>;
  /** CLI has no native notification capability. */
  noOp?: boolean;
}

const key = attentionRequestKey('permission', 'contract-request');
const failureKey = 'c:contract-failure';
const target = { workspaceId: 'ws-contract', sessionId: 'contract-session' };

function notice(generation: number): SafeHostAttentionNotice {
  return {
    key,
    generation,
    kind: 'permission',
    severity: 'warning',
    label: 'Permission needed',
    actionLabel: 'Open Ptah',
    sessionTitle: 'Contract session',
    target,
  };
}

function failureNotice(generation: number): SafeHostAttentionNotice {
  return {
    key: failureKey,
    generation,
    kind: 'failure',
    severity: 'error',
    label: 'Session failed',
    actionLabel: 'Open Ptah',
    sessionTitle: 'Failed contract session',
    target,
  };
}

/** Shared behavioral suite for Electron, VS Code and the CLI no-op adapter. */
export function runHostAttentionContract(
  name: string,
  setup: HostAttentionContractSetup,
): void {
  describe(`IHostAttentionNotifications contract - ${name}`, () => {
    let provider: IHostAttentionNotifications;

    beforeEach(async () => {
      setup.setEligible(true);
      provider = await setup.createProvider();
    });

    afterEach(async () => {
      provider.dispose();
      await setup.teardown?.();
    });

    it('honours eligibility', () => {
      setup.setEligible(false);
      expect(provider.isEligible()).toBe(false);
      provider.present(notice(1));
      expect(setup.presented()).toHaveLength(0);
      setup.setEligible(true);
      expect(provider.isEligible()).toBe(!setup.noOp);
    });

    it('issues once per generation and preserves only approved display fields', () => {
      provider.present(notice(1));
      provider.present(notice(1));
      if (setup.noOp) {
        expect(setup.presented()).toHaveLength(0);
        return;
      }
      expect(setup.presented()).toHaveLength(1);
      expect(setup.presented()[0].sessionTitle).toBe('Contract session');
      expect(Object.keys(setup.presented()[0]).sort()).toEqual(
        ['actionLabel', 'generation', 'key', 'kind', 'label', 'sessionTitle', 'severity', 'target'].sort(),
      );
      expect(Object.keys(setup.presented()[0].target).sort()).toEqual(
        ['sessionId', 'workspaceId'],
      );
    });

    it('keeps the latest generation when an old generation resolves or arrives', () => {
      provider.present(notice(1));
      provider.present(notice(2));
      provider.present(notice(1));
      provider.resolve(key, 1);
      expect(setup.active()).toEqual(setup.noOp ? [] : [{ key, generation: 2 }]);
      provider.resolve(key, 2);
      expect(setup.active()).toEqual([]);
    });

    it('applies title, generation, resolution and stale-open rules to failures', () => {
      provider.present(failureNotice(1));
      provider.present(failureNotice(1));
      provider.present(failureNotice(2));
      provider.resolve(failureKey, 1);
      expect(setup.active()).toEqual(
        setup.noOp ? [] : [{ key: failureKey, generation: 2 }],
      );
      if (setup.noOp) {
        expect(setup.presented()).toHaveLength(0);
      } else {
        expect(setup.presented()).toHaveLength(2);
        expect(setup.presented()[0]).toMatchObject({
          kind: 'failure',
          severity: 'error',
          label: 'Session failed',
          sessionTitle: 'Failed contract session',
        });
        expect(Object.keys(setup.presented()[0]).sort()).toEqual(
          ['actionLabel', 'generation', 'key', 'kind', 'label', 'sessionTitle', 'severity', 'target'].sort(),
        );
      }
      provider.open({ key: failureKey, generation: 1, target });
      expect(setup.opened()).toHaveLength(0);
      provider.resolve(failureKey, 2);
      expect(setup.active()).toEqual([]);
      provider.open({ key: failureKey, generation: 2, target });
      expect(setup.opened()).toHaveLength(0);
    });

    it('does not route a stale target after resolution', () => {
      provider.present(notice(1));
      provider.resolve(key, 1);
      provider.open({ key, generation: 1, target });
      expect(setup.opened()).toHaveLength(0);
    });

    it('routes only a currently active target', () => {
      provider.present(notice(2));
      provider.open({ key, generation: 1, target });
      expect(setup.opened()).toHaveLength(0);
      provider.open({ key, generation: 2, target });
      expect(setup.opened()).toHaveLength(setup.noOp ? 0 : 1);
    });

    it('can be disposed twice and stops accepting notices', () => {
      expect(() => provider.dispose()).not.toThrow();
      expect(() => provider.dispose()).not.toThrow();
      provider.present(notice(1));
      expect(setup.presented()).toHaveLength(0);
    });
  });
}

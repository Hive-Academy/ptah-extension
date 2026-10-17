import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import {
  CommandCenterRecordsService,
  TabManagerService,
  type CommandCenterRunManifest,
} from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { TribunalDiscoveryService } from '@ptah-extension/tribunal-panel/discovery';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import type { ProposalTransport } from '../model/tribunal-run-coordinator';
import type {
  ProposalAvailability,
  TribunalRosterProposal,
} from '../model/tribunal-roster-proposal';

/** Page lifetime transport for a single root's Tribunal proposals. */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped provider
@Injectable()
export class CommandCenterTribunalTransport implements ProposalTransport {
  private readonly coordinator = inject(CommandCenterSessionCoordinator);
  private readonly tabs = inject(TabManagerService);
  private readonly records = inject(CommandCenterRecordsService);
  private readonly discovery = inject(TribunalDiscoveryService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly store = inject(CommandCenterStore);
  private readonly destroyRef = inject(DestroyRef);
  private disabledClis: readonly string[] = [];
  private configReady = false;
  private boundarySeq = 0;
  private boundaryResolve: (() => void) | null = null;
  private boundaryReject: ((reason: Error) => void) | null = null;
  private exited = false;

  public constructor() {
    effect(() => {
      const tabId = this.store.markedTabId();
      const pulse = tabId
        ? this.tabs.lastTerminalPulseByTab().get(tabId)
        : undefined;
      if (pulse && pulse.seq > this.boundarySeq && this.boundaryResolve) {
        this.boundarySeq = pulse.seq;
        const resolve = this.boundaryResolve;
        this.boundaryResolve = null;
        this.boundaryReject = null;
        resolve();
      }
    });
    this.destroyRef.onDestroy(() => this.pageExit());
  }

  public async open(): Promise<void> {
    const discovered = this.discovery.ensureDiscovered();
    try {
      const result = await this.rpc.call('agent:getConfig', undefined);
      this.configReady = result.isSuccess() && !!result.data;
      this.disabledClis = this.configReady
        ? (result.data?.disabledClis ?? [])
        : [];
      if (!this.configReady)
        this.reportFailure(
          'Could not read disabled agents. Tribunal is unavailable.',
        );
    } catch {
      // degradation-audit: reported — configuration failure disables Tribunal availability
      this.configReady = false;
      this.disabledClis = this.discovery
        .vendors()
        .map((vendor) => vendor.lane.cli);
      this.reportFailure(
        'Could not read disabled agents. Tribunal is unavailable.',
      );
    }
    await discovered;
  }

  public answer(
    questionId: string,
    questionKey: string,
    answer: string,
  ): boolean {
    const tabId = this.store.markedTabId();
    if (!tabId) return false;
    this.boundarySeq = this.tabs.lastTerminalPulseByTab().get(tabId)?.seq ?? 0;
    try {
      this.coordinator.answerQuestion({
        id: questionId,
        answers: {
          [questionKey]: /\bconfirm\b/i.test(answer) ? 'Decline' : answer,
        },
      });
      return true;
    } catch {
      // degradation-audit: reported — answer delivery failure is shown and the coordinator may retry Decline
      this.reportFailure('Could not answer the Tribunal proposal.');
      return false;
    }
  }

  public availability(): ProposalAvailability {
    return {
      lanes:
        this.discovery.discovered() && this.configReady
          ? this.discovery.vendors().map((vendor) => ({
              laneId: vendor.lane.laneId,
              state: vendor.available ? 'AVAILABLE' : 'AT LIMIT',
              family: vendor.lane.family,
              cli: vendor.lane.cli,
            }))
          : [],
      disabledClis: this.disabledClis,
    };
  }

  public discoveryComplete(): Promise<void> {
    if (this.exited) return Promise.reject(new Error('Page exited'));
    const tabId = this.store.markedTabId();
    const pulse = tabId
      ? this.tabs.lastTerminalPulseByTab().get(tabId)
      : undefined;
    if (pulse && pulse.seq > this.boundarySeq) {
      this.boundarySeq = pulse.seq;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.boundaryResolve = resolve;
      this.boundaryReject = reject;
    });
  }

  public pageExit(): void {
    this.exited = true;
    this.cancelDiscovery('Page exited');
  }

  public cancelDiscovery(reason = 'Discovery cancelled'): void {
    const reject = this.boundaryReject;
    this.boundaryResolve = null;
    this.boundaryReject = null;
    reject?.(new Error(reason));
  }

  public async createTask(
    proposal: TribunalRosterProposal,
  ): Promise<string | null> {
    const workspaceRoot = this.store.workspace();
    try {
      const result = await this.rpc.call('tasks:create', {
        title: `Tribunal ${proposal.move} — ${new Date().toISOString().slice(0, 10)}`,
        type: 'FEATURE',
        status: 'in_progress',
        description: proposal.objective,
        ...(workspaceRoot ? { workspaceRoot } : {}),
      });
      if (result.isSuccess() && result.data?.success && result.data.task)
        return result.data.task.id;
    } catch {
      // degradation-audit: reported — task allocation failure is shown in the page toast
      this.reportFailure('Could not create the Tribunal task.');
      return null;
    }
    this.reportFailure('Could not create the Tribunal task.');
    return null;
  }

  public writeManifest(
    workspace: string,
    manifest: CommandCenterRunManifest,
  ): boolean {
    return this.records.writeRunManifest(workspace, manifest);
  }
  public removeManifest(workspace: string, runId: string): boolean {
    return this.records.removeRunManifest(workspace, runId);
  }
  public sendLaunchTurn(content: string): Promise<boolean> {
    if (this.store.workspace() !== this.tabs.activeWorkspacePath) {
      this.reportFailure(
        'Command Center is switching workspaces. Confirm again when it is ready.',
      );
      return Promise.resolve(false);
    }
    return this.coordinator.sendLaunchTurn(content);
  }
  public reportFailure(message: string): void {
    this.store.setToast({ message, tone: 'error' });
  }
}

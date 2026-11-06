import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  RpcUserError,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import {
  MACHINES_RPC_METHOD_NAMES,
  MACHINES_RPC_PARAMS_SCHEMAS,
  type MachinesRpcMethodName,
} from '@ptah-extension/shared';
import { WorkerClientError } from '@ptah-extension/worker-protocol';
import { MachinesService } from './machines-service';

export function mapMachineError(error: unknown): Error {
  if (error instanceof RpcUserError) return error;
  if (error instanceof WorkerClientError) {
    const code =
      error.code === 'VERSION_MISMATCH'
        ? 'MACHINE_VERSION_MISMATCH'
        : error.code === 'NOT_FOUND_OR_FORBIDDEN'
          ? 'MACHINE_NOT_FOUND_OR_FORBIDDEN'
          : error.code === 'PAIRING_REJECTED'
            ? 'MACHINE_PAIRING_REJECTED'
            : error.code === 'SESSION_DRIVEN_ELSEWHERE'
              ? 'SESSION_DRIVEN_ELSEWHERE'
              : error.code === 'DRIVER_LOCK_UNAVAILABLE'
                ? 'SESSION_DRIVER_LOCK_UNAVAILABLE'
                : 'MACHINE_UNREACHABLE';
    return new RpcUserError(error.message, code);
  }
  return error instanceof Error ? error : new Error('Machine operation failed');
}

@injectable()
export class MachinesRpcHandlers {
  constructor(
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly machines: MachinesService,
  ) {}
  register(): void {
    for (const method of MACHINES_RPC_METHOD_NAMES) {
      this.rpcHandler.registerMethod(method, async (params: unknown) => {
        const parsed = MACHINES_RPC_PARAMS_SCHEMAS[method].safeParse(params);
        if (!parsed.success)
          throw new RpcUserError(
            'Invalid machine parameters',
            'INVALID_PARAMS',
          );
        try {
          return await this.dispatch(method, parsed.data);
        } catch (error) {
          throw mapMachineError(error);
        }
      });
    }
  }
  private dispatch(
    method: MachinesRpcMethodName,
    params: unknown,
  ): Promise<unknown> {
    switch (method) {
      case 'machines:list':
        return this.machines.list();
      case 'machines:sshAliases':
        return this.machines.sshAliases();
      case 'machines:add':
        return this.machines.add(
          MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params).alias,
        );
      case 'machines:pair': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.pair(p.machineId, p.code);
      }
      case 'machines:pairViaSsh':
        return this.machines.pairViaSsh(
          MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params).machineId,
        );
      case 'machines:remove':
        return this.machines.remove(
          MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params).machineId,
        );
      case 'machines:retry':
        return this.machines.retry(
          MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params).machineId,
        );
      case 'machines:readiness':
        return this.machines.readiness(
          MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params).machineId,
        );
      case 'machines:workspaces':
        return this.machines
          .call(
            MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params).machineId,
            'workspaces.list',
            {},
          )
          .then((workspaces) => ({ workspaces }));
      case 'machines:sessions': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines
          .call(p.machineId, 'sessions.list', { workspaceId: p.workspaceId })
          .then((sessions) => ({ sessions }));
      }
      case 'machines:session.attach': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.attach(p.machineId, p.sessionId);
      }
      case 'machines:session.detach': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.detach(p.machineId, p.sessionId);
      }
      case 'machines:session.replay': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.attach(p.machineId, p.sessionId, p.afterSeq);
      }
      case 'machines:session.start': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.call(p.machineId, 'session.start', {
          workspaceId: p.workspaceId,
          prompt: p.prompt,
          ...(p.name ? { name: p.name } : {}),
        });
      }
      case 'machines:session.continue': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.call(p.machineId, 'session.continue', {
          sessionId: p.sessionId,
          prompt: p.prompt,
        });
      }
      case 'machines:session.stop': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.call(p.machineId, 'session.stop', {
          sessionId: p.sessionId,
        });
      }
      case 'machines:permission.respond': {
        const p = MACHINES_RPC_PARAMS_SCHEMAS[method].parse(params);
        return this.machines.call(p.machineId, 'permission.respond', {
          sessionId: p.sessionId,
          requestId: p.requestId,
          decision: p.decision,
          ...(p.reason ? { reason: p.reason } : {}),
        });
      }
    }
  }
}

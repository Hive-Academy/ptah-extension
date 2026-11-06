import {
  RPC_CAPABILITIES,
  type Capability,
} from '@ptah-extension/rpc-handlers';
import type { RemoteMethod } from '@ptah-extension/worker-protocol';

export type WorkerCapabilityRow = {
  readonly capability: Capability | 'core chat/session';
  readonly status:
    'supported' | 'deferred' | 'unsupported-remotely' | 'not-applicable';
  readonly reason?: string;
  readonly phase?: string;
  readonly methods: readonly RemoteMethod[];
};

const CORE_METHODS = [
  'machine.info',
  'workspaces.list',
  'sessions.list',
  'session.attach',
  'session.detach',
  'session.start',
  'session.continue',
  'session.stop',
  'permission.respond',
  'token.revokeSelf',
] as const satisfies readonly RemoteMethod[];

/** Documentation data; a capability can exist in-process without being remotely callable. */
export const WORKER_CAPABILITIES: readonly WorkerCapabilityRow[] = [
  {
    capability: 'core chat/session',
    status: 'supported',
    methods: CORE_METHODS,
  },
  ...RPC_CAPABILITIES.map((capability): WorkerCapabilityRow => ({
    capability,
    status:
      capability === 'remoteMachines'
        ? 'not-applicable'
        : 'unsupported-remotely',
    reason:
      capability === 'remoteMachines'
        ? 'The worker is the remote endpoint; Electron owns SSH connections.'
        : 'Phase 1 exposes only the core chat and session methods.',
    methods: [],
  })),
];

export function supportedRemoteMethods(): readonly RemoteMethod[] {
  return WORKER_CAPABILITIES.flatMap((row) =>
    row.status === 'supported' ? row.methods : [],
  );
}

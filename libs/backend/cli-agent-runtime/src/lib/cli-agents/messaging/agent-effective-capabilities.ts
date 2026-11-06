import type { AgentProcessInfo, CliAdapterManifest, EffectiveLaneCapabilities } from '@ptah-extension/shared';
import type { SdkHandle } from '../cli-adapters/cli-adapter.interface';

const supported = { state: 'supported' } as const;
const unsupported = { state: 'unsupported', reason: 'The live handle does not expose this operation.' } as const;

/** A live operation is effective only when its handle actually exposes it. */
export function resolveEffectiveLaneCapabilities(
  info: AgentProcessInfo,
  potential: CliAdapterManifest,
  handle?: SdkHandle,
  released = false,
  now = Date.now(),
): EffectiveLaneCapabilities {
  if (!handle || released) {
    return {
      agentId: info.agentId,
      resolvedAt: now,
      source: 'restored-record',
      messaging: {
        steer: unsupported,
        interrupt: unsupported,
        continuation: unsupported,
        resume: info.cliSessionId ? potential.messaging.resume : unsupported,
      },
      mcp: potential.mcp,
    };
  }
  return {
    agentId: info.agentId,
    resolvedAt: now,
    source: 'live-handle',
    messaging: {
      steer: typeof handle.steer === 'function' ? supported : unsupported,
      interrupt: handle.supportsInterrupt?.() === true && typeof handle.interrupt === 'function' ? supported : unsupported,
      continuation: handle.supportsContinuation?.() === true && typeof handle.continue === 'function' ? supported : unsupported,
      resume: potential.messaging.resume,
    },
    mcp: potential.mcp,
  };
}

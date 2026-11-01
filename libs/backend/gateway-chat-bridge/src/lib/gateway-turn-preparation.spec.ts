import 'reflect-metadata';
import type { ExecutionProfileRequest } from '@ptah-extension/auth-providers';
import type { SessionRuntimeIdentityLookup } from '@ptah-extension/agent-sdk';
import {
  SessionId,
  type RuntimeHostCapabilities,
  type SessionRuntimeIdentity,
} from '@ptah-extension/shared';
import {
  GatewayTurnPreparation,
  type GatewayTurnPreparationDeps,
} from './gateway-turn-preparation';

const SESSION = '11111111-2222-4333-8444-555555555555';
const WORKSPACE = '/ws/proj';

const hostCapabilities: RuntimeHostCapabilities = {
  nativeCodex: true,
  nativeCodexGateway: true,
};

function preparation(options?: {
  readonly sessionIdentities?: SessionRuntimeIdentityLookup;
  readonly profileResolver?: GatewayTurnPreparationDeps['profileResolver'];
}): GatewayTurnPreparation {
  const profileResolver: GatewayTurnPreparationDeps['profileResolver'] =
    options?.profileResolver ?? {
      resolveStoredModel: (_workspacePath, storedModel) => storedModel,
      resolveExecutionProfile: async () => ({
        runtime: 'claude-sdk',
        model: 'claude-from-resolver',
        providerProfile: undefined,
      }),
    };
  return new GatewayTurnPreparation({
    logger: {
      debug: () => undefined,
      warn: () => undefined,
    },
    codeExecutionMcp: {
      getPort: () => null,
      ensureRegisteredForSubagents: async () => ({ registered: true }),
    },
    enhancedPrompts: {
      getEnhancedPromptContent: async () => null,
    },
    profileResolver,
    readSelectedModel: () => 'stored-model',
    hostCapabilities,
    sessionIdentities: options?.sessionIdentities,
  });
}

function nativeIdentity(sessionId: SessionId): SessionRuntimeIdentity {
  return {
    version: 1,
    sessionId,
    providerId: 'openai-codex',
    workspaceId: WORKSPACE,
    runtime: 'codex-app-server',
    codex: { normalizedHome: 'c:\\codex-home' },
  };
}

function expectLegacyClaude(
  identity: SessionRuntimeIdentity | undefined,
): void {
  expect(identity).toEqual({
    version: 1,
    sessionId: SessionId.from(SESSION),
    runtime: 'claude-sdk',
    providerId: 'claude-cli',
    workspaceId: WORKSPACE,
  });
}

describe('GatewayTurnPreparation.readBoundSessionIdentity', () => {
  it('returns a legacy Claude identity when no lookup service is bound', () => {
    const result = preparation().readBoundSessionIdentity(SESSION, WORKSPACE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected a legacy identity');
    }
    expectLegacyClaude(result.identity);
  });

  it('returns a legacy Claude identity when lookup returns undefined', () => {
    const lookup: SessionRuntimeIdentityLookup = {
      lookup: () => undefined,
    };
    const result = preparation({
      sessionIdentities: lookup,
    }).readBoundSessionIdentity(SESSION, WORKSPACE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected a legacy identity');
    }
    expectLegacyClaude(result.identity);
  });

  it('fails a non-empty id that is not a session id', () => {
    const result = preparation().readBoundSessionIdentity(
      'not-a-session-id',
      WORKSPACE,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected an invalid-id failure');
    }
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe(
      'Bound gateway session id is not a valid session id',
    );
  });

  it('fails when lookup throws', () => {
    const failure = new Error('store down');
    const lookup: SessionRuntimeIdentityLookup = {
      lookup: () => {
        throw failure;
      },
    };
    const result = preparation({
      sessionIdentities: lookup,
    }).readBoundSessionIdentity(SESSION, WORKSPACE);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a lookup failure');
    }
    expect(result.error).toBe(failure);
  });

  it('passes a native identity through', () => {
    const id = SessionId.from(SESSION);
    const native = nativeIdentity(id);
    const lookup: SessionRuntimeIdentityLookup = {
      lookup: (requested) =>
        requested === id ? { persisted: native } : undefined,
    };
    const result = preparation({
      sessionIdentities: lookup,
    }).readBoundSessionIdentity(SESSION, WORKSPACE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected the stored identity');
    }
    expect(result.identity).toBe(native);
  });

  it('carries no identity for an absent or empty binding', () => {
    const unit = preparation();
    expect(unit.readBoundSessionIdentity(null, WORKSPACE)).toEqual({
      ok: true,
    });
    expect(unit.readBoundSessionIdentity(undefined, WORKSPACE)).toEqual({
      ok: true,
    });
    expect(unit.readBoundSessionIdentity('', WORKSPACE)).toEqual({ ok: true });
  });
});

describe('GatewayTurnPreparation.prepareTurn', () => {
  it('omits existingIdentity for a new session and uses the Claude decision', async () => {
    let seen: ExecutionProfileRequest | undefined;
    const unit = preparation({
      profileResolver: {
        resolveStoredModel: (_workspacePath, storedModel) => storedModel,
        resolveExecutionProfile: async (input) => {
          seen = input;
          return {
            runtime: 'claude-sdk',
            model: 'claude-from-resolver',
            providerProfile: undefined,
          };
        },
      },
    });

    const prepared = await unit.prepareTurn(WORKSPACE);

    expect(prepared.provider).toEqual({
      model: 'claude-from-resolver',
      providerProfile: undefined,
      runtime: 'claude-sdk',
    });
    expect(prepared.sdkContext).toEqual({
      mcpServerRunning: false,
      enhancedPromptsContent: undefined,
    });
    expect(seen?.requestedModel).toBe('stored-model');
    expect(seen?.consumer).toBe('gateway');
    expect(seen?.workspacePath).toBe(WORKSPACE);
    expect(seen?.hostCapabilities).toBe(hostCapabilities);
    expect(
      seen !== undefined &&
        Object.prototype.hasOwnProperty.call(seen, 'existingIdentity'),
    ).toBe(false);
  });

  it('forwards a native identity and takes the model from the Codex seed', async () => {
    const native = nativeIdentity(SessionId.from(SESSION));
    let seen: ExecutionProfileRequest | undefined;
    const unit = preparation({
      profileResolver: {
        resolveStoredModel: () => 'stored-model',
        resolveExecutionProfile: async (input) => {
          seen = input;
          return {
            runtime: 'codex-app-server',
            seed: {
              providerId: 'openai-codex',
              consumer: 'gateway',
              workspacePath: WORKSPACE,
              home: 'C:\\codex',
              normalizedHome: 'c:\\codex',
              model: 'codex-model',
            },
          };
        },
      },
    });

    const prepared = await unit.prepareTurn(WORKSPACE, native);

    expect(seen?.existingIdentity).toBe(native);
    expect(prepared.provider).toEqual({
      model: 'codex-model',
      providerProfile: undefined,
      runtime: 'codex-app-server',
    });
  });
});

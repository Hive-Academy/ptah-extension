import type { EffortLevel } from '../ai-provider.types';
import { readProviderAccountSelectionField } from '../provider-account.schemas';
import type {
  ProviderAccountBinding,
  ProviderAccountBindingPresence,
} from '../provider-account.types';
import { RPC_METHOD_NAMES } from '../rpc.types';
import {
  CLAUDE_REASONING_EFFORT_VALUES,
  classifyAgentResumeAccountSelection,
  isClaudeReasoningEffortSetting,
} from './rpc-agents.types';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
} from './rpc-agents.types';
import { SCOPED_SETTING_KEYS } from './rpc-auth.types';
import {
  PROVIDER_ACCOUNT_ABSENT_SELECTION_REVISION,
  PROVIDER_ACCOUNT_RPC_METHOD_NAMES,
} from './rpc-provider-accounts.types';
import type {
  ProviderAccountRpcMethodName,
  ProviderAccountRpcMethodRegistry,
  ProviderAccountRpcRegistryInSync,
  ProviderAccountSelectionWrite,
  ProviderAccountsChangedNotification,
} from './rpc-provider-accounts.types';

type ParamsOf<M extends ProviderAccountRpcMethodName> =
  ProviderAccountRpcMethodRegistry[M]['params'];

type AnyParamKey = {
  [M in ProviderAccountRpcMethodName]: keyof ParamsOf<M>;
}[ProviderAccountRpcMethodName];

/** Keys that would hand a caller route, environment, owner or binding authority. */
type ForbiddenAuthorityKey =
  | 'directory'
  | 'path'
  | 'configDir'
  | 'env'
  | 'environment'
  | 'token'
  | 'apiKey'
  | 'owner'
  | 'ownerKey'
  | 'identity'
  | 'routeFingerprint'
  | 'routeRevision'
  | 'authEpoch'
  | 'binding'
  | 'runId';

const PUBLIC_PARAM_KEYS: ReadonlySet<string> = new Set([
  'provider',
  'workspaceRoot',
  'scope',
  'profileId',
  'label',
  'requestId',
  'operationId',
  'selection',
  'expectedRevision',
  'expectedSelectionRevision',
  'expectedSelectionRevisions',
]);

const WORKSPACE = 'D:/work/project';
const PROFILE_ID = 'profile-aaaa1111';
const REQUEST_ID = 'request-0001';

const named: ProviderAccountSelectionWrite = {
  kind: 'named',
  profileId: PROFILE_ID,
  expectedProfileRevision: 3,
};

/** One params value per method; the Record type forces full coverage. */
const SAMPLE_PARAMS: { [M in ProviderAccountRpcMethodName]: ParamsOf<M> } = {
  'provider:listAccounts': { provider: 'claude', workspaceRoot: WORKSPACE },
  'provider:addAccount': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    requestId: REQUEST_ID,
    label: 'Work',
  },
  'provider:renameAccount': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    profileId: PROFILE_ID,
    expectedRevision: 3,
    requestId: REQUEST_ID,
    label: 'Personal',
  },
  'provider:removeAccount': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    profileId: PROFILE_ID,
    expectedRevision: 3,
    requestId: REQUEST_ID,
  },
  'provider:getAccountStatus': { provider: 'claude', profileId: PROFILE_ID },
  'provider:startAccountSignIn': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    profileId: PROFILE_ID,
    expectedRevision: 3,
    requestId: REQUEST_ID,
  },
  'provider:cancelAccountSignIn': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    profileId: PROFILE_ID,
    operationId: 'operation-0001',
    requestId: REQUEST_ID,
  },
  'provider:signOutAccount': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    profileId: PROFILE_ID,
    expectedRevision: 4,
    requestId: REQUEST_ID,
  },
  'provider:setAccountSelection': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    scope: 'lane',
    selection: named,
    expectedSelectionRevision: PROVIDER_ACCOUNT_ABSENT_SELECTION_REVISION,
    requestId: REQUEST_ID,
  },
  'provider:setAccountDefault': {
    provider: 'claude',
    workspaceRoot: WORKSPACE,
    selection: { kind: 'ambient' },
    expectedSelectionRevisions: { main: 0, lane: -1 },
    requestId: REQUEST_ID,
  },
};

const BINDING: ProviderAccountBinding = {
  version: 1,
  provider: 'claude',
  profileId: PROFILE_ID,
  routeRevision: 0,
  routeFingerprint: 'f'.repeat(32),
  authEpoch: 0,
  runId: 'run-00000001',
  identity: { kind: 'unknown' },
};

const BOUND: ProviderAccountBindingPresence = { status: 'bound', binding: BINDING };
const ABSENT: ProviderAccountBindingPresence = { status: 'absent' };
const INVALID_BOUND: ProviderAccountBindingPresence = { status: 'invalid-bound' };

describe('provider account RPC contracts', () => {
  describe('method names', () => {
    it('are unique, provider-prefixed and in sync with the registry slice', () => {
      const inSync: ProviderAccountRpcRegistryInSync = true;
      expect(inSync).toBe(true);
      expect(new Set(PROVIDER_ACCOUNT_RPC_METHOD_NAMES).size).toBe(
        PROVIDER_ACCOUNT_RPC_METHOD_NAMES.length,
      );
      for (const name of PROVIDER_ACCOUNT_RPC_METHOD_NAMES) {
        expect(name.startsWith('provider:')).toBe(true);
      }
      expect(Object.keys(SAMPLE_PARAMS).sort()).toEqual(
        [...PROVIDER_ACCOUNT_RPC_METHOD_NAMES].sort(),
      );
    });

    it('cover every account action the design specifies', () => {
      expect(PROVIDER_ACCOUNT_RPC_METHOD_NAMES).toEqual([
        'provider:listAccounts',
        'provider:addAccount',
        'provider:renameAccount',
        'provider:removeAccount',
        'provider:getAccountStatus',
        'provider:startAccountSignIn',
        'provider:cancelAccountSignIn',
        'provider:signOutAccount',
        'provider:setAccountSelection',
        'provider:setAccountDefault',
      ]);
    });

    it('are registered exactly once and do not match the host-source pattern', () => {
      const hostSource =
        /turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage/i;
      for (const name of PROVIDER_ACCOUNT_RPC_METHOD_NAMES) {
        expect(hostSource.test(name)).toBe(false);
        expect(RPC_METHOD_NAMES.filter((n) => n === name)).toHaveLength(1);
      }
    });
  });

  describe('public account input authority', () => {
    it('declares no route, env, owner or binding key on any params type', () => {
      const noAuthority: [Extract<AnyParamKey, ForbiddenAuthorityKey>] extends [
        never,
      ]
        ? true
        : false = true;
      const selectionKeys: [
        Extract<
          keyof Extract<ProviderAccountSelectionWrite, { kind: 'named' }>,
          ForbiddenAuthorityKey
        >,
      ] extends [never]
        ? true
        : false = true;
      expect(noAuthority).toBe(true);
      expect(selectionKeys).toBe(true);
    });

    it('carries only ID, sentinel, provider, scope, workspace, label and revision keys', () => {
      for (const params of Object.values(SAMPLE_PARAMS)) {
        for (const key of Object.keys(params)) {
          expect(PUBLIC_PARAM_KEYS.has(key)).toBe(true);
        }
      }
      expect(Object.keys(named).sort()).toEqual([
        'expectedProfileRevision',
        'kind',
        'profileId',
      ]);
    });

    it('requires a request id on every write', () => {
      const reads = new Set(['provider:listAccounts', 'provider:getAccountStatus']);
      for (const [method, params] of Object.entries(SAMPLE_PARAMS)) {
        expect('requestId' in params).toBe(!reads.has(method));
      }
    });

    it('survives JSON serialization of a snapshot notification unchanged', () => {
      const notification: ProviderAccountsChangedNotification = {
        requestId: REQUEST_ID,
        snapshot: {
          provider: 'claude',
          workspaceRoot: WORKSPACE,
          revision: 7,
          accounts: [
            {
              profileId: PROFILE_ID,
              label: 'Work',
              provider: 'claude',
              state: 'signed-in',
              owner: 'unknown',
              revision: 3,
              activeRunCount: 0,
            },
          ],
          selections: {
            main: { scope: 'main', selection: { kind: 'omitted' }, revision: -1 },
            lane: {
              scope: 'lane',
              selection: { kind: 'named', profileId: PROFILE_ID },
              revision: 0,
            },
          },
        },
      };
      expect(JSON.parse(JSON.stringify(notification))).toEqual(notification);
    });
  });

  describe('resume account selection', () => {
    const field = (value: unknown) => readProviderAccountSelectionField(value);

    it('inherits the stored route when nothing or the same route is supplied', () => {
      expect(classifyAgentResumeAccountSelection(field(undefined), BOUND)).toBe('inherit');
      expect(classifyAgentResumeAccountSelection(field({ kind: 'omitted' }), BOUND)).toBe(
        'inherit',
      );
      expect(
        classifyAgentResumeAccountSelection(
          field({ kind: 'named', profileId: PROFILE_ID }),
          BOUND,
        ),
      ).toBe('inherit');
      expect(classifyAgentResumeAccountSelection(field({ kind: 'ambient' }), ABSENT)).toBe(
        'inherit',
      );
      expect(classifyAgentResumeAccountSelection(field(undefined), ABSENT)).toBe('inherit');
    });

    it('rejects a conflicting supplied account', () => {
      expect(
        classifyAgentResumeAccountSelection(
          field({ kind: 'named', profileId: 'profile-bbbb2222' }),
          BOUND,
        ),
      ).toBe('conflict');
      expect(classifyAgentResumeAccountSelection(field({ kind: 'ambient' }), BOUND)).toBe(
        'conflict',
      );
      expect(
        classifyAgentResumeAccountSelection(
          field({ kind: 'named', profileId: PROFILE_ID }),
          ABSENT,
        ),
      ).toBe('conflict');
    });

    it('rejects malformed input and unreadable stored bindings', () => {
      expect(classifyAgentResumeAccountSelection(field(null), BOUND)).toBe('invalid');
      expect(
        classifyAgentResumeAccountSelection(
          field({ kind: 'named', profileId: PROFILE_ID, directory: 'D:/x' }),
          BOUND,
        ),
      ).toBe('invalid');
      expect(classifyAgentResumeAccountSelection(field(undefined), INVALID_BOUND)).toBe(
        'invalid',
      );
    });
  });

  describe('Claude lane configuration keys', () => {
    it('accepts exactly the SDK effort scale plus default and inherit', () => {
      const sdkScale: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
      expect([...CLAUDE_REASONING_EFFORT_VALUES]).toEqual(['', 'inherit', ...sdkScale]);
      for (const value of CLAUDE_REASONING_EFFORT_VALUES) {
        expect(isClaudeReasoningEffortSetting(value)).toBe(true);
      }
    });

    it('rejects unsupported effort values instead of coercing them', () => {
      for (const value of ['minimal', 'off', 'none', 'HIGH', ' high', 'ultra']) {
        expect(isClaudeReasoningEffortSetting(value)).toBe(false);
      }
    });

    it('round-trips set params into the reported config shape', () => {
      const set: AgentSetConfigParams = {
        claudeModel: 'claude-sonnet-4-5',
        claudeReasoningEffort: 'high',
      };
      const wire = JSON.parse(JSON.stringify(set)) as AgentSetConfigParams;
      const reported: Pick<AgentOrchestrationConfig, 'claudeModel' | 'claudeReasoningEffort'> = {
        claudeModel: wire.claudeModel,
        claudeReasoningEffort: wire.claudeReasoningEffort,
      };
      expect(reported).toEqual(set);
      const legacy: AgentSetConfigParams = { codexModel: '' };
      expect('claudeModel' in legacy).toBe(false);
    });

    it('registers both keys as global-only scoped settings', () => {
      for (const key of [
        'agentOrchestration.claudeModel',
        'agentOrchestration.claudeReasoningEffort',
      ]) {
        expect(SCOPED_SETTING_KEYS[key]).toEqual({
          appScopable: false,
          supportedTargets: ['global'],
        });
      }
    });
  });
});

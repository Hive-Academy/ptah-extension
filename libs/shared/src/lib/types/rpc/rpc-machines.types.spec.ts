import { MESSAGE_TYPES } from '../messages/message-constants';
import type { MessagePayloadMap } from '../messages/payload-map';
import type { RpcUserErrorCode } from './rpc-error-codes.types';
import {
  MACHINE_CONNECTION_STATES,
  MACHINE_PROMPT_MAX_LENGTH,
  MACHINE_SSH_ALIAS_PATTERN,
  MACHINES_RPC_METHOD_NAMES,
  MACHINES_RPC_PARAMS_SCHEMAS,
  MachinesAddParamsSchema,
  MachinesListParamsSchema,
  MachinesPairParamsSchema,
  MachinesPermissionRespondParamsSchema,
  MachinesSessionContinueParamsSchema,
  MachinesSessionReplayParamsSchema,
  MachinesSessionStartParamsSchema,
  type MachinesEventPayload,
  type MachinesRpcRegistryInSync,
  type MachinesStatePayload,
} from './rpc-machines.types';

describe('machines:* renderer contract', () => {
  it('lists each method once, under the machines: prefix', () => {
    const inSync: MachinesRpcRegistryInSync = true;
    expect(inSync).toBe(true);
    expect(new Set(MACHINES_RPC_METHOD_NAMES).size).toBe(
      MACHINES_RPC_METHOD_NAMES.length,
    );
    for (const name of MACHINES_RPC_METHOD_NAMES) {
      expect(name.startsWith('machines:')).toBe(true);
    }
  });

  it('has a params schema for exactly the listed methods', () => {
    expect(Object.keys(MACHINES_RPC_PARAMS_SCHEMAS).sort()).toEqual(
      [...MACHINES_RPC_METHOD_NAMES].sort(),
    );
  });

  it('rejects unknown keys on every params schema', () => {
    for (const schema of Object.values(MACHINES_RPC_PARAMS_SCHEMAS)) {
      expect(schema.safeParse({ smuggled: true }).success).toBe(false);
    }
    expect(MachinesListParamsSchema.safeParse({}).success).toBe(true);
  });

  describe('machines:add alias', () => {
    it.each(['gpu-box', 'build.server', 'a', 'host_01', 'A'.repeat(64)])(
      'accepts %s',
      (alias) => {
        expect(MachinesAddParamsSchema.safeParse({ alias }).success).toBe(true);
      },
    );

    it.each([
      '-oProxyCommand=touch /tmp/x',
      '-p',
      '',
      '.hidden',
      'host name',
      'host;rm',
      'user@host',
      'A'.repeat(65),
    ])('rejects %j', (alias) => {
      expect(MACHINE_SSH_ALIAS_PATTERN.test(alias)).toBe(false);
      expect(MachinesAddParamsSchema.safeParse({ alias }).success).toBe(false);
    });
  });

  it('accepts any bounded pairing code, so a malformed code is not told apart', () => {
    expect(
      MachinesPairParamsSchema.safeParse({
        machineId: 'm1',
        code: 'not a code',
      }).success,
    ).toBe(true);
    expect(
      MachinesPairParamsSchema.safeParse({ machineId: 'm1', code: '' }).success,
    ).toBe(false);
    expect(
      MachinesPairParamsSchema.safeParse({
        machineId: 'm1',
        code: 'X'.repeat(33),
      }).success,
    ).toBe(false);
  });

  it('requires a non-negative integer afterSeq for replay', () => {
    const base = { machineId: 'm1', sessionId: 's1' };
    expect(
      MachinesSessionReplayParamsSchema.safeParse({ ...base, afterSeq: 0 })
        .success,
    ).toBe(true);
    for (const afterSeq of [-1, 1.5, '3', undefined]) {
      expect(
        MachinesSessionReplayParamsSchema.safeParse({ ...base, afterSeq })
          .success,
      ).toBe(false);
    }
  });

  it('bounds prompts on start and continue', () => {
    const long = 'p'.repeat(MACHINE_PROMPT_MAX_LENGTH + 1);
    expect(
      MachinesSessionStartParamsSchema.safeParse({
        machineId: 'm1',
        workspaceId: 'w1',
        prompt: 'hi',
      }).success,
    ).toBe(true);
    expect(
      MachinesSessionStartParamsSchema.safeParse({
        machineId: 'm1',
        workspaceId: 'w1',
        prompt: long,
      }).success,
    ).toBe(false);
    expect(
      MachinesSessionContinueParamsSchema.safeParse({
        machineId: 'm1',
        sessionId: 's1',
        prompt: '',
      }).success,
    ).toBe(false);
  });

  it('offers allow and deny only for permission answers', () => {
    const base = { machineId: 'm1', sessionId: 's1', requestId: 'r1' };
    expect(
      MachinesPermissionRespondParamsSchema.safeParse({
        ...base,
        decision: 'allow',
      }).success,
    ).toBe(true);
    expect(
      MachinesPermissionRespondParamsSchema.safeParse({
        ...base,
        decision: 'always_allow',
      }).success,
    ).toBe(false);
  });

  it('registers both push message types with typed payloads', () => {
    expect(MESSAGE_TYPES.MACHINES_EVENT).toBe('machines:event');
    expect(MESSAGE_TYPES.MACHINES_STATE).toBe('machines:state');

    const event: MessagePayloadMap['machines:event'] = {
      machineId: 'm1',
      sessionId: 's1',
      epoch: 'e1',
      seq: 1,
      type: 'chat:chunk',
      payload: {},
    } satisfies MachinesEventPayload;
    const state: MessagePayloadMap['machines:state'] = {
      machineId: 'm1',
      state: 'version-mismatch',
      versions: {
        local: { ptahVersion: '1.0.0', protocol: { min: 1, max: 1 } },
        remote: { ptahVersion: '2.0.0', protocol: { min: 2, max: 2 } },
      },
    } satisfies MachinesStatePayload;
    expect(event.seq).toBe(1);
    expect(MACHINE_CONNECTION_STATES).toContain(state.state);
  });

  it('adds the remote-machine error codes', () => {
    const codes: RpcUserErrorCode[] = [
      'SESSION_DRIVEN_ELSEWHERE',
      'SESSION_DRIVER_LOCK_UNAVAILABLE',
      'MACHINE_UNREACHABLE',
      'MACHINE_VERSION_MISMATCH',
      'MACHINE_NOT_FOUND_OR_FORBIDDEN',
      'MACHINE_PAIRING_REJECTED',
    ];
    expect(new Set(codes).size).toBe(6);
  });
});

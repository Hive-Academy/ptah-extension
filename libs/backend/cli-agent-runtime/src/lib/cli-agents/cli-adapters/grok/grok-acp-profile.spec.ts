/**
 * GrokAcpProfile — argv, MCP entry, session config, extension filter and the
 * error rows. The error rows are checked against the real JSON-RPC errors
 * Grok 1.0.46 sent in the `grok-p3-*` probe transcripts (envelopes
 * `{ms, dir, msg}`), paired with the request each one answered.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { CliCommandOptions } from '../cli-adapter.interface';
import type { AcpRequestFailure, AcpRequestMethod } from '../acp';
import { grokAcpProfile } from './grok-acp-profile';

const FIXTURES = join(__dirname, '..', 'acp', '__fixtures__');

interface Envelope {
  readonly dir: string;
  readonly msg?: {
    readonly id?: number;
    readonly method?: string;
    readonly params?: Record<string, unknown>;
    readonly result?: Record<string, unknown>;
    readonly error?: { code: number; message: string; data?: unknown };
  };
}

function readEnvelopes(file: string): Envelope[] {
  return readFileSync(join(FIXTURES, file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Envelope);
}

/** The first error Grok answered `method` with in `file`, and that request's params. */
function fixtureError(
  file: string,
  method: AcpRequestMethod,
): {
  code: number;
  message: string;
  data?: unknown;
  params: Record<string, unknown>;
} {
  const envelopes = readEnvelopes(file);
  const request = envelopes.find(
    (e) => e.dir === 'out' && e.msg?.method === method,
  );
  if (request?.msg?.id === undefined) {
    throw new Error(`${file} has no ${method} request`);
  }
  const reply = envelopes.find(
    (e) => e.dir === 'in' && e.msg?.id === request.msg?.id && e.msg?.error,
  );
  if (!reply?.msg?.error) {
    throw new Error(`${file} has no error answer to ${method}`);
  }
  return { ...reply.msg.error, params: request.msg.params ?? {} };
}

/** The values the fixture session advertised for the `model` config option. */
function advertisedModels(file: string): string[] {
  const created = readEnvelopes(file).find(
    (e) => e.dir === 'in' && e.msg?.result?.['configOptions'],
  );
  const options = created?.msg?.result?.['configOptions'] as Array<{
    id: string;
    options: Array<{ value: string }>;
  }>;
  return (options.find((o) => o.id === 'model')?.options ?? []).map(
    (o) => o.value,
  );
}

const BASE_OPTIONS: CliCommandOptions = {
  task: 'Summarise the repository',
  workingDirectory: 'D:\\work\\repo',
};

function failure(
  overrides: Partial<AcpRequestFailure> &
    Pick<AcpRequestFailure, 'method' | 'code' | 'message'>,
): AcpRequestFailure {
  return { options: BASE_OPTIONS, ...overrides };
}

describe('grokAcpProfile', () => {
  it('identifies the Grok lane and resumes with session/resume', () => {
    expect(grokAcpProfile.vendor).toBe('grok');
    expect(grokAcpProfile.displayName).toBe('Grok');
    expect(grokAcpProfile.resumeStrategy).toBe('resume');
  });

  describe('buildSpawn', () => {
    it('spawns exactly `agent --no-leader stdio` with no extra environment', () => {
      const spec = grokAcpProfile.buildSpawn(BASE_OPTIONS);
      expect(spec.args).toEqual(['agent', '--no-leader', 'stdio']);
      expect(spec.env).toBeUndefined();
    });

    it('never puts the model, effort or approval on argv', () => {
      const { args } = grokAcpProfile.buildSpawn({
        ...BASE_OPTIONS,
        model: 'grok-4.7',
        reasoningEffort: 'high',
        autoApprove: true,
        resumeSessionId: 'sess-1',
        mcpPort: 51820,
      });
      expect(args).toEqual(['agent', '--no-leader', 'stdio']);
      expect(args).not.toContain('-m');
      expect(args).not.toContain('--reasoning-effort');
      expect(args).not.toContain('--always-approve');
      expect(args).not.toContain('--leader');
    });
  });

  describe('buildMcpServers', () => {
    it('attaches the scoped Ptah http entry when mcpPort is set', () => {
      expect(
        grokAcpProfile.buildMcpServers({
          ...BASE_OPTIONS,
          mcpPort: 51820,
          agentId: 'agent-7',
        }),
      ).toEqual([
        {
          type: 'http',
          name: 'ptah',
          url: `http://localhost:51820/agent/agent-7/workspace/${encodeURIComponent('D:\\work\\repo')}`,
          headers: [],
        },
      ]);
    });

    it('attaches nothing when mcpPort is unset', () => {
      expect(grokAcpProfile.buildMcpServers(BASE_OPTIONS)).toEqual([]);
    });
  });

  describe('sessionConfig', () => {
    const sessionConfig = grokAcpProfile.sessionConfig;
    if (!sessionConfig) throw new Error('grokAcpProfile.sessionConfig missing');

    it('sets the model and the mapped effort', () => {
      expect(
        sessionConfig({
          ...BASE_OPTIONS,
          model: 'grok-4.7',
          reasoningEffort: 'max',
        }),
      ).toEqual([
        { configId: 'model', value: 'grok-4.7' },
        { configId: 'reasoning_effort', value: 'xhigh' },
      ]);
    });

    it('clamps minimal to low and drops an effort Grok has no value for', () => {
      expect(
        sessionConfig({ ...BASE_OPTIONS, reasoningEffort: 'minimal' }),
      ).toEqual([{ configId: 'reasoning_effort', value: 'low' }]);
      expect(
        sessionConfig({ ...BASE_OPTIONS, reasoningEffort: 'turbo' }),
      ).toEqual([]);
    });

    it('applies nothing when neither model nor effort is set', () => {
      expect(sessionConfig(BASE_OPTIONS)).toEqual([]);
    });
  });

  it('treats the x.ai namespaces as extension notifications', () => {
    const isExtension = grokAcpProfile.isExtensionNotification;
    if (!isExtension) throw new Error('isExtensionNotification missing');
    expect(isExtension('_x.ai/session_notification')).toBe(true);
    expect(isExtension('x.ai/auth/status')).toBe(true);
    expect(isExtension('_x.ai/session/prompt_complete')).toBe(true);
    expect(isExtension('session/update')).toBe(false);
    expect(isExtension('_other.vendor/x.ai/thing')).toBe(false);
  });

  it('reads a numeric exit_code from rawOutput only', () => {
    const extract = grokAcpProfile.extractExitCode;
    if (!extract) throw new Error('extractExitCode missing');
    expect(extract({ exit_code: 2 })).toBe(2);
    expect(extract({ exit_code: '2' })).toBeUndefined();
    expect(extract(null)).toBeUndefined();
  });

  describe('describeError (grok-p3 fixture payloads)', () => {
    const describe_ = grokAcpProfile.describeError;
    if (!describe_) throw new Error('describeError missing');

    it('-32003 on session/prompt with string data names the rate limit detail', () => {
      const error = fixtureError(
        'grok-p3-rate-limited-429.ndjson',
        'session/prompt',
      );
      expect(error.code).toBe(-32003);
      expect(typeof error.data).toBe('string');
      expect(describe_(failure({ method: 'session/prompt', ...error }))).toBe(
        `Grok is rate limited: ${String(error.data)}`,
      );
    });

    it('-32003 on session/prompt with object data reads its message', () => {
      const error = fixtureError(
        'grok-p3-rate-limited-429.ndjson',
        'session/prompt',
      );
      const detail = String(error.data);
      expect(
        describe_(
          failure({
            method: 'session/prompt',
            code: error.code,
            message: error.message,
            data: { message: detail, status: 429 },
          }),
        ),
      ).toBe(`Grok is rate limited: ${detail}`);
    });

    it('-32003 without data falls back to the error message', () => {
      expect(
        describe_(
          failure({
            method: 'session/prompt',
            code: -32003,
            message: 'Rate limited',
          }),
        ),
      ).toBe('Grok is rate limited: Rate limited');
    });

    it('-32000 on session/new and session/resume asks for a sign-in', () => {
      const error = fixtureError('grok-p3-signed-out.ndjson', 'session/new');
      expect(error.code).toBe(-32000);
      const expected =
        'Grok is not signed in: run `grok login` or set XAI_API_KEY';
      expect(describe_(failure({ method: 'session/new', ...error }))).toBe(
        expected,
      );
      expect(describe_(failure({ method: 'session/resume', ...error }))).toBe(
        expected,
      );
    });

    it('-32602 on the model config names the model, its source and the advertised values', () => {
      const file = 'grok-p3-set-model-unknown.ndjson';
      const error = fixtureError(file, 'session/set_config_option');
      expect(error.code).toBe(-32602);
      expect(error.data).toBe('unknown model id');
      const model = String(error.params['value']);
      const advertised = advertisedModels(file);
      expect(advertised).toEqual(['grok-4.7']);

      expect(
        describe_(
          failure({
            method: 'session/set_config_option',
            code: error.code,
            message: error.message,
            data: error.data,
            configId: 'model',
            configValue: model,
            advertisedValues: advertised,
            options: { ...BASE_OPTIONS, model, modelSource: 'setting' },
          }),
        ),
      ).toBe(
        "Grok rejected model 'nonexistent-model' (from the `agentOrchestration.grokModel` setting); available models: grok-4.7",
      );
    });

    it.each([
      ['request', 'the spawn request'],
      ['ptah-default', "Ptah's lane default"],
      [
        undefined,
        'the `agentOrchestration.grokModel` setting or the spawn request',
      ],
    ] as const)(
      'names model source %s and points at `grok models` when nothing is advertised',
      (modelSource, wording) => {
        expect(
          describe_(
            failure({
              method: 'session/set_config_option',
              code: -32602,
              message: 'Invalid params',
              data: 'unknown model id',
              configId: 'model',
              configValue: 'nope',
              advertisedValues: [],
              options: { ...BASE_OPTIONS, model: 'nope', modelSource },
            }),
          ),
        ).toBe(
          `Grok rejected model 'nope' (from ${wording}); run \`grok models\` to see the available models`,
        );
      },
    );

    it('leaves every other failure to the generic message', () => {
      expect(
        describe_(
          failure({
            method: 'session/set_config_option',
            code: -32602,
            message: 'Invalid params',
            configId: 'reasoning_effort',
            configValue: 'xhigh',
          }),
        ),
      ).toBeUndefined();
      expect(
        describe_(
          failure({ method: 'session/new', code: -32003, message: 'x' }),
        ),
      ).toBeUndefined();
      expect(
        describe_(
          failure({ method: 'session/prompt', code: -32000, message: 'x' }),
        ),
      ).toBeUndefined();
      expect(
        describe_(
          failure({ method: 'initialize', code: -32603, message: 'boom' }),
        ),
      ).toBeUndefined();
    });
  });
});

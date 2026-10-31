import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { MESSAGE_TYPES, RPC_METHOD_NAMES, TabId } from '@ptah-extension/shared';
import {
  DEFAULT_ALLOWED_PUSH_TYPES,
  DEFAULT_ALLOWED_RPC_METHODS,
  DEFAULT_SCENARIO_TIME_BASE,
  PLACEHOLDER_CLI_OUTPUT,
  PLACEHOLDER_DIFF,
  PLACEHOLDER_FILE_CONTENT,
  PLACEHOLDER_TOOL_OUTPUT,
  SYNTHETIC_EMAIL,
  SYNTHETIC_HOST,
  SYNTHETIC_USER,
  SYNTHETIC_WORKSPACE_ROOT,
  sanitizeScenario,
  scanScenarioPrivacy,
} from './scenario-sanitizer';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SAMPLE_SCENARIO_PATH = path.join(
  REPO_ROOT,
  'libs/web/landing/src/lib/live-demo/scenarios/chat-tool-call.json',
);
const CLI_SCRIPT_PATH = path.join(
  REPO_ROOT,
  'apps/ptah-electron/scripts/sanitize-replay-scenario.mjs',
);

/**
 * Shared privacy canary corpus mirroring `libs/web/landing/src/lib/live-demo/scenario/privacy-scan.ts`
 * rules (copied locally so `ptah-electron` never imports `scope:web` code).
 */
const SHARED_PRIVACY_CANARY_CORPUS: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly expectedKind: string;
}> = [
  // Plain-text credential assignments
  {
    label: 'double-quoted password assignment',
    value: 'config: password = "correct-horse-battery-staple"',
    expectedKind: 'credential assignment',
  },
  {
    label: 'single-quoted token assignment',
    value: "token: 'my-live-token-value-123'",
    expectedKind: 'credential assignment',
  },
  {
    label: 'unquoted api_key assignment',
    value: 'api_key=live_secret_value_999',
    expectedKind: 'credential assignment',
  },
  {
    label: 'client_secret assignment',
    value: 'client_secret: "cs_live_abcdef123456"',
    expectedKind: 'credential assignment',
  },
  {
    label: 'private_key assignment',
    value: 'private_key="pk_value_987654"',
    expectedKind: 'credential assignment',
  },
  {
    label: 'auth assignment',
    value: 'auth=my_raw_credential_token',
    expectedKind: 'credential assignment',
  },
  // All token prefixes
  {
    label: 'github_pat_ prefix',
    value: 'github_pat_11AABBCCDDEEFF0011223344',
    expectedKind: 'credential shape',
  },
  {
    label: 'ghp_ prefix',
    value: 'ghp_1234567890abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'gho_ prefix',
    value: 'gho_1234567890abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'ghu_ prefix',
    value: 'ghu_1234567890abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'ghs_ prefix',
    value: 'ghs_1234567890abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'ghr_ prefix',
    value: 'ghr_1234567890abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'glpat- prefix',
    value: 'glpat-abcdef1234567890',
    expectedKind: 'credential shape',
  },
  {
    label: 'xoxa- prefix',
    value: 'xoxa-1234567890-abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'xoxb- prefix',
    value: 'xoxb-1234567890-abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'xoxp- prefix',
    value: 'xoxp-1234567890-abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'xoxr- prefix',
    value: 'xoxr-1234567890-abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'xoxs- prefix',
    value: 'xoxs-1234567890-abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'sk-ant- prefix',
    value: 'sk-ant-api03-abcdef1234567890',
    expectedKind: 'credential shape',
  },
  {
    label: 'sk-proj- prefix',
    value: 'sk-proj-abcdef1234567890',
    expectedKind: 'credential shape',
  },
  {
    label: 'AIza prefix',
    value: 'AIzaSyA1234567890abcdefGHIJKL',
    expectedKind: 'credential shape',
  },
  {
    label: 'npm_ prefix',
    value: 'npm_1234567890abcdef123456',
    expectedKind: 'credential shape',
  },
  {
    label: 'hf_ prefix',
    value: 'hf_abcdef1234567890abcdef',
    expectedKind: 'credential shape',
  },
  {
    label: 'AKIA prefix',
    value: 'AKIAIOSFODNN7EXAMPLE',
    expectedKind: 'credential shape',
  },
  {
    label: 'ASIA prefix',
    value: 'ASIAY34FZKBOKMUTVV7A',
    expectedKind: 'credential shape',
  },
  // Home paths
  {
    label: 'tilde home path ~/...',
    value: 'reading ~/.ssh/id_rsa',
    expectedKind: 'home path',
  },
  {
    label: '/root/ home path',
    value: 'located at /root/.bashrc',
    expectedKind: 'home path',
  },
  {
    label: '/var/folders/ macOS temp home path',
    value: '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T/dump.log',
    expectedKind: 'home path',
  },
  {
    label: 'C:/Users forward-slash Windows home path',
    value: 'C:/Users/alice/Documents/secret.txt',
    expectedKind: 'home path',
  },
  {
    label: 'C:\\Users backslash Windows home path',
    value: 'C:\\Users\\alice\\Documents\\secret.txt',
    expectedKind: 'home path',
  },
  // Windows paths & delimited Unix absolute paths
  {
    label: 'Windows non-home absolute path',
    value: 'D:\\Projects\\client-app\\src\\index.ts',
    expectedKind: 'absolute path',
  },
  {
    label: 'JSON array bracketed Unix absolute path',
    value: '["/etc/shadow"]',
    expectedKind: 'absolute path',
  },
  // Hostnames in public suffixes and URL/@/// contexts
  {
    label: 'hostname in // context with non-public suffix',
    value: 'connecting to //db.corp:5432',
    expectedKind: 'hostname',
  },
  {
    label: 'hostname in @ context with custom suffix',
    value: 'ssh deploy@bastion.internalnet',
    expectedKind: 'hostname',
  },
  {
    label: '.internal hostname',
    value: 'service.internal',
    expectedKind: 'hostname',
  },
  {
    label: '.sh hostname',
    value: 'runner.platform.sh',
    expectedKind: 'hostname',
  },
  {
    label: '.cloud hostname',
    value: 'tenant.Private.cloud',
    expectedKind: 'hostname',
  },
  // Private IPs
  {
    label: '10.x private IPv4',
    value: '10.24.0.15',
    expectedKind: 'IP address',
  },
  {
    label: '172.16-31.x private IPv4',
    value: '172.20.10.2',
    expectedKind: 'IP address',
  },
  {
    label: '192.168.x private IPv4',
    value: '192.168.1.50',
    expectedKind: 'IP address',
  },
  {
    label: '127.0.0.1 loopback IPv4',
    value: '127.0.0.1',
    expectedKind: 'IP address',
  },
  {
    label: '169.254.x link-local IPv4',
    value: '169.254.169.254',
    expectedKind: 'IP address',
  },
];

describe('scenario-sanitizer (B5)', () => {
  it('keeps allow-lists aligned with shared RPC_METHOD_NAMES and MESSAGE_TYPES', () => {
    const validRpcNames = new Set<string>(RPC_METHOD_NAMES);
    for (const method of DEFAULT_ALLOWED_RPC_METHODS) {
      expect(validRpcNames.has(method)).toBe(true);
    }

    const validMessageTypes = new Set<string>(Object.values(MESSAGE_TYPES));
    for (const pushType of DEFAULT_ALLOWED_PUSH_TYPES) {
      expect(validMessageTypes.has(pushType)).toBe(true);
    }
    expect(DEFAULT_ALLOWED_PUSH_TYPES.has('rpc:response')).toBe(false);
    expect(DEFAULT_ALLOWED_PUSH_TYPES.has('rpc:call')).toBe(false);
  });

  it('drops unknown RPC methods and push types in default mode and throws in strict mode', () => {
    const raw = {
      timeBase: 1700000000000,
      rpc: {
        'boot:getReadiness': {
          phase: 'settled',
          readiness: 'ready',
          startedAt: 1700000000000,
          steps: [],
        },
        'auth:setApiKey': { ok: true },
        'unknown:secretMethod': { leaked: true },
      },
      rpcCases: {
        'unknown:caseMethod': [{ match: {}, data: {} }],
      },
      rpcErrors: {
        'unknown:errorMethod': { error: 'boom' },
      },
      timeline: [
        {
          at: 10,
          message: {
            type: 'rpc:response',
            correlationId: 'c1',
            success: true,
          },
        },
        {
          at: 20,
          message: {
            type: 'unknown:pushType',
            payload: {},
          },
        },
        {
          at: 30,
          message: {
            type: 'batch',
            payload: {
              events: [
                { type: 'unknown:innerPush', payload: {} },
                {
                  type: 'chat:complete',
                  payload: {
                    sessionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                  },
                },
              ],
            },
          },
        },
      ],
    };

    const { scenario, report } = sanitizeScenario(raw, {
      id: 'allowlist-test',
      title: 'Allowlist Test',
    });

    expect(Object.keys(scenario.rpc)).toEqual(['boot:getReadiness']);
    expect(scenario.rpcCases).toBeUndefined();
    expect(scenario.rpcErrors).toBeUndefined();
    expect(report.droppedRpcMethods).toEqual([
      'auth:setApiKey',
      'unknown:secretMethod',
      'unknown:caseMethod',
      'unknown:errorMethod',
    ]);
    expect(report.droppedPushTypes).toEqual([
      'rpc:response',
      'unknown:pushType',
      'unknown:innerPush',
    ]);
    expect(scenario.timeline).toHaveLength(1);
    expect(scenario.timeline[0].message.type).toBe('batch');

    expect(() =>
      sanitizeScenario(raw, { id: 'allowlist-test', strict: true }),
    ).toThrow(/Disallowed or unknown RPC method/);

    expect(() =>
      sanitizeScenario(
        {
          rpc: {},
          timeline: [{ at: 0, message: { type: 'unknown:pushType' } }],
        },
        { id: 'strict-push-test', strict: true },
      ),
    ).toThrow(/Disallowed or unknown push type/);
  });

  it('scrubs canary secrets, PII, paths, IPs, URLs, tool outputs, diffs, CLI output, timestamps, and UUIDs', () => {
    const rawCanary = {
      timeBase: 1710000000000,
      rpc: {
        'workspace:getInfo': {
          folders: ['/home/amun/private-client-repo'],
          root: '/home/amun/private-client-repo',
          activeFolder: '/home/amun/private-client-repo',
          name: 'private-client-repo',
        },
        'auth:getAuthStatus': {
          hasApiKey: true,
          hasOpenRouterKey: true,
          hasAnyProviderKey: true,
          apiKey: 'sk-ant-api03-canarySecretKey1234567890abcdef',
          accessToken: 'ghp_canaryGithubToken1234567890abcdef',
          client_secret: 'super-secret-value',
          password: 'correct-horse-battery-staple',
          authorization:
            'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
          cookie: 'session_id=xyz987654321',
          privateKey:
            '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC\n-----END PRIVATE KEY-----',
          authMethod: 'claudeCli',
        },
        'git:lastCommit': {
          hash: 'abc1234',
          authorName: 'Alice SecretName',
          authorEmail: 'alice.secret@internal-corp.io',
          hostname: 'devbox-01.internal-corp.io',
          message:
            'Connect to https://admin:p4ssw0rd@git.internal-corp.io:8443/team/repo.git from 192.168.10.25 and [2001:db8:85a3::8a2e:370:7334] for amun',
          timestamp: 1710000000500,
        },
        'file:read': {
          path: '/home/amun/private-client-repo/src/secret-config.ts',
          content: 'export const DB_PASS = "canary-db-password";',
        },
        'git:diffFile': {
          filePath: 'C:\\Users\\bob\\work\\app\\src\\private.ts',
          diff: '@@ -1,2 +1,2 @@\n-secret\n+more secret',
        },
        'session:cli-output-page': {
          sessionId: 'non-uuid-cli-session',
          output: 'amun@devbox:$ cat /etc/passwd',
        },
        'analytics:spendSummary': {
          generatedAt: '2024-03-09T16:00:01.000Z',
        },
      },
      rpcCases: {
        'file:viewContent': [
          {
            match: {
              filePath: '/home/amun/private-client-repo/src/main.ts',
            },
            data: {
              filePath: '/home/amun/private-client-repo/src/main.ts',
              content:
                'import { bootstrapApplication } from "@angular/platform-browser"; // /home/amun/private-client-repo/src/main.ts',
            },
          },
          {
            match: {
              filePath: '/home/amun/private-client-repo/src/private-keys.ts',
            },
            data: {
              filePath: '/home/amun/private-client-repo/src/private-keys.ts',
              content: 'const SECRET = "should-not-survive";',
            },
          },
        ],
      },
      timeline: [
        {
          at: 100,
          message: {
            type: 'chat:chunk',
            payload: {
              tabId: 'custom-tab-id',
              sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              event: {
                id: 'evt-1',
                eventType: 'text_delta',
                timestamp: 1710000001200,
                sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                messageId: 'turn-f47ac10b-58cc-4372-a567-0e02b2c3d479',
                delta: [
                  'Leaked keys: sk-1234567890abcdef12345678, AKIAIOSFODNN7EXAMPLE, xoxb-123456789012-123456789012-abcdef, ghp_1234567890abcdef123456',
                  'Bearer secretBearerToken999',
                  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
                  '-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJALa\n-----END CERTIFICATE-----',
                  `base64:${'Q'.repeat(220)}`,
                  'Path: /Users/charlie/secret-repo/file.ts and /tmp/private-dump/out.log',
                  'Email: bob@company.org Host: internal.company.com',
                ].join(' | '),
              },
            },
          },
        },
        {
          at: 200,
          message: {
            type: 'chat:chunk',
            payload: {
              tabId: 'custom-tab-id',
              sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              event: {
                id: 'tool-start-allowed',
                eventType: 'tool_start',
                toolCallId: 'call_allowed',
                toolName: 'Read',
                toolInput: {
                  file_path: '/home/amun/private-client-repo/src/main.ts',
                },
              },
            },
          },
        },
        {
          at: 300,
          message: {
            type: 'chat:chunk',
            payload: {
              tabId: 'custom-tab-id',
              sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              event: {
                id: 'tool-result-allowed',
                eventType: 'tool_result',
                toolCallId: 'call_allowed',
                output:
                  'Allowed public content from /home/amun/private-client-repo/src/main.ts',
              },
            },
          },
        },
        {
          at: 400,
          message: {
            type: 'chat:chunk',
            payload: {
              tabId: 'custom-tab-id',
              sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              event: {
                id: 'tool-start-blocked',
                eventType: 'tool_start',
                toolCallId: 'call_blocked',
                toolName: 'Write',
                toolInput: {
                  file_path: '/home/amun/private-client-repo/src/secret.ts',
                  content: 'private file write content',
                },
              },
            },
          },
        },
        {
          at: 500,
          message: {
            type: 'chat:chunk',
            payload: {
              tabId: 'custom-tab-id',
              sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              event: {
                id: 'tool-result-blocked',
                eventType: 'tool_result',
                toolCallId: 'call_blocked',
                output: 'Private tool result that must be replaced',
              },
            },
          },
        },
        {
          at: 600,
          message: {
            type: 'agent-monitor:output',
            payload: {
              sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              data: 'raw terminal stdout with private env vars',
            },
          },
        },
      ],
    };

    const { scenario, report } = sanitizeScenario(rawCanary, {
      id: 'canary-test',
      title: 'Canary Sanitizer Test',
      allowFiles: ['src/main.ts'],
    });

    // Final privacy scan must return zero findings
    expect(scanScenarioPrivacy(scenario)).toEqual([]);

    // Report must confirm every category fired
    expect(report.redactedFields).toEqual(
      expect.arrayContaining([
        '$.rpc.auth:getAuthStatus.apiKey',
        '$.rpc.auth:getAuthStatus.accessToken',
        '$.rpc.auth:getAuthStatus.client_secret',
        '$.rpc.auth:getAuthStatus.password',
        '$.rpc.auth:getAuthStatus.authorization',
        '$.rpc.auth:getAuthStatus.cookie',
        '$.rpc.auth:getAuthStatus.privateKey',
      ]),
    );
    expect(report.redactedSecretsCount).toBeGreaterThan(0);
    expect(report.replacedPathsCount).toBeGreaterThan(0);
    expect(report.replacedPiiCount).toBeGreaterThan(0);
    expect(report.redactedPayloadsCount).toBeGreaterThan(0);
    expect(report.remappedUuidsCount).toBeGreaterThan(0);
    expect(report.normalizedTimestampsCount).toBeGreaterThan(0);

    // Safe boolean credential status fields are preserved as false
    expect(scenario.rpc['auth:getAuthStatus']).toEqual({
      hasApiKey: false,
      hasOpenRouterKey: false,
      hasAnyProviderKey: false,
      authMethod: 'claudeCli',
    });

    // Workspace paths & PII replaced with synthetic fixtures
    expect(scenario.rpc['workspace:getInfo']).toEqual({
      folders: [SYNTHETIC_WORKSPACE_ROOT],
      root: SYNTHETIC_WORKSPACE_ROOT,
      activeFolder: SYNTHETIC_WORKSPACE_ROOT,
      name: 'acme-app',
    });
    const lastCommit = scenario.rpc['git:lastCommit'] as Record<
      string,
      unknown
    >;
    expect(lastCommit['authorName']).toBe(SYNTHETIC_USER);
    expect(lastCommit['authorEmail']).toBe(SYNTHETIC_EMAIL);
    expect(lastCommit['hostname']).toBe(SYNTHETIC_HOST);
    expect(lastCommit['timestamp']).toBe(DEFAULT_SCENARIO_TIME_BASE + 500);
    expect(String(lastCommit['message'])).not.toContain('p4ssw0rd');
    expect(String(lastCommit['message'])).not.toContain('192.168.10.25');
    expect(String(lastCommit['message'])).not.toContain('2001:db8');
    expect(String(lastCommit['message'])).not.toContain('amun');

    // Non-allowlisted file contents, diffs, and CLI output replaced with placeholders
    expect((scenario.rpc['file:read'] as { content: string }).content).toBe(
      PLACEHOLDER_FILE_CONTENT,
    );
    expect((scenario.rpc['git:diffFile'] as { diff: string }).diff).toBe(
      PLACEHOLDER_DIFF,
    );
    expect(
      (scenario.rpc['session:cli-output-page'] as { output: string }).output,
    ).toBe(PLACEHOLDER_CLI_OUTPUT);

    // Allowlisted file (`src/main.ts`) keeps its content (with paths sanitized), while `src/private-keys.ts` is replaced
    const fileCases = scenario.rpcCases?.['file:viewContent'] ?? [];
    expect(fileCases).toHaveLength(2);
    expect((fileCases[0].data as { content: string }).content).toContain(
      'bootstrapApplication',
    );
    expect((fileCases[0].data as { content: string }).content).toContain(
      `${SYNTHETIC_WORKSPACE_ROOT}/src/main.ts`,
    );
    expect((fileCases[1].data as { content: string }).content).toBe(
      PLACEHOLDER_FILE_CONTENT,
    );

    // Timeline tool_result for allowlisted `src/main.ts` kept, blocked `src/secret.ts` replaced
    const allowedToolResult = (
      scenario.timeline[2].message.payload as { event: { output: string } }
    ).event;
    expect(allowedToolResult.output).toBe(
      `Allowed public content from ${SYNTHETIC_WORKSPACE_ROOT}/src/main.ts`,
    );

    const blockedToolStart = (
      scenario.timeline[3].message.payload as {
        event: { toolInput: { content: string } };
      }
    ).event;
    expect(blockedToolStart.toolInput.content).toBe(PLACEHOLDER_FILE_CONTENT);

    const blockedToolResult = (
      scenario.timeline[4].message.payload as { event: { output: string } }
    ).event;
    expect(blockedToolResult.output).toBe(PLACEHOLDER_TOOL_OUTPUT);

    const cliPushPayload = scenario.timeline[5].message.payload as {
      data: string;
    };
    expect(cliPushPayload.data).toBe(PLACEHOLDER_CLI_OUTPUT);

    // Every tabId and sessionId is a valid UUID v4
    const firstChunkPayload = scenario.timeline[0].message.payload as {
      tabId: string;
      sessionId: string;
      event: { sessionId: string; messageId: string; timestamp: number };
    };
    expect(TabId.validate(firstChunkPayload.tabId)).toBe(true);
    expect(TabId.validate(firstChunkPayload.sessionId)).toBe(true);
    expect(firstChunkPayload.event.sessionId).toBe(firstChunkPayload.sessionId);
    expect(firstChunkPayload.event.messageId).toBe(
      `turn-${firstChunkPayload.sessionId}`,
    );
    expect(firstChunkPayload.event.timestamp).toBe(
      DEFAULT_SCENARIO_TIME_BASE + 1200,
    );
  });

  describe('S1: privacy scan parity with B2 contract scanner over shared canary list', () => {
    it.each(
      SHARED_PRIVACY_CANARY_CORPUS.map((entry) => [
        entry.label,
        entry.value,
        entry.expectedKind,
      ]),
    )(
      'detects %s (%s) in scanScenarioPrivacy and scrubs it in sanitizeScenario',
      (_label, value, expectedKind) => {
        const findings = scanScenarioPrivacy({ canary: value });
        expect(findings.map((f) => f.kind)).toContain(expectedKind);

        const raw = {
          rpc: {},
          timeline: [
            {
              at: 10,
              message: {
                type: 'chat:chunk',
                payload: {
                  tabId: '$activeTabId',
                  sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                  event: {
                    id: 'evt-canary',
                    eventType: 'text_delta',
                    delta: String(value),
                  },
                },
              },
            },
          ],
        };

        const { scenario } = sanitizeScenario(raw, { id: 'parity-canary' });
        expect(scanScenarioPrivacy(scenario)).toEqual([]);
      },
    );

    it('preserves placeholder credential assignments and version strings while flagging private IPs', () => {
      expect(
        scanScenarioPrivacy({
          placeholders: [
            'password="[REDACTED]"',
            'token="<redacted>"',
            'secret="****"',
            'api_key=${API_KEY}',
            'auth=process.env.PTAH_AUTH_TOKEN',
          ],
          version: '1.2.3.4',
          note: 'Running runtime v20.11.1.0',
        }),
      ).toEqual([]);

      // Private IP inside a version field is still flagged
      expect(
        scanScenarioPrivacy({
          version: '192.168.1.1',
        }),
      ).toEqual([{ path: '$.version', kind: 'IP address' }]);
    });
  });

  describe('S2: decode-before-scan and sanitization for nested JSON, URL encoding, escaped backslashes, and base64 >= 40 chars', () => {
    it('parses and scans nested JSON strings, URL-encoded values, escaped backslashes, and printable base64 >= 40 chars', () => {
      const nestedJson = JSON.stringify({
        cwd: 'C:\\Users\\bob\\secret-workspace\\src\\app.ts',
        nestedToken: 'glpat-1234567890abcdef',
        apiKey: 'raw-key-value',
      });
      const urlEncodedPath =
        'file%3A%2F%2F%2Fhome%2Fcharlie%2Fprivate%2Fkeys.pem';
      const urlEncodedEmailAndToken =
        'owner=alice%40secret-corp.io&key=sk-proj-1234567890abcdef';
      const escapedWindowsPath =
        'trace from C:\\\\Users\\\\dave\\\\work\\\\secret.ts';
      // 48-char base64 of '/home/amun/private-repo/src/secrets.ts' (38 bytes -> 52 base64 chars, < 201)
      const b64Path = Buffer.from(
        '/home/amun/private-repo/src/secrets.ts',
        'utf8',
      ).toString('base64');
      expect(b64Path.length).toBeGreaterThanOrEqual(40);
      expect(b64Path.length).toBeLessThan(201);

      // 48-char base64 of 'password="mySuperSecretPassword123"' (35 bytes -> 48 base64 chars, < 201)
      const b64Cred = Buffer.from(
        'password="mySuperSecretPassword123"',
        'utf8',
      ).toString('base64');
      expect(b64Cred.length).toBeGreaterThanOrEqual(40);
      expect(b64Cred.length).toBeLessThan(201);

      expect(scanScenarioPrivacy(nestedJson).map((f) => f.kind)).toEqual(
        expect.arrayContaining([
          'home path',
          'absolute path',
          'credential shape',
          'credential field',
        ]),
      );
      expect(scanScenarioPrivacy(urlEncodedPath).map((f) => f.kind)).toEqual(
        expect.arrayContaining(['home path', 'absolute path']),
      );
      expect(
        scanScenarioPrivacy(urlEncodedEmailAndToken).map((f) => f.kind),
      ).toEqual(expect.arrayContaining(['email', 'credential shape']));
      expect(
        scanScenarioPrivacy(escapedWindowsPath).map((f) => f.kind),
      ).toEqual(expect.arrayContaining(['home path', 'absolute path']));
      expect(
        scanScenarioPrivacy(`payload:${b64Path}`).map((f) => f.kind),
      ).toEqual(expect.arrayContaining(['home path', 'absolute path']));
      expect(
        scanScenarioPrivacy(`payload:${b64Cred}`).map((f) => f.kind),
      ).toEqual(expect.arrayContaining(['credential assignment']));

      // Verify sanitizeScenario scrubs all of them so the final scan passes
      const { scenario } = sanitizeScenario(
        {
          rpc: {},
          timeline: [
            {
              at: 10,
              message: {
                type: 'chat:chunk',
                payload: {
                  tabId: '$activeTabId',
                  sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                  event: {
                    id: 'evt-s2',
                    eventType: 'text_delta',
                    nestedJson,
                    urlEncodedPath,
                    urlEncodedEmailAndToken,
                    escapedWindowsPath,
                    b64Path: `token=${b64Path}`,
                    b64Cred: `data:${b64Cred}`,
                  },
                },
              },
            },
          ],
        },
        { id: 's2-decode-test' },
      );

      expect(scanScenarioPrivacy(scenario)).toEqual([]);
      const sanitizedEvent = (
        scenario.timeline[0].message.payload as {
          event: Record<string, string>;
        }
      ).event;
      expect(sanitizedEvent['nestedJson']).not.toContain('bob');
      expect(sanitizedEvent['nestedJson']).not.toContain('glpat-');
      expect(sanitizedEvent['nestedJson']).not.toContain('apiKey');
      expect(sanitizedEvent['escapedWindowsPath']).not.toContain('dave');
      expect(sanitizedEvent['b64Path']).not.toContain(b64Path);
      expect(sanitizedEvent['b64Cred']).not.toContain(b64Cred);
    });
  });

  describe('S3: array and object tool_result / CLI output replacement', () => {
    it('replaces array and object content in tool_result and CLI output with placeholders unless allow-listed', () => {
      const raw = {
        rpc: {
          'session:cli-output-page': {
            sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
            output: [{ type: 'text', text: 'secret cli array output' }],
            data: { stdout: 'secret cli object stdout', exitCode: 0 },
          },
        },
        timeline: [
          {
            at: 10,
            message: {
              type: 'chat:chunk',
              payload: {
                tabId: '$activeTabId',
                sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                event: {
                  id: 'start-blocked',
                  eventType: 'tool_start',
                  toolCallId: 'call_blocked_arr',
                  toolName: 'Read',
                  toolInput: {
                    file_path: '/home/amun/repo/src/private.ts',
                  },
                },
              },
            },
          },
          {
            at: 20,
            message: {
              type: 'chat:chunk',
              payload: {
                tabId: '$activeTabId',
                sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                event: {
                  id: 'result-blocked-arr',
                  eventType: 'tool_result',
                  toolCallId: 'call_blocked_arr',
                  content: [
                    {
                      type: 'text',
                      text: 'export const PRIVATE_SECRET = 123;',
                    },
                  ],
                  result: { raw: 'object-shaped tool output' },
                },
              },
            },
          },
          {
            at: 30,
            message: {
              type: 'chat:chunk',
              payload: {
                tabId: '$activeTabId',
                sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                event: {
                  id: 'start-allowed',
                  eventType: 'tool_start',
                  toolCallId: 'call_allowed_arr',
                  toolName: 'Read',
                  toolInput: {
                    file_path: '/home/amun/repo/src/main.ts',
                  },
                },
              },
            },
          },
          {
            at: 40,
            message: {
              type: 'chat:chunk',
              payload: {
                tabId: '$activeTabId',
                sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                event: {
                  id: 'result-allowed-arr',
                  eventType: 'tool_result',
                  toolCallId: 'call_allowed_arr',
                  content: [
                    {
                      type: 'text',
                      text: 'Allowed block from /home/amun/repo/src/main.ts',
                    },
                  ],
                },
              },
            },
          },
          {
            at: 50,
            message: {
              type: 'agent-monitor:output',
              payload: {
                sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                content: [{ type: 'text', text: 'raw agent monitor array' }],
              },
            },
          },
        ],
      };

      const { scenario } = sanitizeScenario(raw, {
        id: 's3-structured-output',
        allowFiles: ['src/main.ts'],
      });

      const cliPage = scenario.rpc['session:cli-output-page'] as Record<
        string,
        unknown
      >;
      expect(cliPage['output']).toBe(PLACEHOLDER_CLI_OUTPUT);
      expect(cliPage['data']).toBe(PLACEHOLDER_CLI_OUTPUT);

      const blockedResult = (
        scenario.timeline[1].message.payload as {
          event: { content: unknown; result: unknown };
        }
      ).event;
      expect(blockedResult.content).toBe(PLACEHOLDER_TOOL_OUTPUT);
      expect(blockedResult.result).toBe(PLACEHOLDER_TOOL_OUTPUT);

      const allowedResult = (
        scenario.timeline[3].message.payload as {
          event: { content: Array<{ type: string; text: string }> };
        }
      ).event;
      expect(allowedResult.content).toEqual([
        {
          type: 'text',
          text: `Allowed block from ${SYNTHETIC_WORKSPACE_ROOT}/src/main.ts`,
        },
      ]);

      const monitorOutput = scenario.timeline[4].message.payload as {
        content: unknown;
      };
      expect(monitorOutput.content).toBe(PLACEHOLDER_CLI_OUTPUT);
    });
  });

  it('is deterministic and strictly idempotent (sanitizing a sanitized scenario changes nothing)', () => {
    const sampleScenario = JSON.parse(
      readFileSync(SAMPLE_SCENARIO_PATH, 'utf8'),
    );

    const first = sanitizeScenario(sampleScenario, {
      id: 'chat-tool-call',
      title: 'PtahCode chat and tool call',
      allowFiles: ['src/main.ts'],
      strict: true,
    });
    const second = sanitizeScenario(first.scenario, {
      id: 'chat-tool-call',
      title: 'PtahCode chat and tool call',
      allowFiles: ['src/main.ts'],
      strict: true,
    });

    expect(second.scenario).toEqual(first.scenario);
    expect(first.scenario).toEqual(sampleScenario);
  });

  describe('CLI script (sanitize-replay-scenario.mjs)', () => {
    it('runs without a build via jiti, writes atomically, and prints only sanitized key paths without values', () => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'ptah-sanitize-cli-'));
      try {
        const inPath = path.join(tmpDir, 'raw.json');
        const outPath = path.join(tmpDir, 'scenario.json');
        const leakedKeySecret = 'sk-ant-api03-secretInObjectKey999999';
        const leakedFieldValue = 'super-secret-value-never-printed';

        writeFileSync(
          inPath,
          JSON.stringify({
            timeBase: 1720000000000,
            rpc: {
              'workspace:getInfo': {
                folders: ['/Users/dev/my-app'],
                root: '/Users/dev/my-app',
                activeFolder: '/Users/dev/my-app',
                name: 'my-app',
              },
              'auth:getAuthStatus': {
                hasApiKey: true,
                apiKey: leakedFieldValue,
                [`${leakedKeySecret}_token`]: leakedFieldValue,
              },
            },
            timeline: [
              {
                at: 50,
                message: {
                  type: 'session:turnEnded',
                  payload: {
                    sessionId: '123e4567-e89b-42d3-a456-426614174000',
                    cwd: '/Users/dev/my-app',
                    timestamp: 1720000000500,
                  },
                },
              },
            ],
          }),
          'utf8',
        );

        const stdout = execFileSync(
          process.execPath,
          [
            CLI_SCRIPT_PATH,
            '--in',
            inPath,
            '--out',
            outPath,
            '--id',
            'cli-smoke',
            '--title',
            'CLI Smoke Scenario',
            '--allow-file',
            'src/main.ts',
            '--strict',
          ],
          { cwd: REPO_ROOT, encoding: 'utf8' },
        );

        expect(stdout).not.toContain(leakedFieldValue);
        expect(stdout).not.toContain(leakedKeySecret);
        expect(existsSync(`${outPath}.tmp`)).toBe(false);

        const cliOutput = JSON.parse(stdout.trim());
        expect(cliOutput.ok).toBe(true);
        expect(cliOutput.id).toBe('cli-smoke');
        expect(cliOutput.report.redactedFields).toEqual([
          '$.rpc.auth:getAuthStatus.apiKey',
          '$.rpc.auth:getAuthStatus.[REDACTED]_token',
        ]);

        const writtenScenario = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(writtenScenario.id).toBe('cli-smoke');
        expect(writtenScenario.title).toBe('CLI Smoke Scenario');
        expect(writtenScenario.timeBase).toBe(DEFAULT_SCENARIO_TIME_BASE);
        expect(scanScenarioPrivacy(writtenScenario)).toEqual([]);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('refuses --in equal to --out without modifying the input file', () => {
      const tmpDir = mkdtempSync(
        path.join(tmpdir(), 'ptah-sanitize-cli-same-'),
      );
      try {
        const filePath = path.join(tmpDir, 'raw.json');
        const originalContent = '{"raw":"keep-me"}\n';
        writeFileSync(filePath, originalContent, 'utf8');

        const result = spawnSync(
          process.execPath,
          [
            CLI_SCRIPT_PATH,
            '--in',
            filePath,
            '--out',
            filePath,
            '--id',
            'same-path-test',
          ],
          { cwd: REPO_ROOT, encoding: 'utf8' },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          '--in and --out must not resolve to the same file path',
        );
        expect(readFileSync(filePath, 'utf8')).toBe(originalContent);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

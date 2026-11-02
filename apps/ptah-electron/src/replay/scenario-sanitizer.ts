import {
  isSecretFieldName,
  redactSecrets,
  REDACTED,
} from '../services/diagnostics/log-redaction';

export const DEFAULT_SCENARIO_TIME_BASE = 1793476800000;
export const SYNTHETIC_WORKSPACE_ROOT = '/workspace/acme-app';
export const SYNTHETIC_WORKSPACE_NAME = 'acme-app';
export const SYNTHETIC_HOST = 'ptah.live';
export const SYNTHETIC_URL = 'https://ptah.live';
export const SYNTHETIC_USER = 'demo-user';
export const SYNTHETIC_EMAIL = 'demo@example.invalid';
export const PLACEHOLDER_TOOL_OUTPUT = '[sanitized tool output]';
export const PLACEHOLDER_FILE_CONTENT = '[sanitized file content]';
export const PLACEHOLDER_DIFF = '[sanitized diff]';
export const PLACEHOLDER_CLI_OUTPUT = '[sanitized cli output]';

export interface PrivacyFinding {
  readonly path: string;
  readonly kind: string;
}

export interface SanitizeScenarioOptions {
  readonly id?: string;
  readonly title?: string;
  readonly initialView?: 'chat' | 'command-center';
  readonly timeBase?: number;
  readonly allowFiles?: readonly string[];
  readonly workspacePaths?: readonly string[];
  readonly usernames?: readonly string[];
  readonly allowedRpcMethods?: ReadonlySet<string> | readonly string[];
  readonly allowedPushTypes?: ReadonlySet<string> | readonly string[];
  readonly strict?: boolean;
}

export interface SanitizeScenarioReport {
  readonly droppedRpcMethods: string[];
  readonly droppedPushTypes: string[];
  readonly redactedFields: string[];
  readonly redactedSecretsCount: number;
  readonly replacedPathsCount: number;
  readonly replacedPiiCount: number;
  readonly redactedPayloadsCount: number;
  readonly remappedUuidsCount: number;
  readonly normalizedTimestampsCount: number;
}

export interface SanitizedScenario {
  readonly id: string;
  readonly title: string;
  readonly timeBase: number;
  readonly config: {
    readonly initialView: 'chat' | 'command-center';
    readonly workspaceRoot: string;
    readonly workspaceName: string;
  };
  readonly rpc: Record<string, unknown>;
  readonly rpcCases?: Record<
    string,
    Array<{ readonly match: Record<string, unknown>; readonly data: unknown }>
  >;
  readonly rpcErrors?: Record<
    string,
    { readonly error: string; readonly errorCode?: string }
  >;
  readonly bootMessages?: Array<{
    readonly type: string;
    readonly payload?: unknown;
    readonly [key: string]: unknown;
  }>;
  readonly start?:
    | { readonly mode: 'auto' }
    | { readonly mode: 'on-send'; readonly prompt: string };
  readonly timeline: Array<{
    readonly at: number;
    readonly message: {
      readonly type: string;
      readonly payload?: unknown;
      readonly [key: string]: unknown;
    };
  }>;
}

export interface SanitizeScenarioResult {
  readonly scenario: SanitizedScenario;
  readonly report: SanitizeScenarioReport;
}

/**
 * Default allow-list of RPC methods permitted in published replay scenarios.
 * Excludes credential mutators, key setters, token setters, and raw settings export.
 */
export const DEFAULT_ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set<string>(
  [
    'artifacts:list',
    'artifacts:openLink',
    'displayWindow:open',
    'displayWindow:close',
    'displayWindow:status',
    'displayWindow:publishState',
    'displayWindow:getState',
    'displayWindow:action',
    'analytics:spendSummary',
    'attention:getSnapshot',
    'chat:start',
    'chat:continue',
    'chat:setStreamViewport',
    'chat:abort',
    'chat:pending-questions',
    'chat:running-agents',
    'chat:agent-sessions',
    'chat:resume',
    'chat:history-page',
    'chat:subagent-query',
    'chat:dismiss-resumable-subagents',
    'subagent:send-message',
    'subagent:stop',
    'subagent:interrupt',
    'subagent:background',
    'subagent:history-page',
    'session:list',
    'session:load',
    'session:validate',
    'session:cli-sessions',
    'session:cli-output-page',
    'session:stats-batch',
    'session:status',
    'session:getOrganization',
    'session:listForTasks',
    'context:getAllFiles',
    'context:getFileSuggestions',
    'autocomplete:agents',
    'autocomplete:commands',
    'file:viewContent',
    'file:read',
    'file:exists',
    'editor:detectTargets',
    'config:model-switch',
    'config:model-get',
    'config:model-set',
    'config:autopilot-toggle',
    'config:autopilot-get',
    'config:models-list',
    'config:effort-get',
    'config:effort-set',
    'config:pricing-get',
    'config:getScopes',
    'auth:getHealth',
    'auth:getAuthStatus',
    'auth:copilotStatus',
    'auth:getEffectiveRoute',
    'auth:checkConnection',
    'auth:getScope',
    'auth:getStatus',
    'auth:getApiKeyStatus',
    'setup-status:get-status',
    'wizard:get-resumable-run',
    'wizard:analysis-status',
    'wizard:recommend-agents',
    'wizard:get-generation-run-state',
    'wizard:preview-generation',
    'wizard:list-analyses',
    'wizard:load-analysis',
    'wizard:list-agent-packs',
    'wizard:plan-pack-install',
    'license:getStatus',
    'llm:getProviderStatus',
    'llm:getDefaultProvider',
    'llm:listVsCodeModels',
    'llm:listProviderModels',
    'llm:getProviderBaseUrl',
    'provider:listModels',
    'provider:getModelTiers',
    'provider:listCustomEntries',
    'provider:getAccountUsage',
    'provider:getPlanLimits',
    'provider:listAccounts',
    'provider:getAccountStatus',
    'provider:getAmbientClaudeStatus',
    'enhancedPrompts:getStatus',
    'enhancedPrompts:getRunState',
    'enhancedPrompts:getPromptContent',
    'quality:getAssessment',
    'quality:getHistory',
    'plugins:list-available',
    'plugins:get-config',
    'plugins:list-skills',
    'plugins:list-marketplaces',
    'plugins:browse-marketplace',
    'agent:getConfig',
    'agent:getClaudeBuiltins',
    'agent:detectClis',
    'agent:listCliModels',
    'agent:permissionResponse',
    'agent:stop',
    'agent:continue',
    'agent:resumeCliSession',
    'agent:backgroundList',
    'agent:getLanePlanLimits',
    'agent:outcomeSignals',
    'agent:listDecisionModels',
    'ptahCli:list',
    'ptahCli:listModels',
    'skillsSh:search',
    'skillsSh:listInstalled',
    'skillsSh:getPopular',
    'skillsSh:detectRecommended',
    'mcpDirectory:search',
    'mcpDirectory:getDetails',
    'mcpDirectory:listInstalled',
    'mcpDirectory:getPopular',
    'mcpDirectory:getSmitheryKeyStatus',
    'mcpDirectory:listSmitheryInstalled',
    'mcpDirectory:listSmitheryConnections',
    'mcpDirectory:smitheryConnectionStatus',
    'mcpDirectory:oauthStatus',
    'mcpDirectory:listOAuthConnected',
    'capabilities:getState',
    'capabilities:getEffective',
    'workspace:getInfo',
    'workspace:switch',
    'workspace:listRecent',
    'settings:get',
    'webSearch:getApiKeyStatus',
    'webSearch:getConfig',
    'git:info',
    'git:watchRoots',
    'git:reviewChanges',
    'git:reviewFile',
    'git:worktrees',
    'git:prStatus',
    'git:log',
    'git:showFile',
    'git:diffFile',
    'git:branches',
    'git:stashList',
    'git:stashShow',
    'git:tags',
    'git:remotes',
    'git:lastCommit',
    'git:turnChangeSets',
    'harness:search-skills',
    'harness:discover-mcp',
    'harness:load-presets',
    'harness:get-proposal',
    'harness:health',
    'harness:get-skill-selection',
    'memory:list',
    'memory:search',
    'memory:get',
    'memory:stats',
    'memory:searchSymbols',
    'memory:diagnostics',
    'memory:getTriggers',
    'memory:listQuarantined',
    'mem:searchIndex',
    'mem:timeline',
    'mem:getObservations',
    'corpus:list',
    'corpus:get',
    'corpus:query',
    'corpus:suggest',
    'skillSynthesis:listClones',
    'skillSynthesis:getClone',
    'skillSynthesis:getHistoryBody',
    'skillSynthesis:listQuarantinedAgents',
    'skillSynthesis:getAgentModels',
    'skillSynthesis:invocationStats',
    'skillSynthesis:getScorecards',
    'skillSynthesis:getScorecardDetail',
    'skillSynthesis:listSpecs',
    'cron:list',
    'cron:get',
    'cron:runs',
    'cron:nextFire',
    'gateway:status',
    'gateway:listBindings',
    'gateway:listMessages',
    'gateway:getAllowList',
    'voice:getConfig',
    'voice:getTtsConfig',
    'voice:listProviders',
    'voice:listVoices',
    'voice:getProviderConfig',
    'boot:getReadiness',
    'db:health',
    'embedder:status',
    'indexing:getStatus',
    'update:get-state',
    'diagnostics:go-vet-consent-get',
    'tasks:list',
    'tasks:get',
    'tasks:getArtifact',
    'tasks:board',
    'tasks:doctorPlan',
    'tasks:getViews',
    'outputStyle:list',
    'outputStyle:get',
    'outputStyle:diagnose',
    'peerSession:list',
    'surface:read',
  ],
);

/**
 * Default allow-list of host-to-webview push types permitted in published scenarios.
 * `rpc:response` and `rpc:call` are never permitted in the timeline.
 */
export const DEFAULT_ALLOWED_PUSH_TYPES: ReadonlySet<string> = new Set<string>([
  'batch',
  'chat:chunk',
  'chat:messageChunk',
  'chat:thinking',
  'chat:toolProgress',
  'chat:complete',
  'chat:streamSnapshot',
  'chat:error',
  'chat:sessionEnded',
  'session:turnEnded',
  'session:turnFailed',
  'session:subagentEnded',
  'session:id-resolved',
  'session:stats',
  'session:stats-live',
  'session:metadataChanged',
  'session:compactionComplete',
  'session:mcpStatus',
  'session:organizationChanged',
  'session:plan-mode-changed',
  'planLimits:changed',
  'agentSession:opened',
  'sessionHandoff:opened',
  'agent-monitor:spawned',
  'agent-monitor:output',
  'agent-monitor:exited',
  'agent-monitor:expired',
  'agent-monitor:permission-request',
  'permission:request',
  'ask-user-question:request',
  'workspaceChanged',
  'boot:readinessChanged',
  'boot:progress',
  'update:statusChanged',
  'activity:event',
  'degradation:event',
  'switchView',
]);

// --- Privacy scan rules (mirrors & extends B2 libs/web/landing/src/lib/live-demo/scenario/privacy-scan.ts) ---
const SAFE_CREDENTIAL_FIELDS = new Set([
  'hasApiKey',
  'hasOpenRouterKey',
  'hasAnyProviderKey',
]);
const CREDENTIAL_FIELD_RE =
  /(?:^|[_-])(api[_-]?key|token|secret|password|authorization|cookie)(?:$|[_-])/i;
const CAMEL_CREDENTIAL_FIELD_RE =
  /(?:apiKey|Token|Secret|Password|Authorization|Cookie)$/;
const EMAIL_REPLACE_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOME_TEST_RE =
  /(?:\/home\/|\/Users\/|C:[\\/]Users[\\/]|~\/|\/root(?:\/|\b)|\/var\/folders\/)/i;
const URL_GLOBAL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const HOSTNAME_ANY_GLOBAL_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const PUBLIC_HOST_SUFFIXES = new Set([
  'com',
  'net',
  'org',
  'io',
  'dev',
  'live',
  'app',
  'xyz',
  'edu',
  'gov',
  'me',
  'sh',
  'cloud',
  'tech',
  'co',
  'ai',
  'internal',
  'local',
  'corp',
  'lan',
  'intranet',
]);
const FILE_SUFFIXES = new Set(['ts', 'js', 'json']);
const IPV4_GLOBAL_RE = /\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6_TEST_RE =
  /(?:^|[\s[(/])(?=[a-f\d:]*:[a-f\d:]*:)(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4}(?=$|[\s\]/),])/i;
const IPV6_REPLACE_RE =
  /(^|[\s[(/])((?=[a-f\d:]*:[a-f\d:]*:)(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4})(?=$|[\s\]/),])/gi;
const SECRET_SHAPE_TEST_RE =
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:sk-|pk-|rk-|(?:sk|pk|rk)_(?:live|test)_|github_pat_|gh[opusr]_|glpat-|xox[a-z]-|sk-ant-|sk-proj-|AIza|npm_|hf_|AKIA|ASIA)[A-Za-z0-9_-]{8,}/i;
const CREDENTIAL_ASSIGNMENT_GLOBAL_RE =
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+_)*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth)(?:_[A-Za-z0-9]+)*\b["']?\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|(<[^>]*>|\[[^\]]*\]|\$\{[^}]*\}|[^\s,;}\]]+))/gi;
const AUTHORIZATION_GLOBAL_RE =
  /\b(?:Authorization\s*:\s*)?(Bearer\s+\S+|Basic\s+[A-Za-z0-9+/]+={0,2})/gi;
const PEM_TEST_RE = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/;
const LONG_BASE64_TEST_RE = /(?:[A-Za-z0-9+/]{201,}={0,2}|[A-Za-z0-9_-]{201,})/;
const LONG_BASE64_REPLACE_RE =
  /(?:[A-Za-z0-9+/]{201,}={0,2}|[A-Za-z0-9_-]{201,})/g;
const BASE64_SEGMENT_GLOBAL_RE =
  /(?:[A-Za-z0-9+/]{40,}={0,2}|[A-Za-z0-9_-]{40,})/g;
const ABSOLUTE_PATH_GLOBAL_RE =
  /(?:^|[\s"'=:(,{>]|\[)(?:\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|[A-Z]:[\\/][^\s"']+)/g;

const MAX_DECODE_DEPTH = 4;

const UUID_ANY_GLOBAL_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_V4_EXACT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_OR_SESSION_ID_FIELD_RE = /(?:^|[A-Z])(?:tabId|sessionId)$/i;
const SCENARIO_ID_RE = /^[a-z0-9-]+$/;

const EPOCH_MS_MIN = 1_000_000_000_000;
const EPOCH_MS_MAX = 3_000_000_000_000;
const MAX_RELATIVE_TIME_OFFSET_MS = 86_400_000;
const ISO_TIMESTAMP_EXACT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const EXTRA_SECRET_REPLACE_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9 ]*-----/g,
  /-----BEGIN [A-Z0-9 ]*-----/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\b(?:sk-ant-|sk-proj-|sk-|pk-|rk-|(?:sk|pk|rk)_(?:live|test)_|github_pat_|gh[opusr]_|glpat-|xox[a-z]-|AIza|npm_|hf_|AKIA|ASIA)[A-Za-z0-9_-]{8,}/gi,
  /\b(?:Authorization\s*:\s*)?(?:Bearer|Basic)\s+(?!\[REDACTED\])\S+/gi,
  /\b(?:Set-Cookie|Cookie)\s*[:=]\s*[^\r\n;"']+/gi,
];

const USERNAME_FIELD_NAMES = new Set([
  'username',
  'userName',
  'accountName',
  'accountLabel',
  'authorName',
  'committerName',
  'osUsername',
]);

const EMAIL_FIELD_NAMES = new Set(['email', 'authorEmail', 'committerEmail']);

const HOST_FIELD_NAMES = new Set(['hostname', 'host']);

const FILE_CONTENT_RPC_METHODS = new Set([
  'file:read',
  'file:viewContent',
  'git:showFile',
  'git:diffFile',
  'git:reviewFile',
  'git:stashShow',
  'git:reviewChanges',
]);

const DIFF_FIELD_NAMES = new Set(['diff', 'patch', 'rawDiff', 'unifiedDiff']);

const FILE_CONTENT_FIELD_NAMES = new Set([
  'fileContent',
  'oldContent',
  'newContent',
  'originalContent',
  'modifiedContent',
]);

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return (
    !trimmed ||
    /^\*+$/.test(trimmed) ||
    /^<redacted>$/i.test(trimmed) ||
    /^\[redacted\]$/i.test(trimmed) ||
    /^\$\{[^}]+\}$/.test(trimmed) ||
    /^process\.env\.[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)
  );
}

function isAllowedHost(host: string): boolean {
  return (
    host === SYNTHETIC_HOST ||
    host.endsWith(`.${SYNTHETIC_HOST}`) ||
    host === 'example.invalid'
  );
}

function isPrivateIpv4(parts: number[]): boolean {
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function safeDecodeURIComponent(text: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (chunk) => {
      try {
        return decodeURIComponent(chunk);
      } catch {
        return chunk;
      }
    });
  }
}

function unescapeBackslashes(text: string): string {
  if (
    !text.includes('\\\\') &&
    !text.includes('\\/') &&
    !text.includes('\\"')
  ) {
    return text;
  }
  return text.replace(/\\\\/g, '\\').replace(/\\\//g, '/').replace(/\\"/g, '"');
}

/**
 * Decodes a base64 / base64url segment (>= 40 chars) if and only if the decoded
 * bytes are valid UTF-8 printable ASCII text.
 */
export function tryDecodePrintableBase64(segment: string): string | null {
  if (segment.length < 40) return null;
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  if (normalized.length % 4 === 1) return null;
  const padded =
    normalized.length % 4 === 0
      ? normalized
      : normalized + '='.repeat(4 - (normalized.length % 4));
  try {
    const buf = Buffer.from(padded, 'base64');
    if (buf.length < 16) return null;
    const decoded = buf.toString('utf8');
    if (!decoded || decoded.includes('\uFFFD')) return null;
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i);
      const isPrintable =
        (code >= 0x20 && code <= 0x7e) ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d;
      if (!isPrintable) return null;
    }
    return decoded;
  } catch {
    // degradation-audit: optional-capability - a segment that does not decode is not base64 text, so it is not scanned
    return null;
  }
}

function tryParseJsonStructure(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (trimmed.length < 2) return undefined;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (
    (first === '{' && last === '}') ||
    (first === '[' && last === ']') ||
    (first === '"' && last === '"')
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && parsed !== text) {
        return parsed;
      }
    } catch {
      // Not a standalone JSON literal; fall through to embedded JSON check
    }
  }
  return undefined;
}

/**
 * Pure, fail-closed privacy scan mirroring and extending B2's `scanScenarioPrivacy`.
 * Also decodes nested JSON strings, URL-encoded values, escaped backslashes,
 * and base64 segments >= 40 chars that decode to printable text before scanning.
 */
export function scanScenarioPrivacy(value: unknown): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const seenDecodedFindings = new Set<string>();

  const add = (path: string, kind: string, isDecodedPass = false) => {
    const dedupeKey = `${path}\u0000${kind}`;
    if (isDecodedPass && seenDecodedFindings.has(dedupeKey)) {
      return;
    }
    seenDecodedFindings.add(dedupeKey);
    findings.push({ path, kind });
  };

  const scanString = (
    text: string,
    path: string,
    allowSyntheticEmail = false,
    scanAssignments = true,
    depth = 0,
  ) => {
    const isDecoded = depth > 0;

    for (const match of text.matchAll(EMAIL_REPLACE_RE)) {
      if (!(
        (allowSyntheticEmail || match[0] === SYNTHETIC_EMAIL) &&
        match[0] === SYNTHETIC_EMAIL
      )) {
        add(path, 'email', isDecoded);
      }
    }
    if (HOME_TEST_RE.test(text)) {
      add(path, 'home path', isDecoded);
    }
    if (IPV6_TEST_RE.test(text)) {
      add(path, 'IP address', isDecoded);
    }
    for (const match of text.matchAll(IPV4_GLOBAL_RE)) {
      const idx = match.index ?? 0;
      if (idx > 0 && /[\d.]/.test(text[idx - 1])) continue;
      const parts = match[0].split('.').map(Number);
      if (parts.some((part) => part > 255)) continue;
      const before = text.slice(0, idx);
      const hostContext =
        /(?:\/\/|\bhost(?:name)?\s*[:=]\s*)$/i.test(before) ||
        /(?:^|\.|\[)(?:host|hostname)(?:\]|$)/i.test(path);
      const versionContext =
        /(?:^|\.|\[)(?:version|semver)(?:\]|$)/i.test(path) ||
        /v$/i.test(before);
      if (isPrivateIpv4(parts) || hostContext || !versionContext) {
        add(path, 'IP address', isDecoded);
      }
    }
    if (scanAssignments) {
      for (const match of text.matchAll(CREDENTIAL_ASSIGNMENT_GLOBAL_RE)) {
        const captured = match[1] ?? match[2] ?? match[3] ?? '';
        if (!isPlaceholder(captured)) {
          add(path, 'credential assignment', isDecoded);
        }
      }
    }
    for (const match of text.matchAll(AUTHORIZATION_GLOBAL_RE)) {
      const credential = match[1].replace(/^(?:Bearer|Basic)\s+/i, '');
      if (!isPlaceholder(credential)) {
        add(path, 'credential shape', isDecoded);
      }
    }
    if (SECRET_SHAPE_TEST_RE.test(text)) {
      add(path, 'credential shape', isDecoded);
    }
    if (PEM_TEST_RE.test(text)) {
      add(path, 'PEM block', isDecoded);
    }
    if (LONG_BASE64_TEST_RE.test(text)) {
      add(path, 'long base64', isDecoded);
    }

    for (const match of text.matchAll(URL_GLOBAL_RE)) {
      try {
        const parsed = new URL(match[0]);
        const host = parsed.hostname.toLowerCase();
        if (
          parsed.username ||
          parsed.password ||
          (host && !isAllowedHost(host))
        ) {
          add(path, 'URL host', isDecoded);
        }
      } catch {
        add(path, 'invalid URL', isDecoded);
      }
    }

    for (const match of text.matchAll(HOSTNAME_ANY_GLOBAL_RE)) {
      const host = match[0].toLowerCase();
      const suffix = host.slice(host.lastIndexOf('.') + 1);
      const before = text.slice(0, match.index ?? 0);
      const explicitContext = /(?:\/\/|@)$/.test(before);
      if (
        !isAllowedHost(host) &&
        !FILE_SUFFIXES.has(suffix) &&
        (PUBLIC_HOST_SUFFIXES.has(suffix) || explicitContext)
      ) {
        add(path, 'hostname', isDecoded);
      }
    }

    for (const match of text.matchAll(ABSOLUTE_PATH_GLOBAL_RE)) {
      const candidate = match[0]
        .trim()
        .replace(/^(?:["'=:(,{>]|\[)/, '')
        .replace(/[)\]},;'"]+$/, '');
      if (
        !candidate.startsWith(`${SYNTHETIC_WORKSPACE_ROOT}/`) &&
        candidate !== SYNTHETIC_WORKSPACE_ROOT
      ) {
        add(path, 'absolute path', isDecoded);
      }
    }

    // S2: Decode-before-scan passes (bounded by MAX_DECODE_DEPTH)
    if (depth >= MAX_DECODE_DEPTH) {
      return;
    }

    // 1. Nested JSON string
    const parsedJson = tryParseJsonStructure(text);
    if (parsedJson !== undefined) {
      visit(parsedJson, path, allowSyntheticEmail, depth + 1);
    }

    // 2. Escaped backslashes (e.g. C:\\Users\\bob in partially serialized strings)
    const unescaped = unescapeBackslashes(text);
    if (unescaped !== text) {
      scanString(
        unescaped,
        path,
        allowSyntheticEmail,
        scanAssignments,
        depth + 1,
      );
    }

    // 3. URL-encoded values (decodeURIComponent safe)
    const urlDecoded = safeDecodeURIComponent(text);
    if (urlDecoded !== text) {
      scanString(
        urlDecoded,
        path,
        allowSyntheticEmail,
        scanAssignments,
        depth + 1,
      );
    }

    // 4. Base64 segments >= 40 chars that decode to printable text
    for (const match of text.matchAll(BASE64_SEGMENT_GLOBAL_RE)) {
      const decodedB64 = tryDecodePrintableBase64(match[0]);
      if (decodedB64 !== null && decodedB64 !== text) {
        scanString(decodedB64, path, false, true, depth + 1);
      }
    }
  };

  const visit = (
    item: unknown,
    path: string,
    allowSyntheticEmail = false,
    depth = 0,
  ) => {
    if (typeof item === 'string') {
      scanString(item, path, allowSyntheticEmail, true, depth);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) =>
        visit(child, `${path}[${index}]`, false, depth),
      );
      return;
    }
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        const keyPath = `${path}.${key}`;
        scanString(key, `${keyPath} (key)`, false, false, depth);
        if (
          (isSecretFieldName(key) ||
            CREDENTIAL_FIELD_RE.test(key) ||
            CAMEL_CREDENTIAL_FIELD_RE.test(key)) &&
          !(SAFE_CREDENTIAL_FIELDS.has(key) && typeof child === 'boolean')
        ) {
          add(keyPath, 'credential field', depth > 0);
        }
        visit(child, keyPath, key === 'authorEmail', depth);
      }
    }
  };

  visit(value, '$', false, 0);
  return findings;
}

export function formatFakeUuidV4(index: number): string {
  if (index >= 1 && index <= 9) {
    const d = String(index);
    return `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`;
  }
  const hex = Math.max(1, index).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

function normalizeRelativeFilePath(filePath: string): string {
  let normalized = filePath.trim().replace(/\\/g, '/');
  if (normalized.startsWith(`${SYNTHETIC_WORKSPACE_ROOT}/`)) {
    normalized = normalized.slice(SYNTHETIC_WORKSPACE_ROOT.length + 1);
  } else if (normalized.startsWith('/workspace/')) {
    normalized = normalized.slice('/workspace/'.length);
  }
  normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '');
  return normalized;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFilePathFromObject(
  obj: Record<string, unknown>,
): string | undefined {
  for (const key of [
    'file_path',
    'filePath',
    'path',
    'relativePath',
    'targetFile',
  ]) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
  }
  return undefined;
}

function toStringSet(
  input: ReadonlySet<string> | readonly string[] | undefined,
  fallback: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!input) return fallback;
  return input instanceof Set ? input : new Set(input);
}

/**
 * Pure offline scenario sanitizer.
 *
 * Converts a raw capture (or an existing scenario) into a contract-compliant,
 * synthetic `SanitizedScenario` and verifies it passes `scanScenarioPrivacy`.
 */
export function sanitizeScenario(
  rawInput: unknown,
  options: SanitizeScenarioOptions = {},
): SanitizeScenarioResult {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error(
      'sanitizeScenario requires a non-null scenario/capture object',
    );
  }
  const raw = rawInput as Record<string, unknown>;

  const rawId =
    typeof options.id === 'string'
      ? options.id
      : typeof raw['id'] === 'string'
        ? raw['id']
        : 'demo-scenario';
  if (!SCENARIO_ID_RE.test(rawId)) {
    throw new Error(
      `Invalid scenario id '${rawId}': must match /^[a-z0-9-]+$/`,
    );
  }

  const rawTitle =
    typeof options.title === 'string' && options.title.trim().length > 0
      ? options.title.trim()
      : typeof raw['title'] === 'string' && raw['title'].trim().length > 0
        ? raw['title'].trim()
        : `PtahCode ${rawId.replace(/-/g, ' ')}`;

  const strict = options.strict === true;
  const targetTimeBase = options.timeBase ?? DEFAULT_SCENARIO_TIME_BASE;
  const allowedRpc = toStringSet(
    options.allowedRpcMethods,
    DEFAULT_ALLOWED_RPC_METHODS,
  );
  const allowedPush = toStringSet(
    options.allowedPushTypes,
    DEFAULT_ALLOWED_PUSH_TYPES,
  );

  const allowFilesSet = new Set<string>(
    (options.allowFiles ?? []).map((f) => normalizeRelativeFilePath(f)),
  );

  const droppedRpcMethods: string[] = [];
  const droppedPushTypes: string[] = [];
  const redactedFields: string[] = [];
  let redactedSecretsCount = 0;
  let replacedPathsCount = 0;
  let replacedPiiCount = 0;
  let redactedPayloadsCount = 0;
  let normalizedTimestampsCount = 0;

  // 1. Collect workspace roots and usernames to scrub
  const workspaceRoots = new Set<string>();
  for (const wp of options.workspacePaths ?? []) {
    if (typeof wp === 'string' && wp.trim().length > 1) {
      workspaceRoots.add(wp.trim().replace(/[\\/]+$/, ''));
    }
  }
  const rawConfig =
    raw['config'] && typeof raw['config'] === 'object'
      ? (raw['config'] as Record<string, unknown>)
      : undefined;
  if (
    typeof rawConfig?.['workspaceRoot'] === 'string' &&
    rawConfig['workspaceRoot'].trim().length > 1 &&
    rawConfig['workspaceRoot'] !== SYNTHETIC_WORKSPACE_ROOT
  ) {
    workspaceRoots.add(
      rawConfig['workspaceRoot'].trim().replace(/[\\/]+$/, ''),
    );
  }
  const rawRpc =
    raw['rpc'] && typeof raw['rpc'] === 'object' && !Array.isArray(raw['rpc'])
      ? (raw['rpc'] as Record<string, unknown>)
      : {};
  const wsInfo =
    rawRpc['workspace:getInfo'] &&
    typeof rawRpc['workspace:getInfo'] === 'object' &&
    !Array.isArray(rawRpc['workspace:getInfo'])
      ? (rawRpc['workspace:getInfo'] as Record<string, unknown>)
      : undefined;
  if (wsInfo) {
    for (const key of ['root', 'activeFolder']) {
      const val = wsInfo[key];
      if (
        typeof val === 'string' &&
        val.trim().length > 1 &&
        val !== SYNTHETIC_WORKSPACE_ROOT
      ) {
        workspaceRoots.add(val.trim().replace(/[\\/]+$/, ''));
      }
    }
    if (Array.isArray(wsInfo['folders'])) {
      for (const folder of wsInfo['folders']) {
        if (
          typeof folder === 'string' &&
          folder.trim().length > 1 &&
          folder !== SYNTHETIC_WORKSPACE_ROOT
        ) {
          workspaceRoots.add(folder.trim().replace(/[\\/]+$/, ''));
        }
      }
    }
  }

  const knownUsernames = new Set<string>();
  for (const u of options.usernames ?? []) {
    if (typeof u === 'string' && u.trim().length >= 3) {
      knownUsernames.add(u.trim());
    }
  }

  // Scan strings once for home-directory usernames (including escaped/URL-encoded/nested JSON) and earliest timestamp
  let detectedMinTimestamp: number | null = null;
  const extractUsernamesFromText = (str: string) => {
    const candidates = [
      str,
      unescapeBackslashes(str),
      safeDecodeURIComponent(str),
    ];
    for (const candidate of candidates) {
      for (const match of candidate.matchAll(
        /(?:\/home\/|\/Users\/|C:\\+Users\\+|C:\/Users\/)([A-Za-z0-9._-]{3,})/gi,
      )) {
        const user = match[1];
        if (
          user &&
          user.toLowerCase() !== 'public' &&
          user.toLowerCase() !== 'default' &&
          user.toLowerCase() !== SYNTHETIC_USER
        ) {
          knownUsernames.add(user);
        }
      }
    }
  };

  const preScan = (val: unknown, depth = 0) => {
    if (depth > MAX_DECODE_DEPTH) return;
    if (typeof val === 'number') {
      if (val >= EPOCH_MS_MIN && val <= EPOCH_MS_MAX) {
        if (detectedMinTimestamp === null || val < detectedMinTimestamp) {
          detectedMinTimestamp = val;
        }
      }
      return;
    }
    if (typeof val === 'string') {
      extractUsernamesFromText(val);
      const parsed = tryParseJsonStructure(val);
      if (parsed !== undefined) {
        preScan(parsed, depth + 1);
      }
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((child) => preScan(child, depth));
      return;
    }
    if (val && typeof val === 'object') {
      for (const [k, child] of Object.entries(val)) {
        extractUsernamesFromText(k);
        preScan(child, depth);
      }
    }
  };
  preScan(raw);

  const sourceTimeBase =
    typeof raw['timeBase'] === 'number' && Number.isFinite(raw['timeBase'])
      ? raw['timeBase']
      : (detectedMinTimestamp ?? targetTimeBase);

  // Sort workspace roots longest-first so deeper paths match before prefixes
  const sortedWorkspaceRoots = [...workspaceRoots].sort(
    (a, b) => b.length - a.length,
  );

  // Deterministic UUID v4 mapper (idempotent because k-th distinct UUID in traversal order -> formatFakeUuidV4(k))
  const uuidMap = new Map<string, string>();
  const mapUuid = (rawUuid: string): string => {
    const key = rawUuid.toLowerCase();
    const existing = uuidMap.get(key);
    if (existing) return existing;
    const mapped = formatFakeUuidV4(uuidMap.size + 1);
    uuidMap.set(key, mapped);
    return mapped;
  };

  const sanitizePathsInString = (input: string): string => {
    let text = input;

    // 1. Replace explicit workspace roots
    for (const root of sortedWorkspaceRoots) {
      const normalizedRoot = root.replace(/\\/g, '/');
      const escapedBackslashRoot = root.replace(/\\/g, '\\\\');
      for (const variant of [root, normalizedRoot, escapedBackslashRoot]) {
        if (variant && text.includes(variant)) {
          text = text.split(variant).join(SYNTHETIC_WORKSPACE_ROOT);
          replacedPathsCount++;
        }
      }
    }

    // 2. Replace tilde home paths (~/... or bare ~/)
    text = text.replace(
      /(^|[\s"'=:(,{>[])~\/([A-Za-z0-9._/-]*)/g,
      (_m, prefix: string, rest: string | undefined) => {
        replacedPathsCount++;
        const cleanRest = (rest ?? '').replace(/^\/+/, '');
        return cleanRest
          ? `${prefix}${SYNTHETIC_WORKSPACE_ROOT}/${cleanRest}`
          : `${prefix}${SYNTHETIC_WORKSPACE_ROOT}`;
      },
    );

    // 3. Replace Windows home paths C:\Users\<user>\<project?>\..., C:\\Users\\..., C:/Users/... or [A-Z]:\... / [A-Z]:/...
    text = text.replace(
      /\b[A-Z]:(?:\\+|\/)Users(?:\\+|\/)[^\\/\s"']+(?:(?:\\+|\/)[^\\/\s"']+)?(?:(?:\\+|\/)([^\s"'<>\]},)]*))?/gi,
      (_m, rest: string | undefined) => {
        replacedPathsCount++;
        const suffix = rest ? `/${rest.replace(/\\+/g, '/')}` : '';
        return `${SYNTHETIC_WORKSPACE_ROOT}${suffix}`;
      },
    );
    text = text.replace(
      /\b[A-Z]:(?:\\+|\/)([^\s"'<>\]},)]*)/g,
      (_m, rest: string | undefined) => {
        replacedPathsCount++;
        const cleanRest = (rest ?? '')
          .replace(/\\+/g, '/')
          .replace(/^Users\/[^/]+\/?/i, '')
          .replace(/^\/+/, '');
        return cleanRest
          ? `${SYNTHETIC_WORKSPACE_ROOT}/${cleanRest}`
          : SYNTHETIC_WORKSPACE_ROOT;
      },
    );

    // 4. Replace Linux/macOS home paths (/home/<user>/<repo?>/... or /Users/<user>/<repo?>/...)
    text = text.replace(
      /(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?(?:\/([A-Za-z0-9._/-]*))?/g,
      (_m, rest: string | undefined) => {
        replacedPathsCount++;
        const cleanRest = (rest ?? '').replace(/^\/+/, '');
        return cleanRest
          ? `${SYNTHETIC_WORKSPACE_ROOT}/${cleanRest}`
          : SYNTHETIC_WORKSPACE_ROOT;
      },
    );

    // 5. Replace /var/folders/... paths
    text = text.replace(/\/var\/folders\/[A-Za-z0-9._/-]*/g, (matched) => {
      replacedPathsCount++;
      const base = matched.split('/').filter(Boolean).pop() ?? '';
      return base && base !== 'folders'
        ? `${SYNTHETIC_WORKSPACE_ROOT}/${base}`
        : SYNTHETIC_WORKSPACE_ROOT;
    });

    // 6. Replace any remaining non-/workspace/acme-app absolute paths matched by privacy-scan
    text = text.replace(
      /(^|[\s"'=:(,{>[])(\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/g,
      (full, prefix: string, candidate: string) => {
        if (
          candidate === SYNTHETIC_WORKSPACE_ROOT ||
          candidate.startsWith(`${SYNTHETIC_WORKSPACE_ROOT}/`)
        ) {
          return full;
        }
        replacedPathsCount++;
        if (candidate === '/workspace') {
          return `${prefix}${SYNTHETIC_WORKSPACE_ROOT}`;
        }
        if (candidate.startsWith('/workspace/')) {
          const afterWorkspace = candidate
            .slice('/workspace/'.length)
            .replace(/^acme-app\/?/, '');
          return afterWorkspace
            ? `${prefix}${SYNTHETIC_WORKSPACE_ROOT}/${afterWorkspace}`
            : `${prefix}${SYNTHETIC_WORKSPACE_ROOT}`;
        }
        const stripped = candidate.replace(
          /^\/(?:var\/folders|tmp|var|opt|etc|private|srv|root|usr|mnt|proc)(?:\/|$)/,
          '',
        );
        const rel = stripped.replace(/^\/+/, '');
        return rel
          ? `${prefix}${SYNTHETIC_WORKSPACE_ROOT}/${rel}`
          : `${prefix}${SYNTHETIC_WORKSPACE_ROOT}`;
      },
    );

    return text;
  };

  const isFileAllowed = (rawFilePath: string | undefined): boolean => {
    if (!rawFilePath || allowFilesSet.size === 0) return false;
    const sanitizedPath = sanitizePathsInString(rawFilePath);
    const normalized = normalizeRelativeFilePath(sanitizedPath);
    return allowFilesSet.has(normalized);
  };

  // Pre-collect toolCallId -> filePath mappings across the scenario so tool_result can check allowFiles
  const toolCallFilePaths = new Map<string, string>();
  const collectToolStarts = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      item.forEach(collectToolStarts);
      return;
    }
    const obj = item as Record<string, unknown>;
    if (
      obj['eventType'] === 'tool_start' &&
      typeof obj['toolCallId'] === 'string' &&
      obj['toolInput'] &&
      typeof obj['toolInput'] === 'object'
    ) {
      const fp = extractFilePathFromObject(
        obj['toolInput'] as Record<string, unknown>,
      );
      if (fp) {
        toolCallFilePaths.set(obj['toolCallId'], fp);
      }
    }
    for (const child of Object.values(obj)) {
      collectToolStarts(child);
    }
  };
  collectToolStarts(raw);

  const sanitizeStringValue = (
    input: string,
    path = '$',
    context: {
      rpcMethod?: string;
      pushType?: string;
      allowFileContent?: boolean;
      depth?: number;
    } = {},
  ): string => {
    const depth = context.depth ?? 0;

    // Preserve exact ISO timestamps while shifting relative to targetTimeBase
    if (ISO_TIMESTAMP_EXACT_RE.test(input)) {
      const parsedMs = Date.parse(input);
      if (!Number.isNaN(parsedMs)) {
        const shift = Math.round(targetTimeBase - sourceTimeBase);
        if (shift === 0) {
          return input;
        }
        const shiftedMs = parsedMs + shift;
        normalizedTimestampsCount++;
        return new Date(shiftedMs).toISOString();
      }
    }

    // S2: If the string is a nested JSON object/array/string, parse, recursively sanitize, and re-serialize
    if (depth < MAX_DECODE_DEPTH) {
      const parsedJson = tryParseJsonStructure(input);
      if (parsedJson !== undefined) {
        const sanitizedNested = sanitizeValue(parsedJson, `${path}<json>`, {
          ...context,
          depth: depth + 1,
        });
        return JSON.stringify(sanitizedNested);
      }
    }

    let text = input;

    // S2: If URL-encoded segments decode to text with privacy findings, decode before scrubbing
    if (depth < MAX_DECODE_DEPTH && /%[0-9A-Fa-f]{2}/.test(text)) {
      const decodedUrl = safeDecodeURIComponent(text);
      if (decodedUrl !== text && scanScenarioPrivacy(decodedUrl).length > 0) {
        text = decodedUrl;
      }
    }

    // 1. Redact secrets via shared log-redaction helper + extended patterns + credential assignments
    const afterLogRedaction = redactSecrets(text);
    if (afterLogRedaction !== text) {
      redactedSecretsCount++;
      text = afterLogRedaction;
    }
    for (const pattern of EXTRA_SECRET_REPLACE_PATTERNS) {
      const next = text.replace(pattern, REDACTED);
      if (next !== text) {
        redactedSecretsCount++;
        text = next;
      }
    }
    text = text.replace(
      /(?<![A-Za-z0-9])((?:[A-Za-z0-9]+_)*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth)(?:_[A-Za-z0-9]+)*\b["']?\s*[=:]\s*)(?:"([^"]*)"|'([^']*)'|(<[^>]*>|\[[^\]]*\]|\$\{[^}]*\}|[^\s,;}\]]+))/gi,
      (full, prefix: string, dq?: string, sq?: string, bare?: string) => {
        const captured = dq ?? sq ?? bare ?? '';
        if (isPlaceholder(captured)) return full;
        redactedSecretsCount++;
        if (dq !== undefined) return `${prefix}"${REDACTED}"`;
        if (sq !== undefined) return `${prefix}'${REDACTED}'`;
        return `${prefix}${REDACTED}`;
      },
    );

    const afterBase64 = text.replace(LONG_BASE64_REPLACE_RE, REDACTED);
    if (afterBase64 !== text) {
      redactedSecretsCount++;
      text = afterBase64;
    }

    // S2: Redact base64 segments >= 40 chars that decode to printable text containing privacy findings
    text = text.replace(BASE64_SEGMENT_GLOBAL_RE, (segment) => {
      const decoded = tryDecodePrintableBase64(segment);
      if (decoded !== null && scanScenarioPrivacy(decoded).length > 0) {
        redactedSecretsCount++;
        return REDACTED;
      }
      return segment;
    });

    // 2. Sanitize URLs (strip URL credentials and rewrite non-ptah.live hosts)
    text = text.replace(URL_GLOBAL_RE, (rawUrl) => {
      const trailingMatch = rawUrl.match(/([).,;:!?]+)$/);
      const trailing = trailingMatch ? trailingMatch[1] : '';
      const coreUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
      try {
        const parsed = new URL(coreUrl);
        let changed = false;
        if (parsed.username || parsed.password) {
          parsed.username = '';
          parsed.password = '';
          redactedSecretsCount++;
          changed = true;
        }
        const host = parsed.hostname.toLowerCase();
        if (
          (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
          (host !== SYNTHETIC_HOST && !host.endsWith(`.${SYNTHETIC_HOST}`))
        ) {
          parsed.protocol = 'https:';
          parsed.hostname = SYNTHETIC_HOST;
          parsed.port = '';
          replacedPiiCount++;
          changed = true;
        }
        // Sanitize URL pathname if it contains paths
        if (parsed.pathname && parsed.pathname !== '/') {
          const decodedPath = safeDecodeURIComponent(parsed.pathname);
          if (HOME_TEST_RE.test(decodedPath)) {
            parsed.pathname = '/';
            replacedPathsCount++;
            changed = true;
          }
        }
        if (!changed) {
          return rawUrl;
        }
        const rebuilt = parsed
          .toString()
          .replace(/\/$/, coreUrl.endsWith('/') ? '/' : '');
        return `${rebuilt}${trailing}`;
      } catch {
        replacedPiiCount++;
        return `${SYNTHETIC_URL}${trailing}`;
      }
    });

    // 3. Sanitize workspace & home/absolute paths
    text = sanitizePathsInString(text);

    // 4. Replace emails
    text = text.replace(EMAIL_REPLACE_RE, (matchedEmail) => {
      if (matchedEmail === SYNTHETIC_EMAIL) {
        return matchedEmail;
      }
      replacedPiiCount++;
      return SYNTHETIC_EMAIL;
    });

    // 5. Replace IPv4 (respecting version context unless private IP or host context) and IPv6 addresses
    text = text.replace(
      IPV4_GLOBAL_RE,
      (matchedIp: string, offset: number, fullText: string) => {
        if (offset > 0 && /[\d.]/.test(fullText[offset - 1])) {
          return matchedIp;
        }
        const parts = matchedIp.split('.').map(Number);
        if (parts.some((part) => part > 255)) {
          return matchedIp;
        }
        const before = fullText.slice(0, offset);
        const hostContext =
          /(?:\/\/|\bhost(?:name)?\s*[:=]\s*)$/i.test(before) ||
          /(?:^|\.|\[)(?:host|hostname)(?:\]|$)/i.test(path);
        const versionContext =
          /(?:^|\.|\[)(?:version|semver)(?:\]|$)/i.test(path) ||
          /v$/i.test(before);
        if (isPrivateIpv4(parts) || hostContext || !versionContext) {
          replacedPiiCount++;
          return SYNTHETIC_HOST;
        }
        return matchedIp;
      },
    );
    text = text.replace(IPV6_REPLACE_RE, (_m, prefix: string) => {
      replacedPiiCount++;
      return `${prefix}${SYNTHETIC_HOST}`;
    });

    // 6. Replace non-allow-listed hostnames (public/internal suffixes or URL/@/// context)
    text = text.replace(
      HOSTNAME_ANY_GLOBAL_RE,
      (hostMatch: string, offset: number, fullText: string) => {
        const lower = hostMatch.toLowerCase();
        if (isAllowedHost(lower)) {
          return hostMatch;
        }
        const suffix = lower.slice(lower.lastIndexOf('.') + 1);
        const before = fullText.slice(0, offset);
        const explicitContext = /(?:\/\/|@)$/.test(before);
        if (
          !FILE_SUFFIXES.has(suffix) &&
          (PUBLIC_HOST_SUFFIXES.has(suffix) || explicitContext)
        ) {
          replacedPiiCount++;
          return SYNTHETIC_HOST;
        }
        return hostMatch;
      },
    );

    // 7. Replace known OS/workspace usernames when appearing as whole tokens
    for (const user of knownUsernames) {
      const re = new RegExp(`\\b${escapeRegExp(user)}\\b`, 'g');
      const next = text.replace(re, SYNTHETIC_USER);
      if (next !== text) {
        replacedPiiCount++;
        text = next;
      }
    }

    // 8. Remap all UUIDs consistently to deterministic fake UUID v4 values
    text = text.replace(UUID_ANY_GLOBAL_RE, (uuid) => mapUuid(uuid));

    return text;
  };

  const sanitizeNumberValue = (num: number): number => {
    if (num >= EPOCH_MS_MIN && num <= EPOCH_MS_MAX) {
      const offset = Math.max(
        0,
        Math.min(MAX_RELATIVE_TIME_OFFSET_MS, Math.round(num - sourceTimeBase)),
      );
      const normalized = targetTimeBase + offset;
      if (normalized !== num) {
        normalizedTimestampsCount++;
      }
      return normalized;
    }
    return num;
  };

  const isReplacableContentValue = (val: unknown): boolean =>
    typeof val === 'string' || (val !== null && typeof val === 'object');

  const sanitizeValue = (
    value: unknown,
    path: string,
    context: {
      rpcMethod?: string;
      pushType?: string;
      allowFileContent?: boolean;
      depth?: number;
    } = {},
  ): unknown => {
    if (value === null || value === undefined || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return sanitizeNumberValue(value);
    }
    if (typeof value === 'string') {
      return sanitizeStringValue(value, path, context);
    }
    if (Array.isArray(value)) {
      return value.map((item, idx) =>
        sanitizeValue(item, `${path}[${idx}]`, context),
      );
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};

      // Determine whether this object represents a tool event, file content, diff, or CLI output
      const eventType =
        typeof obj['eventType'] === 'string' ? obj['eventType'] : undefined;
      const toolCallId =
        typeof obj['toolCallId'] === 'string' ? obj['toolCallId'] : undefined;
      const objectFilePath =
        extractFilePathFromObject(obj) ??
        (toolCallId ? toolCallFilePaths.get(toolCallId) : undefined);
      const allowFileHere =
        context.allowFileContent === true || isFileAllowed(objectFilePath);

      let keyCollisionCounter = 1;
      for (const [rawKey, childValue] of Object.entries(obj)) {
        const sanitizedKeyCandidate = sanitizeStringValue(
          rawKey,
          `${path}.${rawKey} (key)`,
          context,
        );
        const sanitizedKeyPath = `${path}.${sanitizedKeyCandidate}`;

        if (
          SAFE_CREDENTIAL_FIELDS.has(rawKey) &&
          typeof childValue === 'boolean'
        ) {
          result[rawKey] = false;
          continue;
        }

        // Secret-shaped field name check (records sanitized key path without values)
        if (
          isSecretFieldName(rawKey) ||
          CREDENTIAL_FIELD_RE.test(rawKey) ||
          CAMEL_CREDENTIAL_FIELD_RE.test(rawKey) ||
          isSecretFieldName(sanitizedKeyCandidate) ||
          CREDENTIAL_FIELD_RE.test(sanitizedKeyCandidate) ||
          CAMEL_CREDENTIAL_FIELD_RE.test(sanitizedKeyCandidate)
        ) {
          redactedFields.push(sanitizedKeyPath);
          redactedSecretsCount++;
          continue;
        }

        const sanitizedKey =
          sanitizedKeyCandidate !== rawKey &&
          Object.prototype.hasOwnProperty.call(result, sanitizedKeyCandidate)
            ? `${sanitizedKeyCandidate}_${++keyCollisionCounter}`
            : sanitizedKeyCandidate;

        // Enforce UUID v4 on any tabId or sessionId field (preserving B1/B2's `$activeTabId` token on chat:chunk)
        if (
          TAB_OR_SESSION_ID_FIELD_RE.test(sanitizedKey) &&
          typeof childValue === 'string' &&
          childValue.trim().length > 0
        ) {
          const trimmedId = childValue.trim();
          if (sanitizedKey === 'tabId' && trimmedId === '$activeTabId') {
            result[sanitizedKey] = '$activeTabId';
            continue;
          }
          result[sanitizedKey] = UUID_V4_EXACT_RE.test(trimmedId)
            ? mapUuid(trimmedId)
            : mapUuid(`nonuuid:${sanitizedKey}:${trimmedId}`);
          continue;
        }

        // Fixed fixtures for username / email / host fields
        if (
          EMAIL_FIELD_NAMES.has(sanitizedKey) &&
          typeof childValue === 'string'
        ) {
          if (childValue !== SYNTHETIC_EMAIL) {
            replacedPiiCount++;
          }
          result[sanitizedKey] = SYNTHETIC_EMAIL;
          continue;
        }
        if (
          USERNAME_FIELD_NAMES.has(sanitizedKey) &&
          typeof childValue === 'string'
        ) {
          if (childValue !== SYNTHETIC_USER) {
            replacedPiiCount++;
          }
          result[sanitizedKey] = SYNTHETIC_USER;
          continue;
        }
        if (
          HOST_FIELD_NAMES.has(sanitizedKey) &&
          typeof childValue === 'string'
        ) {
          if (childValue !== SYNTHETIC_HOST) {
            replacedPiiCount++;
          }
          result[sanitizedKey] = SYNTHETIC_HOST;
          continue;
        }

        // S3: Tool result output replacement (strings, arrays like [{type:'text', text}], and objects unless file is allow-listed)
        if (
          eventType === 'tool_result' &&
          (sanitizedKey === 'output' ||
            sanitizedKey === 'result' ||
            sanitizedKey === 'content' ||
            sanitizedKey === 'stdout' ||
            sanitizedKey === 'stderr') &&
          isReplacableContentValue(childValue) &&
          !allowFileHere
        ) {
          if (childValue !== PLACEHOLDER_TOOL_OUTPUT) {
            redactedPayloadsCount++;
          }
          result[sanitizedKey] = PLACEHOLDER_TOOL_OUTPUT;
          continue;
        }

        // Tool start input content/diff replacement for non-allow-listed files
        if (
          eventType === 'tool_start' &&
          sanitizedKey === 'toolInput' &&
          childValue &&
          typeof childValue === 'object' &&
          !Array.isArray(childValue)
        ) {
          const inputObj = childValue as Record<string, unknown>;
          const inputFile =
            extractFilePathFromObject(inputObj) ?? objectFilePath;
          const allowInputFile = isFileAllowed(inputFile);
          const sanitizedInput = sanitizeValue(inputObj, sanitizedKeyPath, {
            ...context,
            allowFileContent: allowInputFile,
          }) as Record<string, unknown>;
          if (!allowInputFile) {
            for (const contentKey of [
              'content',
              'new_string',
              'old_string',
              'diff',
              'patch',
            ]) {
              if (isReplacableContentValue(sanitizedInput[contentKey])) {
                if (sanitizedInput[contentKey] !== PLACEHOLDER_FILE_CONTENT) {
                  redactedPayloadsCount++;
                }
                sanitizedInput[contentKey] = PLACEHOLDER_FILE_CONTENT;
              }
            }
          }
          result[sanitizedKey] = sanitizedInput;
          continue;
        }

        // S3: CLI output replacement (strings, arrays, and objects unless allow-listed)
        if (
          (context.pushType === 'agent-monitor:output' ||
            context.rpcMethod === 'session:cli-output-page') &&
          (sanitizedKey === 'data' ||
            sanitizedKey === 'output' ||
            sanitizedKey === 'delta' ||
            sanitizedKey === 'text' ||
            sanitizedKey === 'chunk' ||
            sanitizedKey === 'stdout' ||
            sanitizedKey === 'stderr' ||
            sanitizedKey === 'content' ||
            sanitizedKey === 'lines' ||
            sanitizedKey === 'entries') &&
          isReplacableContentValue(childValue) &&
          !allowFileHere
        ) {
          if (childValue !== PLACEHOLDER_CLI_OUTPUT) {
            redactedPayloadsCount++;
          }
          result[sanitizedKey] = PLACEHOLDER_CLI_OUTPUT;
          continue;
        }

        // Diff / patch fields replacement
        if (
          DIFF_FIELD_NAMES.has(sanitizedKey) &&
          isReplacableContentValue(childValue) &&
          !allowFileHere
        ) {
          if (childValue !== PLACEHOLDER_DIFF) {
            redactedPayloadsCount++;
          }
          result[sanitizedKey] = PLACEHOLDER_DIFF;
          continue;
        }

        // File content fields replacement
        if (
          (FILE_CONTENT_FIELD_NAMES.has(sanitizedKey) ||
            (FILE_CONTENT_RPC_METHODS.has(context.rpcMethod ?? '') &&
              (sanitizedKey === 'content' || sanitizedKey === 'contents'))) &&
          isReplacableContentValue(childValue) &&
          !allowFileHere
        ) {
          if (childValue !== PLACEHOLDER_FILE_CONTENT) {
            redactedPayloadsCount++;
          }
          result[sanitizedKey] = PLACEHOLDER_FILE_CONTENT;
          continue;
        }

        result[sanitizedKey] = sanitizeValue(childValue, sanitizedKeyPath, {
          ...context,
          allowFileContent: allowFileHere,
        });
      }

      return result;
    }
    return undefined;
  };

  // Sanitize RPC map
  const sanitizedRpc: Record<string, unknown> = {};
  for (const [method, data] of Object.entries(rawRpc)) {
    if (!allowedRpc.has(method)) {
      if (strict) {
        throw new Error(
          `Disallowed or unknown RPC method in scenario: ${method}`,
        );
      }
      droppedRpcMethods.push(method);
      continue;
    }
    sanitizedRpc[method] = sanitizeValue(data, `$.rpc.${method}`, {
      rpcMethod: method,
    });
  }

  // Normalize canonical RPC shapes when present
  if ('workspace:getInfo' in sanitizedRpc) {
    sanitizedRpc['workspace:getInfo'] = {
      folders: [SYNTHETIC_WORKSPACE_ROOT],
      root: SYNTHETIC_WORKSPACE_ROOT,
      activeFolder: SYNTHETIC_WORKSPACE_ROOT,
      name: SYNTHETIC_WORKSPACE_NAME,
    };
  }
  if ('attention:getSnapshot' in sanitizedRpc) {
    const snap = sanitizedRpc['attention:getSnapshot'];
    if (
      !snap ||
      typeof snap !== 'object' ||
      !Array.isArray((snap as { notices?: unknown }).notices)
    ) {
      sanitizedRpc['attention:getSnapshot'] = { notices: [] };
    }
  }
  if ('provider:getPlanLimits' in sanitizedRpc) {
    const limits = sanitizedRpc['provider:getPlanLimits'];
    if (
      !limits ||
      typeof limits !== 'object' ||
      !Array.isArray((limits as { owners?: unknown }).owners) ||
      typeof (limits as { sessionOwners?: unknown }).sessionOwners !== 'object'
    ) {
      sanitizedRpc['provider:getPlanLimits'] = {
        generatedAt: targetTimeBase,
        owners: [],
        sessionOwners: {},
      };
    }
  }

  // Sanitize rpcCases
  const rawRpcCases =
    raw['rpcCases'] &&
    typeof raw['rpcCases'] === 'object' &&
    !Array.isArray(raw['rpcCases'])
      ? (raw['rpcCases'] as Record<string, unknown>)
      : {};
  const sanitizedRpcCases: Record<
    string,
    Array<{ readonly match: Record<string, unknown>; readonly data: unknown }>
  > = {};
  for (const [method, casesValue] of Object.entries(rawRpcCases)) {
    if (!allowedRpc.has(method)) {
      if (strict) {
        throw new Error(
          `Disallowed or unknown RPC method in rpcCases: ${method}`,
        );
      }
      if (!droppedRpcMethods.includes(method)) {
        droppedRpcMethods.push(method);
      }
      continue;
    }
    if (!Array.isArray(casesValue)) continue;
    const sanitizedCases = casesValue
      .filter((c) => c && typeof c === 'object')
      .map((c, idx) => {
        const entry = c as { match?: unknown; data?: unknown };
        const rawMatch =
          entry.match &&
          typeof entry.match === 'object' &&
          !Array.isArray(entry.match)
            ? (entry.match as Record<string, unknown>)
            : {};
        const matchFile = extractFilePathFromObject(rawMatch);
        const allowFile = isFileAllowed(matchFile);
        return {
          match: sanitizeValue(rawMatch, `$.rpcCases.${method}[${idx}].match`, {
            rpcMethod: method,
            allowFileContent: allowFile,
          }) as Record<string, unknown>,
          data: sanitizeValue(
            entry.data ?? null,
            `$.rpcCases.${method}[${idx}].data`,
            { rpcMethod: method, allowFileContent: allowFile },
          ),
        };
      });
    if (sanitizedCases.length > 0) {
      sanitizedRpcCases[method] = sanitizedCases;
    }
  }

  // Sanitize rpcErrors
  const rawRpcErrors =
    raw['rpcErrors'] &&
    typeof raw['rpcErrors'] === 'object' &&
    !Array.isArray(raw['rpcErrors'])
      ? (raw['rpcErrors'] as Record<string, unknown>)
      : {};
  const sanitizedRpcErrors: Record<
    string,
    { readonly error: string; readonly errorCode?: string }
  > = {};
  for (const [method, errValue] of Object.entries(rawRpcErrors)) {
    if (!allowedRpc.has(method)) {
      if (strict) {
        throw new Error(
          `Disallowed or unknown RPC method in rpcErrors: ${method}`,
        );
      }
      if (!droppedRpcMethods.includes(method)) {
        droppedRpcMethods.push(method);
      }
      continue;
    }
    if (!errValue || typeof errValue !== 'object') continue;
    const errObj = errValue as { error?: unknown; errorCode?: unknown };
    const errorText =
      typeof errObj.error === 'string' && errObj.error.length > 0
        ? sanitizeStringValue(errObj.error, `$.rpcErrors.${method}.error`)
        : 'Operation unavailable in demo replay';
    const errorCode =
      typeof errObj.errorCode === 'string' && errObj.errorCode.length > 0
        ? sanitizeStringValue(
            errObj.errorCode,
            `$.rpcErrors.${method}.errorCode`,
          )
        : undefined;
    sanitizedRpcErrors[method] = {
      error: errorText,
      ...(errorCode ? { errorCode } : {}),
    };
  }

  // Sanitize timeline
  const rawTimeline = Array.isArray(raw['timeline']) ? raw['timeline'] : [];
  const sanitizedTimeline: Array<{
    readonly at: number;
    readonly message: {
      readonly type: string;
      readonly payload?: unknown;
      readonly [key: string]: unknown;
    };
  }> = [];

  const sanitizePushMessage = (
    msgObj: Record<string, unknown>,
    path: string,
  ): {
    readonly type: string;
    readonly payload?: unknown;
    readonly [key: string]: unknown;
  } | null => {
    const type = msgObj['type'];
    if (typeof type !== 'string' || type.length === 0) {
      return null;
    }
    if (
      type === 'rpc:response' ||
      type === 'rpc:call' ||
      !allowedPush.has(type)
    ) {
      if (strict) {
        throw new Error(`Disallowed or unknown push type in timeline: ${type}`);
      }
      droppedPushTypes.push(type);
      return null;
    }

    if (type === 'batch') {
      const payload =
        msgObj['payload'] && typeof msgObj['payload'] === 'object'
          ? (msgObj['payload'] as Record<string, unknown>)
          : {};
      const rawEvents = Array.isArray(payload['events'])
        ? payload['events']
        : [];
      const sanitizedEvents: Array<Record<string, unknown>> = [];
      rawEvents.forEach((ev, evIdx) => {
        if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return;
        const inner = sanitizePushMessage(
          ev as Record<string, unknown>,
          `${path}.payload.events[${evIdx}]`,
        );
        if (inner) {
          sanitizedEvents.push(inner);
        }
      });
      if (sanitizedEvents.length === 0) {
        return null;
      }
      return {
        type: 'batch',
        payload: {
          events: sanitizedEvents,
        },
      };
    }

    const sanitizedMsg = sanitizeValue(msgObj, path, {
      pushType: type,
    }) as Record<string, unknown>;
    return {
      ...sanitizedMsg,
      type,
    };
  };

  // Sanitize optional bootMessages
  const rawBootMessages = Array.isArray(raw['bootMessages'])
    ? raw['bootMessages']
    : undefined;
  const sanitizedBootMessages: Array<{
    readonly type: string;
    readonly payload?: unknown;
    readonly [key: string]: unknown;
  }> = [];
  if (rawBootMessages) {
    rawBootMessages.forEach((msg, idx) => {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      const sanitizedMsg = sanitizePushMessage(
        msg as Record<string, unknown>,
        `$.bootMessages[${idx}]`,
      );
      if (sanitizedMsg) {
        sanitizedBootMessages.push(sanitizedMsg);
      }
    });
  }

  let lastAt = 0;
  rawTimeline.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    const rec = entry as { at?: unknown; t?: unknown; message?: unknown };
    const rawAt =
      typeof rec.at === 'number' && Number.isFinite(rec.at)
        ? rec.at
        : typeof rec.t === 'number' && Number.isFinite(rec.t)
          ? rec.t
          : 0;
    const at = Math.max(lastAt, Math.max(0, Math.round(rawAt)));
    if (
      !rec.message ||
      typeof rec.message !== 'object' ||
      Array.isArray(rec.message)
    ) {
      return;
    }
    const sanitizedMessage = sanitizePushMessage(
      rec.message as Record<string, unknown>,
      `$.timeline[${idx}].message`,
    );
    if (!sanitizedMessage) return;
    lastAt = at;
    sanitizedTimeline.push({
      at,
      message: sanitizedMessage,
    });
  });

  const initialView: 'chat' | 'command-center' =
    options.initialView ??
    (rawConfig?.['initialView'] === 'command-center'
      ? 'command-center'
      : 'chat');

  // Keep the playback start mode (on-send scenarios break without it)
  const rawStart = raw['start'];
  let start: SanitizedScenario['start'];
  if (rawStart && typeof rawStart === 'object' && !Array.isArray(rawStart)) {
    const startRec = rawStart as Record<string, unknown>;
    if (startRec['mode'] === 'auto') {
      start = { mode: 'auto' };
    } else if (
      startRec['mode'] === 'on-send' &&
      typeof startRec['prompt'] === 'string'
    ) {
      start = {
        mode: 'on-send',
        prompt: sanitizeStringValue(startRec['prompt'], '$.start.prompt'),
      };
    } else {
      throw new Error(
        'Scenario start must be { mode: "auto" } or { mode: "on-send", prompt }',
      );
    }
  }

  const scenario: SanitizedScenario = {
    id: rawId,
    title: sanitizeStringValue(rawTitle, '$.title'),
    timeBase: targetTimeBase,
    config: {
      initialView,
      workspaceRoot: SYNTHETIC_WORKSPACE_ROOT,
      workspaceName: SYNTHETIC_WORKSPACE_NAME,
    },
    rpc: sanitizedRpc,
    ...(Object.keys(sanitizedRpcCases).length > 0
      ? { rpcCases: sanitizedRpcCases }
      : {}),
    ...(Object.keys(sanitizedRpcErrors).length > 0
      ? { rpcErrors: sanitizedRpcErrors }
      : {}),
    ...(rawBootMessages ? { bootMessages: sanitizedBootMessages } : {}),
    timeline: sanitizedTimeline,
    ...(start ? { start } : {}),
  };

  // Final fail-closed privacy scan (prints sanitized key paths only, never values)
  const privacyFindings = scanScenarioPrivacy(scenario);
  if (privacyFindings.length > 0) {
    const summary = privacyFindings
      .map((f) => `${sanitizeStringValue(f.path, f.path)} (${f.kind})`)
      .join(', ');
    throw new Error(`Sanitized scenario failed final privacy scan: ${summary}`);
  }

  return {
    scenario,
    report: {
      droppedRpcMethods,
      droppedPushTypes,
      redactedFields,
      redactedSecretsCount,
      replacedPathsCount,
      replacedPiiCount,
      redactedPayloadsCount,
      remappedUuidsCount: uuidMap.size,
      normalizedTimestampsCount,
    },
  };
}

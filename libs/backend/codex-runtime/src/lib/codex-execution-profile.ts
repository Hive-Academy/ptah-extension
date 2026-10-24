import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { z } from 'zod';
import type {
  CodexExecutionProfile,
  CodexJsonValue,
} from './codex-runtime.types';

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0 && !value.includes('\0'));
const references = z.record(text, text);
const settings = z.strictObject({
  contextId: text,
  consumer: z.enum(['chat', 'gateway', 'lane', 'usage']),
  normalizedHome: text,
  accountId: text.optional(),
  providerId: text,
  workspaceId: text,
  cwd: text,
  model: text,
  effort: text.optional(),
  permissionLevel: z.enum(['ask', 'plan', 'auto-edit', 'yolo']),
  enhancedPrompt: z.string().optional(),
  systemPrompt: z.string().optional(),
  developerPrompt: z.string().optional(),
  outputStyle: z.string().optional(),
  instructionSources: z
    .array(
      z.strictObject({
        kind: z.enum(['skill', 'file', 'inline']),
        name: text,
        content: z.string(),
      }),
    )
    .default([]),
  mcpServers: z
    .array(
      z.discriminatedUnion('transport', [
        z.strictObject({
          name: text,
          transport: z.literal('stdio'),
          command: text,
          args: z.array(z.string()),
          envReferences: references,
        }),
        z.strictObject({
          name: text,
          transport: z.enum(['http', 'sse']),
          url: z.url().refine((value) => {
            const url = new URL(value);
            return (
              ['http:', 'https:'].includes(url.protocol) &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash
            );
          }),
          headerReferences: references,
          authReference: text.optional(),
        }),
      ]),
    )
    .default([]),
  attachments: z
    .array(
      z.discriminatedUnion('type', [
        z.strictObject({
          type: z.literal('image'),
          data: text,
          mediaType: text,
        }),
        z.strictObject({ type: z.literal('file'), path: text }),
      ]),
    )
    .default([]),
  lane: z
    .strictObject({
      suppressedTools: z.array(text),
      maxTurns: z.number().int().positive().optional(),
      maxBudgetUsd: z.number().finite().nonnegative().optional(),
      explicitFullAccess: z.boolean(),
    })
    .optional(),
});
const pathSnapshot = z.strictObject({
  platform: z.enum(['win32', 'posix']),
  baseDirectory: text,
  entries: z.record(
    text,
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.enum(['directory', 'file']), realpath: text }),
      z.strictObject({ kind: z.literal('missing') }),
    ]),
  ),
});

export type CodexProfileSettings = z.input<typeof settings>;
export interface CodexExecutionProfileInput {
  readonly session: Readonly<Partial<CodexProfileSettings>>;
  readonly resolved?: Readonly<Partial<CodexProfileSettings>>;
  readonly defaults?: Readonly<Partial<CodexProfileSettings>>;
  readonly capturedCodexHome?: string;
  readonly defaultHome?: string;
  /** Captured by the caller: existing paths use realpath; missing paths resolve lexically.
   * Every used path must have an entry, so unobserved aliases cannot silently pass.
   */
  readonly paths: z.input<typeof pathSnapshot>;
  readonly resume?: CodexExecutionProfile;
}

export interface BuiltCodexExecutionProfile extends CodexExecutionProfile {
  readonly approvalsReviewer: 'user';
  readonly fullAccessStatus: 'unproved-disabled';
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  // Zod details can contain caller data. Never expose prompts, credentials or paths.
  if (!result.success) throw new Error('Invalid Codex execution profile input');
  return result.data;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonical(value: CodexJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Pure snapshot builder: no filesystem, environment, auth, process or routing access. */
export function buildCodexExecutionProfile(
  input: CodexExecutionProfileInput,
): BuiltCodexExecutionProfile {
  const paths = parse(pathSnapshot, input.paths);
  const path = paths.platform === 'win32' ? win32 : posix;
  if (!path.isAbsolute(paths.baseDirectory))
    throw new Error('Absolute path base required');
  const normalize = (value: string, directory = false): string => {
    if (
      value.startsWith('~') ||
      /\$|%[^%]+%/.test(value) ||
      (paths.platform === 'win32' &&
        (/^[a-z]:[^\\/]/i.test(value) || /^[\\/](?![\\/])/.test(value)))
    ) {
      throw new Error('Unresolved path alias');
    }
    const resolved = path.resolve(paths.baseDirectory, value);
    const entry = paths.entries[resolved];
    if (!entry || (directory && entry.kind !== 'directory'))
      throw new Error('Unverified or invalid profile path');
    if (entry.kind === 'missing') return resolved;
    if (!path.isAbsolute(entry.realpath))
      throw new Error('Absolute realpath required');
    return path.normalize(entry.realpath);
  };
  // Undefined means absent, while empty strings/arrays remain explicit overrides.
  const merge = (layer: unknown) => {
    const source = parse(z.record(z.string(), z.unknown()), layer ?? {});
    return Object.fromEntries(
      Object.entries(parse(settings.partial(), source)).filter(
        ([key, value]) => Object.hasOwn(source, key) && value !== undefined,
      ),
    );
  };
  const merged = {
    ...merge(input.defaults),
    ...merge(input.resolved),
    ...merge(input.session),
  };
  const selected = parse(settings, {
    ...merged,
    normalizedHome:
      merged['normalizedHome'] ?? input.capturedCodexHome ?? input.defaultHome,
  });
  if (selected.lane && selected.consumer !== 'lane')
    throw new Error('Lane settings require a lane consumer');
  if (selected.lane?.explicitFullAccess)
    throw new Error('Explicit lane full access remains unproved and disabled');
  const names = selected.mcpServers.map((server) => server.name);
  if (new Set(names).size !== names.length)
    throw new Error('Duplicate MCP server names');
  const cwd = normalize(selected.cwd, true);
  const normalizedHome = normalize(selected.normalizedHome);
  if (input.resume) {
    for (const key of [
      'contextId',
      'consumer',
      'accountId',
      'providerId',
      'workspaceId',
    ] as const) {
      if (selected[key] !== input.resume[key])
        throw new Error('Resume identity cannot change');
    }
    if (
      cwd !== input.resume.cwd ||
      normalizedHome !== input.resume.normalizedHome
    )
      throw new Error('Resume paths cannot change');
  }
  const writable =
    selected.permissionLevel === 'auto-edit' ||
    selected.permissionLevel === 'yolo';
  const profile: Omit<BuiltCodexExecutionProfile, 'profileFingerprint'> = {
    ...selected,
    normalizedHome,
    cwd,
    attachments: selected.attachments.map((attachment) =>
      attachment.type === 'file'
        ? { ...attachment, path: normalize(attachment.path) }
        : attachment,
    ),
    // Matches evidence-harness policy() (6e-6j); Ptah-side YOLO approvals live in 2f.
    approvalPolicy:
      selected.permissionLevel === 'ask'
        ? {
            granular: {
              sandbox_approval: true,
              rules: true,
              skill_approval: true,
              request_permissions: true,
              mcp_elicitations: true,
            },
          }
        : 'on-request',
    sandboxPolicy: {
      mode: writable ? 'workspace-write' : 'read-only',
      networkAccess: false,
      writableRoots: writable ? [cwd] : [],
    },
    experimentalApi: selected.permissionLevel === 'ask',
    approvalsReviewer: 'user',
    fullAccessStatus: 'unproved-disabled',
  };
  // Only validated configuration and opaque auth references enter this digest. No
  // secret resolver is available here. JSON parsing removes absent optional fields.
  const fingerprint = createHash('sha256')
    .update(canonical(parse(z.json(), JSON.parse(JSON.stringify(profile)))))
    .digest('hex');
  return freeze({ ...profile, profileFingerprint: `sha256:${fingerprint}` });
}

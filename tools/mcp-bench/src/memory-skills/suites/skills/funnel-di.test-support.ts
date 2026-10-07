/**
 * Spec support for the funnel suites: the production skill-synthesis
 * registration (`registerSkillSynthesisServices`) in a child container over a
 * real migrated SQLite file, the real agent-sdk callback registries and JSONL
 * reader, and `LANE_RUNNER_SERVICE` bound to the record/replay double over a
 * cassette in the spec's temp dir.
 *
 * The cassette is synthetic, never live: in record mode the double wraps
 * {@link SyntheticLane}, which answers every lane call with a value built from
 * the request's own JSON schema. No model is called.
 *
 * Specs that use this must mock `os.homedir()` (the JSONL reader and the
 * curator report resolve `~` through it) before importing it.
 */

import 'reflect-metadata';

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  JsonlReaderService,
  PostToolUseCallbackRegistry,
  SDK_TOKENS,
  SessionActivityRegistry,
  SessionEndCallbackRegistry,
  SessionIdResolvedCallbackRegistry,
  StopCallbackRegistry,
  SubagentStopCallbackRegistry,
  UserPromptExpansionCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  type SqliteDatabaseFactory,
} from '@ptah-extension/persistence-sqlite';
import { CliFileSystemProvider } from '@ptah-extension/platform-cli';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SKILL_LANE_DEFAULTS,
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  registerSkillSynthesisServices,
  type LaneRunRequest,
  type LaneRunResult,
} from '@ptah-extension/skill-synthesis';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';

import { CassetteStore, type CassetteMode } from '../../doubles/cassette-store';
import {
  RecordedLaneRunner,
  type LaneRunnerDouble,
} from '../../doubles/recorded-lane-runner';

type JsonSchema = Record<string, unknown>;

function asSchema(value: unknown): JsonSchema | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchema)
    : null;
}

function typesOf(schema: JsonSchema): string[] {
  const type = schema['type'];
  return Array.isArray(type)
    ? type.filter((t): t is string => typeof t === 'string')
    : typeof type === 'string'
      ? [type]
      : [];
}

/**
 * A value that satisfies `schema`, deterministic in `seed`. Numbers take the
 * upper bound or 8 (a passing judge score); nullable fields are `null` unless
 * `fill(name)` asks for a value; arrays hold one item; strings name their key.
 */
export function valueFor(
  schema: JsonSchema,
  name: string,
  seed: string,
  fill: (name: string) => boolean,
): unknown {
  const types = typesOf(schema);
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  if (types.includes('null') && !fill(name)) return null;
  const type = types.find((t) => t !== 'null') ?? 'string';
  switch (type) {
    case 'object': {
      const properties = asSchema(schema['properties']) ?? {};
      const required = Array.isArray(schema['required'])
        ? (schema['required'] as string[])
        : Object.keys(properties);
      const out: Record<string, unknown> = {};
      for (const key of required) {
        const child = asSchema(properties[key]) ?? {};
        out[key] = valueFor(child, key, seed, fill);
      }
      return out;
    }
    case 'array': {
      const items = asSchema(schema['items']) ?? { type: 'string' };
      return [valueFor(items, name, seed, fill)];
    }
    case 'number':
    case 'integer': {
      const maximum = schema['maximum'];
      const minimum = schema['minimum'];
      if (typeof maximum === 'number') return Math.min(maximum, 8);
      if (typeof minimum === 'number') return minimum;
      return 8;
    }
    case 'boolean':
      return true;
    default:
      return name === 'name'
        ? `synthetic-skill-${seed.slice(0, 10)}`
        : `Synthetic ${name}: use when running the routine.`;
  }
}

/**
 * The synthetic inner lane: `ok` with a schema-shaped `json`. `routineWhen`
 * decides, per prompt, whether a nullable `routine` is filled in.
 */
export class SyntheticLane implements LaneRunnerDouble {
  readonly calls: LaneRunRequest[] = [];

  constructor(
    private readonly routineWhen: (prompt: string) => boolean = (prompt) =>
      /repetition \d/.test(prompt),
  ) {}

  async run(req: LaneRunRequest): Promise<LaneRunResult> {
    this.calls.push(req);
    const seed = createHash('sha256').update(req.prompt).digest('hex');
    const schema = asSchema(req.outputSchema);
    const json =
      schema === null
        ? null
        : valueFor(schema, 'root', seed, (name) =>
            name === 'routine' ? this.routineWhen(req.prompt) : false,
          );
    return {
      status: 'ok',
      run: {
        lane: {
          config: SKILL_LANE_DEFAULTS[req.laneId],
          auth: undefined,
          model: 'synthetic-model',
        },
        text: json === null ? 'synthetic answer' : JSON.stringify(json),
        json,
        structuredOutputHonoured: true,
        usage: { inputTokens: 10, outputTokens: 10 },
        truncated: false,
        degradedReason: null,
        executions: 1,
        passesAllowed: 1,
      },
    };
  }
}

export interface FunnelSpecContainer {
  readonly container: DependencyContainer;
  readonly laneRunner: RecordedLaneRunner;
  readonly connection: SqliteConnectionService;
  readonly settings: Map<string, unknown>;
  dispose(): void;
}

/** A logger that records nothing. */
export function quietLogger(): Logger {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  } as unknown as Logger;
}

function workspaceOver(
  root: string,
  settings: Map<string, unknown>,
): IWorkspaceProvider {
  const disposable = { dispose: () => undefined };
  return {
    getWorkspaceFolders: () => [root],
    getWorkspaceRoot: () => root,
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      (settings.has(key) ? settings.get(key) : fallback) as T | undefined,
    setConfiguration: async (_section: string, key: string, value: unknown) => {
      settings.set(key, value);
    },
    onDidChangeConfiguration: () => disposable,
    onDidChangeWorkspaceFolders: () => disposable,
  } as unknown as IWorkspaceProvider;
}

/**
 * Production DI over `<root>/skills.sqlite`, skills under `<root>/skills`, the
 * lane double over `cassettePath` (record ⇒ wraps `inner`).
 */
export function funnelSpecContainer(input: {
  readonly root: string;
  readonly cassettePath: string;
  readonly mode: CassetteMode;
  readonly inner?: LaneRunnerDouble;
}): FunnelSpecContainer {
  mkdirSync(input.root, { recursive: true });
  const workspaceRoot = join(input.root, 'host-workspace');
  mkdirSync(workspaceRoot, { recursive: true });
  const settings = new Map<string, unknown>([
    ['skillSynthesis.skillsRoot', join(input.root, 'skills')],
    ['skillSynthesis.candidatesDir', join(input.root, 'skills', '_candidates')],
  ]);
  const logger = quietLogger();
  const child = rootContainer.createChildContainer();
  child.register<Logger>(TOKENS.LOGGER, { useValue: logger });
  child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
    useValue: join(input.root, 'skills.sqlite'),
  });
  child.registerSingleton(SqliteConnectionService);
  child.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
    useToken: SqliteConnectionService,
  });
  child.register(PERSISTENCE_TOKENS.VEC_STATUS, {
    useValue: { available: false },
  });
  child.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: workspaceOver(workspaceRoot, settings),
  });
  child.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: new CliFileSystemProvider(),
  });
  const registries: Array<[symbol, new (logger: Logger) => unknown]> = [
    [SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY, SessionEndCallbackRegistry],
    [SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY, SessionActivityRegistry],
    [
      SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
      PostToolUseCallbackRegistry,
    ],
    [
      SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
      SubagentStopCallbackRegistry,
    ],
    [
      SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY,
      UserPromptExpansionCallbackRegistry,
    ],
    [SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY, StopCallbackRegistry],
    [
      SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
      SessionIdResolvedCallbackRegistry,
    ],
  ];
  for (const [token, Registry] of registries) {
    child.register(token, { useValue: new Registry(logger) });
  }
  child.register(SDK_TOKENS.SDK_JSONL_READER, {
    useValue: new JsonlReaderService(logger),
  });
  child.register(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT, {
    useValue: {
      tryAcquire: () => ({ allowed: true }),
      refund: () => undefined,
      snapshot: () => null,
    },
  });
  child.register(USER_LAYER_MIRROR_SERVICE_TOKEN, {
    useValue: { mirrorAll: async () => undefined },
  });

  const connection = child.resolve(SqliteConnectionService);
  const Database = require('better-sqlite3') as new (file: string) => unknown;
  const factory = ((file: string) =>
    new Database(file)) as unknown as SqliteDatabaseFactory;
  connection.configure({
    factory,
    vecPathResolver: null,
    vecPathPlatformResolver: null,
    vecPathFallbackResolver: null,
  });
  registerSkillSynthesisServices(child, logger);
  const laneRunner = new RecordedLaneRunner({
    store: new CassetteStore({ path: input.cassettePath, mode: input.mode }),
    model: 'synthetic-model',
    inner: input.mode === 'record' ? input.inner : undefined,
  });
  child.register(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE, {
    useValue: laneRunner,
  });
  return {
    container: child,
    laneRunner,
    connection,
    settings,
    dispose: () => {
      try {
        connection.close();
      } finally {
        child.reset();
      }
    },
  };
}

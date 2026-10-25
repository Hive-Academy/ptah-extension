import { z } from 'zod';

export const string = z.string();
export const integer = z.number().int();
export const json = z.json();
export const object = z.record(string, json);
export const empty = z.strictObject({});
export const threadId = { threadId: string };
export const turnIds = { ...threadId, turnId: string };
export const itemIds = { ...turnIds, itemId: string };
export const approvalIds = { ...itemIds, startedAtMs: integer };
export const decision = z.enum([
  'accept',
  'acceptForSession',
  'decline',
  'cancel',
]);
export const approvalPolicy = z.union([
  z.enum(['untrusted', 'on-request', 'never']),
  z.strictObject({
    granular: z.strictObject({
      mcp_elicitations: z.boolean(),
      rules: z.boolean(),
      sandbox_approval: z.boolean(),
      request_permissions: z.boolean().optional(),
      skill_approval: z.boolean().optional(),
    }),
  }),
]);
export const reviewer = z.enum(['user', 'auto_review', 'guardian_subagent']);
export const sandbox = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('dangerFullAccess') }),
  z.strictObject({
    type: z.literal('readOnly'),
    networkAccess: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('externalSandbox'),
    networkAccess: z.enum(['enabled', 'restricted']).optional(),
  }),
  z.strictObject({
    type: z.literal('workspaceWrite'),
    networkAccess: z.boolean().optional(),
    writableRoots: z.array(string).optional(),
    excludeSlashTmp: z.boolean().optional(),
    excludeTmpdirEnvVar: z.boolean().optional(),
  }),
]);
const textElement = z.strictObject({
  byteRange: z.strictObject({
    start: integer.nonnegative(),
    end: integer.nonnegative(),
  }),
  placeholder: string.nullish(),
});
export const input = z.array(
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('text'),
      text: string,
      text_elements: z.array(textElement).optional(),
    }),
    z.strictObject({
      type: z.literal('image'),
      url: string,
      detail: z.enum(['auto', 'low', 'high', 'original']).nullish(),
    }),
    z.strictObject({
      type: z.literal('localImage'),
      path: string,
      detail: z.enum(['auto', 'low', 'high', 'original']).nullish(),
    }),
    z.strictObject({ type: z.literal('audio'), url: string }),
    z.strictObject({ type: z.literal('localAudio'), path: string }),
    z.strictObject({ type: z.literal('skill'), name: string, path: string }),
    z.strictObject({ type: z.literal('mention'), name: string, path: string }),
  ]),
);
export const commandAction = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('read'),
    command: string,
    name: string,
    path: string,
  }),
  z.strictObject({
    type: z.literal('listFiles'),
    command: string,
    path: string.nullish(),
  }),
  z.strictObject({
    type: z.literal('search'),
    command: string,
    path: string.nullish(),
    query: string.nullish(),
  }),
  z.strictObject({ type: z.literal('unknown'), command: string }),
]);
const itemStatus = z.enum(['inProgress', 'completed', 'failed', 'declined']);
export const functionOutput = z.union([
  string,
  z.array(
    z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('input_text'), text: string }),
      z.strictObject({
        type: z.literal('input_image'),
        image_url: string,
        detail: z.enum(['auto', 'low', 'high', 'original']).nullish(),
      }),
      z.strictObject({ type: z.literal('input_audio'), audio_url: string }),
      z.strictObject({
        type: z.literal('encrypted_content'),
        encrypted_content: string,
      }),
    ]),
  ),
]);
export const item = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('userMessage'),
    id: string,
    content: input,
    clientId: string.nullish(),
  }),
  z.strictObject({
    type: z.literal('agentMessage'),
    id: string,
    text: string,
    phase: z.enum(['commentary', 'final_answer']).nullish(),
    delivery: z.literal('async').nullish(),
    memoryCitation: z
      .strictObject({
        entries: z.array(
          z.strictObject({
            lineEnd: integer.nonnegative(),
            lineStart: integer.nonnegative(),
            note: string,
            path: string,
          }),
        ),
        threadIds: z.array(string),
      })
      .nullish(),
    questions: z.array(object).nullish(),
  }),
  z.strictObject({ type: z.literal('plan'), id: string, text: string }),
  z.strictObject({
    type: z.literal('reasoning'),
    id: string,
    summary: z.array(string).optional(),
    content: z.array(string).optional(),
  }),
  z.strictObject({
    type: z.literal('commandExecution'),
    id: string,
    command: string,
    cwd: string,
    commandActions: z.array(commandAction),
    status: itemStatus,
    aggregatedOutput: string.nullish(),
    durationMs: integer.nullish(),
    exitCode: integer.nullish(),
    processId: string.nullish(),
    pluginId: string.nullish(),
    scriptPath: string.nullish(),
    source: z
      .enum([
        'agent',
        'userShell',
        'unifiedExecStartup',
        'unifiedExecInteraction',
      ])
      .optional(),
  }),
  z.strictObject({
    type: z.literal('fileChange'),
    id: string,
    status: itemStatus,
    changes: z.array(
      z.strictObject({
        path: string,
        diff: string,
        kind: z.discriminatedUnion('type', [
          z.strictObject({ type: z.literal('add') }),
          z.strictObject({ type: z.literal('delete') }),
          z.strictObject({
            type: z.literal('update'),
            move_path: string.nullish(),
          }),
        ]),
      }),
    ),
  }),
  z.strictObject({
    type: z.literal('mcpToolCall'),
    id: string,
    server: string,
    tool: string,
    arguments: json,
    status: z.enum(['inProgress', 'completed', 'failed']),
    durationMs: integer.nullish(),
    error: z.strictObject({ message: string }).nullish(),
    result: z
      .strictObject({
        content: z.array(json),
        structuredContent: json.optional(),
        _meta: json.optional(),
      })
      .nullish(),
    appContext: z
      .strictObject({
        connectorId: string,
        actionName: string.nullish(),
        appName: string.nullish(),
        linkId: string.nullish(),
        resourceUri: string.nullish(),
      })
      .nullish(),
    mcpAppResourceUri: string.nullish(),
    pluginId: string.nullish(),
    readOnlyHint: z.boolean().nullish(),
  }),
  z.strictObject({
    type: z.literal('webSearch'),
    id: string,
    query: string,
    action: object.nullish(),
    results: z.array(json).nullish(),
  }),
  z.strictObject({ type: z.literal('imageView'), id: string, path: string }),
  z.strictObject({
    type: z.literal('sleep'),
    id: string,
    durationMs: integer.nonnegative(),
  }),
  z.strictObject({ type: z.literal('contextCompaction'), id: string }),
  z.strictObject({
    type: z.literal('hookPrompt'),
    id: string,
    fragments: z.array(z.strictObject({ hookRunId: string, text: string })),
  }),
  z.strictObject({
    type: z.literal('functionCallOutput'),
    id: string,
    name: string,
    namespace: string.nullish(),
    output: functionOutput,
  }),
  z.strictObject({
    type: z.literal('dynamicToolCall'),
    id: string,
    arguments: json,
    tool: string,
    namespace: string.nullish(),
    status: z.enum(['inProgress', 'completed', 'failed']),
    success: z.boolean().nullish(),
    durationMs: integer.nullish(),
    contentItems: z
      .array(
        z.discriminatedUnion('type', [
          z.strictObject({ type: z.literal('inputText'), text: string }),
          z.strictObject({ type: z.literal('inputImage'), imageUrl: string }),
          z.strictObject({ type: z.literal('inputAudio'), audioUrl: string }),
        ]),
      )
      .nullish(),
  }),
  z.strictObject({
    type: z.literal('collabAgentToolCall'),
    id: string,
    senderThreadId: string,
    receiverThreadIds: z.array(string),
    status: z.enum(['inProgress', 'completed', 'failed', 'interrupted']),
    tool: z.enum([
      'spawnAgent',
      'sendInput',
      'resumeAgent',
      'wait',
      'closeAgent',
      'sendMessage',
      'followupTask',
      'interruptAgent',
      'listAgents',
    ]),
    agentsStates: z.record(
      string,
      z.strictObject({
        status: z.enum([
          'pendingInit',
          'running',
          'interrupted',
          'completed',
          'errored',
          'shutdown',
          'notFound',
        ]),
        message: string.nullish(),
      }),
    ),
    model: string.nullish(),
    prompt: string.nullish(),
    reasoningEffort: string.nullish(),
  }),
  z.strictObject({
    type: z.literal('subAgentActivity'),
    id: string,
    agentPath: string,
    agentThreadId: string,
    kind: z.enum(['started', 'interacted', 'interrupted', 'completed']),
  }),
  z.strictObject({
    type: z.literal('imageGeneration'),
    id: string,
    result: string,
    status: string,
    revisedPrompt: string.nullish(),
    savedPath: string.nullish(),
    transparentBackground: z.boolean().nullish(),
    failure: z
      .strictObject({
        type: z.literal('usageLimitExceeded'),
        limitId: string,
        resetsAt: integer.nullish(),
      })
      .nullish(),
  }),
  z.strictObject({
    type: z.literal('enteredReviewMode'),
    id: string,
    review: string,
  }),
  z.strictObject({
    type: z.literal('exitedReviewMode'),
    id: string,
    review: string,
  }),
]);
export const turnError = z.strictObject({
  message: string,
  additionalDetails: string.nullish(),
  codexErrorInfo: z.union([string, object]).nullish(),
  misalignment: object.nullish(),
});
export const turn = z.strictObject({
  id: string,
  items: z.array(item),
  status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
  error: turnError.nullish(),
  startedAt: integer.nullish(),
  completedAt: integer.nullish(),
  durationMs: integer.nullish(),
  itemsView: z.enum(['notLoaded', 'summary', 'full']).optional(),
});
export const thread = z.strictObject({
  id: string,
  cliVersion: string,
  createdAt: integer,
  updatedAt: integer,
  cwd: string,
  ephemeral: z.boolean(),
  modelProvider: string,
  preview: string,
  projectId: string.nullable(),
  sessionId: string,
  source: z.union([
    z.enum(['cli', 'vscode', 'exec', 'appServer', 'unknown']),
    z.strictObject({ custom: string }),
    z.strictObject({ subAgent: json }),
  ]),
  status: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('notLoaded') }),
    z.strictObject({ type: z.literal('idle') }),
    z.strictObject({ type: z.literal('systemError') }),
    z.strictObject({
      type: z.literal('active'),
      activeFlags: z.array(z.enum(['waitingOnApproval', 'waitingOnUserInput'])),
    }),
  ]),
  turns: z.array(turn),
  model: string.nullish(),
  name: string.nullish(),
  originator: string.nullish(),
  parentThreadId: string.nullish(),
  forkedFromId: string.nullish(),
  path: string.nullish(),
  agentNickname: string.nullish(),
  agentRole: string.nullish(),
  reasoningEffort: string.nullish(),
  recencyAt: integer.nullish(),
  sectionEnteredAt: integer.nullish(),
  historyMode: z.enum(['legacy', 'paginated']).optional(),
  gitInfo: object.nullish(),
  section: object.nullish(),
  threadSource: string.nullish(),
});
export const threadOptions = {
  approvalPolicy: approvalPolicy.nullish(),
  approvalsReviewer: reviewer.nullish(),
  baseInstructions: string.nullish(),
  developerInstructions: string.nullish(),
  config: object.nullish(),
  cwd: string.nullish(),
  model: string.nullish(),
  modelProvider: string.nullish(),
  personality: z.enum(['none', 'friendly', 'pragmatic']).nullish(),
  sandbox: z
    .enum(['read-only', 'workspace-write', 'danger-full-access'])
    .nullish(),
  serviceTier: string.nullish(),
};
export const threadResult = z.strictObject({
  thread,
  approvalPolicy,
  approvalsReviewer: reviewer,
  cwd: string,
  model: string,
  modelProvider: string,
  sandbox,
  instructionSources: z.array(string).optional(),
  reasoningEffort: string.nullish(),
  serviceTier: string.nullish(),
});
export const permissions = z.strictObject({
  network: z.strictObject({ enabled: z.boolean().nullish() }).nullish(),
  fileSystem: z
    .strictObject({
      read: z.array(string).nullish(),
      write: z.array(string).nullish(),
      globScanMaxDepth: integer.min(1).nullish(),
      entries: z
        .array(
          z.strictObject({
            access: z.enum(['read', 'write', 'deny']),
            path: z.discriminatedUnion('type', [
              z.strictObject({ type: z.literal('path'), path: string }),
              z.strictObject({
                type: z.literal('glob_pattern'),
                pattern: string,
              }),
              z.strictObject({
                type: z.literal('special'),
                value: z.discriminatedUnion('kind', [
                  z.strictObject({ kind: z.literal('root') }),
                  z.strictObject({ kind: z.literal('minimal') }),
                  z.strictObject({
                    kind: z.literal('project_roots'),
                    subpath: string.nullish(),
                  }),
                  z.strictObject({ kind: z.literal('tmpdir') }),
                  z.strictObject({ kind: z.literal('slash_tmp') }),
                  z.strictObject({
                    kind: z.literal('unknown'),
                    path: string,
                    subpath: string.nullish(),
                  }),
                ]),
              }),
            ]),
          }),
        )
        .nullish(),
    })
    .nullish(),
});
const elicitationBase = {
  ...threadId,
  turnId: string.nullish(),
  serverName: string,
  message: string,
  _meta: json.optional(),
};
export const elicitation = z.discriminatedUnion('mode', [
  z.strictObject({
    ...elicitationBase,
    mode: z.literal('form'),
    requestedSchema: z.strictObject({
      type: z.literal('object'),
      properties: z.record(string, object),
      required: z.array(string).nullish(),
    }),
  }),
  z.strictObject({
    ...elicitationBase,
    mode: z.literal('openai/form'),
    requestedSchema: json,
  }),
  z.strictObject({
    ...elicitationBase,
    mode: z.literal('openaiForm'),
    requestedSchema: json,
  }),
  z.strictObject({
    ...elicitationBase,
    mode: z.literal('url'),
    elicitationId: string,
    url: string,
  }),
]);
export const usage = z.strictObject({
  cachedInputTokens: integer,
  inputTokens: integer,
  outputTokens: integer,
  reasoningOutputTokens: integer,
  totalTokens: integer,
  cacheWriteInputTokens: integer.optional(),
});
export const rateWindow = z.strictObject({
  usedPercent: integer,
  resetsAt: integer.nullish(),
  windowDurationMins: integer.nullish(),
});
export const rateLimits = z.strictObject({
  primary: rateWindow.nullish(),
  secondary: rateWindow.nullish(),
  limitId: string.nullish(),
  limitName: string.nullish(),
  normalModelSlug: string.nullish(),
  planType: string.nullish(),
  rateLimitReachedType: string.nullish(),
  spendControlReached: z.boolean().nullish(),
  individualLimit: z
    .strictObject({
      limit: string,
      remainingPercent: integer,
      resetsAt: integer,
      used: string,
    })
    .nullish(),
  credits: z
    .strictObject({
      balance: string.nullish(),
      hasCredits: z.boolean(),
      unlimited: z.boolean(),
    })
    .nullish(),
});

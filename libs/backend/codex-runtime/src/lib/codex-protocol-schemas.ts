import { z } from 'zod';

export const string = z.string();
export const integer = z.number().int();
export const json = z.json();
export const object = z.record(string, json);
export const empty = z.strictObject({});
export const serverEmpty = z.object({});
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
// Server data strips extensions; the client variant above remains strict.
export const serverApprovalPolicy = z.union([
  z.enum(['untrusted', 'on-request', 'never']),
  z.object({
    granular: z.object({
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
// Server data strips extensions; the client variant above remains strict.
export const serverSandbox = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dangerFullAccess') }),
  z.object({
    type: z.literal('readOnly'),
    networkAccess: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('externalSandbox'),
    networkAccess: z.enum(['enabled', 'restricted']).optional(),
  }),
  z.object({
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
// Server data strips extensions; the client variant above remains strict.
const serverTextElement = z.object({
  byteRange: z.object({
    start: integer.nonnegative(),
    end: integer.nonnegative(),
  }),
  placeholder: string.nullish(),
});
export const serverInput = z.array(
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: string,
      text_elements: z.array(serverTextElement).optional(),
    }),
    z.object({
      type: z.literal('image'),
      url: string,
      detail: z.enum(['auto', 'low', 'high', 'original']).nullish(),
    }),
    z.object({
      type: z.literal('localImage'),
      path: string,
      detail: z.enum(['auto', 'low', 'high', 'original']).nullish(),
    }),
    z.object({ type: z.literal('audio'), url: string }),
    z.object({ type: z.literal('localAudio'), path: string }),
    z.object({ type: z.literal('skill'), name: string, path: string }),
    z.object({ type: z.literal('mention'), name: string, path: string }),
  ]),
);
export const commandAction = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('read'),
    command: string,
    name: string,
    path: string,
  }),
  z.object({
    type: z.literal('listFiles'),
    command: string,
    path: string.nullish(),
  }),
  z.object({
    type: z.literal('search'),
    command: string,
    path: string.nullish(),
    query: string.nullish(),
  }),
  z.object({ type: z.literal('unknown'), command: string }),
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
// Server data strips extensions; the client variant above remains strict.
export const serverFunctionOutput = z.union([
  string,
  z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('input_text'), text: string }),
      z.object({
        type: z.literal('input_image'),
        image_url: string,
        detail: z.enum(['auto', 'low', 'high', 'original']).nullish(),
      }),
      z.object({ type: z.literal('input_audio'), audio_url: string }),
      z.object({
        type: z.literal('encrypted_content'),
        encrypted_content: string,
      }),
    ]),
  ),
]);
export const item = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('userMessage'),
    id: string,
    content: serverInput,
    clientId: string.nullish(),
  }),
  z.object({
    type: z.literal('agentMessage'),
    id: string,
    text: string,
    phase: z.enum(['commentary', 'final_answer']).nullish(),
    delivery: z.literal('async').nullish(),
    memoryCitation: z
      .object({
        entries: z.array(
          z.object({
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
  z.object({ type: z.literal('plan'), id: string, text: string }),
  z.object({
    type: z.literal('reasoning'),
    id: string,
    summary: z.array(string).optional(),
    content: z.array(string).optional(),
  }),
  z.object({
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
  z.object({
    type: z.literal('fileChange'),
    id: string,
    status: itemStatus,
    changes: z.array(
      z.object({
        path: string,
        diff: string,
        kind: z.discriminatedUnion('type', [
          z.object({ type: z.literal('add') }),
          z.object({ type: z.literal('delete') }),
          z.object({
            type: z.literal('update'),
            move_path: string.nullish(),
          }),
        ]),
      }),
    ),
  }),
  z.object({
    type: z.literal('mcpToolCall'),
    id: string,
    server: string,
    tool: string,
    arguments: json,
    status: z.enum(['inProgress', 'completed', 'failed']),
    durationMs: integer.nullish(),
    error: z.object({ message: string }).nullish(),
    result: z
      .object({
        content: z.array(json),
        structuredContent: json.optional(),
        _meta: json.optional(),
      })
      .nullish(),
    appContext: z
      .object({
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
  z.object({
    type: z.literal('webSearch'),
    id: string,
    query: string,
    action: object.nullish(),
    results: z.array(json).nullish(),
  }),
  z.object({ type: z.literal('imageView'), id: string, path: string }),
  z.object({
    type: z.literal('sleep'),
    id: string,
    durationMs: integer.nonnegative(),
  }),
  z.object({ type: z.literal('contextCompaction'), id: string }),
  z.object({
    type: z.literal('hookPrompt'),
    id: string,
    fragments: z.array(z.object({ hookRunId: string, text: string })),
  }),
  z.object({
    type: z.literal('functionCallOutput'),
    id: string,
    name: string,
    namespace: string.nullish(),
    output: serverFunctionOutput,
  }),
  z.object({
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
          z.object({ type: z.literal('inputText'), text: string }),
          z.object({ type: z.literal('inputImage'), imageUrl: string }),
          z.object({ type: z.literal('inputAudio'), audioUrl: string }),
        ]),
      )
      .nullish(),
  }),
  z.object({
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
      z.object({
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
  z.object({
    type: z.literal('subAgentActivity'),
    id: string,
    agentPath: string,
    agentThreadId: string,
    kind: z.enum(['started', 'interacted', 'interrupted', 'completed']),
  }),
  z.object({
    type: z.literal('imageGeneration'),
    id: string,
    result: string,
    status: string,
    revisedPrompt: string.nullish(),
    savedPath: string.nullish(),
    transparentBackground: z.boolean().nullish(),
    failure: z
      .object({
        type: z.literal('usageLimitExceeded'),
        limitId: string,
        resetsAt: integer.nullish(),
      })
      .nullish(),
  }),
  z.object({
    type: z.literal('enteredReviewMode'),
    id: string,
    review: string,
  }),
  z.object({
    type: z.literal('exitedReviewMode'),
    id: string,
    review: string,
  }),
]);
// Reasoning deltas stream before the reasoning item completes; the completed
// item still carries the authoritative final text (summary, else content).
export const reasoningSummaryTextDelta = z.object({
  ...itemIds,
  summaryIndex: integer,
  delta: string,
});
export const reasoningTextDelta = z.object({
  ...itemIds,
  contentIndex: integer,
  delta: string,
});
export const turnError = z.object({
  message: string,
  additionalDetails: string.nullish(),
  codexErrorInfo: z.union([string, object]).nullish(),
  misalignment: object.nullish(),
});
export const turn = z.object({
  id: string,
  items: z.array(item),
  status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
  error: turnError.nullish(),
  startedAt: integer.nullish(),
  completedAt: integer.nullish(),
  durationMs: integer.nullish(),
  itemsView: z.enum(['notLoaded', 'summary', 'full']).optional(),
});
export const thread = z.object({
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
    z.object({ custom: string }),
    z.object({ subAgent: json }),
  ]),
  status: z.discriminatedUnion('type', [
    z.object({ type: z.literal('notLoaded') }),
    z.object({ type: z.literal('idle') }),
    z.object({ type: z.literal('systemError') }),
    z.object({
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
export const historyPage = z.object({
  nextCursor: string.nullish(),
  backwardsCursor: string.nullish(),
});
export const historySortDirection = z.enum(['asc', 'desc']);
export const historyLimit = integer.min(0).max(4_294_967_295).nullish();
export const threadItemEntry = z.object({
  turnId: string,
  item,
  startedAtMs: integer.nullish(),
  completedAtMs: integer.nullish(),
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
export const threadResult = z.object({
  thread,
  approvalPolicy: serverApprovalPolicy,
  approvalsReviewer: reviewer,
  cwd: string,
  model: string,
  modelProvider: string,
  sandbox: serverSandbox,
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
// Server data strips extensions; the client variant above remains strict.
export const serverPermissions = z.object({
  network: z.object({ enabled: z.boolean().nullish() }).nullish(),
  fileSystem: z
    .object({
      read: z.array(string).nullish(),
      write: z.array(string).nullish(),
      globScanMaxDepth: integer.min(1).nullish(),
      entries: z
        .array(
          z.object({
            access: z.enum(['read', 'write', 'deny']),
            path: z.discriminatedUnion('type', [
              z.object({ type: z.literal('path'), path: string }),
              z.object({
                type: z.literal('glob_pattern'),
                pattern: string,
              }),
              z.object({
                type: z.literal('special'),
                value: z.discriminatedUnion('kind', [
                  z.object({ kind: z.literal('root') }),
                  z.object({ kind: z.literal('minimal') }),
                  z.object({
                    kind: z.literal('project_roots'),
                    subpath: string.nullish(),
                  }),
                  z.object({ kind: z.literal('tmpdir') }),
                  z.object({ kind: z.literal('slash_tmp') }),
                  z.object({
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
  z.object({
    ...elicitationBase,
    mode: z.literal('form'),
    requestedSchema: z.object({
      type: z.literal('object'),
      properties: z.record(string, object),
      required: z.array(string).nullish(),
    }),
  }),
  z.object({
    ...elicitationBase,
    mode: z.literal('openai/form'),
    requestedSchema: json,
  }),
  z.object({
    ...elicitationBase,
    mode: z.literal('openaiForm'),
    requestedSchema: json,
  }),
  z.object({
    ...elicitationBase,
    mode: z.literal('url'),
    elicitationId: string,
    url: string,
  }),
]);
export const usage = z.object({
  cachedInputTokens: integer,
  inputTokens: integer,
  outputTokens: integer,
  reasoningOutputTokens: integer,
  totalTokens: integer,
  cacheWriteInputTokens: integer.optional(),
});
export const rateWindow = z.object({
  usedPercent: integer,
  resetsAt: integer.nullish(),
  windowDurationMins: integer.nullish(),
});
export const rateLimits = z.object({
  primary: rateWindow.nullish(),
  secondary: rateWindow.nullish(),
  limitId: string.nullish(),
  limitName: string.nullish(),
  normalModelSlug: string.nullish(),
  planType: string.nullish(),
  rateLimitReachedType: string.nullish(),
  spendControlReached: z.boolean().nullish(),
  individualLimit: z
    .object({
      limit: string,
      remainingPercent: integer,
      resetsAt: integer,
      used: string,
    })
    .nullish(),
  credits: z
    .object({
      balance: string.nullish(),
      hasCredits: z.boolean(),
      unlimited: z.boolean(),
    })
    .nullish(),
});

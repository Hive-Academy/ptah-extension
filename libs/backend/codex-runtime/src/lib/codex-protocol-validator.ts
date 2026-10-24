import { z } from 'zod';

const string = z.string();
const integer = z.number().int();
const json = z.json();
const object = z.record(string, json);
const empty = z.strictObject({});
const threadId = { threadId: string };
const turnIds = { ...threadId, turnId: string };
const itemIds = { ...turnIds, itemId: string };
const approvalIds = { ...itemIds, startedAtMs: integer };
const decision = z.enum(['accept', 'acceptForSession', 'decline', 'cancel']);
const approvalPolicy = z.union([
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
const reviewer = z.enum(['user', 'auto_review', 'guardian_subagent']);
const sandbox = z.discriminatedUnion('type', [
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
const input = z.array(
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
const commandAction = z.discriminatedUnion('type', [
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
const functionOutput = z.union([
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
const item = z.discriminatedUnion('type', [
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
const turnError = z.strictObject({
  message: string,
  additionalDetails: string.nullish(),
  codexErrorInfo: z.union([string, object]).nullish(),
  misalignment: object.nullish(),
});
const turn = z.strictObject({
  id: string,
  items: z.array(item),
  status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
  error: turnError.nullish(),
  startedAt: integer.nullish(),
  completedAt: integer.nullish(),
  durationMs: integer.nullish(),
  itemsView: z.enum(['notLoaded', 'summary', 'full']).optional(),
});
const thread = z.strictObject({
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
const threadOptions = {
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
const threadResult = z.strictObject({
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
const permissions = z.strictObject({
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
const elicitation = z.discriminatedUnion('mode', [
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
const usage = z.strictObject({
  cachedInputTokens: integer,
  inputTokens: integer,
  outputTokens: integer,
  reasoningOutputTokens: integer,
  totalTokens: integer,
  cacheWriteInputTokens: integer.optional(),
});
const rateWindow = z.strictObject({
  usedPercent: integer,
  resetsAt: integer.nullish(),
  windowDurationMins: integer.nullish(),
});
const rateLimits = z.strictObject({
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

/** Hand-written boundary schemas for the pinned runtime surface. */
export const codexRequestSchemas = {
  initialize: {
    params: z.strictObject({
      clientInfo: z.strictObject({ name: string, version: string }),
      capabilities: z.strictObject({
        experimentalApi: z.literal(true),
        extensions: object.nullish(),
        mcpServerOpenaiFormElicitation: z.boolean().optional(),
        optOutNotificationMethods: z.array(string).nullish(),
        requestAttestation: z.boolean().optional(),
      }),
    }),
    result: z.strictObject({
      codexHome: string,
      platformFamily: string,
      platformOs: string,
      userAgent: string,
    }),
  },
  'thread/start': {
    params: z.strictObject({
      ...threadOptions,
      ephemeral: z.boolean().nullish(),
      serviceName: string.nullish(),
      sessionStartSource: z.enum(['startup', 'clear']).nullish(),
      threadSource: string.nullish(),
    }),
    result: threadResult,
  },
  'thread/resume': {
    params: z.strictObject({
      ...threadOptions,
      ...threadId,
      excludeTurns: z.boolean().optional(),
    }),
    result: threadResult,
  },
  'turn/start': {
    params: z.strictObject({
      ...threadId,
      input,
      approvalPolicy: approvalPolicy.nullish(),
      approvalsReviewer: reviewer.nullish(),
      clientUserMessageId: string.nullish(),
      cwd: string.nullish(),
      effort: string.min(1).nullish(),
      model: string.nullish(),
      outputSchema: json.optional(),
      personality: threadOptions.personality,
      sandboxPolicy: sandbox.nullish(),
      serviceTier: string.nullish(),
      serviceTierForTurn: string.nullish(),
      summary: z.enum(['auto', 'concise', 'detailed', 'none']).nullish(),
      toolOutput: z
        .strictObject({
          name: string,
          namespace: string.nullish(),
          output: functionOutput,
        })
        .nullish(),
      turnTrigger: string.nullish(),
    }),
    result: z.strictObject({ turn }),
  },
  'turn/steer': {
    params: z.strictObject({
      ...threadId,
      expectedTurnId: string,
      input,
      clientUserMessageId: string.nullish(),
    }),
    result: z.strictObject({ turnId: string }),
  },
  'turn/interrupt': { params: z.strictObject(turnIds), result: empty },
  'thread/compact/start': { params: z.strictObject(threadId), result: empty },
  'account/rateLimits/read': {
    params: empty.nullish(),
    result: z.strictObject({
      rateLimits,
      accountId: string.nullish(),
      ordinaryUsageAllowed: z.boolean().nullish(),
      rateLimitsByLimitId: z.record(string, rateLimits).nullish(),
      rateLimitResetCredits: object.nullish(),
      rateLimitUpsell: json.optional(),
    }),
  },
} as const;

export const codexServerRequestSchemas = {
  'item/commandExecution/requestApproval': {
    params: z.strictObject({
      ...approvalIds,
      approvalId: string.nullish(),
      command: string.nullish(),
      commandActions: z.array(commandAction).nullish(),
      cwd: string.nullish(),
      environmentId: string.nullish(),
      kind: z.enum(['command', 'writeStdin']).optional(),
      reason: string.nullish(),
      proposedExecpolicyAmendment: z.array(string).nullish(),
      networkApprovalContext: z
        .strictObject({
          host: string,
          protocol: z.enum(['http', 'https', 'socks5Tcp', 'socks5Udp']),
        })
        .nullish(),
      proposedNetworkPolicyAmendments: z
        .array(
          z.strictObject({ host: string, action: z.enum(['allow', 'deny']) }),
        )
        .nullish(),
    }),
    result: z.strictObject({ decision }),
  },
  'item/fileChange/requestApproval': {
    params: z.strictObject({
      ...approvalIds,
      grantRoot: string.nullish(),
      reason: string.nullish(),
    }),
    result: z.strictObject({ decision }),
  },
  'item/permissions/requestApproval': {
    params: z.strictObject({
      ...approvalIds,
      cwd: string,
      environmentId: string.nullish(),
      permissions,
      reason: string.nullish(),
    }),
    result: z.strictObject({
      permissions,
      scope: z.enum(['turn', 'session']).optional(),
      strictAutoReview: z.boolean().nullish(),
    }),
  },
  'item/tool/requestUserInput': {
    params: z.strictObject({
      ...itemIds,
      isBlocking: z.boolean(),
      autoResolutionMs: integer.nonnegative().nullish(),
      questions: z.array(
        z.strictObject({
          id: string,
          header: string,
          question: string,
          isOther: z.boolean().optional(),
          isSecret: z.boolean().optional(),
          options: z
            .array(z.strictObject({ label: string, description: string }))
            .nullish(),
        }),
      ),
    }),
    result: z.strictObject({
      answers: z.record(string, z.strictObject({ answers: z.array(string) })),
    }),
  },
  'mcpServer/elicitation/request': {
    params: elicitation,
    result: z.strictObject({
      action: z.enum(['accept', 'decline', 'cancel']),
      content: json.optional(),
      _meta: json.optional(),
    }),
  },
} as const;

// Notification objects permit additional properties in the pinned schema.
// Keep these separate from the strict request/response contracts.
const notificationStatus = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('notLoaded') }),
  z.looseObject({ type: z.literal('idle') }),
  z.looseObject({ type: z.literal('systemError') }),
  z.looseObject({
    type: z.literal('active'),
    activeFlags: z.array(z.enum(['waitingOnApproval', 'waitingOnUserInput'])),
  }),
]);
const notificationRateLimits = rateLimits.loose().extend({
  primary: rateWindow.loose().nullish(),
  secondary: rateWindow.loose().nullish(),
  planType: z
    .enum([
      'free',
      'go',
      'plus',
      'pro',
      'prolite',
      'team',
      'self_serve_business_prolite',
      'self_serve_business_usage_based',
      'business',
      'ent26',
      'enterprise_cbp_automation',
      'enterprise_cbp_usage_based',
      'enterprise',
      'edu',
      'edu_plus',
      'edu_pro',
      'unknown',
    ])
    .nullish(),
  rateLimitReachedType: z
    .enum([
      'rate_limit_reached',
      'workspace_owner_credits_depleted',
      'workspace_member_credits_depleted',
      'workspace_owner_usage_limit_reached',
      'workspace_member_usage_limit_reached',
    ])
    .nullish(),
  individualLimit: rateLimits.shape.individualLimit
    .unwrap()
    .unwrap()
    .loose()
    .nullish(),
  credits: rateLimits.shape.credits.unwrap().unwrap().loose().nullish(),
});

export const codexNotificationSchemas = {
  initialized: empty.optional(),
  'account/rateLimits/updated': z.looseObject({
    rateLimits: notificationRateLimits,
  }),
  'mcpServer/startupStatus/updated': z.looseObject({
    name: string,
    status: z.enum(['starting', 'ready', 'failed', 'cancelled']),
    error: string.nullish(),
    failureReason: z.literal('reauthenticationRequired').nullish(),
    threadId: string.nullish(),
  }),
  'remoteControl/status/changed': z.looseObject({
    installationId: string,
    serverName: string,
    status: z.enum(['disabled', 'connecting', 'connected', 'errored']),
    environmentId: string.nullish(),
  }),
  'serverRequest/resolved': z.looseObject({
    ...threadId,
    requestId: z.union([string, integer]),
  }),
  'thread/started': z.looseObject({
    thread: thread.loose().extend({ status: notificationStatus }),
  }),
  'thread/status/changed': z.looseObject({
    ...threadId,
    status: notificationStatus,
  }),
  'turn/moderationMetadata': z.looseObject({ ...turnIds, metadata: json }),
  'item/started': z.strictObject({ ...turnIds, item, startedAtMs: integer }),
  'item/completed': z.strictObject({
    ...turnIds,
    item,
    completedAtMs: integer,
  }),
  'item/agentMessage/delta': z.strictObject({ ...itemIds, delta: string }),
  'turn/started': z.strictObject({ ...threadId, turn }),
  'turn/completed': z.strictObject({ ...threadId, turn }),
  'thread/tokenUsage/updated': z.strictObject({
    ...turnIds,
    tokenUsage: z.strictObject({
      last: usage,
      total: usage,
      modelContextWindow: integer.nullish(),
    }),
  }),
  error: z.strictObject({
    ...turnIds,
    error: turnError,
    willRetry: z.boolean(),
  }),
} as const;

const requests = { ...codexRequestSchemas, ...codexServerRequestSchemas };
export type CodexRequestMethod = keyof typeof requests;
export type CodexNotificationMethod = keyof typeof codexNotificationSchemas;
export type CodexProtocolMethod = CodexRequestMethod | CodexNotificationMethod;
export type CodexRequestParams<M extends CodexRequestMethod> = z.infer<
  (typeof requests)[M]['params']
>;
export type CodexRequestResult<M extends CodexRequestMethod> = z.infer<
  (typeof requests)[M]['result']
>;
export type CodexProtocolErrorCode =
  | 'unknownMethod'
  | 'invalidEnvelope'
  | 'invalidParams'
  | 'invalidResult'
  | 'missingResponseMethod';

export class CodexProtocolError extends Error {
  constructor(
    readonly code: CodexProtocolErrorCode,
    readonly method?: string,
  ) {
    // Do not retain wire payloads, validation values or remote error text.
    super(`Codex protocol validation failed: ${code}`);
    this.name = 'CodexProtocolError';
  }
}

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  code: CodexProtocolErrorCode,
  method?: string,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new CodexProtocolError(code, method);
  return result.data;
}
function isRequest(method: string): method is CodexRequestMethod {
  return Object.hasOwn(requests, method);
}
function isNotification(method: string): method is CodexNotificationMethod {
  return Object.hasOwn(codexNotificationSchemas, method);
}

// Pinned 0.155.1 ServerNotification methods; specs compare this surface with both artifacts.
const pinnedServerNotifications = new Set<string>([
  'account/login/completed',
  'account/rateLimits/updated',
  'account/updated',
  'app/list/updated',
  'autoApprovalReview/strictReviewRequired',
  'command/exec/outputDelta',
  'configWarning',
  'deprecationNotice',
  'error',
  'externalAgentConfig/import/completed',
  'externalAgentConfig/import/progress',
  'fs/changed',
  'fuzzyFileSearch/sessionCompleted',
  'fuzzyFileSearch/sessionUpdated',
  'guardianWarning',
  'hook/completed',
  'hook/started',
  'item/agentMessage/delta',
  'item/autoApprovalReview/completed',
  'item/autoApprovalReview/started',
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/completed',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'item/plan/delta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/started',
  'mcpServer/event/stream/notification',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'model/rerouted',
  'model/safetyBuffering/updated',
  'model/verification',
  'modelProvider/authRecoveryCompleted',
  'modelProvider/authRecoveryStarted',
  'process/exited',
  'process/outputDelta',
  'project/changed',
  'remoteControl/status/changed',
  'serverRequest/resolved',
  'skills/changed',
  'thread/archived',
  'thread/attachment/updated',
  'thread/closed',
  'thread/compacted',
  'thread/deleted',
  'thread/environment/connected',
  'thread/environment/disconnected',
  'thread/goal/cleared',
  'thread/goal/updated',
  'thread/name/updated',
  'thread/project/updated',
  'thread/queue/changed',
  'thread/realtime/closed',
  'thread/realtime/error',
  'thread/realtime/item/completed',
  'thread/realtime/item/started',
  'thread/realtime/item/transcript/delta',
  'thread/realtime/itemAdded',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/started',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/reverted',
  'thread/settings/updated',
  'thread/started',
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'thread/unarchived',
  'turn/completed',
  'turn/diff/updated',
  'turn/moderationMetadata',
  'turn/plan/updated',
  'turn/started',
  'warning',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
]);
const unmodeledParams = z.record(string, z.unknown());

/** Only the pinned server-notification allowlist may bypass payload modeling. */
export function isUnmodeledCodexNotification(method: string): boolean {
  return pinnedServerNotifications.has(method) && !isNotification(method);
}

export function validateCodexParams<M extends CodexRequestMethod>(
  method: M,
  value: unknown,
): CodexRequestParams<M>;
export function validateCodexParams<M extends CodexNotificationMethod>(
  method: M,
  value: unknown,
): z.infer<(typeof codexNotificationSchemas)[M]>;
export function validateCodexParams(method: string, value: unknown): unknown;
export function validateCodexParams(method: string, value: unknown): unknown {
  if (isRequest(method))
    return parse(requests[method].params, value, 'invalidParams', method);
  if (isNotification(method))
    return parse(
      codexNotificationSchemas[method],
      value,
      'invalidParams',
      method,
    );
  if (isUnmodeledCodexNotification(method))
    return parse(unmodeledParams, value, 'invalidParams', method);
  throw new CodexProtocolError('unknownMethod', method);
}
export function validateCodexResult<M extends CodexRequestMethod>(
  method: M,
  value: unknown,
): CodexRequestResult<M>;
export function validateCodexResult(method: string, value: unknown): unknown;
export function validateCodexResult(method: string, value: unknown): unknown {
  if (!isRequest(method)) throw new CodexProtocolError('unknownMethod', method);
  return parse(requests[method].result, value, 'invalidResult', method);
}

const id = z.union([string, integer]);
const header = {
  jsonrpc: z.literal('2.0').optional(),
  emittedAtMs: integer.nonnegative().optional(),
};
const envelope = z.union([
  z.strictObject({ ...header, id, method: string, params: json.optional() }),
  z.strictObject({ ...header, method: string, params: json.optional() }),
  z.strictObject({ ...header, id, result: json }),
  z.strictObject({
    ...header,
    id,
    error: z.strictObject({
      code: integer,
      message: string,
      data: json.optional(),
    }),
  }),
]);
export type CodexProtocolFrame =
  | (z.infer<typeof envelope> & { readonly modeled?: true })
  | {
      readonly method: string;
      readonly params: Record<string, unknown>;
      readonly modeled: false;
      readonly jsonrpc?: '2.0';
      readonly emittedAtMs?: number;
    };

/** Supply the pending method for responses, before settling correlation or dispatching. */
export function validateCodexFrame(
  value: unknown,
  responseMethod?: string,
): CodexProtocolFrame {
  const frame = parse(envelope, value, 'invalidEnvelope');
  if ('method' in frame) {
    if (isUnmodeledCodexNotification(frame.method)) {
      if ('id' in frame)
        throw new CodexProtocolError('invalidEnvelope', frame.method);
      return {
        ...frame,
        params: parse(
          unmodeledParams,
          frame.params,
          'invalidParams',
          frame.method,
        ),
        modeled: false,
      };
    }
    if (!isRequest(frame.method) && !isNotification(frame.method))
      throw new CodexProtocolError('unknownMethod', frame.method);
    if (isRequest(frame.method) !== 'id' in frame)
      throw new CodexProtocolError('invalidEnvelope', frame.method);
    validateCodexParams(frame.method, frame.params);
  } else {
    if (responseMethod === undefined)
      throw new CodexProtocolError('missingResponseMethod');
    if (!isRequest(responseMethod))
      throw new CodexProtocolError('unknownMethod', responseMethod);
    if ('result' in frame) validateCodexResult(responseMethod, frame.result);
  }
  return frame;
}

import { z } from 'zod';
import {
  string,
  integer,
  json,
  object,
  empty,
  serverEmpty,
  threadId,
  turnIds,
  itemIds,
  approvalIds,
  decision,
  approvalPolicy,
  reviewer,
  sandbox,
  input,
  commandAction,
  functionOutput,
  item,
  turnError,
  turn,
  thread,
  threadOptions,
  threadResult,
  permissions,
  serverPermissions,
  elicitation,
  usage,
  rateWindow,
  rateLimits,
} from './codex-protocol-schemas';

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
    result: z.object({
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
    result: z.object({ turn }),
  },
  'turn/steer': {
    params: z.strictObject({
      ...threadId,
      expectedTurnId: string,
      input,
      clientUserMessageId: string.nullish(),
    }),
    result: z.object({ turnId: string }),
  },
  'turn/interrupt': { params: z.strictObject(turnIds), result: serverEmpty },
  'thread/compact/start': {
    params: z.strictObject(threadId),
    result: serverEmpty,
  },
  'model/list': {
    params: z.strictObject({
      cursor: string.nullish(),
      includeHidden: z.boolean().nullish(),
      limit: integer.min(0).max(4_294_967_295).nullish(),
    }),
    result: z.object({
      data: z.array(
        z.object({
          id: string,
          model: string,
          displayName: string,
          description: string,
          hidden: z.boolean(),
          isDefault: z.boolean(),
          defaultReasoningEffort: string.min(1),
          supportedReasoningEfforts: z.array(
            z.object({
              reasoningEffort: string.min(1),
              description: string,
            }),
          ),
          additionalSpeedTiers: z.array(string).optional(),
          availabilityNux: z.object({ message: string }).nullish(),
          defaultServiceTier: string.nullish(),
          inputModalities: z
            .array(z.enum(['text', 'image', 'audio']))
            .optional(),
          modelSpecialty: string.nullish(),
          multiAgentVersion: z.enum(['disabled', 'v1', 'v2']).nullish(),
          serviceTiers: z
            .array(z.object({ id: string, name: string, description: string }))
            .optional(),
          supportsPersonality: z.boolean().optional(),
          upgrade: string.nullish(),
          upgradeInfo: z
            .object({
              model: string,
              migrationMarkdown: string.nullish(),
              modelLink: string.nullish(),
              retirementAt: integer.nullish(),
              upgradeCopy: string.nullish(),
            })
            .nullish(),
        }),
      ),
      nextCursor: string.nullish(),
    }),
  },
  'account/rateLimits/read': {
    params: empty.nullish(),
    result: z.object({
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
    params: z.object({
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
        .object({
          host: string,
          protocol: z.enum(['http', 'https', 'socks5Tcp', 'socks5Udp']),
        })
        .nullish(),
      proposedNetworkPolicyAmendments: z
        .array(z.object({ host: string, action: z.enum(['allow', 'deny']) }))
        .nullish(),
    }),
    result: z.strictObject({ decision }),
  },
  'item/fileChange/requestApproval': {
    params: z.object({
      ...approvalIds,
      grantRoot: string.nullish(),
      reason: string.nullish(),
    }),
    result: z.strictObject({ decision }),
  },
  'item/permissions/requestApproval': {
    params: z.object({
      ...approvalIds,
      cwd: string,
      environmentId: string.nullish(),
      permissions: serverPermissions,
      reason: string.nullish(),
    }),
    result: z.strictObject({
      permissions,
      scope: z.enum(['turn', 'session']).optional(),
      strictAutoReview: z.boolean().nullish(),
    }),
  },
  'item/tool/requestUserInput': {
    params: z.object({
      ...itemIds,
      isBlocking: z.boolean(),
      autoResolutionMs: integer.nonnegative().nullish(),
      questions: z.array(
        z.object({
          id: string,
          header: string,
          question: string,
          isOther: z.boolean().optional(),
          isSecret: z.boolean().optional(),
          options: z
            .array(z.object({ label: string, description: string }))
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

// Server notifications strip extensions while retaining their pinned field constraints.
const notificationStatus = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notLoaded') }),
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('systemError') }),
  z.object({
    type: z.literal('active'),
    activeFlags: z.array(z.enum(['waitingOnApproval', 'waitingOnUserInput'])),
  }),
]);
const notificationRateLimits = rateLimits.strip().extend({
  primary: rateWindow.strip().nullish(),
  secondary: rateWindow.strip().nullish(),
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
    .strip()
    .nullish(),
  credits: rateLimits.shape.credits.unwrap().unwrap().strip().nullish(),
});

export const codexNotificationSchemas = {
  initialized: empty.optional(),
  'account/rateLimits/updated': z.object({
    rateLimits: notificationRateLimits,
  }),
  'mcpServer/startupStatus/updated': z.object({
    name: string,
    status: z.enum(['starting', 'ready', 'failed', 'cancelled']),
    error: string.nullish(),
    failureReason: z.literal('reauthenticationRequired').nullish(),
    threadId: string.nullish(),
  }),
  'remoteControl/status/changed': z.object({
    installationId: string,
    serverName: string,
    status: z.enum(['disabled', 'connecting', 'connected', 'errored']),
    environmentId: string.nullish(),
  }),
  'serverRequest/resolved': z.object({
    ...threadId,
    requestId: z.union([string, integer]),
  }),
  'thread/started': z.object({
    thread: thread.strip().extend({ status: notificationStatus }),
  }),
  'thread/status/changed': z.object({
    ...threadId,
    status: notificationStatus,
  }),
  'turn/moderationMetadata': z.object({ ...turnIds, metadata: json }),
  'item/started': z.object({ ...turnIds, item, startedAtMs: integer }),
  'item/completed': z.object({
    ...turnIds,
    item,
    completedAtMs: integer,
  }),
  'item/agentMessage/delta': z.object({ ...itemIds, delta: string }),
  'turn/started': z.object({ ...threadId, turn }),
  'turn/completed': z.object({ ...threadId, turn }),
  'thread/tokenUsage/updated': z.object({
    ...turnIds,
    tokenUsage: z.object({
      last: usage,
      total: usage,
      modelContextWindow: integer.nullish(),
    }),
  }),
  error: z.object({
    ...turnIds,
    error: turnError,
    willRetry: z.boolean(),
  }),
} as const;

/**
 * `ptah_route_decide` call handler (TASK_2026_646, part A §8).
 *
 * Zod runs here, before `route.decide`. `route.decide` is the only path
 * to `RouteDecideService`, and it resolves that service through
 * `LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE`. An invalid argument is a
 * tool error that names the field. The service is not called.
 *
 * Any throw becomes a tool error. The F9 sentence is returned unchanged.
 * Every other message is redacted before it is logged or returned.
 */
import {
  RouteDecideArgsSchema,
  type RouteDecideResult,
} from '@ptah-extension/lane-routing';
import { countTokensPiecewise } from '@ptah-extension/tool-output-reducers';
import type { ZodError } from 'zod';
import {
  ROUTING_UNAVAILABLE_MESSAGE,
  type RouteNamespace,
} from '../namespace-builders/route-namespace.builder';
import { ROUTE_DECIDE_TOOL_NAME } from './route-tools';
import { ROUTE_DECIDE_RESULT_BUDGET } from './tool-result-budget';

/** What the dispatcher needs to build a success or an `isError` result. */
export interface RouteToolReply {
  readonly isError: boolean;
  readonly text: string;
}

/** Subset of `Logger` this handler uses. */
export interface RouteToolLogger {
  warn(message: string, ...args: unknown[]): void;
}

const MAX_ERROR_CHARS = 500;

const SECRET_SHAPES: readonly RegExp[] = [
  /\bBearer\s+\S+/gi,
  /\b(?:sk|pk|api|key|token|secret)[_-][A-Za-z0-9]{8,}\b/gi,
  /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
];

/**
 * One line naming each offending field (`a.b: message; (root): message`).
 * The one Zod issue formatter of this server: the dispatcher's other tools
 * and `ptah_outcome_report` import it from here.
 */
export function describeZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0
          ? issue.path.map((part) => String(part)).join('.')
          : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}

function redact(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_SHAPES) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  if (redacted.length <= MAX_ERROR_CHARS) return redacted;
  return `${redacted.slice(0, MAX_ERROR_CHARS)}…`;
}

/** Tool text for a thrown failure. F9 is returned verbatim. */
export function routeFailureText(error: unknown): string {
  const message = errorMessage(error);
  if (message === ROUTING_UNAVAILABLE_MESSAGE) return message;
  const raw = message.trim().length > 0 ? message.trim() : 'unknown error';
  return `${ROUTE_DECIDE_TOOL_NAME} failed: ${redact(raw)}`;
}

/**
 * Whether the budget step (`applyOutputBudget`) returns `text` byte-for-byte:
 * the same two checks it makes, chars first, then the piecewise token count
 * against {@link ROUTE_DECIDE_RESULT_BUDGET}. A text that fails either would
 * be cut and spooled under a success flag, so the caller makes it an error.
 */
function returnedWhole(text: string): boolean {
  const { chars, tokens } = ROUTE_DECIDE_RESULT_BUDGET;
  return text.length <= chars && countTokensPiecewise(text, tokens) <= tokens;
}

function invalidArguments(error: ZodError): RouteToolReply {
  return {
    isError: true,
    text:
      `Error: invalid ${ROUTE_DECIDE_TOOL_NAME} arguments — ` +
      `${describeZodIssues(error)}`,
  };
}

/**
 * Validate `args`, then call `route.decide`. Does not resolve the service
 * itself: the namespace does, and only after this parse succeeds.
 */
export async function handleRouteToolCall(
  args: unknown,
  route: RouteNamespace,
  logger: RouteToolLogger,
): Promise<RouteToolReply> {
  const parsed = RouteDecideArgsSchema.safeParse(args);
  if (!parsed.success) return invalidArguments(parsed.error);

  try {
    const result: RouteDecideResult = await route.decide(parsed.data);
    const text = JSON.stringify(result);
    if (!returnedWhole(text)) {
      const { chars, tokens } = ROUTE_DECIDE_RESULT_BUDGET;
      return {
        isError: true,
        text: `${ROUTE_DECIDE_TOOL_NAME} failed: result exceeds the ${chars}-character / ${tokens}-token tool limit`,
      };
    }
    return { isError: false, text };
  } catch (error: unknown) {
    const text = routeFailureText(error);
    const name = error instanceof Error ? error.name : 'UnknownError';
    logger.warn(`[MCP] ${ROUTE_DECIDE_TOOL_NAME} failed (${name}): ${text}`);
    return { isError: true, text };
  }
}

import { execFile } from 'node:child_process';
import {
  request as httpRequest,
  Agent as HttpAgent,
  type ClientRequest,
  type IncomingMessage,
} from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { promisify } from 'node:util';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  windowKindFromDuration,
  type PlanLimitWindow,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import { observeAntigravityAccount } from '../provider-owner.resolver';
import {
  ANTIGRAVITY_CONNECT_PROTOCOL_VERSION,
  ANTIGRAVITY_CSRF_ARGUMENT,
  ANTIGRAVITY_CSRF_HEADER,
  ANTIGRAVITY_EXTENSION_CSRF_ARGUMENT,
  ANTIGRAVITY_EXTENSION_PORT_ARGUMENT,
  ANTIGRAVITY_POSIX_PROCESS_ARGS,
  ANTIGRAVITY_PROCESS_MARKER,
  ANTIGRAVITY_PRODUCT_MARKER,
  ANTIGRAVITY_REQUEST_BODY,
  ANTIGRAVITY_STATUS_PATH,
  ANTIGRAVITY_WINDOWS_PROCESS_ARGS,
  AntigravityStatusSchema,
} from './antigravity-ls.provisional';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const ANTIGRAVITY_USAGE_TIMEOUT_MS = 3_000;
export const ANTIGRAVITY_MAX_BODY_BYTES = 1_048_576;
export const ANTIGRAVITY_MAX_MODEL_LENGTH = 64;
const MAX_ATTEMPTS = 8;
type Scheme = 'http' | 'https';
type StatusRequest = (
  scheme: Scheme,
  port: number,
  csrfToken: string,
  signal: AbortSignal,
) => Promise<unknown>;
type ProbeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;
interface Server {
  pid: string;
  csrfToken: string;
  extensionPort: number | null;
  extensionCsrfToken: string | null;
  ports: readonly number[];
}

export function createAntigravityPlanUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  run: ProbeCommandRunner = defaultRun,
  requestStatus: StatusRequest = defaultRequest,
  observeAccount: (email: string | null) => string = observeAntigravityAccount,
): PlanUsageReader {
  return async ({ signal, target }) => {
    if (signal?.aborted) return unavailable();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, ANTIGRAVITY_USAGE_TIMEOUT_MS);
    try {
      const server = await discoverServer(run, controller.signal);
      if (!server) return unavailable();
      for (const candidate of candidates(server)) {
        try {
          const parsed = AntigravityStatusSchema.safeParse(
            await untilAborted(
              requestStatus(
                candidate.scheme,
                candidate.port,
                candidate.csrfToken,
                controller.signal,
              ),
              controller.signal,
            ),
          );
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            logger.warn('[PlanUsage] provisional usage response rejected', {
              providerId: 'antigravity',
              fieldPath: issue?.path.map(String).join('.') ?? '',
              reason: issue?.code ?? 'invalid',
            });
            continue;
          }
          if (
            observeAccount(parsed.data.userStatus.email ?? null) !==
            (target as { ownerRef?: QuotaOwnerRef }).ownerRef?.key
          ) {
            logger.debug(
              '[PlanUsage] antigravity account changed; owner re-resolves',
              { providerId: 'antigravity' },
            );
            return unavailable();
          }
          const observedAt = now();
          const windows =
            parsed.data.userStatus.cascadeModelConfigData.clientModelConfigs.flatMap(
              (config, index) => {
                if (!config.quotaInfo) return [];
                const model = config.modelOrAlias?.model ?? config.label;
                return model
                  ? [
                      toWindow(
                        model,
                        config.label ?? model,
                        config.quotaInfo,
                        observedAt,
                        index + 1,
                      ),
                    ]
                  : [];
              },
            );
          return windows.length
            ? {
                status: 'available',
                fetchedAt: observedAt,
                windowSetEstablished: true,
                windows,
              }
            : unavailable();
        } catch {
          // degradation-audit: optional-capability - another local protocol candidate may answer.
        }
      }
      return unavailable();
    } catch {
      // degradation-audit: optional-capability - local server discovery is unavailable.
      return unavailable();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}

async function discoverServer(
  run: ProbeCommandRunner,
  signal: AbortSignal,
): Promise<Server | null> {
  const processOutput = await untilAborted(
    run(
      process.platform === 'win32' ? 'powershell.exe' : 'ps',
      process.platform === 'win32'
        ? ANTIGRAVITY_WINDOWS_PROCESS_ARGS
        : ANTIGRAVITY_POSIX_PROCESS_ARGS,
      signal,
    ),
    signal,
  );
  const servers = parseServers(processOutput);
  if (servers.length !== 1) return null;
  const server = servers[0];
  if (process.platform === 'win32') return server;
  try {
    return {
      ...server,
      ports: parseLsofPorts(
        await untilAborted(
          run(
            'lsof',
            ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', server.pid, '-Fn'],
            signal,
          ),
          signal,
        ),
      ),
    };
  } catch {
    // degradation-audit: optional-capability - no local listening-port command.
    return server;
  }
}

function parseServers(stdout: string): Server[] {
  const processes = new Map<string, Server>();
  const ports = new Map<string, number[]>();
  for (const line of stdout.split(/\r?\n/)) {
    const listener = /^L\s+(\d+)\s+(\d+)$/.exec(line);
    if (listener) {
      const port = Number(listener[2]);
      if (validPort(port)) {
        const values = ports.get(listener[1]) ?? [];
        values.push(port);
        ports.set(listener[1], values);
      }
      continue;
    }
    const match = /^\s*(?:P\s+)?(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const [pid, commandLine] = [match[1], match[2]];
    const executable = splitExecutable(commandLine);
    if (!isServer(executable.executable)) continue;
    const csrfToken = argument(commandLine, ANTIGRAVITY_CSRF_ARGUMENT);
    if (!csrfToken) continue;
    processes.set(pid, {
      pid,
      csrfToken,
      extensionPort: numericArgument(
        commandLine,
        ANTIGRAVITY_EXTENSION_PORT_ARGUMENT,
      ),
      extensionCsrfToken: argument(
        commandLine,
        ANTIGRAVITY_EXTENSION_CSRF_ARGUMENT,
      ),
      ports: [],
    });
  }
  return [...processes.values()].map((server) => ({
    ...server,
    ports: ports.get(server.pid) ?? [],
  }));
}

function candidates(
  server: Server,
): Array<{ scheme: Scheme; port: number; csrfToken: string }> {
  const results: Array<{ scheme: Scheme; port: number; csrfToken: string }> =
    [];
  for (const port of server.ports) {
    results.push(
      { scheme: 'https', port, csrfToken: server.csrfToken },
      { scheme: 'http', port, csrfToken: server.csrfToken },
    );
  }
  if (server.extensionPort) {
    const csrfToken = server.extensionCsrfToken ?? server.csrfToken;
    results.push(
      { scheme: 'http', port: server.extensionPort, csrfToken },
      { scheme: 'https', port: server.extensionPort, csrfToken },
    );
  }
  return results.slice(0, MAX_ATTEMPTS);
}
function splitExecutable(commandLine: string): {
  executable: string;
  rest: string;
} {
  const trimmed = commandLine.trimStart();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end < 0
      ? { executable: trimmed.slice(1), rest: '' }
      : { executable: trimmed.slice(1, end), rest: trimmed.slice(end + 1) };
  }
  const end = trimmed.search(/\s/);
  return end < 0
    ? { executable: trimmed, rest: '' }
    : { executable: trimmed.slice(0, end), rest: trimmed.slice(end) };
}
function isServer(executable: string): boolean {
  const path = executable.toLowerCase();
  return (
    (path.split(/[\\/]/).pop() ?? '').includes(ANTIGRAVITY_PROCESS_MARKER) &&
    path.includes(ANTIGRAVITY_PRODUCT_MARKER)
  );
}
function argument(args: string, name: string): string | null {
  const match = new RegExp(
    '(?:^|\\s)' + name + '(?:=|\\s+)(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|(\\S+))',
  ).exec(args);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}
function numericArgument(args: string, name: string): number | null {
  const result = Number(argument(args, name));
  return validPort(result) ? result : null;
}
function validPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < 65536;
}
function parseLsofPorts(output: string): number[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const port = Number(/^n.*:(\d+)$/.exec(line)?.[1]);
    return validPort(port) ? [port] : [];
  });
}
function toWindow(
  model: string,
  label: string,
  quotaInfo: { remainingFraction?: number; resetTime?: string },
  observedAt: number,
  position: number,
): PlanLimitWindow {
  const name = model.slice(0, ANTIGRAVITY_MAX_MODEL_LENGTH);
  const descriptor = windowKindFromDuration(undefined, position);
  const reset = quotaInfo.resetTime
    ? Date.parse(quotaInfo.resetTime)
    : Number.NaN;
  return {
    key: ('other:model-' + name) as PlanLimitWindow['key'],
    kind: descriptor.kind,
    label: descriptor.label + ' · ' + label,
    modelScope: name,
    used: {
      kind: 'percent',
      percent: Math.round((1 - (quotaInfo.remainingFraction ?? 0)) * 1000) / 10,
    },
    usedSource: 'provider-unofficial',
    usedObservedAt: observedAt,
    ...(Number.isFinite(reset) && {
      resetsAt: reset,
      resetSource: 'provider-unofficial',
    }),
    observedAt,
  };
}
function unavailable(): PlanUsageReading {
  return {
    status: 'service-unavailable',
    windowSetEstablished: false,
    windows: [],
  };
}
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}
const execFileAsync = promisify(execFile);
const HTTPS_AGENT = new HttpsAgent({
  keepAlive: false,
  rejectUnauthorized: false,
});
const HTTP_AGENT = new HttpAgent({ keepAlive: false });
function defaultRun(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  return execFileAsync(command, [...args], { signal, windowsHide: true }).then(
    ({ stdout }) => stdout,
  );
}
export function defaultRequest(
  scheme: Scheme,
  port: number,
  csrfToken: string,
  signal: AbortSignal,
): Promise<unknown> {
  const request = scheme === 'https' ? httpsRequest : httpRequest;
  return readJsonResponse((onResponse) => {
    const client = request(
      {
        hostname: '127.0.0.1',
        port,
        path: ANTIGRAVITY_STATUS_PATH,
        method: 'POST',
        headers: {
          [ANTIGRAVITY_CSRF_HEADER]: csrfToken,
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': ANTIGRAVITY_CONNECT_PROTOCOL_VERSION,
        },
        agent: scheme === 'https' ? HTTPS_AGENT : HTTP_AGENT,
        signal,
      },
      onResponse,
    );
    client.write(JSON.stringify(ANTIGRAVITY_REQUEST_BODY));
    return client;
  });
}
export function readJsonResponse(
  open: (onResponse: (response: IncomingMessage) => void) => ClientRequest,
  maxBytes: number = ANTIGRAVITY_MAX_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responded = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };
    const request = open((response) => {
      responded = true;
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        fail(new Error('status ' + status));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) fail(new Error('response body too large'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error: unknown) {
          reject(error);
        }
      });
      response.on('error', fail);
      response.on('close', () => fail(new Error('response closed early')));
    });
    request.on('error', fail);
    request.on('close', () => {
      if (!responded) fail(new Error('request closed early'));
    });
    request.end();
  });
}

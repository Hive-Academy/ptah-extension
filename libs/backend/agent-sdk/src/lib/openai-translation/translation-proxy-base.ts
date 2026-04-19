/**
 * Translation Proxy Base Class - TASK_2025_193 Batch 1
 *
 * Abstract base class for local HTTP proxy servers that translate between
 * the Anthropic Messages API (used by Claude Agent SDK) and the OpenAI
 * Chat Completions API (used by Copilot, Codex, and other providers).
 *
 * The SDK sends Anthropic-format requests to this proxy, which:
 * 1. Translates the request to OpenAI format
 * 2. Forwards to the upstream API with proper auth headers
 * 3. Translates the OpenAI streaming response back to Anthropic format
 *
 * Subclasses provide provider-specific configuration:
 * - API endpoint URL
 * - Authentication headers
 * - Auth failure recovery (token refresh, re-login)
 * - Static model list
 * - Completions path
 *
 * Uses Node's built-in `http` module (no express dependency).
 * Listens on port 0 (OS-assigned) to avoid port conflicts.
 *
 * Extracted from CopilotTranslationProxy to enable reuse across providers.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { Logger } from '@ptah-extension/vscode-core';
import type {
  ITranslationProxy,
  AnthropicMessagesRequest,
  OpenAIChatCompletionsRequest,
} from './openai-translation.types';
import { translateAnthropicToOpenAI } from './request-translator';
import { OpenAIResponseTranslator } from './response-translator';
import {
  translateAnthropicToResponses,
  type OpenAIResponsesRequest,
} from './responses-request-translator';
import { ResponsesStreamTranslator } from './responses-stream-translator';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for a translation proxy instance */
export interface TranslationProxyConfig {
  /** Display name for logging (e.g., 'Copilot', 'Codex') */
  name: string;
  /** Model prefix to add during translation (e.g., 'capi:' for Copilot, '' for Codex) */
  modelPrefix: string;
  /** Path for the upstream chat completions endpoint (e.g., '/chat/completions', '/v1/chat/completions') */
  completionsPath: string;
  /** Path for the upstream responses endpoint (e.g., '/responses', '/v1/responses'). Defaults to '/responses'. */
  responsesPath?: string;
}

/** Maximum request body size (50 MB) */
const MAX_BODY_SIZE = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Abstract Base Class
// ---------------------------------------------------------------------------

export abstract class TranslationProxyBase implements ITranslationProxy {
  private server: http.Server | null = null;
  private port: number | null = null;
  private requestCounter = 0;

  /** Log prefix derived from config name, e.g. '[CopilotProxy]' */
  private readonly logPrefix: string;

  constructor(
    protected readonly logger: Logger,
    protected readonly config: TranslationProxyConfig,
  ) {
    this.logPrefix = `[${this.config.name}Proxy]`;
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — subclasses must implement
  // ---------------------------------------------------------------------------

  /**
   * Get the upstream API base URL (e.g., 'https://api.githubcopilot.com').
   * Called on each request to allow dynamic endpoint resolution.
   */
  protected abstract getApiEndpoint(): Promise<string>;

  /**
   * Get the HTTP headers required for upstream API authentication.
   * Called on each request to ensure fresh credentials.
   */
  protected abstract getHeaders(): Promise<Record<string, string>>;

  /**
   * Handle an authentication failure (401 response from upstream).
   * Should attempt to refresh/re-acquire credentials.
   * Returns true if credentials were successfully refreshed, false otherwise.
   */
  protected abstract onAuthFailure(): Promise<boolean>;

  /**
   * Get the static list of models supported by this provider.
   * Used for the /v1/models endpoint response.
   */
  protected abstract getStaticModels(): Array<{ id: string }>;

  // ---------------------------------------------------------------------------
  // ITranslationProxy implementation
  // ---------------------------------------------------------------------------

  /**
   * Start the proxy server on a dynamically assigned port.
   * Returns the assigned port and full URL.
   */
  async start(): Promise<{ port: number; url: string }> {
    if (this.server) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const url = this.getUrl()!;
      this.logger.info(`${this.logPrefix} Already running at ${url}`);
      return { port: this.port!, url }; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }

    return new Promise<{ port: number; url: string }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger.error(
            `${this.logPrefix} Unhandled error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          if (!res.headersSent) {
            this.sendErrorResponse(
              res,
              500,
              'api_error',
              'Internal proxy error',
            );
          }
        });
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }

        this.server = server;
        this.port = addr.port;
        const url = `http://127.0.0.1:${this.port}`;

        this.logger.info(
          `${this.logPrefix} Translation proxy started at ${url}`,
        );
        resolve({ port: this.port, url });
      });

      server.on('error', (err) => {
        this.logger.error(`${this.logPrefix} Server error: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Stop the proxy server and release resources.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    return new Promise<void>((resolve) => {
      const forceTimeout = setTimeout(() => {
        this.logger.warn(
          `${this.logPrefix} Graceful shutdown timed out, forcing close`,
        );
        try {
          const serverWithConnections = server as unknown as {
            closeAllConnections?: () => void;
          };
          if (typeof serverWithConnections.closeAllConnections === 'function') {
            serverWithConnections.closeAllConnections();
          }
        } catch {
          // closeAllConnections not available in this Node version
        }
        resolve();
      }, 5_000);

      server.close(() => {
        clearTimeout(forceTimeout);
        this.logger.info(`${this.logPrefix} Translation proxy stopped`);
        this.server = null;
        this.port = null;
        resolve();
      });
    });
  }

  /**
   * Whether the proxy server is currently listening.
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * The proxy base URL if running, undefined otherwise.
   */
  getUrl(): string | undefined {
    if (!this.isRunning() || this.port == null) {
      return undefined;
    }
    return `http://127.0.0.1:${this.port}`;
  }

  // ---------------------------------------------------------------------------
  // Request routing
  // ---------------------------------------------------------------------------

  /**
   * Route incoming HTTP requests to the appropriate handler.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method?.toUpperCase() ?? '';
    const rawUrl = req.url ?? '/';
    // Strip query string for route matching (SDK sends ?beta=true, etc.)
    const url = rawUrl.split('?')[0];

    this.logger.debug(`${this.logPrefix} ${method} ${rawUrl}`);

    // Health check
    if (url === '/health' && method === 'GET') {
      this.sendJson(res, 200, { status: 'ok' });
      return;
    }

    // Models list (derived from provider entry — single source of truth)
    if (url === '/v1/models' && method === 'GET') {
      const models = this.getStaticModels().map((m) => ({
        id: m.id,
        object: 'model' as const,
        created: 0,
        owned_by: 'anthropic',
      }));
      this.sendJson(res, 200, { object: 'list', data: models });
      return;
    }

    // Messages endpoint — the core translation path
    if (url === '/v1/messages' && method === 'POST') {
      await this.handleMessages(req, res);
      return;
    }

    // Unknown route
    this.sendErrorResponse(
      res,
      404,
      'not_found_error',
      `Unknown route: ${method} ${url}`,
    );
  }

  // ---------------------------------------------------------------------------
  // POST /v1/messages — core proxy logic
  // ---------------------------------------------------------------------------

  /**
   * Handle POST /v1/messages:
   * 1. Parse Anthropic request body
   * 2. Determine API endpoint (Chat Completions vs Responses API)
   * 3. Translate to appropriate OpenAI format
   * 4. Forward to upstream API with auth headers
   * 5. Translate response back to Anthropic format
   */
  private async handleMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const requestId = this.generateRequestId();

    // Parse incoming body
    let anthropicRequest: AnthropicMessagesRequest;
    try {
      const body = await this.readBody(req);
      anthropicRequest = JSON.parse(body);
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('exceeds')
          ? err.message
          : 'Invalid JSON in request body';
      const status =
        err instanceof Error && err.message.includes('exceeds') ? 413 : 400;
      this.sendErrorResponse(res, status, 'invalid_request_error', message);
      return;
    }

    // Normalize model ID (provider-specific — subclasses can override)
    anthropicRequest.model = this.normalizeModelId(anthropicRequest.model);

    const useResponsesApi = this.shouldUseResponsesApi(anthropicRequest.model);

    this.logger.debug(
      `${this.logPrefix} [${requestId}] Translating request for model: ${anthropicRequest.model}, ` +
        `stream: ${!!anthropicRequest.stream}, messages: ${
          anthropicRequest.messages?.length ?? 0
        }, api: ${useResponsesApi ? 'responses' : 'completions'}`,
    );

    if (useResponsesApi) {
      // GPT-5.3+ models → Responses API
      const responsesRequest = translateAnthropicToResponses(anthropicRequest, {
        modelPrefix: this.config.modelPrefix,
      });

      try {
        await this.forwardToResponsesApi(
          responsesRequest,
          anthropicRequest,
          res,
          requestId,
          false,
        );
      } catch (error) {
        if (!res.headersSent) {
          this.logger.error(
            `${
              this.logPrefix
            } [${requestId}] Forward to Responses API failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          this.sendErrorResponse(
            res,
            500,
            'api_error',
            `Failed to communicate with ${this.config.name} API`,
          );
        }
      }
    } else {
      // All other models → Chat Completions API
      const openaiRequest = translateAnthropicToOpenAI(anthropicRequest, {
        modelPrefix: this.config.modelPrefix,
      });

      try {
        await this.forwardToUpstream(
          openaiRequest,
          anthropicRequest,
          res,
          requestId,
          false,
        );
      } catch (error) {
        if (!res.headersSent) {
          this.logger.error(
            `${this.logPrefix} [${requestId}] Forward failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          this.sendErrorResponse(
            res,
            500,
            'api_error',
            `Failed to communicate with ${this.config.name} API`,
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Provider-specific hooks — subclasses may override
  // ---------------------------------------------------------------------------

  /**
   * Normalize model ID before forwarding to the upstream API.
   * Default: pass through as-is (no modification).
   * Subclasses can override for provider-specific normalization.
   */
  protected normalizeModelId(modelId: string): string {
    return modelId;
  }

  /**
   * Determine whether a model should use the Responses API (/responses)
   * instead of Chat Completions (/chat/completions).
   *
   * Default: returns false (Chat Completions only).
   * Subclasses that support dual-endpoint routing should override.
   */
  protected shouldUseResponsesApi(_modelId: string): boolean {
    return false;
  }

  /**
   * Forward the translated Chat Completions request to the upstream API.
   * Delegates to the shared `forwardToApi()` with completions-specific handlers.
   */
  private async forwardToUpstream(
    openaiRequest: OpenAIChatCompletionsRequest,
    originalRequest: AnthropicMessagesRequest,
    res: http.ServerResponse,
    requestId: string,
    isRetry: boolean,
  ): Promise<void> {
    return this.forwardToApi({
      requestBody: JSON.stringify(openaiRequest),
      path: this.config.completionsPath,
      originalRequest,
      res,
      requestId,
      isRetry,
      apiLabel: 'API',
      onStreamingSuccess: (proxyRes, clientRes, model, reqId) =>
        this.handleStreamingResponse(proxyRes, clientRes, model, reqId),
      onNonStreamingSuccess: (proxyRes, clientRes, model, reqId) =>
        this.handleNonStreamingResponse(proxyRes, clientRes, model, reqId),
      retryFn: (retry) =>
        this.forwardToUpstream(
          openaiRequest,
          originalRequest,
          res,
          requestId,
          retry,
        ),
    });
  }

  /**
   * Forward a Responses API request to the upstream API.
   * Delegates to the shared `forwardToApi()` with responses-specific handlers.
   */
  private async forwardToResponsesApi(
    responsesRequest: OpenAIResponsesRequest,
    originalRequest: AnthropicMessagesRequest,
    res: http.ServerResponse,
    requestId: string,
    isRetry: boolean,
  ): Promise<void> {
    const responsesPath = this.config.responsesPath ?? '/responses';

    return this.forwardToApi({
      requestBody: JSON.stringify(responsesRequest),
      path: responsesPath,
      originalRequest,
      res,
      requestId,
      isRetry,
      apiLabel: 'Responses API',
      onStreamingSuccess: (proxyRes, clientRes, model, reqId) =>
        this.handleResponsesStreamingResponse(
          proxyRes,
          clientRes,
          model,
          reqId,
        ),
      onNonStreamingSuccess: (proxyRes, clientRes, model, reqId) =>
        this.handleResponsesNonStreamingResponse(
          proxyRes,
          clientRes,
          model,
          reqId,
        ),
      retryFn: (retry) =>
        this.forwardToResponsesApi(
          responsesRequest,
          originalRequest,
          res,
          requestId,
          retry,
        ),
    });
  }

  /**
   * Shared forwarding logic for both Chat Completions and Responses API paths.
   * Handles auth, 401 retry, 429 rate limit, error status codes, timeout,
   * and dispatches to the appropriate streaming/non-streaming success handler.
   */
  private async forwardToApi(params: {
    requestBody: string;
    path: string;
    originalRequest: AnthropicMessagesRequest;
    res: http.ServerResponse;
    requestId: string;
    isRetry: boolean;
    apiLabel: string;
    onStreamingSuccess: (
      proxyRes: http.IncomingMessage,
      res: http.ServerResponse,
      model: string,
      requestId: string,
    ) => void;
    onNonStreamingSuccess: (
      proxyRes: http.IncomingMessage,
      res: http.ServerResponse,
      model: string,
      requestId: string,
    ) => Promise<void>;
    retryFn: (isRetry: boolean) => Promise<void>;
  }): Promise<void> {
    const {
      requestBody,
      path,
      originalRequest,
      res,
      requestId,
      isRetry,
      apiLabel,
      onStreamingSuccess,
      onNonStreamingSuccess,
      retryFn,
    } = params;

    // Get auth headers
    let headers: Record<string, string>;
    try {
      headers = await this.getHeaders();
    } catch (error) {
      this.sendErrorResponse(
        res,
        401,
        'authentication_error',
        `${this.config.name} authentication failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // Get the API endpoint and build target URL
    const apiEndpoint = await this.getApiEndpoint();
    const targetUrl = this.buildUpstreamUrl(apiEndpoint, path);

    this.logger.info(
      `${this.logPrefix} [${requestId}] Forwarding to ${apiLabel}: ${targetUrl.href}`,
    );

    return new Promise<void>((resolve, reject) => {
      const requestFn =
        targetUrl.protocol === 'http:' ? http.request : https.request;
      const proxyReq = requestFn(
        targetUrl,
        {
          method: 'POST',
          timeout: 600_000, // 10 minutes — large repos need time for LLM processing
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(requestBody).toString(),
          },
        },
        (proxyRes) => {
          const statusCode = proxyRes.statusCode ?? 500;

          // Handle 401 -- refresh token and retry once
          if (statusCode === 401 && !isRetry) {
            this.logger.warn(
              `${this.logPrefix} [${requestId}] Got 401 from ${apiLabel}, attempting token refresh and retry...`,
            );
            // Consume the response body to free the socket
            proxyRes.resume();
            this.onAuthFailure()
              .then((success) => {
                if (success) {
                  retryFn(true).then(resolve).catch(reject);
                } else {
                  this.sendErrorResponse(
                    res,
                    401,
                    'authentication_error',
                    `${this.config.name} token refresh failed. Please re-authenticate.`,
                  );
                  resolve();
                }
              })
              .catch((err) => {
                this.sendErrorResponse(
                  res,
                  401,
                  'authentication_error',
                  `Token refresh error: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
                resolve();
              });
            return;
          }

          // Handle 429 -- rate limit
          // IMPORTANT: Return 429 rate_limit_error (NOT 529 overloaded_error).
          // The Claude Agent SDK retries 529 aggressively with backoff, which
          // creates a retry amplification loop: each retry sends a new request
          // to the upstream API, consuming another premium request, which gets
          // rate-limited again → another 529 → another retry. This burns through
          // Copilot premium requests until max_retries is exhausted.
          // Returning 429 with retry-after lets the SDK handle rate limits properly.
          if (statusCode === 429) {
            const retryAfter = proxyRes.headers['retry-after'];
            const retryMsg = retryAfter
              ? ` Retry after ${retryAfter} seconds.`
              : '';
            this.logger.warn(
              `${this.logPrefix} [${requestId}] Rate limited by ${this.config.name} ${apiLabel}${retryMsg}`,
            );
            proxyRes.resume();

            // Pass through retry-after header so the SDK can respect it
            const headers: Record<string, string> = {};
            if (retryAfter) {
              headers['retry-after'] = retryAfter;
            }

            this.sendErrorResponse(
              res,
              429,
              'rate_limit_error',
              `${this.config.name} API rate limit exceeded.${retryMsg} Please wait and try again.`,
              headers,
            );
            resolve();
            return;
          }

          // Handle other error status codes
          if (statusCode >= 400) {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
            proxyRes.on('end', () => {
              const errorBody = Buffer.concat(chunks).toString('utf8');
              this.logger.error(
                `${this.logPrefix} [${requestId}] ${
                  this.config.name
                } ${apiLabel} error ${statusCode}: ${errorBody.substring(
                  0,
                  500,
                )}`,
              );
              this.sendErrorResponse(
                res,
                statusCode,
                'api_error',
                `${
                  this.config.name
                } API error (${statusCode}): ${errorBody.substring(0, 200)}`,
              );
              resolve();
            });
            return;
          }

          // Success -- translate response
          if (originalRequest.stream) {
            onStreamingSuccess(proxyRes, res, originalRequest.model, requestId);
            proxyRes.on('end', () => resolve());
            proxyRes.on('error', (err) => reject(err));
          } else {
            onNonStreamingSuccess(
              proxyRes,
              res,
              originalRequest.model,
              requestId,
            )
              .then(resolve)
              .catch(reject);
          }
        },
      );

      proxyReq.on('timeout', () => {
        this.logger.error(
          `${this.logPrefix} [${requestId}] ${apiLabel} request timed out after 600s`,
        );
        proxyReq.destroy();
        if (!res.headersSent) {
          this.sendErrorResponse(
            res,
            504,
            'api_error',
            `${this.config.name} API request timed out`,
          );
        }
        resolve();
      });

      proxyReq.on('error', (err) => {
        this.logger.error(
          `${this.logPrefix} [${requestId}] ${apiLabel} request error: ${err.message}`,
        );
        reject(err);
      });

      proxyReq.write(requestBody);
      proxyReq.end();
    });
  }

  // ---------------------------------------------------------------------------
  // Response handling
  // ---------------------------------------------------------------------------

  /**
   * Handle a streaming response from the upstream Responses API.
   * Reads Responses SSE events, translates to Anthropic SSE, and writes to client.
   */
  private handleResponsesStreamingResponse(
    proxyRes: http.IncomingMessage,
    res: http.ServerResponse,
    model: string,
    requestId: string,
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });

    const translator = new ResponsesStreamTranslator(model, requestId);

    // Emit the initial message_start event
    res.write(translator.getInitialEvents());

    proxyRes.setEncoding('utf8');

    proxyRes.on('data', (chunk: string) => {
      const events = translator.processChunk(chunk);
      for (const event of events) {
        res.write(event);
      }
    });

    proxyRes.on('end', () => {
      res.end();
      this.logger.debug(
        `${this.logPrefix} [${requestId}] Responses API streaming response complete`,
      );
    });

    proxyRes.on('error', (err) => {
      this.logger.error(
        `${this.logPrefix} [${requestId}] Responses API stream error: ${err.message}`,
      );
      res.end();
    });
  }

  /**
   * Handle a non-streaming response from the upstream Responses API.
   * Reads the complete Responses JSON response, translates to Anthropic format.
   */
  private async handleResponsesNonStreamingResponse(
    proxyRes: http.IncomingMessage,
    res: http.ServerResponse,
    model: string,
    requestId: string,
  ): Promise<void> {
    const chunks: Buffer[] = [];

    return new Promise<void>((resolve) => {
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const responsesResponse = JSON.parse(body);

          // Build an Anthropic-format non-streaming response from Responses API output
          const content: Array<Record<string, unknown>> = [];
          let stopReason = 'end_turn';

          if (responsesResponse.output) {
            for (const outputItem of responsesResponse.output) {
              if (outputItem.type === 'message' && outputItem.content) {
                for (const contentItem of outputItem.content) {
                  if (contentItem.type === 'output_text' && contentItem.text) {
                    content.push({
                      type: 'text',
                      text: contentItem.text,
                    });
                  }
                }
              } else if (outputItem.type === 'function_call') {
                stopReason = 'tool_use';
                content.push({
                  type: 'tool_use',
                  id:
                    outputItem.call_id ??
                    `toolu_${requestId}_${content.length}`,
                  name: outputItem.name ?? '',
                  input: this.safeJsonParse(outputItem.arguments ?? '{}'),
                });
              }
            }
          }

          const anthropicResponse = {
            id: `msg_${requestId}`,
            type: 'message',
            role: 'assistant',
            content,
            model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
              input_tokens: responsesResponse.usage?.input_tokens ?? 0,
              output_tokens: responsesResponse.usage?.output_tokens ?? 0,
            },
          };

          this.sendJson(res, 200, anthropicResponse);
          this.logger.debug(
            `${this.logPrefix} [${requestId}] Responses API non-streaming response sent`,
          );
        } catch (error) {
          this.logger.error(
            `${this.logPrefix} [${requestId}] Failed to translate Responses API non-streaming response: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          this.sendErrorResponse(
            res,
            500,
            'api_error',
            `Failed to translate ${this.config.name} response`,
          );
        }
        resolve();
      });

      proxyRes.on('error', (err) => {
        this.logger.error(
          `${this.logPrefix} [${requestId}] Responses API response read error: ${err.message}`,
        );
        if (!res.headersSent) {
          this.sendErrorResponse(
            res,
            500,
            'api_error',
            `Error reading ${this.config.name} response`,
          );
        }
        resolve();
      });
    });
  }

  /**
   * Handle a streaming response from the upstream API.
   * Reads OpenAI SSE chunks, translates to Anthropic SSE, and writes to client.
   */
  private handleStreamingResponse(
    proxyRes: http.IncomingMessage,
    res: http.ServerResponse,
    model: string,
    requestId: string,
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });

    const translator = new OpenAIResponseTranslator(model, requestId);
    let buffer = '';

    proxyRes.setEncoding('utf8');

    proxyRes.on('data', (chunk: string) => {
      buffer += chunk;

      // Process complete SSE lines
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and non-data lines
        if (!trimmed || !trimmed.startsWith('data: ')) {
          continue;
        }

        const data = trimmed.slice(6); // Remove 'data: ' prefix

        // End of stream marker
        if (data === '[DONE]') {
          const finalEvents = translator.finalize();
          for (const event of finalEvents) {
            res.write(event);
          }
          continue;
        }

        // Parse and translate the OpenAI chunk
        try {
          const openaiChunk = JSON.parse(data);
          const anthropicEvents = translator.translateChunk(openaiChunk);
          for (const event of anthropicEvents) {
            res.write(event);
          }
        } catch {
          this.logger.warn(
            `${
              this.logPrefix
            } [${requestId}] Failed to parse SSE chunk: ${data.substring(
              0,
              100,
            )}`,
          );
        }
      }
    });

    proxyRes.on('end', () => {
      // Process any remaining buffer content
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
          try {
            const openaiChunk = JSON.parse(trimmed.slice(6));
            const events = translator.translateChunk(openaiChunk);
            for (const event of events) {
              res.write(event);
            }
          } catch {
            // Ignore parse errors in trailing buffer
          }
        }
      }

      res.end();
      this.logger.debug(
        `${this.logPrefix} [${requestId}] Streaming response complete`,
      );
    });

    proxyRes.on('error', (err) => {
      this.logger.error(
        `${this.logPrefix} [${requestId}] Stream error: ${err.message}`,
      );
      res.end();
    });
  }

  /**
   * Handle a non-streaming response from the upstream API.
   * Reads the complete OpenAI JSON response, translates to Anthropic format.
   */
  private async handleNonStreamingResponse(
    proxyRes: http.IncomingMessage,
    res: http.ServerResponse,
    model: string,
    requestId: string,
  ): Promise<void> {
    const chunks: Buffer[] = [];

    return new Promise<void>((resolve) => {
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const openaiResponse = JSON.parse(body);

          // Build an Anthropic-format non-streaming response
          const choice = openaiResponse.choices?.[0];
          const content: Array<Record<string, unknown>> = [];

          if (choice?.message?.content) {
            content.push({
              type: 'text',
              text: choice.message.content,
            });
          }

          if (choice?.message?.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
              content.push({
                type: 'tool_use',
                id: toolCall.id ?? `toolu_${requestId}_${content.length}`,
                name: toolCall.function?.name ?? '',
                input: this.safeJsonParse(toolCall.function?.arguments ?? '{}'),
              });
            }
          }

          // Map finish reason
          let stopReason = 'end_turn';
          if (choice?.finish_reason === 'tool_calls') stopReason = 'tool_use';
          else if (choice?.finish_reason === 'length')
            stopReason = 'max_tokens';

          const anthropicResponse = {
            id: `msg_${requestId}`,
            type: 'message',
            role: 'assistant',
            content,
            model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
              input_tokens: openaiResponse.usage?.prompt_tokens ?? 0,
              output_tokens: openaiResponse.usage?.completion_tokens ?? 0,
            },
          };

          this.sendJson(res, 200, anthropicResponse);
          this.logger.debug(
            `${this.logPrefix} [${requestId}] Non-streaming response sent`,
          );
        } catch (error) {
          this.logger.error(
            `${this.logPrefix} [${requestId}] Failed to translate non-streaming response: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          this.sendErrorResponse(
            res,
            500,
            'api_error',
            `Failed to translate ${this.config.name} response`,
          );
        }
        resolve();
      });

      proxyRes.on('error', (err) => {
        this.logger.error(
          `${this.logPrefix} [${requestId}] Response read error: ${err.message}`,
        );
        if (!res.headersSent) {
          this.sendErrorResponse(
            res,
            500,
            'api_error',
            `Error reading ${this.config.name} response`,
          );
        }
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Utility methods
  // ---------------------------------------------------------------------------

  /**
   * Read the full body of an incoming HTTP request.
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error(`Request body exceeds ${MAX_BODY_SIZE} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /**
   * Send a JSON response with optional extra headers.
   */
  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): void {
    const json = JSON.stringify(body);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json).toString(),
      ...extraHeaders,
    });
    res.end(json);
  }

  /**
   * Send an Anthropic-format error response with optional extra headers.
   */
  private sendErrorResponse(
    res: http.ServerResponse,
    statusCode: number,
    errorType: string,
    message: string,
    extraHeaders?: Record<string, string>,
  ): void {
    this.sendJson(
      res,
      statusCode,
      {
        type: 'error',
        error: {
          type: errorType,
          message,
        },
      },
      extraHeaders,
    );
  }

  /**
   * Build the full upstream URL by joining the base endpoint and path.
   * Unlike `new URL(path, base)` which replaces the base path when path
   * starts with '/', this method properly concatenates them:
   *   'https://api.openai.com/v1' + '/responses' → 'https://api.openai.com/v1/responses'
   *   'https://chatgpt.com/backend-api/codex' + '/responses' → 'https://chatgpt.com/backend-api/codex/responses'
   */
  private buildUpstreamUrl(baseEndpoint: string, path: string): URL {
    // Strip trailing slash from base, strip leading slash from path
    const base = baseEndpoint.replace(/\/+$/, '');
    const suffix = path.replace(/^\/+/, '');
    return new URL(`${base}/${suffix}`);
  }

  private generateRequestId(): string {
    const prefix = this.config.name.toLowerCase().substring(0, 3);
    return `${prefix}_${Date.now().toString(36)}_${(this
      .requestCounter++).toString(36)}`;
  }

  /**
   * Safely parse JSON, returning the parsed value or an empty object on failure.
   */
  private safeJsonParse(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str);
    } catch {
      return {};
    }
  }
}

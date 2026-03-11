/**
 * Codex Model Fetch & SDK Capabilities Test
 *
 * Validates the full Codex model listing pipeline:
 * 1. Auth token resolution from ~/.codex/auth.json
 * 2. CLI version detection
 * 3. Model API fetch from chatgpt.com backend
 * 4. Response parsing and model list display
 * 5. SDK initialization and capability check (MCP, system prompt)
 *
 * Usage: npx ts-node apps/infra-test/src/test-codex-models.ts
 */
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import whichLib from 'which';

const execFileAsync = promisify(execFile);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCliPath(binary: string): Promise<string | null> {
  try {
    return await whichLib(binary);
  } catch {
    return null;
  }
}

// ── Test 1: Auth Token Resolution ────────────────────────────────────────────

async function testAuthResolution(): Promise<{
  token: string | null;
  tokenType: 'api_key' | 'oauth' | null;
  authFilePath: string;
  authFileExists: boolean;
  rawAuthKeys?: string[];
}> {
  console.log('\n=== Test 1: Auth Token Resolution ===\n');

  const authPath = join(homedir(), '.codex', 'auth.json');
  console.log(`  Auth file path: ${authPath}`);

  try {
    const raw = await readFile(authPath, 'utf-8');
    console.log('  [OK] Auth file found and readable');

    const auth = JSON.parse(raw) as {
      OPENAI_API_KEY?: string | null;
      tokens?: {
        access_token?: string;
        refresh_token?: string;
        expires_at?: number;
      };
    };

    const rawKeys = Object.keys(auth);
    console.log(`  Auth file keys: ${rawKeys.join(', ')}`);

    // Check token expiry if OAuth
    if (auth.tokens?.expires_at) {
      const expiresAt = new Date(auth.tokens.expires_at * 1000);
      const now = new Date();
      const isExpired = expiresAt < now;
      console.log(`  OAuth token expires: ${expiresAt.toISOString()}`);
      console.log(`  Token expired: ${isExpired}`);
      if (isExpired) {
        console.log(
          '  [WARN] OAuth token is EXPIRED — API call will likely fail'
        );
        console.log('  [HINT] Run `codex` interactively to refresh the token');
      }
    }

    // API key takes priority
    if (auth.OPENAI_API_KEY) {
      const masked =
        auth.OPENAI_API_KEY.substring(0, 8) +
        '...' +
        auth.OPENAI_API_KEY.substring(auth.OPENAI_API_KEY.length - 4);
      console.log(`  [OK] OPENAI_API_KEY found: ${masked}`);
      return {
        token: auth.OPENAI_API_KEY,
        tokenType: 'api_key',
        authFilePath: authPath,
        authFileExists: true,
        rawAuthKeys: rawKeys,
      };
    }

    if (auth.tokens?.access_token) {
      const masked =
        auth.tokens.access_token.substring(0, 20) +
        '...' +
        auth.tokens.access_token.substring(auth.tokens.access_token.length - 4);
      console.log(`  [OK] OAuth access_token found: ${masked}`);
      return {
        token: auth.tokens.access_token,
        tokenType: 'oauth',
        authFilePath: authPath,
        authFileExists: true,
        rawAuthKeys: rawKeys,
      };
    }

    console.log('  [FAIL] Auth file exists but no usable token found');
    console.log(`  File structure: ${JSON.stringify(rawKeys)}`);
    return {
      token: null,
      tokenType: null,
      authFilePath: authPath,
      authFileExists: true,
      rawAuthKeys: rawKeys,
    };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message.includes('ENOENT')) {
      console.log('  [FAIL] Auth file not found at expected path');
      console.log('  [HINT] Run `codex` interactively to create auth file');
    } else {
      console.log(`  [FAIL] Error reading auth file: ${err.message}`);
    }
    return {
      token: null,
      tokenType: null,
      authFilePath: authPath,
      authFileExists: false,
    };
  }
}

// ── Test 2: CLI Version Detection ────────────────────────────────────────────

async function testCliVersion(): Promise<string> {
  console.log('\n=== Test 2: CLI Version Detection ===\n');

  const binaryPath = await resolveCliPath('codex');
  console.log(`  Binary path: ${binaryPath ?? 'NOT FOUND'}`);

  if (!binaryPath) {
    console.log('  [FAIL] Codex CLI not installed');
    return '0.107.0';
  }

  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], {
      timeout: 5000,
    });
    const versionRaw = stdout.trim();
    console.log(`  Version output: "${versionRaw}"`);

    const match = versionRaw.match(/[\d.]+/);
    const version = match ? match[0] : '0.107.0';
    console.log(`  [OK] Parsed version: ${version}`);
    return version;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`  [FAIL] Version check failed: ${err.message}`);
    console.log('  Using fallback version: 0.107.0');
    return '0.107.0';
  }
}

// ── Test 3: Model API Fetch ──────────────────────────────────────────────────

interface ModelApiResponse {
  models?: Array<{
    slug: string;
    name?: string;
    description?: string;
    is_default?: boolean;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

async function testModelApiFetch(
  token: string | null,
  version: string
): Promise<void> {
  console.log('\n=== Test 3: Model API Fetch ===\n');

  if (!token) {
    console.log('  [SKIP] No auth token available — cannot call models API');
    console.log('  The extension falls back to FALLBACK_MODELS:');
    console.log('    - gpt-5.3-codex');
    console.log('    - gpt-5.2-codex');
    console.log('    - gpt-5.1-codex-max');
    console.log('    - gpt-5.2');
    console.log('    - gpt-5.1-codex-mini');
    return;
  }

  const url = `https://chatgpt.com/backend-api/codex/models?client_version=${version}`;
  console.log(`  API URL: ${url}`);
  console.log(`  Auth: Bearer ${token.substring(0, 12)}...`);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    console.log(`  HTTP Status: ${response.status} ${response.statusText}`);
    console.log(
      `  Content-Type: ${response.headers.get('content-type') ?? 'N/A'}`
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '<unreadable>');
      console.log(`  [FAIL] API returned error`);
      console.log(
        `  Response body (first 500 chars): ${errorBody.substring(0, 500)}`
      );

      if (response.status === 401 || response.status === 403) {
        console.log(
          '  [DIAGNOSIS] Auth token rejected — likely expired or invalid'
        );
        console.log(
          '  [HINT] Run `codex` interactively to refresh OAuth token'
        );
      }
      return;
    }

    const body = (await response.json()) as ModelApiResponse;
    console.log(`  [OK] API response received`);
    console.log(`  Response top-level keys: ${Object.keys(body).join(', ')}`);

    if (!body.models?.length) {
      console.log('  [WARN] models array is empty or missing');
      console.log(
        `  Full response: ${JSON.stringify(body, null, 2).substring(0, 1000)}`
      );
      return;
    }

    console.log(`  [OK] Found ${body.models.length} models:\n`);

    // Display models in a table format
    console.log('  ' + 'Slug'.padEnd(30) + 'Name'.padEnd(30) + 'Default');
    console.log('  ' + '-'.repeat(70));

    for (const model of body.models) {
      const slug = (model.slug ?? '').padEnd(30);
      const name = (model.name ?? formatModelName(model.slug)).padEnd(30);
      const isDefault = model.is_default ? 'YES' : '';
      console.log(`  ${slug}${name}${isDefault}`);
    }

    // Show extra fields per model (for discovery)
    console.log('\n  [DEBUG] Full model objects:');
    for (const model of body.models) {
      const extraKeys = Object.keys(model).filter(
        (k) => !['slug', 'name', 'description', 'is_default'].includes(k)
      );
      if (extraKeys.length > 0) {
        console.log(`    ${model.slug}: extra keys = ${extraKeys.join(', ')}`);
      }
    }

    // Compare with our fallback list
    console.log('\n  --- Comparison with FALLBACK_MODELS ---');
    const fallbackSlugs = [
      'gpt-5.3-codex',
      'gpt-5.2-codex',
      'gpt-5.1-codex-max',
      'gpt-5.2',
      'gpt-5.1-codex-mini',
    ];
    const apiSlugs = body.models.map((m) => m.slug);

    const inApiNotFallback = apiSlugs.filter((s) => !fallbackSlugs.includes(s));
    const inFallbackNotApi = fallbackSlugs.filter((s) => !apiSlugs.includes(s));

    if (inApiNotFallback.length > 0) {
      console.log(
        `  [STALE] Models in API but NOT in fallback: ${inApiNotFallback.join(
          ', '
        )}`
      );
    }
    if (inFallbackNotApi.length > 0) {
      console.log(
        `  [STALE] Models in fallback but NOT in API: ${inFallbackNotApi.join(
          ', '
        )}`
      );
    }
    if (inApiNotFallback.length === 0 && inFallbackNotApi.length === 0) {
      console.log('  [OK] Fallback list matches API exactly');
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`  [FAIL] API fetch failed: ${err.message}`);
    if (err.message.includes('timeout') || err.message.includes('Timeout')) {
      console.log(
        '  [DIAGNOSIS] Request timed out — chatgpt.com may be blocking non-browser requests'
      );
    }
    if (err.message.includes('fetch')) {
      console.log(
        '  [DIAGNOSIS] Network error — check connectivity to chatgpt.com'
      );
    }
  }
}

// ── Test 4: SDK Import & Capabilities ────────────────────────────────────────

async function testSdkCapabilities(): Promise<void> {
  console.log('\n=== Test 4: SDK Import & Capabilities ===\n');

  try {
    console.log('  [1] Importing @openai/codex-sdk...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = await (Function(
      'return import("@openai/codex-sdk")'
    )() as Promise<any>);
    console.log('  [OK] SDK imported');
    console.log(`  SDK exports: ${Object.keys(sdk).join(', ')}`);

    // Check Codex constructor options
    console.log('\n  [2] Checking Codex constructor...');
    const codex = new sdk.Codex({});
    console.log('  [OK] Codex instance created (no options)');
    console.log(
      `  Codex instance methods: ${Object.getOwnPropertyNames(
        Object.getPrototypeOf(codex)
      )
        .filter((k: string) => k !== 'constructor')
        .join(', ')}`
    );

    // Check if SDK exposes listModels or similar
    const hasListModels = typeof codex.listModels === 'function';
    const hasGetModels = typeof codex.getModels === 'function';
    const hasModels = typeof codex.models === 'object' && codex.models !== null;
    console.log(`  SDK has listModels(): ${hasListModels}`);
    console.log(`  SDK has getModels(): ${hasGetModels}`);
    console.log(`  SDK has models object: ${hasModels}`);

    // If SDK has a native model listing method, try it
    if (hasListModels) {
      console.log('\n  [3] Testing SDK listModels()...');
      try {
        const models = await codex.listModels();
        console.log(
          `  [OK] SDK listModels() returned ${models?.length ?? 0} models`
        );
        if (Array.isArray(models)) {
          for (const m of models.slice(0, 10)) {
            console.log(`    - ${JSON.stringify(m)}`);
          }
        }
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.log(`  [FAIL] SDK listModels() error: ${e.message}`);
      }
    }

    // Check thread options for system prompt support
    console.log('\n  [4] Checking thread/session capabilities...');
    console.log(
      '  Codex SDK thread options (from our types): workingDirectory, model, approvalPolicy, skipGitRepoCheck, sandboxMode'
    );
    console.log(
      '  [INFO] No native systemMessage channel — system prompt must be prepended to task text'
    );
    console.log(
      '  [INFO] MCP support: via config.mcp_servers in Codex constructor options'
    );

    // Test MCP config acceptance
    console.log('\n  [5] Testing MCP config...');
    try {
      const codexWithMcp = new sdk.Codex({
        config: {
          mcp_servers: {
            test_ptah: {
              url: 'http://localhost:12345',
            },
          },
        },
      });
      console.log('  [OK] Codex created with MCP config (no error thrown)');
      // Clean up - we don't need this instance
      void codexWithMcp;
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.log(`  [FAIL] MCP config rejected: ${e.message}`);
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`  [FAIL] SDK import failed: ${err.message}`);
    if (err.stack) {
      console.log(`  [STACK] ${err.stack.split('\n').slice(0, 5).join('\n')}`);
    }
  }
}

// ── Test 5: Quick SDK Run (model validation) ─────────────────────────────────

async function testSdkRun(): Promise<void> {
  console.log('\n=== Test 5: SDK Quick Run (validate model & streaming) ===\n');

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = await (Function(
      'return import("@openai/codex-sdk")'
    )() as Promise<any>);

    const codex = new sdk.Codex({});
    const thread = codex.startThread({
      workingDirectory: process.cwd(),
      approvalPolicy: 'never',
    });

    console.log(
      '  [1] Starting streamed turn with prompt: "What is 2+2? Reply with just the number."'
    );

    const abortController = new AbortController();
    const timer = setTimeout(() => {
      console.log('\n  [TIMEOUT] Aborting after 30s');
      abortController.abort();
    }, 30_000);

    try {
      const streamedTurn = await thread.runStreamed(
        'What is 2+2? Reply with just the number.',
        { signal: abortController.signal }
      );

      let eventCount = 0;
      let responseText = '';

      for await (const event of streamedTurn.events) {
        eventCount++;
        const type = (event as { type: string }).type;

        if (type === 'thread.started') {
          console.log(
            `  Event: thread.started (id: ${
              (event as { thread_id: string }).thread_id
            })`
          );
        } else if (type === 'turn.completed') {
          const usage = (
            event as { usage?: { input_tokens: number; output_tokens: number } }
          ).usage;
          console.log(
            `  Event: turn.completed (in: ${usage?.input_tokens}, out: ${usage?.output_tokens})`
          );
        } else if (type === 'item.completed') {
          const item = (event as { item?: { type: string; text?: string } })
            .item;
          if (item?.type === 'agent_message' && item.text) {
            responseText = item.text;
            console.log(
              `  Event: item.completed [agent_message] "${item.text.substring(
                0,
                100
              )}"`
            );
          }
        }

        if (eventCount > 30) {
          console.log('  [LIMIT] Stopping after 30 events');
          abortController.abort();
          break;
        }
      }

      console.log(`\n  [OK] Received ${eventCount} events`);
      console.log(`  Response: "${responseText}"`);
      console.log('  [OK] SDK execution works correctly');
    } finally {
      clearTimeout(timer);
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`  [FAIL] SDK run failed: ${err.message}`);
    if (err.stack) {
      console.log(`  [STACK] ${err.stack.split('\n').slice(0, 5).join('\n')}`);
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function formatModelName(slug: string): string {
  return slug
    .split('-')
    .map((part) => {
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('==========================================================');
  console.log('  Codex Model Fetch & SDK Capabilities Test');
  console.log('==========================================================\n');
  console.log(`Platform: ${process.platform}`);
  console.log(`Node: ${process.version}`);
  console.log(`Home: ${homedir()}`);
  console.log(`CWD: ${process.cwd()}`);

  // Check for --skip-run flag
  const skipRun = process.argv.includes('--skip-run');
  if (skipRun) {
    console.log(
      '\n  [NOTE] --skip-run flag detected — skipping SDK execution test'
    );
  }

  // Test 1: Auth
  const authResult = await testAuthResolution();

  // Test 2: CLI version
  const version = await testCliVersion();

  // Test 3: Model API fetch
  await testModelApiFetch(authResult.token, version);

  // Test 4: SDK capabilities
  await testSdkCapabilities();

  // Test 5: Quick SDK run (unless --skip-run)
  if (!skipRun) {
    await testSdkRun();
  }

  // Summary
  console.log('\n==========================================================');
  console.log('  Summary');
  console.log('==========================================================\n');

  console.log(
    `  Auth token: ${
      authResult.token ? 'Found (' + authResult.tokenType + ')' : 'MISSING'
    }`
  );
  console.log(`  CLI version: ${version}`);
  console.log(
    `  Auth file: ${authResult.authFileExists ? 'exists' : 'MISSING'}`
  );

  if (!authResult.token) {
    console.log('\n  [ACTION REQUIRED] No auth token found.');
    console.log('  The model list API requires authentication.');
    console.log('  Without it, the extension uses hardcoded FALLBACK_MODELS.');
    console.log('  Fix: Run `codex` in a terminal to authenticate.');
  }

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

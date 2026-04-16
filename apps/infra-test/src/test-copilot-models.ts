/**
 * Copilot Model Format Test
 *
 * Tests what model ID format the Copilot API actually accepts
 * by sending minimal requests with different model name formats.
 *
 * Usage: npx ts-node apps/infra-test/src/test-copilot-models.ts
 */
import * as https from 'https';
import * as http from 'http';

// Model formats to test — try both raw and prefixed variants
const MODEL_FORMATS = [
  'claude-sonnet-4.6', // Copilot CLI format (dotted)
  'copilot/claude-sonnet-4.6', // With copilot/ prefix
  'claude-sonnet-4-5', // Anthropic SDK format (hyphen)
  'copilot/claude-sonnet-4-5', // Copilot-prefixed SDK format
  'gpt-5.2', // Known valid Copilot model
  'copilot/gpt-5.2', // With prefix
  'claude-opus-4-7', // Opus (SDK format)
  'copilot/claude-opus-4-7', // Opus with prefix
];

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

interface TokenResponse {
  token: string;
  expires_at: number;
  endpoints?: { api: string };
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(Buffer.concat(chunks).toString('utf8'));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: object,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const bodyStr = JSON.stringify(body);
    const mod = parsedUrl.protocol === 'https:' ? https : http;

    const req = (mod as typeof https).request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            parsed = Buffer.concat(chunks).toString('utf8');
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function getGitHubToken(): Promise<string> {
  // Try to read from environment or a local token file
  if (process.env['GITHUB_TOKEN']) {
    return process.env['GITHUB_TOKEN'];
  }

  // Try VS Code auth - this only works inside VS Code extension host
  // For standalone testing, set GITHUB_TOKEN env var
  throw new Error(
    'Set GITHUB_TOKEN env var with a GitHub token that has copilot scope.\n' +
      'Get one from: https://github.com/settings/tokens (needs "copilot" scope)\n' +
      'Or extract from VS Code: Developer Tools > Application > Session Storage',
  );
}

async function exchangeForCopilotToken(
  githubToken: string,
): Promise<TokenResponse> {
  console.log('  Exchanging GitHub token for Copilot bearer token...');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: '/copilot_internal/v2/token',
        method: 'GET',
        headers: {
          Authorization: `token ${githubToken}`,
          'User-Agent': 'ptah-infra-test/1.0',
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Token exchange failed (${res.statusCode}): ${Buffer.concat(
                  chunks,
                ).toString()}`,
              ),
            );
            return;
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function testModelFormat(
  model: string,
  apiEndpoint: string,
  bearerToken: string,
): Promise<{
  model: string;
  status: number;
  error?: string;
  success: boolean;
}> {
  const body = {
    model,
    messages: [{ role: 'user', content: 'Say hi in one word' }],
    max_tokens: 10,
    stream: false,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    'Openai-Intent': 'conversation-edits',
    'User-Agent': 'ptah-infra-test/1.0',
    'Copilot-Integration-Id': 'vscode-chat',
    'x-initiator': 'user',
  };

  try {
    const result = await postJson(
      `${apiEndpoint}/chat/completions`,
      headers,
      body,
    );

    const success = result.status >= 200 && result.status < 300;
    const error = success
      ? undefined
      : typeof result.body === 'object'
        ? JSON.stringify(result.body).substring(0, 200)
        : String(result.body).substring(0, 200);

    return { model, status: result.status, error, success };
  } catch (err) {
    return {
      model,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      success: false,
    };
  }
}

async function main() {
  console.log('============================================================');
  console.log('Copilot Model Format Test');
  console.log('============================================================\n');

  // Step 1: Get GitHub token
  let githubToken: string;
  try {
    githubToken = await getGitHubToken();
    console.log(`✓ GitHub token found (length: ${githubToken.length})\n`);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  // Step 2: Exchange for Copilot bearer token
  let tokenResponse: TokenResponse;
  try {
    tokenResponse = await exchangeForCopilotToken(githubToken);
    const apiEndpoint =
      tokenResponse.endpoints?.api ?? 'https://api.githubcopilot.com';
    console.log(`✓ Copilot token obtained`);
    console.log(`  API endpoint: ${apiEndpoint}`);
    console.log(
      `  Expires: ${new Date(tokenResponse.expires_at * 1000).toISOString()}\n`,
    );
  } catch (err) {
    console.error(`✗ Token exchange failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const apiEndpoint =
    tokenResponse.endpoints?.api ?? 'https://api.githubcopilot.com';

  // Step 3: Test each model format
  console.log('Testing model formats against Copilot API...\n');
  console.log('  Model Format                        | Status | Result');
  console.log('  ------------------------------------|--------|--------');

  for (const model of MODEL_FORMATS) {
    const result = await testModelFormat(
      model,
      apiEndpoint,
      tokenResponse.token,
    );

    const statusStr = result.status.toString().padEnd(6);
    const resultStr = result.success
      ? '✓ SUCCESS'
      : `✗ ${result.error?.substring(0, 60) ?? 'FAILED'}`;
    const modelStr = model.padEnd(37);

    console.log(`  ${modelStr} | ${statusStr} | ${resultStr}`);
  }

  console.log('\n============================================================');
  console.log('Done!\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

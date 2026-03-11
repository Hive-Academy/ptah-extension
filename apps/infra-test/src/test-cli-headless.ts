/**
 * Headless CLI Agent Test
 *
 * Standalone test script that validates cross-platform CLI agent spawning.
 * Detects installed CLIs, spawns each in headless mode with a simple prompt,
 * and reports success/failure.
 *
 * Usage: npx ts-node apps/infra-test/src/test-cli-headless.ts
 */
import crossSpawn from 'cross-spawn';
import whichLib from 'which';

const TEST_PROMPT = 'What is 2+2? Reply with just the number.';
const TIMEOUT_MS = 30_000;

const CLI_CLEAN_ENV: Record<string, string> = {
  FORCE_COLOR: '0',
  NO_COLOR: '1',
  NODE_NO_READLINE: '1',
};

interface CliTestConfig {
  name: string;
  binary: string;
  /** Args for headless execution. Prompt is piped via stdin. */
  args: string[];
  /** Whether to pipe the prompt via stdin */
  useStdin: boolean;
}

const CLI_CONFIGS: CliTestConfig[] = [
  {
    name: 'Gemini CLI',
    binary: 'gemini',
    args: ['--prompt=', '--output-format', 'stream-json', '--yolo'],
    useStdin: true,
  },
  {
    name: 'Copilot CLI',
    binary: 'copilot',
    // cross-spawn passes args directly without shell — no cmd.exe mangling.
    // Disable MCP servers and custom instructions to avoid invalid schema errors.
    args: [
      '-p',
      TEST_PROMPT,
      '--yolo',
      '--no-ask-user',
      '--silent',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      '--disable-mcp-server',
      'daisyui',
      '--disable-mcp-server',
      'angular-cli',
      '--disable-mcp-server',
      'sequential-thinking',
    ],
    useStdin: false,
  },
  {
    name: 'Codex CLI',
    binary: 'codex',
    // `exec` subcommand for non-interactive mode
    args: ['exec', '--full-auto', '--ephemeral', TEST_PROMPT],
    useStdin: false,
  },
];

async function resolveCliPath(binary: string): Promise<string | null> {
  try {
    return await whichLib(binary);
  } catch {
    return null;
  }
}

async function testCli(config: CliTestConfig): Promise<{
  name: string;
  success: boolean;
  output: string;
  error?: string;
  exitCode: number | null;
  duration: number;
}> {
  const start = Date.now();
  const binaryPath = await resolveCliPath(config.binary);

  if (!binaryPath) {
    return {
      name: config.name,
      success: false,
      output: '',
      error: `Binary "${config.binary}" not found in PATH`,
      exitCode: null,
      duration: Date.now() - start,
    };
  }

  console.log(`  [${config.name}] Found at: ${binaryPath}`);
  console.log(
    `  [${config.name}] Spawning with args: ${config.args.join(' ')}`
  );

  return new Promise((resolve) => {
    const child = crossSpawn(config.binary, config.args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...CLI_CLEAN_ENV },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (data: string) => {
      stdout += data;
      // Show progress dots
      process.stdout.write('.');
    });

    child.stderr?.on('data', (data: string) => {
      stderr += data;
    });

    // Pipe prompt via stdin if configured
    if (config.useStdin) {
      child.stdin?.write(TEST_PROMPT + '\n');
      child.stdin?.end();
    }

    // Timeout guard
    const timer = setTimeout(() => {
      console.log(`\n  [${config.name}] TIMEOUT after ${TIMEOUT_MS / 1000}s`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3000);
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      const hasOutput = stdout.trim().length > 0;
      const hasError = stderr.includes('error') || stderr.includes('Error');

      console.log(''); // Newline after progress dots
      resolve({
        name: config.name,
        success: code === 0 && hasOutput && !hasError,
        output: stdout.substring(0, 500),
        error: hasError ? stderr.substring(0, 500) : undefined,
        exitCode: code,
        duration,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      console.log('');
      resolve({
        name: config.name,
        success: false,
        output: stdout,
        error: `Spawn error: ${err.message}`,
        exitCode: null,
        duration: Date.now() - start,
      });
    });
  });
}

async function main(): Promise<void> {
  console.log('=== Headless CLI Agent Test ===\n');
  console.log(`Platform: ${process.platform}`);
  console.log(`Node: ${process.version}`);
  console.log(`CWD: ${process.cwd()}`);
  console.log(`Prompt: "${TEST_PROMPT}"`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s per CLI\n`);

  // Phase 1: Detection
  console.log('--- Phase 1: CLI Detection ---\n');
  const detected: CliTestConfig[] = [];

  for (const config of CLI_CONFIGS) {
    const path = await resolveCliPath(config.binary);
    if (path) {
      console.log(`  [OK] ${config.name}: ${path}`);
      detected.push(config);
    } else {
      console.log(`  [--] ${config.name}: not installed`);
    }
  }

  if (detected.length === 0) {
    console.log('\nNo CLI agents found. Install at least one:');
    console.log('  npm install -g @google/gemini-cli');
    console.log('  npm install -g @anthropic-ai/claude-code (for copilot)');
    console.log('  npm install -g @openai/codex');
    process.exit(1);
  }

  // Phase 2: Headless spawn test
  console.log('\n--- Phase 2: Headless Spawn Test ---\n');
  const results = [];

  for (const config of detected) {
    console.log(`Testing ${config.name}...`);
    const result = await testCli(config);
    results.push(result);

    const status = result.success ? 'PASS' : 'FAIL';
    console.log(
      `  [${status}] Exit: ${result.exitCode}, Duration: ${(
        result.duration / 1000
      ).toFixed(1)}s`
    );
    if (result.output) {
      console.log(
        `  Output preview: ${result.output
          .substring(0, 200)
          .replace(/\n/g, '\\n')}`
      );
    }
    if (result.error) {
      console.log(`  Error: ${result.error.substring(0, 200)}`);
    }
    console.log('');
  }

  // Summary
  console.log('--- Summary ---\n');
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  for (const r of results) {
    const icon = r.success ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${r.name} (${(r.duration / 1000).toFixed(1)}s)`);
  }

  console.log(
    `\n  ${passed} passed, ${failed} failed out of ${results.length} tested\n`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

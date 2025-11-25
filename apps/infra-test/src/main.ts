/**
 * Infrastructure Test Application
 *
 * Tests Claude CLI spawn behavior outside of VS Code extension context
 * to identify issues with process spawning, shell execution, and JSONL parsing.
 */

import { spawn, exec, SpawnOptions } from 'child_process';
import * as os from 'os';
import * as path from 'path';

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: string;
  output?: string;
}

const results: TestResult[] = [];

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logSection(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

async function runTest(
  name: string,
  testFn: () => Promise<{ success: boolean; output?: string; error?: string }>
): Promise<void> {
  const start = Date.now();
  log(`Running: ${name}`);

  try {
    const result = await testFn();
    const duration = Date.now() - start;
    results.push({ name, ...result, duration });

    if (result.success) {
      log(`  ✅ PASSED (${duration}ms)`);
      if (result.output) {
        log(
          `  Output: ${result.output.substring(0, 200)}${
            result.output.length > 200 ? '...' : ''
          }`
        );
      }
    } else {
      log(`  ❌ FAILED (${duration}ms)`);
      if (result.error) {
        log(`  Error: ${result.error}`);
      }
    }
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, success: false, duration, error });
    log(`  ❌ EXCEPTION (${duration}ms): ${error}`);
  }
}

// Test 1: Check system environment
async function testSystemEnvironment(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  const info = {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    cwd: process.cwd(),
    shell: process.env['SHELL'] || process.env['ComSpec'] || 'unknown',
    pathSeparator: path.delimiter,
    pathDirs: (process.env['PATH'] || '').split(path.delimiter).length,
  };

  return {
    success: true,
    output: JSON.stringify(info, null, 2),
  };
}

// Test 2: Check if claude command exists using 'where' (Windows) or 'which' (Unix)
async function testClaudeInPath(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const cmd = os.platform() === 'win32' ? 'where claude' : 'which claude';

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        resolve({
          success: false,
          error: `Claude not found in PATH: ${stderr || error.message}`,
        });
      } else {
        resolve({
          success: true,
          output: `Claude found at: ${stdout.trim()}`,
        });
      }
    });
  });
}

// Test 3: Spawn claude --version with shell: false
async function testSpawnNoShell(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    log('  Spawning: claude --version (shell: false)');

    const proc = spawn('claude', ['--version'], options);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Spawn error: ${err.message} (code: ${
          (err as NodeJS.ErrnoException).code
        })`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim() || stderr.trim(),
        });
      } else {
        resolve({
          success: false,
          error: `Exit code ${code}: ${stderr || stdout}`,
        });
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: 'Timeout after 10 seconds',
      });
    }, 10000);
  });
}

// Test 4: Spawn claude --version with shell: true
async function testSpawnWithShell(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    log('  Spawning: claude --version (shell: true)');

    const proc = spawn('claude', ['--version'], options);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Spawn error: ${err.message} (code: ${
          (err as NodeJS.ErrnoException).code
        })`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim() || stderr.trim(),
        });
      } else {
        resolve({
          success: false,
          error: `Exit code ${code}: ${stderr || stdout}`,
        });
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: 'Timeout after 10 seconds',
      });
    }, 10000);
  });
}

// Test 5: Spawn claude --help to verify CLI works
async function testClaudeHelp(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    log('  Spawning: claude --help (shell: false)');

    const proc = spawn('claude', ['--help'], options);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Spawn error: ${err.message} (code: ${
          (err as NodeJS.ErrnoException).code
        })`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const hasExpectedContent =
          stdout.includes('claude') || stdout.includes('Usage');
        resolve({
          success: hasExpectedContent,
          output: hasExpectedContent
            ? `Help output received (${stdout.length} chars)`
            : `Unexpected output: ${stdout.substring(0, 100)}`,
        });
      } else {
        resolve({
          success: false,
          error: `Exit code ${code}: ${stderr || stdout}`,
        });
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: 'Timeout after 10 seconds',
      });
    }, 10000);
  });
}

// Test 6: Test JSONL parsing simulation
async function testJsonlParsing(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  const sampleJsonl = [
    '{"type":"system","subtype":"init","session_id":"test-123"}',
    '{"type":"assistant","message":{"role":"assistant","content":"Hello!"}}',
    '{"type":"result","subtype":"success","cost_usd":0.001}',
  ];

  try {
    const parsed = sampleJsonl.map((line) => JSON.parse(line));

    const hasInit = parsed.some(
      (p) => p.type === 'system' && p.subtype === 'init'
    );
    const hasAssistant = parsed.some((p) => p.type === 'assistant');
    const hasResult = parsed.some((p) => p.type === 'result');

    return {
      success: hasInit && hasAssistant && hasResult,
      output: `Parsed ${parsed.length} JSONL messages: init=${hasInit}, assistant=${hasAssistant}, result=${hasResult}`,
    };
  } catch (err) {
    return {
      success: false,
      error: `JSONL parse error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

// Test 7: Test with explicit .cmd path
async function testExplicitCmdPath(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    // Try to find claude.cmd and execute it directly
    const claudeCmdPath = 'C:\\Users\\abdal\\AppData\\Roaming\\npm\\claude.cmd';

    const options: SpawnOptions = {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    log(
      `  Spawning: "${claudeCmdPath}" --version (shell: true, explicit path)`
    );

    const proc = spawn(claudeCmdPath, ['--version'], options);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Spawn error: ${err.message} (code: ${
          (err as NodeJS.ErrnoException).code
        })`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim() || stderr.trim(),
        });
      } else {
        resolve({
          success: false,
          error: `Exit code ${code}: ${stderr || stdout}`,
        });
      }
    });

    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: 'Timeout after 10 seconds',
      });
    }, 10000);
  });
}

// Test 8: Test with explicit shell (cmd.exe)
async function testExplicitShell(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: 'C:\\Windows\\System32\\cmd.exe',
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    log('  Spawning: claude --version (shell: cmd.exe)');

    const proc = spawn('claude', ['--version'], options);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Spawn error: ${err.message} (code: ${
          (err as NodeJS.ErrnoException).code
        })`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim() || stderr.trim(),
        });
      } else {
        resolve({
          success: false,
          error: `Exit code ${code}: ${stderr || stdout}`,
        });
      }
    });

    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: 'Timeout after 10 seconds',
      });
    }, 10000);
  });
}

// Test 9: Check shell environment variables
async function testShellEnvironment(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  const shellInfo = {
    SHELL: process.env['SHELL'] || 'not set',
    ComSpec: process.env['ComSpec'] || 'not set',
    COMSPEC: process.env['COMSPEC'] || 'not set',
    SystemRoot: process.env['SystemRoot'] || 'not set',
    windir: process.env['windir'] || 'not set',
  };

  return {
    success: true,
    output: JSON.stringify(shellInfo, null, 2),
  };
}

// Test 10: Interactive mode spawn test (short timeout)
async function testInteractiveSpawn(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: true, // Required on Windows for .cmd files
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    log(
      '  Spawning: claude -p "Say hello" --output-format stream-json (shell: true)'
    );

    const proc = spawn(
      'claude',
      ['-p', 'Say hello in one word', '--output-format', 'stream-json'],
      options
    );
    let stdout = '';
    let stderr = '';
    const jsonLines: unknown[] = [];

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Try to parse JSONL lines
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          jsonLines.push(JSON.parse(line));
        } catch {
          // Not valid JSON, skip
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Spawn error: ${err.message} (code: ${
          (err as NodeJS.ErrnoException).code
        })`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0 || jsonLines.length > 0) {
        resolve({
          success: true,
          output: `Received ${jsonLines.length} JSON messages, exit code: ${code}`,
        });
      } else {
        resolve({
          success: false,
          error: `Exit code ${code}: ${stderr || stdout.substring(0, 200)}`,
        });
      }
    });

    // Timeout after 30 seconds for API call
    setTimeout(() => {
      proc.kill();
      if (jsonLines.length > 0) {
        resolve({
          success: true,
          output: `Timeout but received ${jsonLines.length} JSON messages`,
        });
      } else {
        resolve({
          success: false,
          error: 'Timeout after 30 seconds with no JSON output',
        });
      }
    }, 30000);
  });
}

// Test 11: Verify cross-platform shell execution logic
async function testCrossPlatformLogic(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  /**
   * This test verifies the logic used in ClaudeProcess.needsShellExecution()
   * would work correctly across platforms
   */
  const needsShellExecution = (cliPath: string, platform: string): boolean => {
    // On non-Windows, never need shell
    if (platform !== 'win32') {
      return false;
    }

    const pathLower = cliPath.toLowerCase();

    // If it's an explicit .exe with full path, we can spawn directly
    if (pathLower.endsWith('.exe') && pathLower.includes('\\')) {
      return false;
    }

    // Everything else on Windows needs shell
    return true;
  };

  const testCases = [
    // Windows cases
    {
      path: 'claude',
      platform: 'win32',
      expected: true,
      reason: 'PATH command needs shell',
    },
    {
      path: 'C:\\npm\\claude.cmd',
      platform: 'win32',
      expected: true,
      reason: '.cmd needs shell',
    },
    {
      path: 'C:\\Program Files\\claude.exe',
      platform: 'win32',
      expected: false,
      reason: 'Full path .exe can spawn directly',
    },
    {
      path: './claude',
      platform: 'win32',
      expected: true,
      reason: 'Relative path needs shell',
    },
    // macOS cases
    {
      path: 'claude',
      platform: 'darwin',
      expected: false,
      reason: 'macOS no shell needed',
    },
    {
      path: '/usr/local/bin/claude',
      platform: 'darwin',
      expected: false,
      reason: 'macOS full path no shell',
    },
    // Linux cases
    {
      path: 'claude',
      platform: 'linux',
      expected: false,
      reason: 'Linux no shell needed',
    },
    {
      path: '/usr/bin/claude',
      platform: 'linux',
      expected: false,
      reason: 'Linux full path no shell',
    },
  ];

  const results: string[] = [];
  let allPassed = true;

  for (const tc of testCases) {
    const actual = needsShellExecution(tc.path, tc.platform);
    const passed = actual === tc.expected;
    if (!passed) allPassed = false;

    results.push(
      `${passed ? '✅' : '❌'} ${tc.platform}: "${
        tc.path
      }" -> shell:${actual} (expected:${tc.expected}) - ${tc.reason}`
    );
  }

  return {
    success: allPassed,
    output: results.join('\n'),
    error: allPassed ? undefined : 'Some cross-platform tests failed',
  };
}

// Main execution
async function main(): Promise<void> {
  logSection('PTAH Infrastructure Test Suite');
  log('Testing Claude CLI spawn behavior outside VS Code context');

  logSection('Environment Tests');
  await runTest('System Environment', testSystemEnvironment);
  await runTest('Claude in PATH', testClaudeInPath);

  logSection('Spawn Tests (shell: false - recommended)');
  await runTest('Spawn --version (no shell)', testSpawnNoShell);
  await runTest('Spawn --help (no shell)', testClaudeHelp);

  logSection('Spawn Tests (shell: true - works on Windows)');
  await runTest('Spawn --version (with shell)', testSpawnWithShell);
  await runTest('Spawn with explicit .cmd path', testExplicitCmdPath);
  await runTest('Spawn with explicit cmd.exe shell', testExplicitShell);

  logSection('Environment Analysis');
  await runTest('Shell Environment Variables', testShellEnvironment);

  logSection('JSONL Parsing Tests');
  await runTest('JSONL Parsing Simulation', testJsonlParsing);

  logSection('Interactive Claude Tests (shell: true)');
  await runTest('Interactive Spawn Test', testInteractiveSpawn);

  logSection('Cross-Platform Logic Verification');
  await runTest('Cross-Platform Shell Execution Logic', testCrossPlatformLogic);

  // Summary
  logSection('TEST SUMMARY');
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log(`Total: ${results.length} tests`);
  log(`Passed: ${passed}`);
  log(`Failed: ${failed}`);
  log('');

  for (const result of results) {
    const icon = result.success ? '✅' : '❌';
    log(`${icon} ${result.name} (${result.duration}ms)`);
  }

  if (failed > 0) {
    logSection('FAILED TEST DETAILS');
    for (const result of results.filter((r) => !r.success)) {
      log(`\n${result.name}:`);
      log(`  Error: ${result.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

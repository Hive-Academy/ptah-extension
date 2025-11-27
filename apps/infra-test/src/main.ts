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

// Test 12: Test agent streaming to see JSONL structure
async function testAgentStreaming(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  const fs = await import('fs');

  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    };

    // Similar prompt to the Anubis session - invoke researcher/explore agent
    const prompt =
      'Use the Task tool to spawn an Explore agent with description "Research codebase structure" to analyze the project structure. The agent should look at the main directories and key files. Just invoke the Explore agent once.';

    log(
      `  Spawning: claude -p "${prompt.substring(
        0,
        60
      )}..." --output-format stream-json --verbose`
    );

    const proc = spawn(
      'claude',
      ['-p', prompt, '--output-format', 'stream-json', '--verbose'],
      options
    );

    let stdout = '';
    let stderr = '';
    const jsonLines: any[] = [];
    const rawLines: string[] = [];

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Save raw lines for file output
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      rawLines.push(...lines);

      // Parse each JSONL line
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          jsonLines.push(parsed);

          // Log key information about each message
          const info: string[] = [];
          info.push(`type=${parsed.type}`);
          if (parsed.subtype) info.push(`subtype=${parsed.subtype}`);
          if (parsed.agentId) info.push(`agentId=${parsed.agentId}`);
          if (parsed.isSidechain !== undefined)
            info.push(`isSidechain=${parsed.isSidechain}`);
          if (parsed.tool) info.push(`tool=${parsed.tool}`);
          if (parsed.tool_use_id)
            info.push(`tool_use_id=${parsed.tool_use_id?.substring(0, 15)}...`);
          if (parsed.parent_tool_use_id)
            info.push(
              `parent_tool_use_id=${parsed.parent_tool_use_id?.substring(
                0,
                15
              )}...`
            );
          if (parsed.message?.model) info.push(`model=${parsed.message.model}`);
          if (parsed.slug) info.push(`slug=${parsed.slug}`);

          log(`    [${jsonLines.length}] ${info.join(' | ')}`);
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
        error: `Spawn error: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      // Save raw JSONL to file for analysis
      const outputPath = path.join(process.cwd(), 'agent-test-output.jsonl');
      fs.writeFileSync(outputPath, rawLines.join('\n'));
      log(`\n  Raw JSONL saved to: ${outputPath}`);

      // Analyze the session structure
      const agentIds = [
        ...new Set(jsonLines.filter((j) => j.agentId).map((j) => j.agentId)),
      ];
      const sidechainMsgs = jsonLines.filter((j) => j.isSidechain === true);
      const mainMsgs = jsonLines.filter((j) => j.isSidechain === false);
      const taskTools = jsonLines.filter(
        (j) =>
          j.type === 'assistant' &&
          j.message?.content?.some(
            (c: any) => c.type === 'tool_use' && c.name === 'Task'
          )
      );
      const messagesWithParent = jsonLines.filter((j) => j.parent_tool_use_id);
      const models = [
        ...new Set(
          jsonLines.filter((j) => j.message?.model).map((j) => j.message.model)
        ),
      ];

      const analysis = {
        totalMessages: jsonLines.length,
        mainSessionMessages: mainMsgs.length,
        sidechainMessages: sidechainMsgs.length,
        agentIds,
        taskToolInvocations: taskTools.length,
        messagesWithParentToolUseId: messagesWithParent.length,
        modelsUsed: models,
        messageTypes: [...new Set(jsonLines.map((j) => j.type))],
      };

      log(`\n  === ANALYSIS ===`);
      log(`  ${JSON.stringify(analysis, null, 2)}`);

      // Group messages by agentId for detailed view
      if (agentIds.length > 0) {
        log(`\n  === AGENT BREAKDOWN ===`);
        for (const agentId of agentIds) {
          const agentMsgs = jsonLines.filter((j) => j.agentId === agentId);
          const firstMsg = agentMsgs[0];
          log(`\n  Agent: ${agentId}`);
          log(`    Messages: ${agentMsgs.length}`);
          log(`    isSidechain: ${firstMsg?.isSidechain}`);
          log(`    Model: ${firstMsg?.message?.model || 'unknown'}`);
          log(`    Slug: ${firstMsg?.slug || 'none'}`);
          log(
            `    First content preview: ${JSON.stringify(
              firstMsg?.message?.content?.[0]
            )?.substring(0, 100)}...`
          );
        }
      }

      // Check for parent_tool_use_id linkage
      if (messagesWithParent.length > 0) {
        log(`\n  === PARENT_TOOL_USE_ID LINKAGE ===`);
        const parentIds = [
          ...new Set(messagesWithParent.map((m) => m.parent_tool_use_id)),
        ];
        for (const parentId of parentIds) {
          const linked = messagesWithParent.filter(
            (m) => m.parent_tool_use_id === parentId
          );
          log(`  parent_tool_use_id: ${parentId}`);
          log(`    Linked messages: ${linked.length}`);
          log(
            `    Types: ${[...new Set(linked.map((l) => l.type))].join(', ')}`
          );
        }
      }

      resolve({
        success: jsonLines.length > 0,
        output: `Received ${jsonLines.length} messages. Agents: ${agentIds.length}. Sidechain: ${sidechainMsgs.length}. Output saved to ${outputPath}`,
      });
    });

    // Timeout after 180 seconds for agent execution
    setTimeout(() => {
      proc.kill();
      // Still save what we got
      const outputPath = path.join(process.cwd(), 'agent-test-output.jsonl');
      fs.writeFileSync(outputPath, rawLines.join('\n'));

      if (jsonLines.length > 0) {
        resolve({
          success: true,
          output: `Timeout but received ${jsonLines.length} messages. Output saved to ${outputPath}`,
        });
      } else {
        resolve({
          success: false,
          error: 'Timeout after 180 seconds with no output',
        });
      }
    }, 180000);
  });
}

// =============================================================================
// INTERACTIVE SESSION EXPERIMENTS (TASK: Validate stdin behavior)
// =============================================================================

/**
 * EXPERIMENT 1: Interactive mode WITHOUT -p flag
 *
 * Hypothesis: Claude CLI without -p enters interactive mode where stdin stays open
 * and we can send multiple messages.
 *
 * Test: Spawn claude without -p, send prompt via stdin, see if it processes
 */
async function testInteractiveModeNoPFlag(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    };

    // Note: --output-format stream-json requires --verbose
    log(
      '  Spawning: claude --output-format stream-json --verbose (NO -p flag)'
    );
    log('  Will send prompt via stdin WITHOUT closing it...');

    const proc = spawn(
      'claude',
      ['--output-format', 'stream-json', '--verbose'],
      options
    );

    let stdout = '';
    let stderr = '';
    const jsonLines: any[] = [];
    let gotResponse = false;

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      log(
        `  [stdout] ${chunk.substring(0, 100)}${
          chunk.length > 100 ? '...' : ''
        }`
      );

      // Parse JSONL
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          jsonLines.push(parsed);
          if (parsed.type === 'assistant') {
            gotResponse = true;
          }
        } catch {
          // Not JSON
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      log(`  [stderr] ${data.toString().substring(0, 100)}`);
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Spawn error: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      resolve({
        success: gotResponse,
        output: `Exit code: ${code}, Got response: ${gotResponse}, Messages: ${jsonLines.length}`,
        error: gotResponse
          ? undefined
          : `No response. stderr: ${stderr.substring(0, 200)}`,
      });
    });

    // Send prompt via stdin (WITHOUT closing stdin)
    setTimeout(() => {
      log('  Writing prompt to stdin (not closing stdin yet)...');
      proc.stdin?.write('Say "hello" in one word only\n');
      // NOT calling proc.stdin?.end() here!
    }, 1000);

    // Wait for response
    setTimeout(() => {
      if (gotResponse) {
        log('  Got response! Killing process...');
        proc.kill();
      } else {
        log('  No response after 15s, trying to close stdin...');
        proc.stdin?.end();
      }
    }, 15000);

    // Final timeout
    setTimeout(() => {
      proc.kill();
      resolve({
        success: gotResponse,
        output: `Timeout. Got response: ${gotResponse}, Messages: ${jsonLines.length}`,
        error: gotResponse
          ? undefined
          : 'Timeout - prompt may not have been processed without stdin.end()',
      });
    }, 30000);
  });
}

/**
 * EXPERIMENT 2: stdin.write + newline vs stdin.end
 *
 * Hypothesis: Claude needs stdin.end() to process the prompt, newline alone isn't enough
 *
 * Test: Compare behavior with and without stdin.end()
 */
async function testStdinEndVsNewline(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    };

    log('  Spawning: claude -p --output-format stream-json --verbose');
    log('  Will test: Write + newline, wait 5s, then stdin.end()');

    const proc = spawn(
      'claude',
      ['-p', '--output-format', 'stream-json', '--verbose'],
      options
    );

    let stdout = '';
    let stderr = '';
    const jsonLines: any[] = [];
    let gotResponseBeforeEnd = false;
    let gotResponseAfterEnd = false;
    let stdinEndedAt = 0;

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          jsonLines.push(parsed);
          if (parsed.type === 'assistant') {
            if (stdinEndedAt === 0) {
              gotResponseBeforeEnd = true;
              log(`  ✅ Got response BEFORE stdin.end()!`);
            } else {
              gotResponseAfterEnd = true;
              log(
                `  Got response ${
                  Date.now() - stdinEndedAt
                }ms after stdin.end()`
              );
            }
          }
        } catch {
          // Not JSON
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: `Spawn error: ${err.message}` });
    });

    proc.on('close', (code) => {
      resolve({
        success: gotResponseAfterEnd || gotResponseBeforeEnd,
        output: `Exit: ${code}, Before stdin.end: ${gotResponseBeforeEnd}, After stdin.end: ${gotResponseAfterEnd}`,
      });
    });

    // Step 1: Write prompt with newline (no end)
    setTimeout(() => {
      log('  Step 1: Writing prompt + newline (stdin still open)...');
      proc.stdin?.write('Say "test" only\n');
    }, 500);

    // Step 2: Wait 5 seconds to see if newline alone triggers processing
    setTimeout(() => {
      if (!gotResponseBeforeEnd) {
        log('  Step 2: No response from newline alone. Calling stdin.end()...');
        stdinEndedAt = Date.now();
        proc.stdin?.end();
      }
    }, 5500);

    // Timeout
    setTimeout(() => {
      proc.kill();
    }, 30000);
  });
}

/**
 * EXPERIMENT 3: Send Esc key to interrupt
 *
 * Hypothesis: Sending \x1b (Escape) character to stdin will interrupt Claude
 *
 * Test: Start a long task, send Esc, see if it interrupts
 */
async function testEscKeyInterrupt(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    };

    log('  Spawning: claude -p --output-format stream-json --verbose');
    log('  Will start long task, then send Esc to interrupt');

    const proc = spawn(
      'claude',
      ['-p', '--output-format', 'stream-json', '--verbose'],
      options
    );

    let stdout = '';
    const jsonLines: any[] = [];
    let interrupted = false;
    let startedProcessing = false;

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          jsonLines.push(parsed);
          if (parsed.type === 'assistant' || parsed.type === 'system') {
            startedProcessing = true;
          }
          // Check for interruption signals
          if (parsed.type === 'result' && parsed.subtype === 'error') {
            interrupted = true;
            log(`  ⚠️ Got error result - might be interruption`);
          }
        } catch {
          // Not JSON
        }
      }
    });

    proc.on('close', (code) => {
      // Code 130 typically indicates SIGINT (Ctrl+C)
      // Code 0 with incomplete output might indicate Esc interrupt
      const wasInterrupted = code !== 0 || interrupted;
      resolve({
        success: startedProcessing,
        output: `Exit code: ${code}, Started: ${startedProcessing}, Interrupted: ${wasInterrupted}, Messages: ${jsonLines.length}`,
      });
    });

    // Start a task that takes a while
    setTimeout(() => {
      log('  Writing long task prompt...');
      proc.stdin?.write(
        'List all prime numbers from 1 to 1000, one per line\n'
      );
      proc.stdin?.end();
    }, 500);

    // After Claude starts responding, send Esc
    setTimeout(() => {
      if (startedProcessing) {
        log('  Sending Esc character (\\x1b) to stdin...');
        // Try to write Esc - but stdin might be closed already!
        try {
          proc.stdin?.write('\x1b');
        } catch (e) {
          log(`  Could not write to stdin (already closed): ${e}`);
        }
      }
    }, 3000);

    // Also try SIGINT
    setTimeout(() => {
      if (!interrupted && startedProcessing) {
        log('  Esc might not work. Trying SIGINT...');
        proc.kill('SIGINT');
      }
    }, 5000);

    // Timeout
    setTimeout(() => {
      proc.kill();
    }, 20000);
  });
}

/**
 * EXPERIMENT 4: Keep stdin open and send multiple messages
 *
 * Hypothesis: In interactive mode (no -p), we can send multiple prompts
 *
 * Test: Spawn without -p, send message 1, wait for response, send message 2
 */
async function testMultipleMessagesOnStdin(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    };

    log(
      '  Spawning: claude --output-format stream-json --verbose (interactive mode)'
    );
    log('  Will try to send TWO messages sequentially');

    const proc = spawn(
      'claude',
      ['--output-format', 'stream-json', '--verbose'],
      options
    );

    let stdout = '';
    const jsonLines: any[] = [];
    let message1Response = false;
    let message2Response = false;
    let resultCount = 0;

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      log(`  [stdout chunk] ${chunk.substring(0, 80)}...`);

      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          jsonLines.push(parsed);

          if (parsed.type === 'result') {
            resultCount++;
            if (resultCount === 1) {
              message1Response = true;
              log(`  ✅ First message completed!`);
            } else if (resultCount === 2) {
              message2Response = true;
              log(`  ✅ Second message completed!`);
            }
          }
        } catch {
          // Not JSON
        }
      }
    });

    proc.on('close', (code) => {
      resolve({
        success: message1Response && message2Response,
        output: `Exit: ${code}, Msg1: ${message1Response}, Msg2: ${message2Response}, Total results: ${resultCount}`,
        error: !message1Response
          ? 'First message never completed'
          : !message2Response
          ? 'Second message never completed'
          : undefined,
      });
    });

    // Send first message
    setTimeout(() => {
      log('  Sending message 1: "Say apple"');
      proc.stdin?.write('Say the word "apple" only\n');
      // Don't close stdin!
    }, 1000);

    // Wait for first response, then send second message
    setTimeout(() => {
      if (message1Response) {
        log('  Sending message 2: "Say banana"');
        proc.stdin?.write('Say the word "banana" only\n');
      } else {
        log('  Message 1 not complete yet, trying message 2 anyway...');
        proc.stdin?.write('Say the word "banana" only\n');
      }
    }, 15000);

    // Give time for second response
    setTimeout(() => {
      if (!message2Response) {
        log('  Closing stdin to trigger processing...');
        proc.stdin?.end();
      }
    }, 25000);

    // Timeout
    setTimeout(() => {
      proc.kill();
    }, 45000);
  });
}

/**
 * EXPERIMENT 5: Test --resume with new process for each message
 *
 * This is our current fallback pattern - can we reliably resume?
 */
async function testResumePattern(): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  return new Promise(async (resolve) => {
    const sessionId = `test-session-${Date.now()}`;
    let message1Success = false;
    let message2Success = false;
    let capturedSessionId = '';

    log(`  Testing --resume pattern with session: ${sessionId}`);

    // Message 1: Start new session
    log('  Starting message 1 (new session)...');
    const result1 = await new Promise<{
      success: boolean;
      sessionId?: string;
      error?: string;
    }>((res) => {
      const proc = spawn(
        'claude',
        ['-p', '--output-format', 'stream-json', '--verbose'],
        {
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd(),
        }
      );

      let gotResult = false;
      const jsonLines: any[] = [];

      proc.stdout?.on('data', (data) => {
        const lines = data
          .toString()
          .split('\n')
          .filter((l: string) => l.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            jsonLines.push(parsed);
            if (parsed.type === 'system' && parsed.session_id) {
              capturedSessionId = parsed.session_id;
              log(`    Captured session_id: ${capturedSessionId}`);
            }
            if (parsed.type === 'result') {
              gotResult = true;
            }
          } catch {
            /* skip */
          }
        }
      });

      proc.on('close', (code) => {
        res({
          success: gotResult && !!capturedSessionId,
          sessionId: capturedSessionId,
          error: !gotResult
            ? 'No result'
            : !capturedSessionId
            ? 'No session_id captured'
            : undefined,
        });
      });

      proc.stdin?.write(
        'Remember: my favorite color is blue. Respond with just "OK"\n'
      );
      proc.stdin?.end();

      setTimeout(() => proc.kill(), 30000);
    });

    message1Success = result1.success;
    log(
      `  Message 1 result: ${
        message1Success ? '✅' : '❌'
      } (session: ${capturedSessionId})`
    );

    if (!message1Success || !capturedSessionId) {
      resolve({
        success: false,
        error: 'Message 1 failed - cannot test resume',
      });
      return;
    }

    // Message 2: Resume session
    log('  Starting message 2 (--resume)...');
    const result2 = await new Promise<{ success: boolean; output?: string }>(
      (res) => {
        const proc = spawn(
          'claude',
          [
            '-p',
            '--resume',
            capturedSessionId,
            '--output-format',
            'stream-json',
            '--verbose',
          ],
          {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd(),
          }
        );

        let gotResult = false;
        let assistantContent = '';

        proc.stdout?.on('data', (data) => {
          const lines = data
            .toString()
            .split('\n')
            .filter((l: string) => l.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'assistant' && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === 'text') {
                    assistantContent += block.text;
                  }
                }
              }
              if (parsed.type === 'result') {
                gotResult = true;
              }
            } catch {
              /* skip */
            }
          }
        });

        proc.on('close', () => {
          const mentionsBlue = assistantContent.toLowerCase().includes('blue');
          res({
            success: gotResult && mentionsBlue,
            output: `Got result: ${gotResult}, Mentions blue: ${mentionsBlue}, Content: ${assistantContent.substring(
              0,
              100
            )}`,
          });
        });

        proc.stdin?.write('What is my favorite color?\n');
        proc.stdin?.end();

        setTimeout(() => proc.kill(), 30000);
      }
    );

    message2Success = result2.success;
    log(`  Message 2 result: ${message2Success ? '✅' : '❌'}`);
    if (result2.output) log(`    ${result2.output}`);

    resolve({
      success: message1Success && message2Success,
      output: `Msg1: ${message1Success}, Msg2 (resume): ${message2Success}`,
    });
  });
}

// Main execution
async function main(): Promise<void> {
  logSection('PTAH Infrastructure Test Suite');
  log('Testing Claude CLI spawn behavior outside VS Code context');

  // Check command line flags
  const runAgentTest = process.argv.includes('--agent-test');
  const runInteractiveTest = process.argv.includes('--interactive-test');

  if (runInteractiveTest) {
    logSection('Interactive Session Experiments (--interactive-test mode)');
    log('Testing hypotheses about stdin behavior and interactive sessions');
    log('');
    log('EXPERIMENTS:');
    log('1. Interactive mode (no -p flag) - Can we keep stdin open?');
    log('2. stdin.write vs stdin.end - Does newline alone trigger processing?');
    log('3. Esc key interrupt - Can we send \\x1b to stop Claude?');
    log('4. Multiple messages - Can we send follow-up messages?');
    log('5. Resume pattern - Fallback: new process per message with --resume');
    log('');

    await runTest(
      'EXPERIMENT 1: Interactive mode (no -p flag)',
      testInteractiveModeNoPFlag
    );
    await runTest('EXPERIMENT 2: stdin.end vs newline', testStdinEndVsNewline);
    await runTest('EXPERIMENT 3: Esc key interrupt', testEscKeyInterrupt);
    await runTest(
      'EXPERIMENT 4: Multiple messages on stdin',
      testMultipleMessagesOnStdin
    );
    await runTest('EXPERIMENT 5: Resume pattern (fallback)', testResumePattern);
  } else if (runAgentTest) {
    logSection('Agent Streaming Test (--agent-test mode)');
    await runTest('Agent Streaming JSONL Structure', testAgentStreaming);
  } else {
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
    await runTest(
      'Cross-Platform Shell Execution Logic',
      testCrossPlatformLogic
    );
  }

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

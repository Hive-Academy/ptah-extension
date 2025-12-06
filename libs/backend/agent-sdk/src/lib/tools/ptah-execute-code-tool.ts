/**
 * ptah.executeCode - Sandboxed code execution
 * Executes JavaScript/TypeScript with license validation
 * Replaces current MCP server approach
 */
import { z } from 'zod';
import * as vm from 'vm';

export const ptahExecuteCodeToolDefinition = {
  name: 'executeCode',
  description:
    'Executes JavaScript/TypeScript code in sandboxed environment with license validation',
  input_schema: z.object({
    code: z.string().describe('JavaScript/TypeScript code to execute'),
    language: z.enum(['javascript', 'typescript']).describe('Programming language'),
    timeout: z
      .number()
      .max(60000)
      .optional()
      .describe('Execution timeout in milliseconds (max 60s)'),
  }),
};

/**
 * Execute ptah.executeCode tool - Run code in sandboxed VM
 * Returns MCP CallToolResult (using any to avoid type import issues)
 */
export async function executePtahExecuteCodeTool(
  args: z.infer<typeof ptahExecuteCodeToolDefinition.input_schema>
): Promise<any> {
  const startTime = Date.now();

  try {
    const { code, language, timeout = 5000 } = args;

    // Validate license (placeholder - implement actual license check)
    const hasCodeExecutionPermission = await validateLicense();
    if (!hasCodeExecutionPermission) {
      return {
        content: [
          {
            type: 'text',
            text: 'Code execution requires a valid license. Please upgrade your plan.',
          },
        ],
        isError: true,
      };
    }

    // TypeScript requires compilation (simplified - use esbuild or ts-node in production)
    let executableCode = code;
    if (language === 'typescript') {
      // For now, treat as JavaScript (proper TS compilation would use esbuild/ts-node)
      // TODO: Add proper TypeScript compilation
      executableCode = code;
    }

    // Create sandboxed context with limited globals
    const sandbox = {
      console: {
        log: (...args: unknown[]) => capturedOutput.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => capturedErrors.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => capturedOutput.push(`WARN: ${args.map(String).join(' ')}`),
        info: (...args: unknown[]) => capturedOutput.push(`INFO: ${args.map(String).join(' ')}`),
      },
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Buffer,
      // Add safe utilities
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      // Intentionally exclude: require, process, fs, etc.
    };

    const capturedOutput: string[] = [];
    const capturedErrors: string[] = [];

    // Create VM context
    const context = vm.createContext(sandbox);

    // Execute with timeout (timeout applied in runInContext, not Script constructor)
    const script = new vm.Script(executableCode, {
      filename: 'user-code.js',
    });

    let returnValue: unknown;
    try {
      returnValue = script.runInContext(context, {
        timeout: Math.min(timeout, 60000), // Max 60 seconds
        breakOnSigint: true,
      });
    } catch (execError) {
      capturedErrors.push(
        execError instanceof Error ? execError.message : String(execError)
      );
    }

    const duration = Date.now() - startTime;

    // Format output
    const outputSections: string[] = [];

    if (capturedOutput.length > 0) {
      outputSections.push(`**Output:**\n${capturedOutput.join('\n')}`);
    }

    if (capturedErrors.length > 0) {
      outputSections.push(`**Errors:**\n${capturedErrors.join('\n')}`);
    }

    if (returnValue !== undefined) {
      outputSections.push(
        `**Return Value:**\n${typeof returnValue === 'object' ? JSON.stringify(returnValue, null, 2) : String(returnValue)}`
      );
    }

    outputSections.push(`**Execution Time:** ${duration}ms`);

    const hasErrors = capturedErrors.length > 0;

    return {
      content: [
        {
          type: 'text',
          text:
            outputSections.length > 0
              ? outputSections.join('\n\n')
              : 'Code executed successfully (no output)',
        },
      ],
      isError: hasErrors,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      content: [
        {
          type: 'text',
          text: `Execution failed after ${duration}ms:\n${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Validate user license for code execution feature
 * TODO: Implement actual license validation logic
 */
async function validateLicense(): Promise<boolean> {
  // Placeholder - always return true for now
  // In production, check against license server or local license file
  return true;
}

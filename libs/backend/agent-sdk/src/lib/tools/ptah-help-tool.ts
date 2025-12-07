/**
 * ptah.help - Documentation search tool
 * Searches CLAUDE.md files in workspace for relevant documentation
 */
import { z } from 'zod';
import * as vscode from 'vscode';

export const ptahHelpToolDefinition = {
  name: 'help',
  description:
    'Searches Ptah extension documentation and usage examples in workspace CLAUDE.md files',
  input_schema: z.object({
    query: z.string().describe('Search query for documentation'),
    category: z
      .enum(['commands', 'settings', 'features', 'troubleshooting', 'general'])
      .optional()
      .describe('Documentation category to filter by'),
  }),
};

/**
 * Execute ptah.help tool - Search workspace CLAUDE.md files
 * Returns MCP CallToolResult (using any to avoid type import issues)
 */
export async function executePtahHelpTool(
  args: z.infer<typeof ptahHelpToolDefinition.input_schema>
): Promise<any> {
  try {
    const { query, category } = args;

    // Find all CLAUDE.md files in workspace
    const claudeFiles = await vscode.workspace.findFiles(
      '**/CLAUDE.md',
      '**/node_modules/**'
    );

    if (claudeFiles.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No CLAUDE.md documentation files found in workspace.',
          },
        ],
      };
    }

    // Search results accumulator
    const results: Array<{
      file: string;
      excerpts: Array<{ line: number; content: string; context: string }>;
    }> = [];

    // Search each CLAUDE.md file
    for (const fileUri of claudeFiles) {
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(fileContent).toString('utf8');
      const lines = text.split('\n');

      // Find matching lines (case-insensitive)
      const queryLower = query.toLowerCase();
      const matches: Array<{ line: number; content: string; context: string }> =
        [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.toLowerCase().includes(queryLower)) {
          // Extract context (2 lines before, matched line, 2 lines after)
          const contextStart = Math.max(0, i - 2);
          const contextEnd = Math.min(lines.length - 1, i + 2);
          const contextLines = lines.slice(contextStart, contextEnd + 1);

          matches.push({
            line: i + 1, // 1-indexed line numbers
            content: line.trim(),
            context: contextLines.join('\n'),
          });
        }
      }

      if (matches.length > 0) {
        results.push({
          file: vscode.workspace.asRelativePath(fileUri),
          excerpts: matches,
        });
      }
    }

    // Format results
    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No matches found for "${query}" in ${claudeFiles.length} CLAUDE.md file(s).`,
          },
        ],
      };
    }

    // Build formatted response
    let responseText = `Found ${results.reduce(
      (sum, r) => sum + r.excerpts.length,
      0
    )} match(es) in ${results.length} file(s):\n\n`;

    for (const result of results) {
      responseText += `## ${result.file}\n\n`;

      for (const excerpt of result.excerpts.slice(0, 3)) {
        // Limit to 3 excerpts per file
        responseText += `**Line ${excerpt.line}:**\n\`\`\`\n${excerpt.context}\n\`\`\`\n\n`;
      }

      if (result.excerpts.length > 3) {
        responseText += `... and ${
          result.excerpts.length - 3
        } more match(es)\n\n`;
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error searching documentation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}

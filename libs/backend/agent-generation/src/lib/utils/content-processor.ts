import { Result } from '@ptah-extension/shared';

/**
 * Strip markdown code block wrappers from LLM response.
 * Handles patterns like ```markdown ... ```, ```json ... ```, etc.
 *
 * @param content - The content containing markdown code blocks
 * @returns Result with processed content or error
 *
 * @example
 * ```typescript
 * const result = stripMarkdownCodeBlock('```markdown\n# Hello\n```');
 * if (result.isOk()) {
 *   console.log(result.value); // '# Hello'
 * }
 * ```
 */
export function stripMarkdownCodeBlock(content: string): Result<string, Error> {
  try {
    // Remove ^ and $ anchors to match code blocks anywhere in the string
    // Also match and discard optional language identifier after ```
    const processed = content
      .replace(/```markdown\s*([\s\S]*?)\s*```/im, '$1') // Specific markdown block
      .replace(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/im, '$1'); // Generic block with optional language
    return Result.ok(processed);
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new Error(`Failed to strip markdown code blocks: ${String(error)}`)
    );
  }
}

/**
 * Strip HTML comments from content (recursive for nested comments).
 * Handles patterns like <!-- ... --> including nested comments.
 *
 * @param content - The content containing HTML comments
 * @returns Result with processed content or error
 *
 * @example
 * ```typescript
 * const result = stripHtmlComments('Hello <!-- comment --> World');
 * if (result.isOk()) {
 *   console.log(result.value); // 'Hello  World'
 * }
 * ```
 */
export function stripHtmlComments(content: string): Result<string, Error> {
  try {
    // Regex to match HTML comments: <!-- ... -->
    // [\s\S]*? matches any character (including newline) non-greedily
    let previous: string;
    let processed = content;
    do {
      previous = processed;
      processed = processed.replace(/<!--[\s\S]*?-->/g, '');
    } while (processed !== previous);
    return Result.ok(processed);
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new Error(`Failed to strip HTML comments: ${String(error)}`)
    );
  }
}

/**
 * Simple mustache-style template processing.
 * Replaces {{key}} with values from data object.
 *
 * @param template - The template string with {{key}} placeholders
 * @param data - Object with key-value pairs for replacement
 * @returns Result with processed template or error
 *
 * @example
 * ```typescript
 * const result = processTemplate('Hello {{name}}!', { name: 'World' });
 * if (result.isOk()) {
 *   console.log(result.value); // 'Hello World!'
 * }
 * ```
 */
export function processTemplate(
  template: string,
  data: Record<string, unknown>
): Result<string, Error> {
  try {
    let processed = template;
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      processed = processed.replace(regex, String(value));
    }
    return Result.ok(processed);
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new Error(`Failed to process template: ${String(error)}`)
    );
  }
}

/**
 * Simple YAML parser for frontmatter only.
 * Supports basic key-value pairs with strings, numbers, booleans, and arrays.
 *
 * @param yamlContent - The YAML content to parse
 * @returns Parsed object or throws error
 */
function parseSimpleYaml(yamlContent: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlContent.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    // Skip comments
    if (line.trim().startsWith('#')) {
      continue;
    }

    // Parse key-value pairs
    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[2].trim();
    let value: unknown = match[3].trim();

    // Parse value types
    if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (value === 'null') {
      value = null;
    } else if (/^-?\d+$/.test(value as string)) {
      value = parseInt(value as string, 10);
    } else if (/^-?\d+\.\d+$/.test(value as string)) {
      value = parseFloat(value as string);
    } else if (
      (value as string).startsWith('[') &&
      (value as string).endsWith(']')
    ) {
      // Parse simple arrays
      try {
        value = JSON.parse(value as string);
      } catch {
        // If JSON parsing fails, keep as string
      }
    } else if (
      ((value as string).startsWith('"') && (value as string).endsWith('"')) ||
      ((value as string).startsWith("'") && (value as string).endsWith("'"))
    ) {
      // Remove quotes
      value = (value as string).slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Extract YAML frontmatter from markdown content.
 * Returns object with parsed frontmatter and remaining content.
 *
 * @param content - The markdown content with optional frontmatter
 * @returns Result with { frontmatter, content } or error
 *
 * @example
 * ```typescript
 * const result = extractFrontmatter('---\ntitle: Hello\n---\n# Content');
 * if (result.isOk()) {
 *   console.log(result.value.frontmatter); // { title: 'Hello' }
 *   console.log(result.value.content); // '# Content'
 * }
 * ```
 */
export function extractFrontmatter(content: string): Result<
  {
    frontmatter: Record<string, unknown>;
    content: string;
  },
  Error
> {
  try {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return Result.ok({ frontmatter: {}, content });
    }

    try {
      const frontmatter = parseSimpleYaml(match[1]);
      return Result.ok({ frontmatter, content: match[2] });
    } catch (error) {
      return Result.err(
        error instanceof Error
          ? error
          : new Error(`Failed to parse YAML frontmatter: ${String(error)}`)
      );
    }
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new Error(`Failed to extract frontmatter: ${String(error)}`)
    );
  }
}

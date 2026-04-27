/**
 * JSON Namespace Builder
 * TASK_2025_240: JSON validation and repair MCP tool
 *
 * Provides a validate() method that reads a JSON file, extracts JSON from
 * raw agent output (markdown fences, prose), repairs common issues (trailing
 * commas, single quotes, unquoted keys, comments, unbalanced brackets),
 * validates against an optional schema, and overwrites with clean JSON.
 *
 * All repair functions are pure helpers for testability.
 * Pattern: namespace-builders/git-namespace.builder.ts
 */

import * as path from 'path';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
} from '@ptah-extension/platform-core';
import type {
  JsonNamespace,
  JsonValidateParams,
  JsonValidateResult,
} from '../types';

/**
 * Dependencies required to build the JSON namespace.
 */
export interface JsonNamespaceDependencies {
  fileSystemProvider: IFileSystemProvider;
  workspaceProvider: IWorkspaceProvider;
}

/**
 * Build the JSON namespace with the validate method.
 *
 * @param deps - Dependencies containing file system and workspace providers
 * @returns JsonNamespace with validate method
 */
export function buildJsonNamespace(
  deps: JsonNamespaceDependencies,
): JsonNamespace {
  const { fileSystemProvider, workspaceProvider } = deps;

  return {
    async validate(params: JsonValidateParams): Promise<JsonValidateResult> {
      const repairs: string[] = [];

      // 1. Validate input
      if (
        !params.file ||
        typeof params.file !== 'string' ||
        !params.file.trim()
      ) {
        return {
          success: false,
          file: params.file || '',
          repairs: [],
          errors: [
            '"file" parameter is required and must be a non-empty string.',
          ],
          fileOverwritten: false,
        };
      }

      const filePath = params.file.trim();

      // 2. Resolve workspace-relative path (security: reject absolute paths, traversal)
      let resolvedPath: string;
      try {
        resolvedPath = resolveWorkspacePath(filePath, workspaceProvider);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          success: false,
          file: filePath,
          repairs: [],
          errors: [msg],
          fileOverwritten: false,
        };
      }

      // 3. Check file existence
      const exists = await fileSystemProvider.exists(resolvedPath);
      if (!exists) {
        return {
          success: false,
          file: filePath,
          repairs: [],
          errors: [`File not found: ${filePath}`],
          fileOverwritten: false,
        };
      }

      // 4. Read file content
      let content: string;
      try {
        content = await fileSystemProvider.readFile(resolvedPath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          success: false,
          file: filePath,
          repairs: [],
          errors: [`Failed to read file: ${msg}`],
          fileOverwritten: false,
        };
      }

      // 5. Check for empty content
      if (!content.trim()) {
        return {
          success: false,
          file: filePath,
          repairs: [],
          errors: ['File is empty or contains only whitespace.'],
          fileOverwritten: false,
        };
      }

      // 6. Run extraction & repair pipeline
      content = stripMarkdownFences(content, repairs);
      content = extractJsonBody(content, repairs);
      content = stripJsonComments(content, repairs);
      content = fixTrailingCommas(content, repairs);
      content = fixSingleQuotes(content, repairs);
      content = fixUnquotedKeys(content, repairs);
      content = balanceBrackets(content, repairs);

      // 7. Attempt parse
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          success: false,
          file: filePath,
          repairs,
          errors: [
            `JSON parse failed after repairs: ${msg}`,
            `Content preview: ${content.substring(0, 500)}`,
          ],
          fileOverwritten: false,
        };
      }

      // 8. Optional schema validation
      if (params.schema) {
        const schemaErrors = validateAgainstSchema(parsed, params.schema);
        if (schemaErrors.length > 0) {
          return {
            success: false,
            file: filePath,
            repairs,
            errors: schemaErrors,
            fileOverwritten: false,
          };
        }
      }

      // 9. Overwrite with clean, formatted JSON
      const cleanJson = JSON.stringify(parsed, null, 2);
      try {
        await fileSystemProvider.writeFile(resolvedPath, cleanJson);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          success: false,
          file: filePath,
          repairs,
          errors: [`Failed to write cleaned JSON: ${msg}`],
          fileOverwritten: false,
        };
      }

      return {
        success: true,
        file: filePath,
        repairs,
        errors: [],
        fileOverwritten: true,
      };
    },
  };
}

// ========================================
// Path Resolution (duplicated from system-namespace.builders.ts)
// ========================================

/**
 * Resolve a file path relative to workspace root.
 * SECURITY: Rejects absolute paths and path traversal to confine
 * all file operations to the workspace directory.
 *
 * Duplicated from system-namespace.builders.ts because the original
 * is module-private. Same pattern used by buildFilesNamespace.
 */
function resolveWorkspacePath(
  filePath: string,
  workspaceProvider: IWorkspaceProvider,
): string {
  // Normalize path separators to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Reject absolute paths (drive letters, UNC paths, Unix absolute).
  // path.isAbsolute() is platform-dependent and doesn't recognize Windows
  // drive letters or UNC paths on POSIX hosts, so check explicitly.
  const isWindowsDriveAbsolute = /^[a-zA-Z]:[/\\]/.test(filePath);
  const isUncPath = /^[/\\]{2}/.test(filePath);
  if (path.isAbsolute(normalizedPath) || isWindowsDriveAbsolute || isUncPath) {
    throw new Error(
      'Absolute paths are not allowed. Use workspace-relative paths only.',
    );
  }

  // Reject path traversal attempts
  const resolved = path.normalize(normalizedPath);
  if (resolved.startsWith('..')) {
    throw new Error(
      'Path traversal is not allowed. Stay within workspace boundaries.',
    );
  }

  // Resolve relative to workspace root
  const workspaceRoot = workspaceProvider.getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('No workspace folder is open.');
  }

  return path.join(workspaceRoot, normalizedPath);
}

// ========================================
// Repair Pipeline — Pure Helper Functions
// ========================================

/**
 * Strip markdown code fences wrapping JSON content.
 * Handles ```json, ```JSON, ```jsonc, and plain ``` fences.
 * Does not modify content that has no fences.
 */
export function stripMarkdownFences(
  content: string,
  repairs: string[],
): string {
  // Match opening fence with optional language tag, and closing fence
  // Handles: ```json, ```JSON, ```jsonc, ``` (plain), with optional whitespace
  const fencePattern =
    /^[ \t]*```(?:json|JSON|jsonc)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/;
  const match = content.trim().match(fencePattern);

  if (match) {
    repairs.push('Stripped markdown code fence');
    return match[1];
  }

  // Also handle case where fences are present but content follows after closing fence
  // or content precedes opening fence — just strip the fence lines
  const lines = content.split(/\r?\n/);
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*```(?:json|JSON|jsonc)?[ \t]*$/.test(lines[i])) {
      if (startIdx === -1) {
        startIdx = i;
      } else {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    repairs.push('Stripped markdown code fence');
    return lines.slice(startIdx + 1, endIdx).join('\n');
  }

  return content;
}

/**
 * Extract the JSON body from content that may contain surrounding prose.
 * Finds the first { or [ and uses bracket-depth tracking (skipping string
 * literals) to find its matching closer. This correctly handles cases where
 * trailing prose contains } or ] characters that would fool lastIndexOf.
 * Returns content unchanged if no JSON-like structure is found.
 */
export function extractJsonBody(content: string, repairs: string[]): string {
  const trimmed = content.trim();

  // Find the first { or [
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');

  let start: number;
  if (firstBrace === -1 && firstBracket === -1) {
    // No JSON-like structure found
    return trimmed;
  } else if (firstBrace === -1) {
    start = firstBracket;
  } else if (firstBracket === -1) {
    start = firstBrace;
  } else {
    start = Math.min(firstBrace, firstBracket);
  }

  // Use bracket-depth tracking to find the matching closer for the opener at 'start'.
  // This correctly skips brackets inside string literals and finds the true
  // end of the JSON body, even when trailing prose contains } or ] characters.
  const end = findMatchingCloser(trimmed, start);

  if (end === -1) {
    // No matching closer found — fall back to lastIndexOf as best effort
    const lastBrace = trimmed.lastIndexOf('}');
    const lastBracket = trimmed.lastIndexOf(']');
    const lastCloser = Math.max(lastBrace, lastBracket);

    if (lastCloser <= start) {
      return trimmed;
    }

    const extracted = trimmed.substring(start, lastCloser + 1);
    if (start > 0 || lastCloser < trimmed.length - 1) {
      const removedParts: string[] = [];
      if (start > 0) removedParts.push('prose before JSON body');
      if (lastCloser < trimmed.length - 1)
        removedParts.push('prose after JSON body');
      repairs.push(`Removed ${removedParts.join(' and ')}`);
    }
    return extracted;
  }

  const extracted = trimmed.substring(start, end + 1);

  if (start > 0 || end < trimmed.length - 1) {
    const removedParts: string[] = [];
    if (start > 0) removedParts.push('prose before JSON body');
    if (end < trimmed.length - 1) removedParts.push('prose after JSON body');
    repairs.push(`Removed ${removedParts.join(' and ')}`);
  }

  return extracted;
}

/**
 * Find the position of the matching closing bracket/brace for the opener
 * at position `start`. Uses a stack to track all bracket types ({ [ } ])
 * and skips string literals to avoid being fooled by brackets inside strings.
 * Returns -1 if no matching closer is found.
 */
function findMatchingCloser(content: string, start: number): number {
  const stack: string[] = [];
  let i = start;
  const len = content.length;

  while (i < len) {
    const ch = content[i];

    // Skip string literals
    if (ch === '"') {
      i++;
      while (i < len && content[i] !== '"') {
        if (content[i] === '\\') {
          i += 2;
        } else {
          i++;
        }
      }
      if (i < len) i++; // skip closing quote
      continue;
    }

    // Also skip single-quoted strings (common in agent output)
    if (ch === "'") {
      i++;
      while (i < len && content[i] !== "'" && content[i] !== '\n') {
        if (content[i] === '\\') {
          i += 2;
        } else {
          i++;
        }
      }
      if (i < len && content[i] === "'") i++; // skip closing quote
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === '{') {
        stack.pop();
        if (stack.length === 0) return i;
      }
    } else if (ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === '[') {
        stack.pop();
        if (stack.length === 0) return i;
      }
    }

    i++;
  }

  return -1; // No matching closer found
}

/**
 * Strip JavaScript-style comments from JSON content.
 * Handles single-line (//) and multi-line comments.
 * Uses character-by-character parsing to correctly skip string literals,
 * preventing corruption of URLs (e.g., "https://...") and other strings
 * that contain // or /* sequences.
 *
 * Reimplemented from system-namespace.builders.ts (module-private).
 */
export function stripJsonComments(content: string, repairs: string[]): string {
  let result = '';
  let i = 0;
  const len = content.length;
  let commentCount = 0;

  while (i < len) {
    const ch = content[i];

    // Handle string literals — pass through unchanged
    if (ch === '"') {
      result += '"';
      i++;
      while (i < len && content[i] !== '"') {
        if (content[i] === '\\') {
          // Escaped character — copy both backslash and next char
          result += content[i] + (content[i + 1] || '');
          i += 2;
        } else {
          result += content[i];
          i++;
        }
      }
      if (i < len) {
        result += '"'; // closing quote
        i++;
      }
      continue;
    }

    // Handle single-line comments (// ...)
    if (ch === '/' && i + 1 < len && content[i + 1] === '/') {
      commentCount++;
      i += 2;
      while (i < len && content[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Handle multi-line comments (/* ... */)
    if (ch === '/' && i + 1 < len && content[i + 1] === '*') {
      commentCount++;
      i += 2;
      while (i < len - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
        i++;
      }
      if (i < len - 1) {
        i += 2; // skip closing */
      }
      continue;
    }

    // Regular character
    result += ch;
    i++;
  }

  if (commentCount > 0) {
    repairs.push(
      `Removed ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`,
    );
  }

  return result;
}

/**
 * Remove trailing commas before } or ].
 * Handles commas with optional whitespace/newlines between the comma and closer.
 * Uses character-by-character parsing to skip string literals, preventing
 * corruption of string values that contain ",}" or ",]" sequences.
 */
export function fixTrailingCommas(content: string, repairs: string[]): string {
  let result = '';
  let i = 0;
  const len = content.length;
  let fixCount = 0;

  while (i < len) {
    const ch = content[i];

    // Skip string literals — pass through unchanged
    if (ch === '"') {
      result += '"';
      i++;
      while (i < len && content[i] !== '"') {
        if (content[i] === '\\') {
          result += content[i] + (content[i + 1] || '');
          i += 2;
        } else {
          result += content[i];
          i++;
        }
      }
      if (i < len) {
        result += '"';
        i++;
      }
      continue;
    }

    // Check for trailing comma: comma followed by optional whitespace then } or ]
    if (ch === ',') {
      // Look ahead past whitespace to see if next non-whitespace is } or ]
      let j = i + 1;
      while (
        j < len &&
        (content[j] === ' ' ||
          content[j] === '\t' ||
          content[j] === '\n' ||
          content[j] === '\r')
      ) {
        j++;
      }

      if (j < len && (content[j] === '}' || content[j] === ']')) {
        // Trailing comma found — skip the comma, keep the whitespace and closer
        fixCount++;
        // Don't append the comma; continue from i+1 so whitespace and closer are appended normally
        i++;
        continue;
      }
    }

    result += ch;
    i++;
  }

  if (fixCount > 0) {
    repairs.push(
      `Fixed ${fixCount} trailing ${fixCount === 1 ? 'comma' : 'commas'}`,
    );
  }

  return result;
}

/**
 * Context-aware single-quote to double-quote conversion for JSON.
 * Converts single-quoted keys and values to double-quoted.
 * Careful to not corrupt:
 * - Apostrophes inside double-quoted strings (e.g., "it's")
 * - Already double-quoted content
 *
 * Strategy: Process character by character. When we encounter a single quote
 * that is not inside a double-quoted string, and is followed by content that
 * looks like a JSON string (ends with a matching single quote), convert both.
 */
export function fixSingleQuotes(content: string, repairs: string[]): string {
  let result = '';
  let i = 0;
  const len = content.length;
  let fixCount = 0;

  while (i < len) {
    const ch = content[i];

    // Pass through double-quoted strings unchanged
    if (ch === '"') {
      result += '"';
      i++;
      while (i < len && content[i] !== '"') {
        if (content[i] === '\\') {
          result += content[i] + (content[i + 1] || '');
          i += 2;
        } else {
          result += content[i];
          i++;
        }
      }
      if (i < len) {
        result += '"';
        i++;
      }
      continue;
    }

    // Handle single quotes — convert to double quotes for JSON
    if (ch === "'") {
      // Find the matching closing single quote
      let j = i + 1;
      let escaped = false;
      while (j < len) {
        if (escaped) {
          escaped = false;
          j++;
          continue;
        }
        if (content[j] === '\\') {
          escaped = true;
          j++;
          continue;
        }
        if (content[j] === "'") {
          break;
        }
        // If we hit a newline before finding closing quote, it's not a string
        if (content[j] === '\n') {
          break;
        }
        j++;
      }

      if (j < len && content[j] === "'") {
        // Found matching closing single quote — convert both to double quotes
        // Also escape any unescaped double quotes inside the string
        const inner = content.substring(i + 1, j);
        const escapedInner = inner
          .replace(/\\'/g, "'") // unescape escaped single quotes
          .replace(/(?<!\\)"/g, '\\"'); // escape unescaped double quotes
        result += '"' + escapedInner + '"';
        fixCount++;
        i = j + 1;
        continue;
      }

      // No matching closing quote — pass through as-is (likely an apostrophe)
      result += ch;
      i++;
      continue;
    }

    result += ch;
    i++;
  }

  if (fixCount > 0) {
    repairs.push(
      `Converted ${fixCount} single-quoted ${fixCount === 1 ? 'string' : 'strings'} to double quotes`,
    );
  }

  return result;
}

/**
 * Fix unquoted keys in JSON-like content.
 * Converts { key: "value" } to { "key": "value" }.
 * Handles keys that are valid JavaScript identifiers (letters, digits, _, $).
 * Does not modify content inside string values.
 */
export function fixUnquotedKeys(content: string, repairs: string[]): string {
  let fixCount = 0;
  let result = '';
  let i = 0;
  const len = content.length;

  while (i < len) {
    const ch = content[i];

    // Skip over string literals entirely
    if (ch === '"') {
      result += '"';
      i++;
      while (i < len && content[i] !== '"') {
        if (content[i] === '\\') {
          result += content[i] + (content[i + 1] || '');
          i += 2;
        } else {
          result += content[i];
          i++;
        }
      }
      if (i < len) {
        result += '"';
        i++;
      }
      continue;
    }

    // Look for unquoted key pattern: identifier followed by colon
    // Must be preceded by {, comma, or start of line (with optional whitespace)
    if (/[a-zA-Z_$]/.test(ch)) {
      // Check if this looks like a key position
      // Look back to see if we're after a structural character
      const preceding = result.trimEnd();
      const lastChar = preceding[preceding.length - 1];

      if (lastChar === '{' || lastChar === ',' || lastChar === undefined) {
        // Collect the identifier
        let identifier = '';
        let j = i;
        while (j < len && /[a-zA-Z0-9_$]/.test(content[j])) {
          identifier += content[j];
          j++;
        }

        // Check if followed by colon (with optional whitespace)
        let k = j;
        while (k < len && (content[k] === ' ' || content[k] === '\t')) {
          k++;
        }

        if (k < len && content[k] === ':') {
          // This is an unquoted key — quote it
          result += '"' + identifier + '"';
          fixCount++;
          i = j;
          continue;
        }
      }
    }

    result += ch;
    i++;
  }

  if (fixCount > 0) {
    repairs.push(
      `Quoted ${fixCount} unquoted ${fixCount === 1 ? 'key' : 'keys'}`,
    );
  }

  return result;
}

/**
 * Balance brackets and braces by appending missing closers.
 * Counts open vs close braces/brackets (skipping string literals)
 * and appends the minimum closers needed.
 */
export function balanceBrackets(content: string, repairs: string[]): string {
  // Track open brackets/braces using a stack, skipping string literals
  const stack: string[] = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    const ch = content[i];

    // Skip string literals
    if (ch === '"') {
      i++;
      while (i < len && content[i] !== '"') {
        if (content[i] === '\\') {
          i += 2;
        } else {
          i++;
        }
      }
      if (i < len) {
        i++; // skip closing quote
      }
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === '{') {
        stack.pop();
      }
    } else if (ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === '[') {
        stack.pop();
      }
    }

    i++;
  }

  if (stack.length === 0) {
    return content;
  }

  // Append missing closers in reverse order
  const closers = stack
    .reverse()
    .map((opener) => (opener === '{' ? '}' : ']'))
    .join('');

  repairs.push(
    `Appended ${stack.length} missing ${stack.length === 1 ? 'bracket' : 'brackets'}: ${closers}`,
  );

  return content + closers;
}

// ========================================
// Schema Validation
// ========================================

/**
 * Lightweight JSON Schema validation.
 * Checks required keys and basic type constraints without a full schema library.
 *
 * Supports:
 * - "required" array: checks that top-level keys exist
 * - "properties" map: checks type of values (string, number, boolean, array, object)
 *
 * @param parsed - The parsed JSON value
 * @param schema - A schema object with optional "required" and "properties" fields,
 * @returns Array of error messages (empty if valid)
 */
function validateAgainstSchema(
  parsed: unknown,
  schema: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  // Must be an object to validate properties/required
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    if (schema['required'] || schema['properties']) {
      errors.push(
        `Expected a JSON object for schema validation, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      );
    }
    return errors;
  }

  const obj = parsed as Record<string, unknown>;

  // Check required keys
  const requiredKeys = schema['required'];
  if (Array.isArray(requiredKeys)) {
    for (const key of requiredKeys) {
      if (typeof key === 'string' && !(key in obj)) {
        errors.push(`Missing required key: '${key}'`);
      }
    }
  }

  // Check property types
  const schemaProperties = schema['properties'];
  if (
    schemaProperties &&
    typeof schemaProperties === 'object' &&
    !Array.isArray(schemaProperties)
  ) {
    const props = schemaProperties as Record<string, Record<string, unknown>>;

    for (const [key, propSchema] of Object.entries(props)) {
      if (!(key in obj)) {
        continue; // Only validate present keys (required check handles absence)
      }

      const value = obj[key];
      const expectedType = propSchema?.['type'];

      if (typeof expectedType !== 'string') {
        continue; // No type constraint specified
      }

      const actualType = getJsonType(value);
      if (actualType !== expectedType) {
        errors.push(
          `Expected '${key}' to be ${expectedType}, got ${actualType}`,
        );
      }
    }
  }

  return errors;
}

/**
 * Get the JSON Schema type name for a value.
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // string, number, boolean, object
}

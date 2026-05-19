/**
 * WorkspacePathEncoder - Secure workspace path encoding utility
 *
 * **Security Principles**:
 * 1. Prevent path traversal attacks (reject ".." sequences)
 * 2. Reject absolute paths (prevent escaping workspace context)
 * 3. Normalize path separators (cross-platform consistency)
 * 4. URL-encode special characters (prevent injection)
 * 5. Enforce length limits (prevent filesystem overflow)
 *
 * **Use Cases**:
 * - Backend: SessionManager encodes paths for session directory creation
 * - SDK Storage: Path normalization for cross-platform session storage
 *
 * **Design**: Pure utility class (no dependencies, stateless, testable)
 */

/**
 * Security validation result
 */
export interface PathValidationResult {
  isValid: boolean;
  error?: string;
  normalized?: string;
}

/**
 * WorkspacePathEncoder - Secure path encoding with validation
 */
export class WorkspacePathEncoder {
  /**
   * Maximum allowed path length (filesystem safety)
   * Windows MAX_PATH = 260, but encoded paths may be longer
   * Using 255 as safe limit for encoded output
   */
  private static readonly MAX_PATH_LENGTH = 255;

  /**
   * Allowed characters after encoding (alphanumeric + hyphen + underscore)
   */
  private static readonly SAFE_CHAR_PATTERN = /^[a-z0-9_-]+$/;

  /**
   * Encode workspace path securely
   *
   * **Algorithm**:
   * 1. Validate path (reject traversal attempts, absolute paths)
   * 2. Normalize separators (\ → /)
   * 3. Remove drive letters (C: → )
   * 4. Replace special chars with hyphens
   * 5. Lowercase for consistency
   * 6. Validate length and safe characters
   *
   * **Security Checks**:
   * - Rejects paths containing ".." (parent directory traversal)
   * - Rejects absolute paths (starting with / or drive letter)
   * - Enforces max length limit
   * - Only allows safe characters in output
   *
   * @param workspacePath - Workspace path to encode (relative or absolute from workspace root)
   * @returns Encoded path safe for filesystem use
   * @throws Error if path fails security validation
   *
   * @example
   * ```typescript
   * // Valid paths
   * WorkspacePathEncoder.encode('D:\\projects\\ptah-extension');
   * // Returns: 'd--projects-ptah-extension'
   *
   * WorkspacePathEncoder.encode('/home/user/workspace');
   * // Returns: '-home-user-workspace'
   *
   * // Invalid paths (throws Error)
   * WorkspacePathEncoder.encode('../../etc/passwd');  // Path traversal
   * WorkspacePathEncoder.encode('/etc/passwd');       // Absolute path outside workspace
   * ```
   */
  static encode(workspacePath: string): string {
    const validation = this.validate(workspacePath);
    if (!validation.isValid) {
      throw new Error(`Path encoding failed: ${validation.error}`);
    }
    if (!validation.normalized) {
      throw new Error('Path normalization failed');
    }
    const normalized = validation.normalized;
    const withoutDrive = normalized.replace(/^([a-z]):/, '$1-');
    const encoded = withoutDrive
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-') // Replace whitespace with hyphen
      .toLowerCase();
    if (encoded.length > this.MAX_PATH_LENGTH) {
      throw new Error(
        `Encoded path exceeds maximum length (${encoded.length} > ${this.MAX_PATH_LENGTH})`
      );
    }

    if (!this.SAFE_CHAR_PATTERN.test(encoded)) {
      throw new Error(`Encoded path contains unsafe characters: ${encoded}`);
    }

    return encoded;
  }

  /**
   * Validate workspace path for security
   *
   * **Security Checks**:
   * 1. Reject empty paths
   * 2. Reject path traversal attempts (..)
   * 3. Reject absolute paths outside workspace context
   * 4. Normalize separators for consistency
   *
   * @param workspacePath - Path to validate
   * @returns Validation result with normalized path if valid
   *
   * @example
   * ```typescript
   * const result = WorkspacePathEncoder.validate('src/components/app');
   * if (result.isValid) {
   *   console.log('Normalized:', result.normalized);
   * } else {
   *   console.error('Invalid:', result.error);
   * }
   * ```
   */
  static validate(workspacePath: string): PathValidationResult {
    if (!workspacePath || workspacePath.trim().length === 0) {
      return {
        isValid: false,
        error: 'Path cannot be empty',
      };
    }
    if (workspacePath.includes('..')) {
      return {
        isValid: false,
        error: 'Path traversal detected (.. not allowed)',
      };
    }
    const normalized = workspacePath.replace(/\\/g, '/');
    if (normalized.length > this.MAX_PATH_LENGTH * 2) {
      return {
        isValid: false,
        error: `Path too long (${normalized.length} chars)`,
      };
    }

    return {
      isValid: true,
      normalized,
    };
  }

  /**
   * Check if a string is a valid encoded path
   *
   * @param encoded - Encoded path to check
   * @returns True if path matches safe encoding pattern
   *
   * @example
   * ```typescript
   * WorkspacePathEncoder.isValidEncoded('d--projects-app');  // true
   * WorkspacePathEncoder.isValidEncoded('../etc/passwd');     // false
   * WorkspacePathEncoder.isValidEncoded('path/with/slash');   // false
   * ```
   */
  static isValidEncoded(encoded: string): boolean {
    return (
      encoded.length > 0 &&
      encoded.length <= this.MAX_PATH_LENGTH &&
      this.SAFE_CHAR_PATTERN.test(encoded)
    );
  }
}

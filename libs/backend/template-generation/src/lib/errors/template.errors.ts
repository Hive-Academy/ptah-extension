/**
 * Template generation error classes
 * Adapted from roocode-generator memory-bank-errors.ts
 *
 * NOTE: Ptah doesn't have a base RooCodeError class.
 * These errors extend standard Error class instead.
 */

/**
 * Base error class for template generation errors
 */
export class TemplateError extends Error {
  constructor(
    message: string,
    public readonly code = 'TEMPLATE_ERROR',
    public readonly context?: Record<string, unknown>,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TemplateError';

    // Maintain proper stack trace for where error was thrown (only on V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TemplateError);
    }
  }
}

/**
 * Error thrown during template generation process
 */
export class TemplateGenerationError extends TemplateError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super(
      message,
      'TEMPLATE_GENERATION_ERROR',
      { ...context, errorType: 'generation' },
      cause
    );
    this.name = 'TemplateGenerationError';
  }
}

/**
 * Error thrown during template file operations
 */
export class TemplateFileError extends TemplateError {
  constructor(
    message: string,
    public readonly filePath: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super(
      message,
      'TEMPLATE_FILE_ERROR',
      { ...context, filePath, errorType: 'file' },
      cause
    );
    this.name = 'TemplateFileError';
  }
}

/**
 * Error thrown during template processing operations
 */
export class TemplateProcessingError extends TemplateError {
  constructor(
    message: string,
    public readonly templateName: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super(
      message,
      'TEMPLATE_PROCESSING_ERROR',
      { ...context, templateName, errorType: 'template' },
      cause
    );
    this.name = 'TemplateProcessingError';
  }
}

/**
 * Error thrown during template validation operations
 */
export class TemplateValidationError extends TemplateError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super(
      message,
      'TEMPLATE_VALIDATION_ERROR',
      { ...context, errorType: 'validation' },
      cause
    );
    this.name = 'TemplateValidationError';
  }
}

/**
 * Unit tests for MessageValidationService
 *
 * Tests all 5 validation rules:
 * 1. Null/undefined check
 * 2. Type check (string required)
 * 3. Whitespace-only check
 * 4. Maximum length check (100,000 chars)
 * 5. Alphanumeric content check
 *
 * Also tests sanitization logic.
 *
 * Created in ChatStore refactoring (TASK_2025_054) - Batch 5
 */

import { TestBed } from '@angular/core/testing';
import { MessageValidationService } from './message-validation.service';

describe('MessageValidationService', () => {
  let service: MessageValidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MessageValidationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ============================================================================
  // RULE 1: Null/undefined check
  // ============================================================================

  describe('Rule 1: Null/undefined check', () => {
    it('should reject null content', () => {
      const result = service.validate(null);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('null or undefined');
    });

    it('should reject undefined content', () => {
      const result = service.validate(undefined);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('null or undefined');
    });
  });

  // ============================================================================
  // RULE 2: Type check (must be string)
  // ============================================================================

  describe('Rule 2: Type check', () => {
    it('should reject number content', () => {
      const result = service.validate(123);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be a string');
      expect(result.reason).toContain('number');
    });

    it('should reject boolean content', () => {
      const result = service.validate(true);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be a string');
      expect(result.reason).toContain('boolean');
    });

    it('should reject object content', () => {
      const result = service.validate({ message: 'test' });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be a string');
      expect(result.reason).toContain('object');
    });

    it('should reject array content', () => {
      const result = service.validate(['test']);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be a string');
      expect(result.reason).toContain('object'); // Arrays are typeof object
    });
  });

  // ============================================================================
  // RULE 3: Whitespace-only check
  // ============================================================================

  describe('Rule 3: Whitespace-only check', () => {
    it('should reject empty string', () => {
      const result = service.validate('');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty or contains only whitespace');
    });

    it('should reject single space', () => {
      const result = service.validate(' ');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty or contains only whitespace');
    });

    it('should reject multiple spaces', () => {
      const result = service.validate('     ');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty or contains only whitespace');
    });

    it('should reject tabs only', () => {
      const result = service.validate('\t\t\t');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty or contains only whitespace');
    });

    it('should reject newlines only', () => {
      const result = service.validate('\n\n\n');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty or contains only whitespace');
    });

    it('should reject mixed whitespace', () => {
      const result = service.validate('  \t\n  \r  ');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty or contains only whitespace');
    });
  });

  // ============================================================================
  // RULE 4: Maximum length check (100,000 characters)
  // ============================================================================

  describe('Rule 4: Maximum length check', () => {
    it('should accept content at maximum length (100,000 chars)', () => {
      const maxContent = 'a'.repeat(100000);
      const result = service.validate(maxContent);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject content exceeding maximum length (100,001 chars)', () => {
      const tooLongContent = 'a'.repeat(100001);
      const result = service.validate(tooLongContent);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum length');
      expect(result.reason).toContain('100000'); // No comma formatting in error message
      expect(result.reason).toContain('100001'); // Reports actual length
    });

    it('should reject very long content (200,000 chars)', () => {
      const veryLongContent = 'Hello world! '.repeat(16667); // ~200k chars
      const result = service.validate(veryLongContent);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum length');
    });
  });

  // ============================================================================
  // RULE 5: Alphanumeric content check
  // ============================================================================

  describe('Rule 5: Alphanumeric content check', () => {
    it('should reject punctuation-only content (single exclamation)', () => {
      const result = service.validate('!');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('letter or number');
    });

    it('should reject punctuation-only content (multiple symbols)', () => {
      const result = service.validate('!!!???...');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('letter or number');
    });

    it('should reject emoji-only content', () => {
      const result = service.validate('😀😃😄');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('letter or number');
    });

    it('should reject special characters only', () => {
      const result = service.validate('@#$%^&*()');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('letter or number');
    });

    it('should accept content with letters', () => {
      const result = service.validate('Hello');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept content with numbers', () => {
      const result = service.validate('123');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept content with letters and punctuation', () => {
      const result = service.validate('Hello, world!');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept content with numbers and symbols', () => {
      const result = service.validate('2 + 2 = 4');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  // ============================================================================
  // VALID CONTENT TESTS
  // ============================================================================

  describe('Valid content', () => {
    it('should accept simple message', () => {
      const result = service.validate('Hello world');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept message with leading/trailing spaces (sanitization will handle)', () => {
      const result = service.validate('  Hello world  ');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept multi-line message', () => {
      const result = service.validate('Line 1\nLine 2\nLine 3');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept code snippet', () => {
      const result = service.validate('function test() { return 42; }');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept long valid message (50,000 chars)', () => {
      const longMessage = 'Hello world! '.repeat(4167); // ~50k chars
      const result = service.validate(longMessage);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  // ============================================================================
  // SANITIZATION TESTS
  // ============================================================================

  describe('sanitize()', () => {
    it('should trim leading whitespace', () => {
      const result = service.sanitize('   Hello');

      expect(result).toBe('Hello');
    });

    it('should trim trailing whitespace', () => {
      const result = service.sanitize('Hello   ');

      expect(result).toBe('Hello');
    });

    it('should trim both leading and trailing whitespace', () => {
      const result = service.sanitize('   Hello world   ');

      expect(result).toBe('Hello world');
    });

    it('should preserve internal whitespace', () => {
      const result = service.sanitize('  Hello   world  ');

      expect(result).toBe('Hello   world');
    });

    it('should handle tabs and newlines', () => {
      const result = service.sanitize('\t\nHello world\n\t');

      expect(result).toBe('Hello world');
    });

    it('should return same string if no whitespace', () => {
      const result = service.sanitize('Hello');

      expect(result).toBe('Hello');
    });

    it('should handle empty string', () => {
      const result = service.sanitize('');

      expect(result).toBe('');
    });
  });

  // ============================================================================
  // EDGE CASES AND INTEGRATION TESTS
  // ============================================================================

  describe('Edge cases', () => {
    it('should validate then sanitize workflow', () => {
      const content = '  Hello world  ';

      // First validate (should pass with whitespace)
      const validation = service.validate(content);
      expect(validation.valid).toBe(true);

      // Then sanitize
      const sanitized = service.sanitize(content);
      expect(sanitized).toBe('Hello world');

      // Validate sanitized (should still pass)
      const revalidation = service.validate(sanitized);
      expect(revalidation.valid).toBe(true);
    });

    it('should accept Unicode letters (Japanese)', () => {
      // Unicode-aware validation: \p{L} matches letters in any script,
      // so Japanese characters satisfy the "letter or number" rule.
      const result = service.validate('こんにちは世界'); // Japanese

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept content with Unicode and alphanumeric', () => {
      const result = service.validate('Hello 世界'); // Mixed

      expect(result.valid).toBe(true); // Contains 'Hello' (alphanumeric)
    });

    it('should handle zero-width characters', () => {
      const result = service.validate('\u200B'); // Zero-width space

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('letter or number');
    });
  });
});

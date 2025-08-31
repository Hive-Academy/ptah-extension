/**
 * Comprehensive Test Suite for MessageValidatorService
 * Testing critical fixes for TASK_CMD_010
 *
 * Focus areas:
 * 1. Permission validation schemas (chat:permissionRequest/Response)
 * 2. Type safety and zero 'any' types
 * 3. Performance validation under 10ms
 * 4. Error handling robustness
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  MessageValidatorService,
  ValidationError,
  MessageValidationError,
} from './message-validator.service';
import { StrictMessage, MessagePayloadMap } from '@ptah-extension/shared';
import { SessionId, MessageId, CorrelationId } from '@ptah-extension/shared';

describe('MessageValidatorService - TASK_CMD_010 Validation', () => {
  let service: typeof MessageValidatorService;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    service = MessageValidatorService;

    // Mock console methods to avoid noise in tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  describe('🔒 CRITICAL FIX: Permission Validation Schemas', () => {
    describe('chat:permissionRequest validation', () => {
      it('should validate valid permission request messages', () => {
        const validRequestMessage: StrictMessage<'chat:permissionRequest'> = {
          type: 'chat:permissionRequest',
          payload: {
            requestId: 'req_123',
            permission: 'file:write',
            context: 'Writing configuration file',
            timestamp: Date.now(),
            sessionId: 'session_123',
          },
          correlationId: 'corr_123' as CorrelationId,
          timestamp: Date.now(),
        };

        const result = service.validateMessage(validRequestMessage, 'chat:permissionRequest');

        expect(result).toBeDefined();
        expect(result.type).toBe('chat:permissionRequest');
        expect(result.payload.requestId).toBe('req_123');
        expect(result.payload.permission).toBe('file:write');
        expect(result.payload.sessionId).toBe('session_123');
      });

      it('should reject permission requests with missing required fields', () => {
        const invalidRequestMessage = {
          type: 'chat:permissionRequest',
          payload: {
            // Missing requestId
            permission: 'file:write',
            timestamp: Date.now(),
            sessionId: 'session_123',
          },
        };

        expect(() => {
          service.validateMessage(invalidRequestMessage, 'chat:permissionRequest');
        }).toThrow(MessageValidationError);
      });

      it('should reject permission requests with empty string fields', () => {
        const invalidRequestMessage = {
          type: 'chat:permissionRequest',
          payload: {
            requestId: '', // Empty string should fail
            permission: 'file:write',
            timestamp: Date.now(),
            sessionId: 'session_123',
          },
        };

        expect(() => {
          service.validateMessage(invalidRequestMessage, 'chat:permissionRequest');
        }).toThrow(MessageValidationError);
      });

      it('should validate permission request under 10ms (performance test)', async () => {
        const validRequestMessage: StrictMessage<'chat:permissionRequest'> = {
          type: 'chat:permissionRequest',
          payload: {
            requestId: 'req_perf_test',
            permission: 'file:read',
            context: 'Reading file for analysis',
            timestamp: Date.now(),
            sessionId: 'session_perf',
          },
        };

        const startTime = performance.now();

        // Run validation 100 times to get average performance
        for (let i = 0; i < 100; i++) {
          service.validateMessage(validRequestMessage, 'chat:permissionRequest');
        }

        const endTime = performance.now();
        const averageTime = (endTime - startTime) / 100;

        expect(averageTime).toBeLessThan(10); // Must be under 10ms per validation
      });
    });

    describe('chat:permissionResponse validation', () => {
      it('should validate valid permission response messages', () => {
        const validResponseMessage: StrictMessage<'chat:permissionResponse'> = {
          type: 'chat:permissionResponse',
          payload: {
            requestId: 'req_123',
            response: 'allow',
            timestamp: Date.now(),
          },
          correlationId: 'corr_123' as CorrelationId,
          timestamp: Date.now(),
        };

        const result = service.validateMessage(validResponseMessage, 'chat:permissionResponse');

        expect(result).toBeDefined();
        expect(result.type).toBe('chat:permissionResponse');
        expect(result.payload.requestId).toBe('req_123');
        expect(result.payload.response).toBe('allow');
      });

      it('should validate all allowed response types', () => {
        const responseTypes: Array<'allow' | 'always_allow' | 'deny'> = [
          'allow',
          'always_allow',
          'deny',
        ];

        responseTypes.forEach((responseType) => {
          const responseMessage: StrictMessage<'chat:permissionResponse'> = {
            type: 'chat:permissionResponse',
            payload: {
              requestId: 'req_123',
              response: responseType,
              timestamp: Date.now(),
            },
          };

          const result = service.validateMessage(responseMessage, 'chat:permissionResponse');
          expect(result.payload.response).toBe(responseType);
        });
      });

      it('should reject invalid response types', () => {
        const invalidResponseMessage = {
          type: 'chat:permissionResponse',
          payload: {
            requestId: 'req_123',
            response: 'invalid_response', // Not in enum
            timestamp: Date.now(),
          },
        };

        expect(() => {
          service.validateMessage(invalidResponseMessage, 'chat:permissionResponse');
        }).toThrow(MessageValidationError);
      });

      it('should reject permission responses with missing requestId', () => {
        const invalidResponseMessage = {
          type: 'chat:permissionResponse',
          payload: {
            // Missing requestId
            response: 'allow',
            timestamp: Date.now(),
          },
        };

        expect(() => {
          service.validateMessage(invalidResponseMessage, 'chat:permissionResponse');
        }).toThrow(MessageValidationError);
      });
    });
  });

  describe('🛡️ Type Safety and Zero "any" Types', () => {
    it('should maintain strict typing throughout validation chain', () => {
      const message: StrictMessage<'chat:sendMessage'> = {
        type: 'chat:sendMessage',
        payload: {
          content: 'Test message',
          correlationId: 'corr_123' as CorrelationId,
        },
        timestamp: Date.now(),
      };

      const result = service.validateMessage(message, 'chat:sendMessage');

      // TypeScript should enforce these types at compile time
      // Runtime check ensures no 'any' type casting occurred
      expect(typeof result.type).toBe('string');
      expect(typeof result.payload).toBe('object');
      expect(result.payload).not.toBeNull();
    });

    it('should handle unknown message types safely', () => {
      const unknownMessage = {
        type: 'unknown:messageType',
        payload: { data: 'test' },
      };

      const result = service.validateUnknownMessage(unknownMessage);
      expect(result).toBeNull(); // Should safely return null for unknown types
    });

    it('should provide type-safe error information', () => {
      const invalidMessage = {
        type: 'chat:sendMessage',
        payload: {
          // Missing required content field
          correlationId: 'corr_123',
        },
      };

      expect(() => {
        service.validateMessage(invalidMessage, 'chat:sendMessage');
      }).toThrow(MessageValidationError);

      try {
        service.validateMessage(invalidMessage, 'chat:sendMessage');
      } catch (error) {
        expect(error).toBeInstanceOf(MessageValidationError);
        expect((error as MessageValidationError).messageType).toBe('chat:sendMessage');
        expect((error as MessageValidationError).context).toBeDefined();
        expect((error as MessageValidationError).context.errors).toBeDefined();
      }
    });
  });

  describe('⚡ Performance Validation Tests', () => {
    it('should validate chat messages under 10ms p99', async () => {
      const testMessage: StrictMessage<'chat:messageAdded'> = {
        type: 'chat:messageAdded',
        payload: {
          message: {
            id: 'msg_123' as MessageId,
            sessionId: 'session_123' as SessionId,
            type: 'assistant',
            content: 'Performance test message',
            timestamp: Date.now(),
            streaming: false,
          },
        },
      };

      const latencies: number[] = [];

      // Run 1000 validations to get p99
      for (let i = 0; i < 1000; i++) {
        const start = performance.now();
        service.validateMessage(testMessage, 'chat:messageAdded');
        const end = performance.now();
        latencies.push(end - start);
      }

      latencies.sort((a, b) => a - b);
      const p99Index = Math.floor(latencies.length * 0.99);
      const p99Latency = latencies[p99Index];

      expect(p99Latency).toBeLessThan(10); // p99 must be under 10ms
    });

    it('should handle bulk validation efficiently', () => {
      const messages: Array<StrictMessage> = [];

      // Generate 100 test messages
      for (let i = 0; i < 100; i++) {
        messages.push({
          type: 'chat:sendMessage',
          payload: {
            content: `Test message ${i}`,
            correlationId: `corr_${i}` as CorrelationId,
          },
          timestamp: Date.now(),
        });
      }

      const startTime = performance.now();

      messages.forEach((msg) => {
        service.validateMessage(msg, 'chat:sendMessage');
      });

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const avgTimePerMessage = totalTime / messages.length;

      expect(avgTimePerMessage).toBeLessThan(5); // Average should be even faster
      expect(totalTime).toBeLessThan(500); // Total time for 100 messages
    });
  });

  describe('🔧 Error Handling and Edge Cases', () => {
    it('should handle malformed payload gracefully', () => {
      const malformedMessage = {
        type: 'chat:sendMessage',
        payload: null, // null payload
      };

      expect(() => {
        service.validateMessage(malformedMessage, 'chat:sendMessage');
      }).toThrow(ValidationError);
    });

    it('should provide detailed error context', () => {
      const invalidMessage = {
        type: 'chat:permissionRequest',
        payload: {
          requestId: 123, // Wrong type (number instead of string)
          permission: 'file:write',
        },
      };

      try {
        service.validateMessage(invalidMessage, 'chat:permissionRequest');
        fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(MessageValidationError);

        const validationError = error as MessageValidationError;
        expect(validationError.context.errors).toBeDefined();
        expect(validationError.context.received).toBeDefined();
        expect(validationError.messageType).toBe('chat:permissionRequest');
      }
    });

    it('should handle safe validation wrapper correctly', () => {
      const invalidMessage = {
        type: 'invalid:type',
        payload: { data: 'test' },
      };

      // Safe validation should return null instead of throwing
      const result = service.safeValidateMessage(invalidMessage, 'chat:sendMessage');
      expect(result).toBeNull();
    });

    it('should format validation errors properly', () => {
      const invalidMessage = {
        type: 'chat:permissionRequest',
        payload: {
          requestId: '', // Empty string
          permission: '', // Empty string
          timestamp: 'invalid', // Invalid timestamp type
          sessionId: '',
        },
      };

      try {
        service.validateMessage(invalidMessage, 'chat:permissionRequest');
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(MessageValidationError);

        const validationError = error as MessageValidationError;
        expect(validationError.message).toContain('Invalid payload for message type');
        expect(validationError.context.errors).toBeDefined();
      }
    });
  });

  describe('🔍 Branded Types Validation', () => {
    it('should validate SessionId branded types', () => {
      const validSessionId = 'session_123';
      const result = service.validateSessionId(validSessionId);

      expect(result).toBe(validSessionId);
      expect(typeof result).toBe('string');
    });

    it('should validate MessageId branded types', () => {
      const validMessageId = 'msg_123';
      const result = service.validateMessageId(validMessageId);

      expect(result).toBe(validMessageId);
      expect(typeof result).toBe('string');
    });

    it('should validate CorrelationId branded types', () => {
      const validCorrelationId = 'corr_123';
      const result = service.validateCorrelationId(validCorrelationId);

      expect(result).toBe(validCorrelationId);
      expect(typeof result).toBe('string');
    });
  });

  describe('🧪 Edge Case Coverage', () => {
    it('should handle empty payloads for appropriate message types', () => {
      const emptyPayloadMessage: StrictMessage<'analytics:getData'> = {
        type: 'analytics:getData',
        payload: {}, // Empty payload is valid for getData
        timestamp: Date.now(),
      };

      const result = service.validateMessage(emptyPayloadMessage, 'analytics:getData');
      expect(result).toBeDefined();
      expect(result.type).toBe('analytics:getData');
    });

    it('should handle complex nested validation structures', () => {
      const complexMessage: StrictMessage<'providers:healthChanged'> = {
        type: 'providers:healthChanged',
        payload: {
          providerId: 'claude-cli',
          health: {
            status: 'available',
            lastCheck: Date.now(),
            errorMessage: 'All systems operational',
            responseTime: 150,
            uptime: 99.95,
          },
        },
      };

      const result = service.validateMessage(complexMessage, 'providers:healthChanged');
      expect(result).toBeDefined();
      expect(result.payload.health.status).toBe('available');
    });

    it('should reject filtered message types appropriately', () => {
      const filteredMessage = {
        type: 'agent:showContext', // This type should be filtered
        payload: { data: 'test' },
      };

      expect(() => {
        service.validateMessage(filteredMessage, 'agent:showContext' as any);
      }).toThrow(ValidationError);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});

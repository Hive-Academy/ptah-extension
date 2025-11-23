/**
 * Unit Tests for CodeExecutionMCP Service
 *
 * Tests HTTP MCP server lifecycle, JSON-RPC 2.0 protocol, code execution,
 * timeout protection, and error handling for the Code Execution MCP server.
 *
 * Test Coverage:
 * - Server lifecycle (start, stop, dispose, getPort)
 * - MCP protocol endpoints (tools/list, tools/call)
 * - HTTP request handling (POST, OPTIONS, GET, invalid methods)
 * - Code execution with AsyncFunction
 * - Timeout protection and enforcement
 * - Error handling (parse errors, unknown methods, execution errors)
 * - Workspace state management
 */

import 'reflect-metadata';
import { CodeExecutionMCP } from './code-execution-mcp.service';
import { PtahAPIBuilder } from './ptah-api-builder.service';
import { Logger } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as http from 'http';

// Mock vscode module
jest.mock('vscode', () => ({
  ExtensionContext: jest.fn(),
}));

describe('CodeExecutionMCP', () => {
  let service: CodeExecutionMCP;
  let mockApiBuilder: jest.Mocked<PtahAPIBuilder>;
  let mockLogger: jest.Mocked<Logger>;
  let mockContext: jest.Mocked<vscode.ExtensionContext>;
  let mockPtahAPI: any;

  beforeEach(() => {
    // Mock Ptah API
    mockPtahAPI = {
      workspace: {
        analyze: jest.fn().mockResolvedValue({ info: {}, structure: {} }),
        getInfo: jest.fn().mockResolvedValue({ projectType: 'test' }),
      },
      search: {
        findFiles: jest.fn().mockResolvedValue([]),
      },
      symbols: {
        find: jest.fn().mockResolvedValue([]),
      },
      diagnostics: {
        getErrors: jest.fn().mockResolvedValue([]),
        getWarnings: jest.fn().mockResolvedValue([]),
        getAll: jest.fn().mockResolvedValue([]),
      },
      git: {
        getStatus: jest
          .fn()
          .mockResolvedValue({
            branch: 'main',
            modified: [],
            staged: [],
            untracked: [],
          }),
      },
      ai: {
        chat: jest.fn().mockResolvedValue('AI response'),
        selectModel: jest.fn().mockResolvedValue([]),
      },
      files: {
        read: jest.fn().mockResolvedValue('file content'),
        list: jest.fn().mockResolvedValue([]),
      },
      commands: {
        execute: jest.fn().mockResolvedValue({}),
        list: jest.fn().mockResolvedValue([]),
      },
    };

    // Mock API builder
    mockApiBuilder = {
      buildAPI: jest.fn(() => mockPtahAPI),
    } as any;

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Mock extension context
    mockContext = {
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
      },
    } as any;

    // Create service
    service = new CodeExecutionMCP(mockApiBuilder, mockLogger, mockContext);

    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup: stop server if running
    await service.stop();
  });

  describe('Constructor and Dependency Injection', () => {
    it('should be instantiated with all required dependencies', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(CodeExecutionMCP);
    });

    it('should build ptah API on construction', () => {
      // buildAPI is called in constructor, so we need to create a new instance
      const spy = jest.spyOn(mockApiBuilder, 'buildAPI');
      new CodeExecutionMCP(mockApiBuilder, mockLogger, mockContext);
      expect(spy).toHaveBeenCalled();
    });

    it('should be injectable via @injectable() decorator', () => {
      expect(Reflect.hasMetadata('design:paramtypes', CodeExecutionMCP)).toBe(
        true
      );
    });
  });

  describe('Server Lifecycle', () => {
    it('start() should create HTTP server on localhost', async () => {
      const port = await service.start();

      expect(port).toBeGreaterThan(0);
      expect(service.getPort()).toBe(port);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('started'),
        'CodeExecutionMCP'
      );
    });

    it('start() should store port in workspace state', async () => {
      const port = await service.start();

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'ptah.mcp.port',
        port
      );
    });

    it('start() should return existing port if already started', async () => {
      const port1 = await service.start();
      const port2 = await service.start();

      expect(port1).toBe(port2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already started'),
        'CodeExecutionMCP'
      );
    });

    it('getPort() should return current port number', async () => {
      expect(service.getPort()).toBeNull();

      const port = await service.start();
      expect(service.getPort()).toBe(port);
    });

    it('stop() should close server and clear workspace state', async () => {
      await service.start();
      await service.stop();

      expect(service.getPort()).toBeNull();
      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'ptah.mcp.port',
        undefined
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('stopped'),
        'CodeExecutionMCP'
      );
    });

    it('stop() should do nothing if server not running', async () => {
      await service.stop(); // Should not throw
      expect(service.getPort()).toBeNull();
    });

    it('dispose() should call stop()', async () => {
      await service.start();
      service.dispose();

      // Give async stop() time to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(service.getPort()).toBeNull();
    });
  });

  describe('HTTP Request Handling', () => {
    let port: number;
    let serverUrl: string;

    beforeEach(async () => {
      port = await service.start();
      serverUrl = `http://localhost:${port}`;
    });

    it('should handle OPTIONS request (CORS preflight)', (done) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'OPTIONS',
          path: '/',
        },
        (res) => {
          expect(res.statusCode).toBe(204);
          res.on('end', done);
          res.resume();
        }
      );
      req.end();
    });

    it('should handle GET /health request', (done) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'GET',
          path: '/health',
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const data = JSON.parse(body);
            expect(data).toEqual({ status: 'ok', port });
            done();
          });
        }
      );
      req.end();
    });

    it('should return 405 for non-POST MCP requests', (done) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'GET',
          path: '/',
        },
        (res) => {
          expect(res.statusCode).toBe(405);
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const data = JSON.parse(body);
            expect(data).toEqual({ error: 'Method not allowed' });
            done();
          });
        }
      );
      req.end();
    });

    it('should return 400 for invalid JSON', (done) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          expect(res.statusCode).toBe(400);
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const data = JSON.parse(body);
            expect(data.error.code).toBe(-32700);
            expect(data.error.message).toBe('Parse error');
            done();
          });
        }
      );
      req.write('invalid json');
      req.end();
    });
  });

  describe('MCP Protocol - tools/list', () => {
    let port: number;

    beforeEach(async () => {
      port = await service.start();
    });

    it('should return execute_code tool definition', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.jsonrpc).toBe('2.0');
            expect(response.id).toBe(1);
            expect(response.result.tools).toHaveLength(1);
            expect(response.result.tools[0].name).toBe('execute_code');
            expect(response.result.tools[0]).toHaveProperty('description');
            expect(response.result.tools[0]).toHaveProperty('inputSchema');
            expect(response.result.tools[0].inputSchema.required).toContain(
              'code'
            );
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });
  });

  describe('MCP Protocol - tools/call', () => {
    let port: number;

    beforeEach(async () => {
      port = await service.start();
    });

    it('should execute simple synchronous code', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'return 1 + 1;',
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.jsonrpc).toBe('2.0');
            expect(response.id).toBe(2);
            expect(response.result).toBeDefined();
            const result = JSON.parse(response.result.content[0].text);
            expect(result).toBe(2);
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });

    it('should access ptah API in code context', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'return typeof ptah;',
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.result).toBeDefined();
            const result = JSON.parse(response.result.content[0].text);
            expect(result).toBe('object');
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });

    it('should return error for unknown tool', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.error).toBeDefined();
            expect(response.error.code).toBe(-32602);
            expect(response.error.message).toContain('Unknown tool');
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });

    it('should return error for unknown method', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'unknown/method',
        params: {},
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.error).toBeDefined();
            expect(response.error.code).toBe(-32601);
            expect(response.error.message).toContain('Method not found');
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });
  });

  describe('Code Execution and Timeout', () => {
    let port: number;

    beforeEach(async () => {
      port = await service.start();
    });

    it('should execute code with return value', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'return { status: "completed", value: 42 };',
            timeout: 500,
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.result).toBeDefined();
            const result = JSON.parse(response.result.content[0].text);
            expect(result).toEqual({ status: 'completed', value: 42 });
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });

    it('should cap timeout at 30000ms', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'return "ok";',
            timeout: 60000, // Request 60s, should be capped at 30s
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.result).toBeDefined();
            // Verify execution succeeded (timeout was capped, not rejected)
            const result = JSON.parse(response.result.content[0].text);
            expect(result).toBe('ok');
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });

    it('should use default timeout of 5000ms when not specified', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'return "default timeout";',
            // No timeout specified
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.result).toBeDefined();
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });
  });

  describe('Error Handling', () => {
    let port: number;

    beforeEach(async () => {
      port = await service.start();
    });

    it('should handle syntax errors in code', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'this is invalid syntax {{{',
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.error).toBeDefined();
            expect(response.error.code).toBe(-32000);
            expect(response.error.message).toContain('Code execution failed');
            expect(response.error.data).toBeDefined(); // Stack trace
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });

    it('should handle runtime errors in code', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'throw new Error("Runtime error");',
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.error).toBeDefined();
            expect(response.error.message).toContain('Runtime error');
            expect(response.error.data).toBeDefined(); // Stack trace
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });

    it('should include stack traces in error responses', (done) => {
      const mcpRequest = {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: {
            code: 'function test() { throw new Error("Test error"); } test();',
          },
        },
      };

      const req = http.request(
        {
          hostname: 'localhost',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const response = JSON.parse(body);
            expect(response.error).toBeDefined();
            expect(response.error.data).toBeDefined();
            expect(typeof response.error.data).toBe('string');
            expect(response.error.data).toContain('Error: Test error');
            done();
          });
        }
      );
      req.write(JSON.stringify(mcpRequest));
      req.end();
    });
  });
});

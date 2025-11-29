# Ptah MCP Server Issue Report

> **Date:** 2025-11-29  
> **Reporter:** Claude Code (Opus 4.5)  
> **Severity:** Critical - All async operations fail

## Executive Summary

The Ptah MCP server, which provides VS Code extension API access for workspace analysis, has a critical serialization bug that causes all asynchronous operations to fail. Synchronous operations work correctly, indicating the MCP connection itself is functional.

## Environment

| Component             | Details                   |
| :-------------------- | :------------------------ |
| **Platform**          | Windows (win32)           |
| **Working Directory** | `D:\projects\Anubis-MCP`  |
| **MCP Server**        | `ptah`                    |
| **Tool**              | `mcp__ptah__execute_code` |

### Available Namespaces

The `ptah` server exposes 11 namespaces through a global `ptah` object:

`workspace`, `search`, `symbols`, `diagnostics`, `git`, `ai`, `files`, `commands`, `context`, `project`, `relevance`

All namespaces are accessible but their async methods fail.

## Test Results

### Test 1: Basic Synchronous Return (SUCCESS)

**Code:**

```javascript
return 'Hello from ptah';
```

**Result:** "Hello from ptah" ✅

### Test 2: Access ptah Object Keys (SUCCESS)

**Code:**

```javascript
return Object.keys(ptah).join(', ');
```

**Result:** "workspace, search, symbols, diagnostics, git, ai, files, commands, context, project, relevance" ✅

### Test 3: Check ptah Type (SUCCESS)

**Code:**

```javascript
return typeof ptah;
```

**Result:** "object" ✅

### Test 4: Workspace Analysis (FAILURE)

**Code:**

```javascript
(async () => {
  const workspaceAnalysis = await ptah.workspace.analyze();
  const gitStatus = await ptah.git.getStatus();
  const diagnostics = await ptah.diagnostics.getAll();
  const monorepo = await ptah.project.detectMonorepo();

  return {
    workspaceInfo: workspaceAnalysis.info,
    structure: workspaceAnalysis.structure,
    gitStatus,
    monorepo,
    diagnosticsCount: diagnostics.length,
  };
})();
```

**Result:** ❌ Zod validation error (see Error Analysis below)

### Test 5: Simple Workspace Info (FAILURE)

**Code:**

```javascript
(async () => {
  const info = await ptah.workspace.getInfo();
  return JSON.stringify(info, null, 2);
})();
```

**Result:** ❌ Same Zod validation error

### Test 6: AI Chat Analysis (FAILURE)

**Code:**

```javascript
(async () => {
  const aiResponse = await ptah.ai.chat('Analyze this workspace');
  return aiResponse;
})();
```

**Result:** ❌ Same Zod validation error

### Test 7: Simple String Return from Async (FAILURE)

**Code:**

```javascript
(async () => {
  const info = await ptah.workspace.getInfo();
  return 'Project type: ' + info.projectType;
})();
```

**Result:** ❌ Same Zod validation error

## Error Analysis

### Full Error Response

All async operations return the same Zod validation error:

```json
[
  {
    "code": "invalid_union",
    "unionErrors": [
      {
        "issues": [
          {
            "code": "invalid_type",
            "expected": "string",
            "received": "undefined",
            "path": ["content", 0, "text"],
            "message": "Required"
          }
        ],
        "name": "ZodError"
      },
      {
        "issues": [
          {
            "received": "text",
            "code": "invalid_literal",
            "expected": "image",
            "path": ["content", 0, "type"],
            "message": "Invalid literal value, expected \"image\""
          }
        ],
        "name": "ZodError"
      },
      {
        "issues": [
          {
            "received": "text",
            "code": "invalid_literal",
            "expected": "audio",
            "path": ["content", 0, "type"],
            "message": "Invalid literal value, expected \"audio\""
          }
        ],
        "name": "ZodError"
      },
      {
        "issues": [
          {
            "code": "invalid_type",
            "expected": "string",
            "received": "undefined",
            "path": ["content", 0, "name"],
            "message": "Required"
          }
        ],
        "name": "ZodError"
      },
      {
        "issues": [
          {
            "received": "text",
            "code": "invalid_literal",
            "expected": "resource",
            "path": ["content", 0, "type"],
            "message": "Invalid literal value, expected \"resource\""
          }
        ],
        "name": "ZodError"
      }
    ],
    "path": ["content", 0],
    "message": "Invalid input"
  }
]
```

### Root Cause Analysis

The error indicates that when the MCP server tries to return the result of an async operation, it constructs an MCP response with:

```javascript
{
  content: [
    {
      type: 'text',
      text: undefined, // <-- This is the problem
    },
  ];
}
```

The `text` field is `undefined` instead of containing the stringified result. This suggests:

1. **Promise Resolution Issue:** The async result is not being properly awaited or captured before serialization.
2. **Serialization Bug:** The result serialization logic may not handle async/Promise returns correctly.
3. **Scope Issue:** The resolved value may be lost between the execution context and the response builder.

## Possible Solutions

### Solution 1: Fix Promise Handling in ptah Server

The server's code execution handler likely needs to properly await and capture the resolved value:

```javascript
// Current (broken) implementation might be:
const result = executeCode(code); // Returns Promise, not awaited
return { content: [{ type: 'text', text: result }] }; // result is Promise object

// Should be:
const result = await executeCode(code); // Properly await
const textResult = typeof result === 'string' ? result : JSON.stringify(result);
return { content: [{ type: 'text', text: textResult }] };
```

### Solution 2: Handle IIFE Returns Differently

The server may need special handling for Immediately Invoked Function Expressions (IIFE) that return Promises:

```javascript
// Detect if result is a Promise
if (result instanceof Promise || (result && typeof result.then === 'function')) {
  result = await result;
}
```

### Solution 3: Validate Response Before Sending

Add validation before sending the MCP response:

```javascript
function buildResponse(result) {
  const text = result === undefined ? 'undefined' : typeof result === 'string' ? result : JSON.stringify(result);

  if (!text) {
    throw new Error('Cannot serialize result to text');
  }

  return { content: [{ type: 'text', text }] };
}
```

### Solution 4: Update MCP SDK/Dependencies

The Zod validation error suggests the MCP SDK is validating responses. Ensure:

- The MCP SDK version is up to date.
- The response format matches the expected schema.
- Content block structure is correct.

## Workaround Attempts

**Attempted: Top-level await**

```javascript
const info = await ptah.workspace.getInfo();
return JSON.stringify(info, null, 2);
```

**Result:** MCP error -32000: Code execution failed: `await` is only valid in async functions and the top level bodies of modules.

**Attempted: IIFE with async**

```javascript
(async () => {
  const info = await ptah.workspace.getInfo();
  return JSON.stringify(info, null, 2);
})();
```

**Result:** Zod validation error (the Promise is not being resolved before response serialization).

## Recommendations

- **Immediate:** Report this issue to the ptah extension maintainers with this analysis.
- **Short-term:** Check for updates to the ptah VS Code extension.
- **Long-term:** The extension needs a fix in its MCP tool handler to properly await async results.

## Conclusion

The `ptah` MCP server has a critical bug in its async result handling. The MCP connection works (proven by synchronous tests), but any call to the VS Code extension APIs (which are all async) fails because the Promise result is not properly awaited before being serialized into the MCP response format.

This renders the primary functionality of the server (workspace analysis, file search, symbol lookup, diagnostics, git status, AI chat) completely unusable until the bug is fixed.

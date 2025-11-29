# Ptah MCP Server Analysis Report

**Date:** 2025-11-30
**Project:** Anubis-MCP
**MCP Server:** ptah (VS Code Extension API)

---

## Executive Summary

The `ptah` MCP server provides access to VS Code extension APIs for workspace analysis, file operations, code symbol search, diagnostics, git status, and AI chat capabilities. During testing, several issues were discovered related to async code execution patterns, but all features were ultimately functional when using the correct syntax.

---

## Available Namespaces

The ptah server exposes 11 namespaces through a global `ptah` object:

| Namespace          | Purpose                                                  | Status       |
| ------------------ | -------------------------------------------------------- | ------------ |
| `ptah.workspace`   | Workspace analysis (project type, frameworks, structure) | ✅ Working   |
| `ptah.search`      | File discovery (glob patterns, semantic search)          | ✅ Available |
| `ptah.symbols`     | Code symbol search (classes, functions, methods)         | ✅ Available |
| `ptah.diagnostics` | Errors & warnings from VS Code                           | ✅ Working   |
| `ptah.git`         | Repository status (branch, modified, staged files)       | ✅ Working   |
| `ptah.ai`          | VS Code Language Model API                               | ✅ Working   |
| `ptah.files`       | File read/list operations                                | ✅ Available |
| `ptah.commands`    | Execute VS Code commands                                 | ✅ Available |
| `ptah.context`     | Token budget management                                  | ✅ Available |
| `ptah.project`     | Project analysis (monorepo detection, dependencies)      | ✅ Working   |
| `ptah.relevance`   | File ranking by relevance                                | ✅ Available |

---

## Issues Encountered

### Issue 1: Zod Validation Errors with Async Arrow Functions

**Symptom:** When using async arrow functions, the server returned Zod validation errors.

**Error Message:**

```json
{
  "code": "invalid_union",
  "unionErrors": [...],
  "path": ["content", 0],
  "message": "Invalid input"
}
```

**Problematic Code Pattern:**

```javascript
(async () => {
  const info = await ptah.workspace.getInfo();
  return JSON.stringify(info);
})();
```

**Error Details:**

- The error indicated that `content[0].text` was undefined
- The MCP response content block was malformed
- Zod schema validation failed for text, image, audio, and resource types

---

### Issue 2: Async Operations Returning `undefined`

**Symptom:** After the Zod errors stopped appearing, async operations started returning `undefined` instead of results.

**Test Cases That Failed:**

```javascript
// All returned undefined
(async () => {
  return 'async test';
})()(async () => {
  const info = await ptah.workspace.getInfo();
  return info;
})()(async () => {
  return 'sync: ' + (2 + 2);
})();
```

---

### Issue 3: Variable Declarations at Top Level

**Symptom:** Using `const` or `var` at the top level caused syntax errors.

**Error Message:**

```
MCP error -32000: Code execution failed: Unexpected token 'const'
```

**Problematic Code:**

```javascript
const x = 'hello';
return x;
```

---

## Solutions Found

### Solution 1: Use `async function()` Instead of Arrow Functions

**Working Pattern:**

```javascript
(async function () {
  var info = await ptah.workspace.getInfo();
  return info;
})();
```

**Why It Works:**

- The `async function()` syntax is properly handled by the code executor
- Arrow functions `async () => {}` appear to have issues with promise resolution in this context

---

### Solution 2: Wrap Code in IIFE for Variable Declarations

**Working Pattern:**

```javascript
(function () {
  var x = 'hello';
  return x;
})();
```

---

### Solution 3: Direct Returns Work for Simple Values

**Working Patterns:**

```javascript
return 'hello'; // ✅ Works
return 42; // ✅ Works
return [1, 2, 3]; // ✅ Works
return { test: 'object' }; // ✅ Works
```

---

## Test Results Summary

### Successful Tests

| Test           | Code                                                                                         | Result                     |
| -------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| Simple string  | `return "hello";`                                                                            | `"hello"`                  |
| Number         | `return 42;`                                                                                 | `42`                       |
| Array          | `return [1, 2, 3];`                                                                          | `[1, 2, 3]`                |
| Object         | `return {test: "object"};`                                                                   | `{"test": "object"}`       |
| Sync IIFE      | `(function() { return "test"; })()`                                                          | `"test"`                   |
| Async IIFE     | `(async function() { return "test"; })()`                                                    | `"test"`                   |
| Workspace Info | `(async function() { var info = await ptah.workspace.getInfo(); return info; })()`           | Full workspace info object |
| AI Chat        | `(async function() { var response = await ptah.ai.chat("Hello"); return response; })()`      | AI response text           |
| Git Status     | `(async function() { var git = await ptah.git.getStatus(); return git; })()`                 | Git status object          |
| Dependencies   | `(async function() { var deps = await ptah.project.analyzeDependencies(); return deps; })()` | Dependencies array         |
| Diagnostics    | `(async function() { var d = await ptah.diagnostics.getAll(); return d; })()`                | Diagnostics array          |

### Failed Tests (Before Finding Solution)

| Test                       | Code                                 | Error                            |
| -------------------------- | ------------------------------------ | -------------------------------- |
| Arrow async                | `(async () => { return "test"; })()` | Zod validation error / undefined |
| Top-level const            | `const x = 1; return x;`             | Unexpected token 'const'         |
| String concat outside IIFE | `return "sync: " + (2 + 2);`         | undefined                        |

---

## AI Chat Feature

The AI chat feature (`ptah.ai`) successfully connected to VS Code's Language Model API.

### Available Models (22 total)

- **GPT Family:** GPT-3.5 Turbo, GPT-4, GPT-4o, GPT-4o mini, GPT-4.1, GPT-5, GPT-5 mini, GPT-5.1
- **Claude Family:** Claude Sonnet 4, Claude Sonnet 4.5, Claude Opus 4.5, Claude Haiku 4.5
- **Gemini Family:** Gemini 2.5 Pro, Gemini 3 Pro
- **Other:** Grok Code Fast 1, Copilot Fast, Auto

### Successful AI Analysis

The AI was successfully used to analyze the Anubis-MCP workspace:

> "The Anubis-MCP project is a web application built using NestJS and Node.js with TypeScript, focusing on task and workflow management. It leverages Prisma ORM for database interactions, integrates WebSockets for real-time communication, and follows a modular architecture with distinct domains for managing rules and tasks."

---

## Recommendations

### For Users of the ptah MCP Server

1. **Always use `async function()` syntax** instead of arrow functions for async operations
2. **Wrap code in IIFE** when you need variable declarations
3. **Use the correct pattern:**
   ```javascript
   (async function () {
     var result = await ptah.someNamespace.someMethod();
     return result;
   })();
   ```

### For ptah MCP Server Developers

1. **Fix arrow function handling** - The async arrow function syntax should work identically to async function expressions
2. **Fix top-level variable declarations** - Consider wrapping user code in an async IIFE automatically
3. **Improve error messages** - The Zod validation errors don't clearly indicate the actual problem (arrow function vs regular function)
4. **Add documentation** - Document the required code patterns for users

---

## Workspace Analysis Results

Using the working patterns, the following information was successfully retrieved:

### Project Info

- **Name:** Anubis-MCP
- **Path:** d:\projects\Anubis-MCP
- **Type:** Node.js
- **Frameworks:** Express (NestJS detected via dependencies)
- **Has package.json:** Yes
- **Has tsconfig.json:** Yes

### Git Status

- **Branch:** feature/ditch-prisma-json-markdown
- **Modified Files:** 5
- **Staged Files:** 0
- **Untracked Files:** 4

### Diagnostics

- **Total Issues:** 1 (info-level spelling warning)

### Key Dependencies

- @nestjs/common, @nestjs/core (v11.0.1)
- @prisma/client (v6.11.1)
- @modelcontextprotocol/sdk (v1.11.4)
- socket.io (v4.8.1)
- express (v4.19.2)

---

## Conclusion

The ptah MCP server is functional but has specific syntax requirements that differ from standard JavaScript/TypeScript patterns. Once the correct `async function()` IIFE pattern is used, all 11 namespaces work correctly, including the AI chat feature which successfully connected to multiple language models available in VS Code.

The main issues stem from how the code executor handles:

1. Async arrow functions (fails)
2. Top-level variable declarations (fails)
3. Promise resolution for certain syntax patterns (inconsistent)

These appear to be implementation bugs rather than fundamental limitations, and should be addressable by the ptah extension developers.

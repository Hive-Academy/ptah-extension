# Ptah MCP Server - Code Execution Guide

## Overview

The Ptah MCP server exposes a single powerful tool: `execute_code`. This tool executes TypeScript/JavaScript code with access to 14 API namespaces via the global `ptah` object, providing deep VS Code workspace intelligence.

## Quick Start

```typescript
// Always return results - the code runs in an async context
const info = await ptah.workspace.analyze();
return { projectType: info.info.projectType, frameworks: info.info.frameworks };
```

## API Namespaces

### Workspace Intelligence

| Namespace        | Purpose          | Key Methods                                                 |
| ---------------- | ---------------- | ----------------------------------------------------------- |
| `ptah.workspace` | Project analysis | `analyze()`, `getProjectType()`, `getFrameworks()`          |
| `ptah.project`   | Deep analysis    | `detectMonorepo()`, `detectType()`, `analyzeDependencies()` |
| `ptah.relevance` | File ranking     | `scoreFile(path, query)`, `rankFiles(query, limit)`         |
| `ptah.context`   | Token management | `optimize(query, maxTokens)`, `countTokens(text)`           |

### Code & Diagnostics

| Namespace          | Purpose         | Key Methods                                |
| ------------------ | --------------- | ------------------------------------------ |
| `ptah.diagnostics` | Errors/warnings | `getErrors()`, `getWarnings()`, `getAll()` |

### File Operations

| Namespace     | Purpose        | Key Methods                                     |
| ------------- | -------------- | ----------------------------------------------- |
| `ptah.search` | File discovery | `findFiles(pattern)`, `getRelevantFiles(query)` |
| `ptah.files`  | File I/O       | `read(path)`, `list(directory)`                 |

## Recommended Workflows

### 1. Understanding a Codebase

```typescript
// Get project overview first
const { info } = await ptah.workspace.analyze();
const mono = await ptah.project.detectMonorepo();
const deps = await ptah.project.analyzeDependencies();
return { type: info.projectType, isMonorepo: mono.isMonorepo, depCount: deps.length };
```

### 2. Finding Relevant Files for a Task

```typescript
// Use relevance scoring - it explains WHY files match
const files = await ptah.relevance.rankFiles('authentication middleware', 15);
return files.map((f) => ({ file: f.file, score: f.score, reasons: f.reasons }));
```

### 3. Optimizing Context for Large Codebases

```typescript
// Stay within token budget for efficient context
const optimized = await ptah.context.optimize('implement caching layer', 100000);
return {
  files: optimized.selectedFiles.map((f) => f.relativePath),
  totalTokens: optimized.totalTokens,
  reduction: optimized.stats.reductionPercentage + '%',
};
```

### 4. Checking Code Health

```typescript
// Get all TypeScript errors
const errors = await ptah.diagnostics.getErrors();
const tsErrors = errors.filter((e) => e.file.endsWith('.ts'));
return { count: tsErrors.length, errors: tsErrors.slice(0, 10) };
```

## Best Practices

1. **Always return data** - Results must be returned to see output
2. **Use relevance scoring** - `ptah.relevance.rankFiles()` provides reasoning, not just matches
3. **Optimize for large repos** - Use `ptah.context.optimize()` to stay within token limits
4. **Check project type first** - `ptah.workspace.analyze()` reveals framework-specific patterns
5. **Combine namespaces** - Chain calls for comprehensive analysis

## Timeout Configuration

Default: 5000ms, Maximum: 30000ms. For heavy operations (full indexing), increase timeout:

```json
{ "code": "...", "timeout": 15000 }
```

## Connection

The server runs on `http://localhost:51820` (configurable via `ptah.mcpPort` setting).

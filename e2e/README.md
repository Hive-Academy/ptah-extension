# E2E Tests - Agent Visualization

**End-to-end tests for the Agent Visualization feature (TASK_2025_004).**

## Overview

These tests verify the complete agent visualization pipeline:

1. **Claude CLI** invokes Task tool with subagent
2. **JSONL Parser** detects agent events
3. **EventBus** propagates events
4. **MessageHandler** transforms to webview messages
5. **UI Components** render agent tree, timeline, and status badge

## Test Environment Requirements

### Prerequisites

- Node.js 20+
- Claude CLI installed and authenticated
- VS Code extension development environment

### Setup Options

#### Option A: Local Claude CLI

```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-cli

# Authenticate
claude auth login

# Run tests
CLAUDE_CLI_AVAILABLE=true npm run test:e2e
```

#### Option B: Docker Environment (Recommended)

```bash
# Build Docker image
docker build -t ptah-e2e:latest -f e2e/Dockerfile .

# Run tests (no authentication)
docker run --rm -v $(pwd):/workspace ptah-e2e:latest

# Run tests (with authentication)
docker run --rm \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude:ro \
  -e CLAUDE_CLI_AVAILABLE=true \
  ptah-e2e:latest
```

#### Option C: Skip E2E Tests (Default)

Tests are automatically skipped if Claude CLI is not available.

```bash
# This will skip E2E tests
npm run test:e2e
```

## Test Scenarios

### 1. Single Subagent Invocation

**Test**: `should visualize single agent (Explore subagent)`

**Prompt**: "Use the Explore subagent to analyze this codebase"

**Expected Behavior**:

- ✅ 1 agent node in tree (Explore)
- ✅ 1 timeline segment
- ✅ Agent status badge shows "1 agent"
- ✅ Tool activities displayed (Read, Grep, etc.)

### 2. Parallel Subagents

**Test**: `should show parallel agents on separate tracks`

**Prompt**: "Have frontend-developer build the UI while backend-developer creates the API"

**Expected Behavior**:

- ✅ 2 agent nodes in tree (frontend-developer, backend-developer)
- ✅ 2 parallel timeline tracks (non-overlapping)
- ✅ Agent status badge shows "2 agents"
- ✅ Activities for both agents displayed

### 3. Performance Measurement

**Test**: `should meet performance target (<50ms latency)`

**Target**: <50ms end-to-end latency (p95)

**Metrics**:

- Parser detection → EventBus: <10ms
- EventBus → MessageHandler: <5ms
- MessageHandler → UI update: <35ms

**Measurement**:

```typescript
performance.mark('parse_start');
// ... parse JSONL
performance.mark('ui_end');
performance.measure('e2e_latency', 'parse_start', 'ui_end');
```

### 4. Agent Error Handling

**Test**: `should display agent error states correctly`

**Prompt**: "Use the Explore subagent to read a non-existent file"

**Expected Behavior**:

- ✅ Agent completes with error state
- ✅ Error indicator visible in UI
- ✅ Error message displayed in agent tree

### 5. Session Switching

**Test**: `should clean up agent state on session switch`

**Expected Behavior**:

- ✅ Previous session's agents cleared
- ✅ New session's agents displayed
- ✅ No memory leaks (activeAgents map cleaned up)

## Running Tests

### Run All E2E Tests

```bash
npm run test:e2e
```

### Run Specific Test

```bash
npm run test:e2e -- --testPathPattern=agent-visualization --testNamePattern="single agent"
```

### Run with Debug Output

```bash
DEBUG=* npm run test:e2e
```

### Run with Coverage

```bash
npm run test:e2e -- --coverage
```

## CI/CD Integration

### GitHub Actions

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      # Option 1: Skip E2E tests (default)
      - name: Run Unit Tests Only
        run: npm test

      # Option 2: Run E2E with Docker
      - name: Build E2E Docker Image
        run: docker build -t ptah-e2e -f e2e/Dockerfile .
      - name: Run E2E Tests
        run: docker run --rm -v $(pwd):/workspace ptah-e2e
        continue-on-error: true # Don't block CI
```

### Skip Logic

Tests are automatically skipped if:

- Claude CLI not installed
- `CLAUDE_CLI_AVAILABLE` environment variable is not `'true'`
- `claude --version` command fails

When skipped, you'll see:

```
╔════════════════════════════════════════════════════════════════╗
║  SKIPPING E2E TESTS - Claude CLI Not Available                ║
╠════════════════════════════════════════════════════════════════╣
║  To run these tests:                                          ║
║  1. Install Claude CLI: https://claude.ai/cli                 ║
║  2. Authenticate: claude auth login                           ║
║  3. Set environment variable: CLAUDE_CLI_AVAILABLE=true       ║
╚════════════════════════════════════════════════════════════════╝
```

## Troubleshooting

### Tests Skipped - CLI Not Found

**Problem**: Tests are always skipped

**Solution**:

```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-cli

# Authenticate
claude auth login

# Verify installation
claude --version

# Set environment variable
export CLAUDE_CLI_AVAILABLE=true

# Run tests
npm run test:e2e
```

### Tests Timeout

**Problem**: Tests fail with timeout errors

**Solution**: Increase Jest timeout in test file:

```typescript
jest.setTimeout(60000); // 60s timeout
```

### JSONL Parsing Errors

**Problem**: Cannot parse JSONL output

**Solution**: Enable debug logging:

```typescript
console.log('JSONL Output:', jsonlOutput);
```

Check for:

- Malformed JSON lines
- Missing Task tool events
- Incorrect event structure

### Authentication Errors

**Problem**: Claude CLI not authenticated

**Solution**:

```bash
# Re-authenticate
claude auth logout
claude auth login

# Verify authentication
claude chat "Hello" --format jsonl
```

## Performance Benchmarking

### Collect Performance Data

Run tests multiple times and collect metrics:

```bash
for i in {1..10}; do
  npm run test:e2e -- --testNamePattern="performance" >> perf-results.txt
done
```

### Analyze Results

```bash
# Extract latency values
cat perf-results.txt | grep "Total E2E Latency" | awk '{print $5}' | sort -n

# Calculate p50, p95, p99
cat perf-results.txt | grep "Total E2E Latency" | awk '{print $5}' | \
  awk 'BEGIN {count=0; sum=0} {arr[count++]=$1; sum+=$1} END {
    asort(arr);
    print "p50:", arr[int(count*0.5)];
    print "p95:", arr[int(count*0.95)];
    print "p99:", arr[int(count*0.99)];
    print "avg:", sum/count;
  }'
```

## Expected Output

### Successful Test Run

```
 PASS  e2e/agent-visualization.e2e.spec.ts
  Agent Visualization E2E
    ✓ should visualize single agent (Explore subagent) (1234ms)
    ✓ should show parallel agents on separate tracks (2345ms)
    ✓ should meet performance target (<50ms latency) (567ms)
    ✓ should display agent error states correctly (890ms)
    ✓ should clean up agent state on session switch (1234ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Time:        6.27s
```

### Skipped Test Run

```
 PASS  e2e/agent-visualization.e2e.spec.ts
  Agent Visualization E2E
    ○ skipped should visualize single agent (Explore subagent)
    ○ skipped should show parallel agents on separate tracks
    ○ skipped should meet performance target (<50ms latency)
    ○ skipped should display agent error states correctly
    ○ skipped should clean up agent state on session switch

Test Suites: 1 passed, 1 total
Tests:       5 skipped, 5 total
Time:        0.12s
```

## Future Enhancements

1. **Visual Regression Testing**: Add screenshot comparisons for agent UI
2. **Real-World Prompts**: Test with production-like agent scenarios
3. **Stress Testing**: Test with 10+ parallel agents
4. **Network Simulation**: Test with throttled Claude CLI responses
5. **Error Injection**: Test parser resilience with corrupted JSONL

## Resources

- [Agent Visualization Specification](../task-tracking/TASK_2025_004/visual-design-specification.md)
- [Implementation Plan](../task-tracking/TASK_2025_004/implementation-plan.md)
- [Claude CLI Documentation](https://claude.ai/cli)
- [Jest E2E Testing Guide](https://jestjs.io/docs/tutorial-react)

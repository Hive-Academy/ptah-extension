# Ptah Extension - E2E Test Environment
#
# This Dockerfile creates an isolated environment for running E2E tests
# with Claude CLI integration.
#
# **IMPORTANT**: This requires Claude CLI authentication credentials
#
# ## Usage
#
# ### Build Image
# ```bash
# docker build -t ptah-e2e:latest -f e2e/Dockerfile .
# ```
#
# ### Run Tests
# ```bash
# docker run --rm \
#   -v $(pwd):/workspace \
#   -e CLAUDE_CLI_AVAILABLE=true \
#   ptah-e2e:latest npm run test:e2e
# ```
#
# ### Run with Authentication (requires .claude credentials)
# ```bash
# docker run --rm \
#   -v $(pwd):/workspace \
#   -v ~/.claude:/root/.claude:ro \
#   -e CLAUDE_CLI_AVAILABLE=true \
#   ptah-e2e:latest npm run test:e2e
# ```

FROM node:20-alpine

# Metadata
LABEL maintainer="Ptah Extension Team"
LABEL description="E2E test environment with Claude CLI"
LABEL version="1.0.0"

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    bash

# Install Claude CLI (global)
# NOTE: This requires @anthropic-ai/claude-cli to be published
# If not available, tests will be skipped automatically
RUN npm install -g @anthropic-ai/claude-cli || echo "Claude CLI not available"

# Set working directory
WORKDIR /workspace

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --prefer-offline --no-audit

# Copy source code
COPY . .

# Build all libraries (required for tests)
RUN npm run build:all

# Set environment variable to enable E2E tests
ENV CLAUDE_CLI_AVAILABLE=false
ENV NODE_ENV=test

# Health check: Verify Claude CLI installation
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD claude --version || exit 1

# Default command: Run E2E tests
CMD ["npm", "run", "test:e2e"]

# Alternative commands:
# - Run all tests: docker run ptah-e2e npm test
# - Run specific test: docker run ptah-e2e npm run test:e2e -- --testNamePattern="single agent"
# - Debug mode: docker run -it ptah-e2e /bin/bash

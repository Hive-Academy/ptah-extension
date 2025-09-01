# 🚀 **PTAH MONSTER EXTENSION REFACTOR PLAN**

## **Executive Summary**

This comprehensive refactoring plan transforms the Ptah VS Code extension from its current state (with extensive `any` type usage and mixed concerns) into an enterprise-grade, type-safe extension that rivals Cline and GitHub Copilot. The plan leverages battle-tested open-source libraries, implements clean architecture patterns, and provides clear separation between VS Code infrastructure and business logic.

## **Current State Analysis**

### **Critical Issues Identified**

1. **Massive `any` Type Usage**: 47+ instances of `any` types completely undermining type safety
2. **No Separation of Concerns**: Business logic mixed with VS Code infrastructure
3. **Architectural Debt**: Services handling multiple responsibilities (700+ line files)
4. **Underutilized Type System**: Excellent `@libs/shared` types exist but are cast to `any`
5. **Homemade Solutions**: Custom DI, messaging, and routing instead of battle-tested libraries

### **Strengths to Preserve**

- Excellent type system in `@libs/shared` with branded types and Zod validation
- Good provider abstraction pattern (needs refinement)
- Strong foundation for message types and validation
- Angular webview already moving to feature-based organization

## **Technology Stack**

### **Battle-Tested Libraries to Adopt**

```bash
# Core Dependencies
npm install tsyringe reflect-metadata        # Microsoft's TypeScript-first DI
npm install rxjs                            # Reactive programming and messaging
npm install zod @sinclair/typebox          # Runtime validation
npm install eventemitter3                   # Performance-optimized event emitter
npm install p-queue p-limit                 # Concurrency control
npm install class-validator class-transformer # DTO validation

# Dev Dependencies
npm install -D @types/vscode @types/node
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D prettier eslint-config-prettier
```

### **Library Selection Rationale**

- **TSyringe**: Microsoft-backed, TypeScript-first, decorator-based DI (similar to NestJS)
- **RxJS**: Industry standard for reactive programming, perfect for message passing
- **Zod**: You already use it - leverage it more instead of `any` casting
- **EventEmitter3**: 3x faster than Node's EventEmitter, browser compatible

## **Architecture Overview**

### **New Workspace Library Structure**

```
libs/
├── vscode-core/                     # Pure VS Code infrastructure abstraction
│   ├── src/
│   │   ├── di/                      # TSyringe DI container setup
│   │   ├── messaging/               # RxJS event bus with your types
│   │   ├── lifecycle/               # Extension lifecycle management
│   │   ├── api-wrappers/           # VS Code API abstractions
│   │   │   ├── command-manager.ts  # Command registration
│   │   │   ├── webview-manager.ts  # Webview lifecycle
│   │   │   ├── workspace-api.ts    # Workspace operations
│   │   │   └── language-features.ts # Language server protocol
│   │   └── types/                   # VS Code-specific types
│   └── project.json
│
├── ai-providers-core/               # Provider system (domain agnostic)
│   ├── src/
│   │   ├── interfaces/             # Provider contracts
│   │   │   ├── provider.interface.ts
│   │   │   └── strategy.interface.ts
│   │   ├── strategies/             # Intelligent selection strategies
│   │   │   ├── intelligent-provider-strategy.ts
│   │   │   └── fallback-strategy.ts
│   │   ├── health/                 # Health monitoring
│   │   ├── context/                # Context window management
│   │   │   └── context-window-manager.ts
│   │   ├── mcp/                    # Model Context Protocol
│   │   │   ├── mcp-manager.ts
│   │   │   └── mcp-server.interface.ts
│   │   └── factory/                # Provider factory
│   └── project.json
│
├── claude-domain/                   # Claude-specific business logic
│   ├── src/
│   │   ├── cli/                    # CLI integration
│   │   │   ├── claude-cli-adapter.ts
│   │   │   └── cli-detector.ts
│   │   ├── streaming/              # Stream processing
│   │   │   ├── stream-parser.ts
│   │   │   └── message-processor.ts
│   │   ├── sessions/               # Session management
│   │   │   └── claude-session-manager.ts
│   │   └── permissions/            # Permission handling
│   │       └── permission-handler.ts
│   └── project.json
│
├── workspace-intelligence/          # Workspace understanding
│   ├── src/
│   │   ├── project-analysis/       # Project type detection
│   │   ├── file-indexing/          # Smart file discovery
│   │   ├── code-understanding/     # AST analysis, symbol extraction
│   │   └── optimization/           # Performance suggestions
│   └── project.json
│
└── shared/                          # Your existing excellent types!
    └── src/                        # Keep all branded types, Zod schemas
```

## **Phase 1: Foundation & Infrastructure (Weeks 1-3)**

### **Week 1: Clean Slate Dependencies & Workspace Setup**

#### **1.1 Install Battle-Tested Libraries**

```bash
# Core libraries installation
npm install tsyringe reflect-metadata
npm install rxjs
npm install zod @sinclair/typebox
npm install eventemitter3
npm install p-queue p-limit
npm install class-validator class-transformer

# Dev dependencies
npm install -D @types/vscode @types/node
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D prettier eslint-config-prettier
```

#### **1.2 Create Library Structure**

```bash
# Generate Nx libraries
nx g @nx/js:library vscode-core --directory=libs
nx g @nx/js:library ai-providers-core --directory=libs
nx g @nx/js:library claude-domain --directory=libs
nx g @nx/js:library workspace-intelligence --directory=libs
```

### **Week 2: Type-Safe DI Container & Messaging**

#### **2.1 DI Container Setup**

**libs/vscode-core/src/di/container.ts**

```typescript
import { container, injectable, inject, DependencyContainer } from "tsyringe";
import { EventEmitter } from "eventemitter3";

// Type-safe tokens (no more strings!)
export const TOKENS = {
  // VS Code APIs
  EXTENSION_CONTEXT: Symbol("ExtensionContext"),
  WEBVIEW_PROVIDER: Symbol("WebviewProvider"),
  COMMAND_REGISTRY: Symbol("CommandRegistry"),
  
  // Messaging
  EVENT_BUS: Symbol("EventBus"),
  MESSAGE_ROUTER: Symbol("MessageRouter"),
  
  // Providers
  AI_PROVIDER_FACTORY: Symbol("AIProviderFactory"),
  AI_PROVIDER_MANAGER: Symbol("AIProviderManager"),
  
  // Business Logic
  CLAUDE_SERVICE: Symbol("ClaudeService"),
  SESSION_MANAGER: Symbol("SessionManager"),
  WORKSPACE_ANALYZER: Symbol("WorkspaceAnalyzer")
} as const;

// Container setup utility
export class DIContainer {
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // Register VS Code context
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });
    
    // Register singleton event bus
    container.registerSingleton(TOKENS.EVENT_BUS, EventBus);
    
    return container;
  }
}
```

#### **2.2 RxJS Event Bus Implementation**

**libs/vscode-core/src/messaging/event-bus.ts**

```typescript
import { EventEmitter } from "eventemitter3";
import { injectable } from "tsyringe";
import { Observable, fromEvent, filter, map } from "rxjs";
import type { MessagePayloadMap, StrictMessageType } from "@ptah-extension/shared";

export interface TypedEvent<T extends keyof MessagePayloadMap = keyof MessagePayloadMap> {
  type: T;
  payload: MessagePayloadMap[T];
  correlationId?: string;
  source: 'extension' | 'webview' | 'provider';
  timestamp: number;
}

@injectable()
export class EventBus {
  private emitter = new EventEmitter();
  
  // Type-safe publish using your existing types!
  publish<T extends keyof MessagePayloadMap>(
    type: T,
    payload: MessagePayloadMap[T],
    source: TypedEvent['source'] = 'extension'
  ): void {
    const event: TypedEvent<T> = {
      type,
      payload,
      source,
      timestamp: Date.now(),
      correlationId: crypto.randomUUID()
    };
    
    this.emitter.emit(type as string, event);
  }
  
  // Type-safe subscribe with RxJS observables
  subscribe<T extends keyof MessagePayloadMap>(
    messageType: T
  ): Observable<TypedEvent<T>> {
    return fromEvent<TypedEvent<T>>(this.emitter, messageType as string);
  }
  
  // Request-response pattern
  async request<T extends keyof MessagePayloadMap, R = unknown>(
    type: T,
    payload: MessagePayloadMap[T],
    timeout: number = 5000
  ): Promise<R> {
    return new Promise((resolve, reject) => {
      const correlationId = crypto.randomUUID();
      const responseType = `${type}:response` as const;
      
      // Set up response listener
      const responseSubscription = this.subscribe(responseType)
        .pipe(filter(event => event.correlationId === correlationId))
        .subscribe({
          next: (event) => {
            responseSubscription.unsubscribe();
            resolve(event.payload as R);
          },
          error: reject
        });
      
      // Set up timeout
      setTimeout(() => {
        responseSubscription.unsubscribe();
        reject(new Error(`Request timeout: ${type}`));
      }, timeout);
      
      // Send request
      this.publish(type, payload);
    });
  }
}
```

### **Week 3: VS Code API Abstraction Layer**

#### **3.1 Command Manager**

**libs/vscode-core/src/api-wrappers/command-manager.ts**

```typescript
import * as vscode from "vscode";
import { injectable, inject } from "tsyringe";
import { EventBus, TOKENS } from "../di/container";

export interface CommandDefinition<T = unknown> {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly handler: (...args: T[]) => Promise<void> | void;
  readonly when?: string;
}

@injectable()
export class CommandManager {
  private registeredCommands = new Map<string, vscode.Disposable>();
  
  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext,
    @inject(TOKENS.EVENT_BUS) private eventBus: EventBus
  ) {}
  
  registerCommand<T = unknown>(definition: CommandDefinition<T>): void {
    const disposable = vscode.commands.registerCommand(
      definition.id, 
      async (...args: T[]) => {
        // Emit command execution event
        this.eventBus.publish('command:executed', {
          commandId: definition.id,
          args: args as unknown[],
          timestamp: Date.now()
        });
        
        try {
          await definition.handler(...args);
        } catch (error) {
          this.eventBus.publish('command:error', {
            commandId: definition.id,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
      }
    );
    
    this.context.subscriptions.push(disposable);
    this.registeredCommands.set(definition.id, disposable);
  }
  
  // Bulk register commands
  registerCommands(commands: CommandDefinition[]): void {
    commands.forEach(cmd => this.registerCommand(cmd));
  }
}
```

#### **3.2 Webview Manager**

**libs/vscode-core/src/api-wrappers/webview-manager.ts**

```typescript
import * as vscode from "vscode";
import { injectable, inject } from "tsyringe";
import { EventBus, TOKENS } from "../di/container";
import type { WebviewMessage } from "@ptah-extension/shared";

@injectable() 
export class WebviewManager {
  private activeWebviews = new Map<string, vscode.WebviewPanel>();
  
  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext,
    @inject(TOKENS.EVENT_BUS) private eventBus: EventBus
  ) {}
  
  createWebviewPanel<T extends Record<string, unknown>>(
    viewType: string,
    title: string,
    initialData?: T
  ): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri]
      }
    );
    
    // Set up message handling
    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.eventBus.publish('webview:message', {
        webviewId: viewType,
        message: message,
        timestamp: Date.now()
      });
    });
    
    // Send initial data
    if (initialData) {
      panel.webview.postMessage({
        type: 'initialData',
        payload: initialData
      });
    }
    
    // Track active webviews
    this.activeWebviews.set(viewType, panel);
    
    // Cleanup on dispose
    panel.onDidDispose(() => {
      this.activeWebviews.delete(viewType);
    });
    
    return panel;
  }
}
```

## **Phase 2: Provider System Refactor (Weeks 4-6)**

### **Week 4: Provider Core Infrastructure**

#### **4.1 Enhanced Provider Interface**

**libs/ai-providers-core/src/interfaces/provider.interface.ts**

```typescript
import type { 
  ProviderId, 
  ProviderCapabilities, 
  ProviderHealth,
  AISessionConfig 
} from "@ptah-extension/shared";

export interface ProviderContext {
  readonly taskType: 'coding' | 'reasoning' | 'analysis' | 'refactoring' | 'debugging';
  readonly complexity: 'low' | 'medium' | 'high';
  readonly fileTypes: readonly string[];
  readonly projectType?: string;
  readonly contextSize: number;
}

export interface EnhancedAIProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  readonly health: ProviderHealth;
  
  // Context-aware methods
  canHandle(context: ProviderContext): boolean;
  estimateCost(context: ProviderContext): number;
  estimateLatency(context: ProviderContext): number;
  
  // Enhanced session management
  createSession(config: AISessionConfig): Promise<string>;
  sendMessage(sessionId: string, message: string, context: ProviderContext): AsyncIterable<string>;
  
  // Health monitoring
  performHealthCheck(): Promise<ProviderHealth>;
  
  // Resource management
  dispose(): Promise<void>;
}
```

#### **4.2 Intelligent Provider Strategy**

**libs/ai-providers-core/src/strategies/intelligent-provider-strategy.ts**

```typescript
import { injectable } from "tsyringe";
import type { ProviderId } from "@ptah-extension/shared";
import type { ProviderContext, EnhancedAIProvider } from "../interfaces/provider.interface";

export interface ProviderSelectionResult {
  readonly providerId: ProviderId;
  readonly confidence: number;
  readonly reasoning: string;
  readonly fallbacks: readonly ProviderId[];
}

@injectable()
export class IntelligentProviderStrategy {
  
  async selectProvider(
    context: ProviderContext,
    availableProviders: Map<ProviderId, EnhancedAIProvider>
  ): Promise<ProviderSelectionResult> {
    
    // Cline-style intelligence: different models for different tasks
    const candidates = Array.from(availableProviders.entries())
      .filter(([_, provider]) => provider.canHandle(context))
      .map(([id, provider]) => ({
        id,
        provider,
        score: this.calculateScore(context, provider)
      }))
      .sort((a, b) => b.score - a.score);
    
    if (candidates.length === 0) {
      throw new Error(`No providers available for context: ${JSON.stringify(context)}`);
    }
    
    const best = candidates[0];
    const fallbacks = candidates.slice(1, 3).map(c => c.id);
    
    return {
      providerId: best.id,
      confidence: best.score,
      reasoning: this.generateReasoning(context, best.provider),
      fallbacks
    };
  }
  
  private calculateScore(context: ProviderContext, provider: EnhancedAIProvider): number {
    let score = 0;
    
    // Task type matching (Cline-style specialization)
    if (context.taskType === 'reasoning' && provider.id === 'deepseek-r1') score += 50;
    if (context.taskType === 'coding' && provider.id === 'claude-3.5-sonnet') score += 50;
    if (context.taskType === 'analysis' && provider.id === 'gpt-4') score += 40;
    
    // Complexity matching
    if (context.complexity === 'high' && provider.capabilities.functionCalling) score += 20;
    if (context.complexity === 'low' && provider.health.responseTime && provider.health.responseTime < 1000) score += 15;
    
    // File type specialization
    if (context.fileTypes.includes('.ts') && provider.id === 'claude-3.5-sonnet') score += 10;
    if (context.fileTypes.includes('.py') && provider.id === 'gpt-4') score += 10;
    
    // Health and availability
    if (provider.health.status === 'available') score += 30;
    else if (provider.health.status === 'degraded') score += 10;
    
    // Cost consideration (prefer lower cost for simple tasks)
    const estimatedCost = provider.estimateCost(context);
    if (context.complexity === 'low' && estimatedCost < 0.01) score += 5;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private generateReasoning(context: ProviderContext, provider: EnhancedAIProvider): string {
    return `Selected ${provider.id} for ${context.taskType} task with ${context.complexity} complexity. ` +
           `Provider health: ${provider.health.status}, estimated latency: ${provider.estimateLatency(context)}ms`;
  }
}
```

### **Week 5: Claude Domain Separation**

#### **5.1 Claude CLI Adapter**

**libs/claude-domain/src/cli/claude-cli-adapter.ts**

```typescript
import { injectable } from "tsyringe";
import { spawn, ChildProcess } from "child_process";
import type { EnhancedAIProvider, ProviderContext } from "@ptah-extension/ai-providers-core";

@injectable()
export class ClaudeCliAdapter implements EnhancedAIProvider {
  readonly id = 'claude-cli' as const;
  
  readonly capabilities = {
    streaming: true,
    fileAttachments: true,
    contextManagement: true,
    sessionPersistence: true,
    multiTurn: true,
    codeGeneration: true,
    imageAnalysis: true,
    functionCalling: true
  };
  
  private processes = new Map<string, ChildProcess>();
  
  canHandle(context: ProviderContext): boolean {
    // Claude CLI excels at coding and complex reasoning
    return ['coding', 'reasoning', 'refactoring'].includes(context.taskType);
  }
  
  estimateCost(context: ProviderContext): number {
    // Claude CLI pricing logic
    const baseRate = 0.015; // per 1k tokens
    const contextTokens = context.contextSize;
    return (contextTokens / 1000) * baseRate;
  }
  
  estimateLatency(context: ProviderContext): number {
    // Based on task complexity and context size
    const base = 500; // ms
    const complexityMultiplier = {
      'low': 1,
      'medium': 1.5,
      'high': 2.5
    }[context.complexity];
    
    return base * complexityMultiplier + (context.contextSize / 1000 * 10);
  }
  
  async createSession(config: AISessionConfig): Promise<string> {
    const sessionId = crypto.randomUUID();
    
    const args = [
      '-p', '--output-format', 'stream-json',
      '--verbose'
    ];
    
    if (config.projectPath) {
      args.push('--workspace', config.projectPath);
    }
    
    const process = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.projectPath
    });
    
    this.processes.set(sessionId, process);
    
    return sessionId;
  }
  
  async *sendMessage(
    sessionId: string, 
    message: string, 
    context: ProviderContext
  ): AsyncIterable<string> {
    const process = this.processes.get(sessionId);
    if (!process) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Send message to Claude CLI
    process.stdin?.write(`${message}\n`);
    
    // Stream response
    if (process.stdout) {
      for await (const chunk of process.stdout) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'content') {
                yield parsed.data;
              }
            } catch (e) {
              // Handle non-JSON output
              yield line;
            }
          }
        }
      }
    }
  }
  
  async performHealthCheck(): Promise<ProviderHealth> {
    try {
      // Quick health check by spawning Claude CLI with --version
      const process = spawn('claude', ['--version'], { timeout: 5000 });
      
      return new Promise((resolve) => {
        const startTime = Date.now();
        
        process.on('exit', (code) => {
          resolve({
            status: code === 0 ? 'available' : 'error',
            lastCheck: Date.now(),
            responseTime: Date.now() - startTime,
            errorMessage: code !== 0 ? 'Claude CLI not responding' : undefined
          });
        });
        
        process.on('error', () => {
          resolve({
            status: 'error',
            lastCheck: Date.now(),
            errorMessage: 'Claude CLI not installed'
          });
        });
      });
    } catch (error) {
      return {
        status: 'error',
        lastCheck: Date.now(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  async dispose(): Promise<void> {
    // Clean shutdown of all processes
    for (const [sessionId, process] of this.processes) {
      process.kill('SIGTERM');
      this.processes.delete(sessionId);
    }
  }
}
```

### **Week 6: Multi-Provider Manager**

#### **6.1 Provider Manager with RxJS State**

**libs/ai-providers-core/src/manager/provider-manager.ts**

```typescript
import { injectable, inject } from "tsyringe";
import { BehaviorSubject, Observable, interval } from "rxjs";
import { EventBus, TOKENS } from "@ptah-extension/vscode-core";
import type { EnhancedAIProvider, ProviderContext } from "../interfaces/provider.interface";
import { IntelligentProviderStrategy } from "../strategies/intelligent-provider-strategy";

export interface ActiveProviderState {
  readonly current: EnhancedAIProvider | null;
  readonly available: ReadonlyMap<ProviderId, EnhancedAIProvider>;
  readonly health: ReadonlyMap<ProviderId, ProviderHealth>;
  readonly lastSwitch?: {
    readonly from: ProviderId | null;
    readonly to: ProviderId;
    readonly reason: string;
    readonly timestamp: number;
  };
}

@injectable()
export class ProviderManager {
  private providersSubject = new BehaviorSubject<ActiveProviderState>({
    current: null,
    available: new Map(),
    health: new Map()
  });
  
  readonly state$: Observable<ActiveProviderState> = this.providersSubject.asObservable();
  
  constructor(
    @inject(TOKENS.EVENT_BUS) private eventBus: EventBus,
    private strategy: IntelligentProviderStrategy
  ) {
    this.startHealthMonitoring();
    this.setupEventListeners();
  }
  
  registerProvider(provider: EnhancedAIProvider): void {
    const currentState = this.providersSubject.value;
    const newAvailable = new Map(currentState.available);
    newAvailable.set(provider.id, provider);
    
    this.providersSubject.next({
      ...currentState,
      available: newAvailable
    });
    
    this.eventBus.publish('provider:registered', {
      providerId: provider.id,
      capabilities: provider.capabilities
    });
  }
  
  async selectBestProvider(context: ProviderContext): Promise<EnhancedAIProvider> {
    const currentState = this.providersSubject.value;
    
    const selection = await this.strategy.selectProvider(context, currentState.available);
    
    const selectedProvider = currentState.available.get(selection.providerId);
    if (!selectedProvider) {
      throw new Error(`Selected provider ${selection.providerId} not available`);
    }
    
    // Update current provider if different
    if (currentState.current?.id !== selection.providerId) {
      this.providersSubject.next({
        ...currentState,
        current: selectedProvider,
        lastSwitch: {
          from: currentState.current?.id || null,
          to: selection.providerId,
          reason: selection.reasoning,
          timestamp: Date.now()
        }
      });
      
      this.eventBus.publish('provider:switched', {
        from: currentState.current?.id || null,
        to: selection.providerId,
        reason: selection.reasoning,
        confidence: selection.confidence
      });
    }
    
    return selectedProvider;
  }
  
  private startHealthMonitoring(): void {
    // Health check every 30 seconds
    interval(30000).subscribe(async () => {
      const currentState = this.providersSubject.value;
      const healthChecks = new Map<ProviderId, ProviderHealth>();
      
      // Check health of all providers in parallel
      const healthPromises = Array.from(currentState.available.entries())
        .map(async ([id, provider]) => {
          try {
            const health = await provider.performHealthCheck();
            healthChecks.set(id, health);
          } catch (error) {
            healthChecks.set(id, {
              status: 'error',
              lastCheck: Date.now(),
              errorMessage: error instanceof Error ? error.message : 'Health check failed'
            });
          }
        });
      
      await Promise.allSettled(healthPromises);
      
      // Update state with new health info
      this.providersSubject.next({
        ...currentState,
        health: healthChecks
      });
    });
  }
  
  private setupEventListeners(): void {
    // Listen for provider failures and switch to fallback
    this.eventBus.subscribe('provider:error').subscribe(async (event) => {
      const currentState = this.providersSubject.value;
      if (event.payload.providerId === currentState.current?.id) {
        // Current provider failed, try to switch to fallback
        await this.handleProviderFailure(event.payload.providerId, event.payload.error);
      }
    });
  }
  
  private async handleProviderFailure(failedProviderId: ProviderId, error: string): Promise<void> {
    this.eventBus.publish('provider:failover', {
      failedProvider: failedProviderId,
      error: error,
      timestamp: Date.now()
    });
    
    // Strategy will handle fallback selection
    // This creates a resilient system like Cline
  }
}
```

## **Phase 3: VS Code API Integration (Weeks 7-9)**

### **Week 7: Command System Enhancement**

#### **7.1 AI Commands Provider**

**apps/ptah-extension-vscode/src/commands/ai-commands.ts**

```typescript
import { injectable, inject } from "tsyringe";
import type { CommandDefinition } from "@ptah-extension/vscode-core";
import { ProviderManager } from "@ptah-extension/ai-providers-core";
import { TOKENS } from "@ptah-extension/vscode-core";

@injectable()
export class AICommandProvider {
  constructor(
    @inject(TOKENS.AI_PROVIDER_MANAGER) private providerManager: ProviderManager
  ) {}
  
  getCommands(): CommandDefinition[] {
    return [
      {
        id: 'ptah.ask',
        title: 'Ask AI',
        category: 'Ptah',
        handler: this.handleAskCommand.bind(this)
      },
      {
        id: 'ptah.explainCode',
        title: 'Explain Code',
        category: 'Ptah',
        handler: this.handleExplainCode.bind(this)
      },
      {
        id: 'ptah.generateTests',
        title: 'Generate Tests',
        category: 'Ptah',
        handler: this.handleGenerateTests.bind(this)
      },
      {
        id: 'ptah.refactor',
        title: 'Refactor Code',
        category: 'Ptah',
        handler: this.handleRefactor.bind(this)
      },
      {
        id: 'ptah.switchProvider',
        title: 'Switch AI Provider',
        category: 'Ptah',
        handler: this.handleSwitchProvider.bind(this)
      }
    ];
  }
  
  private async handleAskCommand(): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: 'Ask AI anything about your code',
      placeHolder: 'What would you like to know?'
    });
    
    if (input) {
      const context = await this.getContextFromEditor();
      const provider = await this.providerManager.selectBestProvider(context);
      
      // Create AI session and stream response to webview
      const sessionId = await provider.createSession({
        projectPath: vscode.workspace.rootPath
      });
      
      const responseIterable = provider.sendMessage(sessionId, input, context);
      
      // Stream to webview (implementation depends on your webview setup)
      this.streamResponseToWebview(responseIterable);
    }
  }
  
  private async getContextFromEditor(): Promise<ProviderContext> {
    const editor = vscode.window.activeTextEditor;
    const fileTypes = editor ? [path.extname(editor.document.fileName)] : [];
    
    return {
      taskType: 'analysis',
      complexity: 'medium',
      fileTypes,
      contextSize: editor?.document.getText().length || 0
    };
  }
}
```

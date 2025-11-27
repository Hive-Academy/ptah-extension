# RooCode-to-Ptah Code Migration Plan

**Version**: 1.0
**Last Updated**: 2025-11-23
**Status**: Ready for Implementation

## Executive Summary

This document provides a **ready-to-execute migration plan** for copying proven code from `roocode-generator` (D:\projects\roocode-generator) into `ptah-extension` (D:\projects\ptah-extension). The plan focuses on:

1. **AST Parsing & Code Insights** → Enhance `workspace-intelligence`
2. **Langchain Multi-Provider LLM** → Create `llm-abstraction` library
3. **Template Generation System** → Create `template-generation` library

**Total Estimated Effort**: 3-4 weeks
**Complexity**: HIGH (requires careful DI integration, type system alignment, and architecture preservation)

---

## Section 1: File-by-File Migration Map

### 1.1 Core Foundation: Result Type

#### File 1: Result Type

```
SOURCE: D:\projects\roocode-generator\src\core\result\result.ts
TARGET: D:\projects\ptah-extension\libs\shared\src\lib\utils\result.ts
PURPOSE: Type-safe error handling pattern (Result<T, E>)

ADAPTATIONS NEEDED:
  - No changes needed - this is pure TypeScript with no dependencies
  - Export from libs/shared/src/lib/utils/index.ts
  - Update libs/shared/src/index.ts to include utils exports

DEPENDENCIES:
  - None (standalone utility class)

INTEGRATION POINTS:
  - Will be used by all migrated services for error handling
  - Replace existing try/catch patterns in ptah with Result pattern
```

---

### 1.2 AST Parsing & Analysis

#### File 2: Tree-Sitter Parser Service

```
SOURCE: D:\projects\roocode-generator\src\core\analysis\tree-sitter-parser.service.ts
TARGET: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\tree-sitter-parser.service.ts
PURPOSE: Tree-sitter AST parsing for TypeScript/JavaScript

ADAPTATIONS NEEDED:
  - Convert @Injectable() decorator from roocode's DI to tsyringe @injectable()
  - Convert @Inject('ILogger') to constructor injection with @inject(TOKENS.LOGGER)
  - Replace ILogger interface with ptah's Logger class from @ptah-extension/vscode-core
  - Update import paths:
    * Result → '@ptah-extension/shared/utils'
    * Logger → '@ptah-extension/vscode-core'
  - Keep tree-sitter require() pattern (works cross-platform)

DEPENDENCIES:
  - tree-sitter (npm package - needs installation)
  - tree-sitter-javascript (npm package)
  - tree-sitter-typescript (npm package)
  - @ptah-extension/shared (Result type)
  - @ptah-extension/vscode-core (Logger)

INTEGRATION POINTS:
  - Called by AstAnalysisService to parse file content
  - Used by WorkspaceAnalyzerService for code insights extraction
```

#### File 3: AST Analysis Service

```
SOURCE: D:\projects\roocode-generator\src\core\analysis\ast-analysis.service.ts
TARGET: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast-analysis.service.ts
PURPOSE: LLM-powered code insights extraction from AST

ADAPTATIONS NEEDED:
  - Convert @Injectable() to tsyringe @injectable()
  - Convert @Inject('ILLMAgent') to use new LlmAbstractionService
  - Replace ILLMAgent dependency with interface from llm-abstraction library
  - Update prompt building to use ptah's prompt templates if needed
  - Add token budget awareness using TokenCounterService

DEPENDENCIES:
  - @langchain/core (for BaseLanguageModelInput, types)
  - zod (for schema validation)
  - Result type from @ptah-extension/shared
  - Logger from @ptah-extension/vscode-core
  - LlmAbstractionService from @ptah-extension/llm-abstraction (NEW)

INTEGRATION POINTS:
  - Called by WorkspaceAnalyzerService.extractCodeInsights()
  - Uses TreeSitterParserService for AST generation
  - Returns structured CodeInsights for template generation
```

#### File 4: AST Type Definitions

```
SOURCE: D:\projects\roocode-generator\src\core\analysis\types.ts
TARGET: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast.types.ts
PURPOSE: TypeScript interfaces for AST nodes

ADAPTATIONS NEEDED:
  - Extract only GenericAstNode and related types
  - Move to workspace-intelligence types folder
  - No logic changes needed (pure interfaces)

DEPENDENCIES:
  - None (pure TypeScript interfaces)

INTEGRATION POINTS:
  - Used by TreeSitterParserService return types
  - Used by AstAnalysisService input types
```

#### File 5: AST Analysis Interfaces

```
SOURCE: D:\projects\roocode-generator\src\core\analysis\ast-analysis.interfaces.ts
TARGET: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast-analysis.interfaces.ts
PURPOSE: Interfaces for code insights (FunctionInfo, ClassInfo, ImportInfo)

ADAPTATIONS NEEDED:
  - No changes needed (pure interfaces)
  - Export from workspace-intelligence public API

DEPENDENCIES:
  - None

INTEGRATION POINTS:
  - Used by AstAnalysisService return types
  - Used by template generation to understand code structure
```

#### File 6: Tree-Sitter Configuration

```
SOURCE: D:\projects\roocode-generator\src\core\analysis\tree-sitter.config.ts
TARGET: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\tree-sitter.config.ts
PURPOSE: Language mappings for file extensions

ADAPTATIONS NEEDED:
  - No changes needed (configuration constants)

DEPENDENCIES:
  - None

INTEGRATION POINTS:
  - Used by TreeSitterParserService for language detection
```

---

### 1.3 LLM Abstraction Layer

#### File 7: LLM Provider Interfaces

```
SOURCE: D:\projects\roocode-generator\src\core\llm\interfaces.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\interfaces\llm-provider.interface.ts
PURPOSE: Core LLM provider abstraction interfaces

ADAPTATIONS NEEDED:
  - Rename ILLMProvider → ILlmProvider (ptah naming convention)
  - Rename ILLMAgent → ILlmService (more descriptive)
  - Remove ILLMProviderRegistry (ptah uses different pattern)
  - Add IModelListerService to new file
  - Keep LLMCompletionConfig as-is
  - Update imports to use ptah types

DEPENDENCIES:
  - @langchain/core (BaseLanguageModelInput)
  - zod (ZodTypeAny)
  - Result type from @ptah-extension/shared

INTEGRATION POINTS:
  - Implemented by provider adapters (Anthropic, OpenAI, Google)
  - Used by LlmService for provider abstraction
```

#### File 8: LLM Provider Errors

```
SOURCE: D:\projects\roocode-generator\src\core\llm\llm-provider-errors.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\errors\llm-provider.error.ts
PURPOSE: Standardized error types for LLM operations

ADAPTATIONS NEEDED:
  - Rename to LlmProviderError (ptah naming)
  - Extend from base Error class in @ptah-extension/shared if exists
  - Otherwise keep as-is

DEPENDENCIES:
  - None (extends Error)

INTEGRATION POINTS:
  - Thrown by all LLM provider implementations
  - Caught by LlmService and returned as Result.err()
```

#### File 9: LLM Agent (Core Service)

```
SOURCE: D:\projects\roocode-generator\src\core\llm\llm-agent.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\services\llm.service.ts
PURPOSE: Main LLM orchestration service with provider registry

ADAPTATIONS NEEDED:
  - Rename LLMAgent → LlmService
  - Convert @Injectable() to tsyringe @injectable()
  - Remove direct provider registry dependency
  - Integrate with ptah's provider-manager pattern:
    * Use factory pattern to create providers on-demand
    * Support both Langchain providers AND ptah's existing ClaudeCliAdapter
  - Replace IFileOperations with ptah's FileSystemService
  - Remove analyzeProject() method (not needed in ptah)
  - Keep getCompletion(), getStructuredCompletion(), countTokens()
  - Add getProviderFactory() to work with different providers

DEPENDENCIES:
  - @langchain/core
  - zod
  - @ptah-extension/shared (Result)
  - @ptah-extension/vscode-core (Logger, FileSystemService)
  - Provider implementations (Anthropic, OpenAI, Google)

INTEGRATION POINTS:
  - Used by AstAnalysisService for code insights
  - Used by template generation for CLAUDE.md generation
  - Called via VS Code commands (ptah.callVsCodeLM)
  - NOT used for main chat UI (that stays ClaudeCliAdapter)
```

#### File 10-13: Provider Implementations

**Anthropic Provider**:

```
SOURCE: D:\projects\roocode-generator\src\core\llm\providers\anthropic-provider.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\providers\anthropic.provider.ts

ADAPTATIONS:
  - Convert @Injectable() to @injectable()
  - Extend BaseLlmProvider (create new base class in ptah)
  - Update constructor to use ptah Logger
  - Keep all Langchain integration as-is
  - Token validation logic stays the same
```

**OpenAI Provider**:

```
SOURCE: D:\projects\roocode-generator\src\core\llm\providers\openai-provider.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\providers\openai.provider.ts

ADAPTATIONS:
  - Same pattern as Anthropic
  - Convert DI decorators
  - Update Logger injection
```

**Google GenAI Provider**:

```
SOURCE: D:\projects\roocode-generator\src\core\llm\providers\google-genai-provider.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\providers\google-genai.provider.ts

ADAPTATIONS:
  - Same pattern as others
  - Handle Google-specific API differences
```

**OpenRouter Provider**:

```
SOURCE: D:\projects\roocode-generator\src\core\llm\providers\open-router-provider.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\providers\open-router.provider.ts

ADAPTATIONS:
  - Same pattern
  - Keep OpenRouter-specific routing logic
```

#### File 14: Base LLM Provider

```
SOURCE: D:\projects\roocode-generator\src\core\llm\llm-provider.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\providers\base-llm.provider.ts
PURPOSE: Abstract base class for all LLM providers

ADAPTATIONS NEEDED:
  - Rename BaseLLMProvider → BaseLlmProvider
  - Update to implement ILlmProvider interface
  - Keep defaultContextSize property
  - Abstract methods remain the same

DEPENDENCIES:
  - ILlmProvider interface
  - Result type

INTEGRATION POINTS:
  - Extended by all provider implementations
```

#### File 15: Provider Registry

```
SOURCE: D:\projects\roocode-generator\src\core\llm\provider-registry.ts
TARGET: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\registry\provider-registry.ts
PURPOSE: Provider factory registry with dynamic provider creation

ADAPTATIONS NEEDED:
  - Convert @Injectable() to @injectable()
  - Update to use ptah's configuration system
  - Integrate with VS Code settings for API keys
  - Support reading from environment variables AND VS Code settings
  - Add factory registration method for new providers

DEPENDENCIES:
  - Logger from vscode-core
  - Configuration service from vscode-core
  - All provider implementations

INTEGRATION POINTS:
  - Used by LlmService to create provider instances
  - Configured via VS Code settings (ptah.llm.providers)
```

---

### 1.4 Template Generation System

#### File 16: Memory Bank Service (→ Template Generator)

```
SOURCE: D:\projects\roocode-generator\src\memory-bank\memory-bank-service.ts
TARGET: D:\projects\ptah-extension\libs\backend\template-generation\src\services\template-generator.service.ts
PURPOSE: Orchestrates template generation from project context

ADAPTATIONS NEEDED:
  - Rename MemoryBankService → TemplateGeneratorService
  - Replace IMemoryBankOrchestrator dependency with new orchestrator
  - Update to use ptah's workspace-intelligence for project context
  - Generate CLAUDE.md instead of RooCode memory-bank files
  - Support ptah's template system architecture (docs/ptah-template-system-architecture.md)

DEPENDENCIES:
  - @ptah-extension/workspace-intelligence (project analysis)
  - @ptah-extension/llm-abstraction (LLM for template generation)
  - @ptah-extension/vscode-core (Logger, FileSystemService)

INTEGRATION POINTS:
  - Called by VS Code command handler (ptah.generateTemplates)
  - Uses WorkspaceAnalyzerService for project context
  - Outputs CLAUDE.md to workspace root
```

#### File 17: Template Orchestrator

```
SOURCE: D:\projects\roocode-generator\src\memory-bank\memory-bank-orchestrator.ts
TARGET: D:\projects\ptah-extension\libs\backend\template-generation\src\orchestrator\template-orchestrator.ts
PURPOSE: Coordinates template generation workflow

ADAPTATIONS NEEDED:
  - Rename MemoryBankOrchestrator → TemplateOrchestrator
  - Update to generate Ptah-specific templates
  - Remove RooCode-specific logic (memory-bank folder structure)
  - Add CLAUDE.md section generation
  - Add agent template generation (ptah-* agents)

DEPENDENCIES:
  - Template processor
  - Content generator
  - File manager
  - Logger

INTEGRATION POINTS:
  - Called by TemplateGeneratorService
  - Coordinates template-processor, content-generator, file-manager
```

#### File 18: Template Manager

```
SOURCE: D:\projects\roocode-generator\src\memory-bank\memory-bank-template-manager.ts
TARGET: D:\projects\ptah-extension\libs\backend\template-generation\src\template\template-manager.ts
PURPOSE: Loads and manages template files

ADAPTATIONS NEEDED:
  - Update template paths to load from extension bundle
  - Support Ptah template structure (agents/, commands/, templates/)
  - Load templates from extension's templates/ folder
  - Add template validation

DEPENDENCIES:
  - FileSystemService from vscode-core
  - Template interfaces

INTEGRATION POINTS:
  - Used by TemplateOrchestrator to load base templates
  - Reads templates from extension bundle (not from workspace)
```

#### File 19: Content Generator

```
SOURCE: D:\projects\roocode-generator\src\memory-bank\memory-bank-content-generator.ts
TARGET: D:\projects\ptah-extension\libs\backend\template-generation\src\generator\content-generator.ts
PURPOSE: Generates template content from project context

ADAPTATIONS NEEDED:
  - Update to generate Ptah-specific content sections
  - Use project context from workspace-intelligence
  - Generate tech-stack-specific recommendations
  - Add AST-based code insights to templates

DEPENDENCIES:
  - LlmService for AI-generated content
  - WorkspaceAnalyzerService for project info
  - AstAnalysisService for code insights

INTEGRATION POINTS:
  - Called by TemplateOrchestrator
  - Uses AST insights to recommend patterns
```

#### File 20: Template Processor

```
SOURCE: D:\projects\roocode-generator\src\memory-bank\memory-bank-template-processor.ts
TARGET: D:\projects\ptah-extension\libs\backend\template-generation\src\processor\template-processor.ts
PURPOSE: Processes template variables and substitutions

ADAPTATIONS NEEDED:
  - Update variable substitution syntax if needed
  - Support Ptah-specific template variables
  - Keep mustache-style templating ({{variable}})

DEPENDENCIES:
  - Template interfaces
  - None external

INTEGRATION POINTS:
  - Used by ContentGenerator to fill templates
  - Processes variables like {{projectName}}, {{techStack}}
```

#### File 21: File Manager

```
SOURCE: D:\projects\roocode-generator\src\memory-bank\memory-bank-file-manager.ts
TARGET: D:\projects\ptah-extension\libs\backend\template-generation\src\file\template-file-manager.ts
PURPOSE: Writes generated templates to workspace

ADAPTATIONS NEEDED:
  - Update to use ptah's FileSystemService
  - Add conflict detection (check if CLAUDE.md exists)
  - Support append mode for existing CLAUDE.md
  - Namespace isolation for .claude/ files (ptah-* prefix)

DEPENDENCIES:
  - FileSystemService from vscode-core
  - Logger

INTEGRATION POINTS:
  - Called by TemplateOrchestrator to write files
  - Coordinates with DeploymentService (from template-system architecture)
```

#### File 22-26: Template Interfaces

```
SOURCE: D:\projects\roocode-generator\src\memory-bank\interfaces\*.ts
TARGET: D:\projects\ptah-extension\libs\backend\template-generation\src\interfaces\
PURPOSE: TypeScript interfaces for template system

ADAPTATIONS NEEDED:
  - Rename MemoryBank* → Template*
  - Update to match Ptah template structure
  - Add deployment-related interfaces

FILES:
  - config.interface.ts
  - content-generator.interface.ts
  - content-processor.interface.ts
  - file-manager.interface.ts
  - template-manager.interface.ts
  - template-processor.interface.ts
  - orchestrator.interface.ts
  - types.ts (template types)

DEPENDENCIES:
  - None (pure interfaces)

INTEGRATION POINTS:
  - Implemented by all template services
```

---

### 1.5 Supporting Utilities

#### File 27: Retry Utilities

```
SOURCE: D:\projects\roocode-generator\src\core\utils\retry-utils.ts
TARGET: D:\projects\ptah-extension\libs\shared\src\lib\utils\retry.utils.ts
PURPOSE: Retry logic with exponential backoff for LLM calls

ADAPTATIONS NEEDED:
  - No changes needed (pure utility function)
  - Export from shared utils

DEPENDENCIES:
  - None

INTEGRATION POINTS:
  - Used by LLM providers for API retry logic
```

#### File 28: JSON Utilities

```
SOURCE: D:\projects\roocode-generator\src\core\utils\json-utils.ts
TARGET: D:\projects\ptah-extension\libs\shared\src\lib\utils\json.utils.ts
PURPOSE: JSON parsing/repair utilities

ADAPTATIONS NEEDED:
  - Keep jsonrepair dependency
  - No logic changes needed

DEPENDENCIES:
  - jsonrepair (npm package)

INTEGRATION POINTS:
  - Used by template processor for JSON template variables
```

---

## Section 2: New Library Creation Plan

### 2.1 Library: llm-abstraction

```
LIBRARY NAME: libs/backend/llm-abstraction
PURPOSE: Multi-provider LLM abstraction for internal VS Code commands

DEPENDENCIES:
  - @langchain/core@^0.3.44
  - @langchain/anthropic@^0.3.17
  - @langchain/openai@^0.5.5
  - @langchain/google-genai@^0.2.3
  - zod@3.24.4
  - @ptah-extension/shared (Result, types)
  - @ptah-extension/vscode-core (Logger, DI, FileSystemService)

EXPORTS:
  - LlmService (main orchestrator)
  - ILlmProvider (interface)
  - LlmProviderError (error class)
  - ProviderRegistry (factory)
  - All provider implementations (Anthropic, OpenAI, Google, OpenRouter)

FILES TO CREATE:
  - src/services/llm.service.ts (from llm-agent.ts)
  - src/interfaces/llm-provider.interface.ts (from interfaces.ts)
  - src/errors/llm-provider.error.ts (from llm-provider-errors.ts)
  - src/providers/base-llm.provider.ts (from llm-provider.ts)
  - src/providers/anthropic.provider.ts (from providers/anthropic-provider.ts)
  - src/providers/openai.provider.ts (from providers/openai-provider.ts)
  - src/providers/google-genai.provider.ts (from providers/google-genai-provider.ts)
  - src/providers/open-router.provider.ts (from providers/open-router-provider.ts)
  - src/registry/provider-registry.ts (from provider-registry.ts)
  - src/di/register.ts (NEW - tsyringe registration)
  - src/index.ts (barrel exports)

DI REGISTRATION:
  1. Create registerLlmAbstractionServices(container: DependencyContainer)
  2. Register providers as factories:
     container.register(TOKENS.LLM_ANTHROPIC_PROVIDER_FACTORY, {
       useFactory: () => (config: LlmConfig) => new AnthropicProvider(config, logger, clientFactory)
     });
  3. Register LlmService as singleton:
     container.registerSingleton(TOKENS.LLM_SERVICE, LlmService);
  4. Register ProviderRegistry as singleton:
     container.registerSingleton(TOKENS.LLM_PROVIDER_REGISTRY, ProviderRegistry);
  5. Add tokens to @ptah-extension/vscode-core TOKENS constant
```

**Library Configuration**:

- **TypeScript Config**: Extend from workspace tsconfig.base.json
- **Build**: esbuild targeting CommonJS (like other backend libs)
- **Test**: Jest with 80% coverage target
- **Lint**: ESLint with ptah rules

**Public API** (`index.ts`):

```typescript
export { LlmService } from './services/llm.service';
export { ILlmProvider, LlmCompletionConfig } from './interfaces/llm-provider.interface';
export { LlmProviderError } from './errors/llm-provider.error';
export { ProviderRegistry } from './registry/provider-registry';
export { registerLlmAbstractionServices } from './di/register';
// Provider implementations NOT exported (internal use)
```

---

### 2.2 Library: template-generation

```
LIBRARY NAME: libs/backend/template-generation
PURPOSE: Intelligent workspace analysis → CLAUDE.md generation → agent template creation

DEPENDENCIES:
  - @ptah-extension/shared (Result, types)
  - @ptah-extension/vscode-core (Logger, FileSystemService, DI)
  - @ptah-extension/workspace-intelligence (WorkspaceAnalyzerService, AstAnalysisService)
  - @ptah-extension/llm-abstraction (LlmService)

EXPORTS:
  - TemplateGeneratorService (main entry point)
  - TemplateOrchestrator
  - TemplateManager
  - ContentGenerator
  - TemplateProcessor
  - TemplateFileManager
  - All interfaces

FILES TO CREATE:
  - src/services/template-generator.service.ts (from memory-bank-service.ts)
  - src/orchestrator/template-orchestrator.ts (from memory-bank-orchestrator.ts)
  - src/template/template-manager.ts (from memory-bank-template-manager.ts)
  - src/generator/content-generator.ts (from memory-bank-content-generator.ts)
  - src/processor/template-processor.ts (from memory-bank-template-processor.ts)
  - src/file/template-file-manager.ts (from memory-bank-file-manager.ts)
  - src/interfaces/*.ts (from memory-bank/interfaces/*.ts)
  - src/di/register.ts (NEW - tsyringe registration)
  - src/index.ts (barrel exports)

DI REGISTRATION:
  1. Create registerTemplateGenerationServices(container: DependencyContainer)
  2. Register all services as singletons:
     container.registerSingleton(TOKENS.TEMPLATE_GENERATOR_SERVICE, TemplateGeneratorService);
     container.registerSingleton(TOKENS.TEMPLATE_ORCHESTRATOR, TemplateOrchestrator);
     container.registerSingleton(TOKENS.TEMPLATE_MANAGER, TemplateManager);
     container.registerSingleton(TOKENS.CONTENT_GENERATOR, ContentGenerator);
     container.registerSingleton(TOKENS.TEMPLATE_PROCESSOR, TemplateProcessor);
     container.registerSingleton(TOKENS.TEMPLATE_FILE_MANAGER, TemplateFileManager);
  3. Add tokens to @ptah-extension/vscode-core TOKENS constant
```

**Library Configuration**:

- **TypeScript Config**: Extend from workspace tsconfig.base.json
- **Build**: esbuild targeting CommonJS
- **Test**: Jest with 80% coverage target
- **Lint**: ESLint with ptah rules

**Public API** (`index.ts`):

```typescript
export { TemplateGeneratorService } from './services/template-generator.service';
export { TemplateOrchestrator } from './orchestrator/template-orchestrator';
export { registerTemplateGenerationServices } from './di/register';
export * from './interfaces';
// Internal services NOT exported (TemplateManager, etc. - internal only)
```

---

## Section 3: Existing Library Enhancement Plan

### 3.1 Enhancement: workspace-intelligence

```
LIBRARY: libs/backend/workspace-intelligence
CURRENT STATE:
  - WorkspaceAnalyzerService (facade)
  - ProjectDetectorService (13+ project types)
  - WorkspaceIndexerService (file indexing)
  - TokenCounterService (native VS Code API)
  - ContextService (file search)

ENHANCEMENTS:

1. Add AST Parsing Module
   NEW FILES:
   - src/ast/tree-sitter-parser.service.ts (from roocode)
   - src/ast/ast-analysis.service.ts (from roocode)
   - src/ast/ast.types.ts (from roocode)
   - src/ast/ast-analysis.interfaces.ts (from roocode)
   - src/ast/tree-sitter.config.ts (from roocode)

2. Modify WorkspaceAnalyzerService
   FILE: src/composite/workspace-analyzer.service.ts
   CHANGES:
   - Add extractCodeInsights() method
   - Inject TreeSitterParserService and AstAnalysisService
   - Add getCodeStructure(filePath: string): Promise<CodeInsights>
   - Integrate AST analysis into analyzeWorkspaceStructure()

3. Update DI Registration
   FILE: src/di/register.ts
   CHANGES:
   - Register TreeSitterParserService as singleton
   - Register AstAnalysisService as singleton
   - Add TOKENS.TREE_SITTER_PARSER_SERVICE
   - Add TOKENS.AST_ANALYSIS_SERVICE

4. Update Public API
   FILE: src/index.ts
   CHANGES:
   - Export AstAnalysisService
   - Export CodeInsights interface
   - Export GenericAstNode type

INTEGRATION POINTS:
  - WorkspaceAnalyzerService.extractCodeInsights() → calls AstAnalysisService
  - AstAnalysisService → uses LlmService from llm-abstraction
  - Template generation → uses CodeInsights for recommendations
```

**Enhancement Code Example**:

```typescript
// In WorkspaceAnalyzerService
@injectable()
export class WorkspaceAnalyzerService {
  constructor(
    // ... existing services
    private readonly treeParser: TreeSitterParserService,
    private readonly astAnalyzer: AstAnalysisService
  ) {}

  /**
   * NEW METHOD: Extract code insights from a file using AST analysis
   */
  async extractCodeInsights(filePath: string): Promise<CodeInsights> {
    // Read file content
    const content = await this.fileSystemService.readFile(filePath);

    // Parse to AST
    const language = this.detectLanguage(filePath); // 'typescript' | 'javascript'
    const astResult = this.treeParser.parse(content, language);

    if (astResult.isErr()) {
      throw astResult.error;
    }

    // Analyze AST with LLM
    const insightsResult = await this.astAnalyzer.analyzeAst(astResult.value, filePath);

    if (insightsResult.isErr()) {
      throw insightsResult.error;
    }

    return insightsResult.value;
  }
}
```

---

### 3.2 Enhancement: ai-providers-core

````
LIBRARY: libs/backend/ai-providers-core
CURRENT STATE:
  - ProviderManager (provider orchestration)
  - IntelligentProviderStrategy (task-based selection)
  - ClaudeCliAdapter (Claude CLI integration)
  - VsCodeLmAdapter (VS Code LM API)
  - ContextManager (file inclusion)

ENHANCEMENTS:

1. Add Langchain Provider Integration
   NEW FILES:
   - src/adapters/langchain-adapter.ts (NEW - wraps llm-abstraction)

2. Update ProviderManager
   FILE: src/manager/provider-manager.ts
   CHANGES:
   - Register LangchainAdapter as provider
   - Add support for "internal" provider type (for template generation)
   - Keep existing Claude CLI as default for main UI

3. Create Langchain Adapter
   PURPOSE: Bridge between ai-providers-core and llm-abstraction
   CODE:
   ```typescript
   @injectable()
   export class LangchainAdapter implements EnhancedAIProvider {
     readonly providerId = 'langchain' as ProviderId;

     constructor(
       @inject(TOKENS.LLM_SERVICE) private llmService: LlmService
     ) {}

     async sendMessage(sessionId, content, context) {
       // Delegate to LlmService for internal LLM calls
       return this.llmService.getCompletion(systemPrompt, userPrompt);
     }

     // ... other IAIProvider methods
   }
````

4. Update DI Registration
   FILE: src/di/register.ts
   CHANGES:
   - Register LangchainAdapter
   - Add to ProviderManager's available providers

INTEGRATION POINTS:

- LangchainAdapter wraps LlmService from llm-abstraction
- Used for internal commands (NOT main chat UI)
- Template generation uses this for AI-powered content

````

**Integration Strategy**:

- **Main Chat UI**: Continues using ClaudeCliAdapter (no changes)
- **Internal Commands** (ptah.callVsCodeLM): Use LangchainAdapter → LlmService
- **Template Generation**: Use LangchainAdapter for CLAUDE.md content generation
- **Code Insights**: Use LangchainAdapter for AST analysis

---

## Section 4: Dependency Installation

### 4.1 NPM Packages to Install

```bash
# Core Langchain
PACKAGE: @langchain/core
VERSION: ^0.3.44
PURPOSE: Multi-provider LLM abstraction core
INSTALL COMMAND: npm install @langchain/core@^0.3.44

PACKAGE: @langchain/anthropic
VERSION: ^0.3.17
PURPOSE: Anthropic Claude provider for Langchain
INSTALL COMMAND: npm install @langchain/anthropic@^0.3.17

PACKAGE: @langchain/openai
VERSION: ^0.5.5
PURPOSE: OpenAI GPT provider for Langchain
INSTALL COMMAND: npm install @langchain/openai@^0.5.5

PACKAGE: @langchain/google-genai
VERSION: ^0.2.3
PURPOSE: Google Gemini provider for Langchain
INSTALL COMMAND: npm install @langchain/google-genai@^0.2.3

PACKAGE: langchain
VERSION: ^0.3.21
PURPOSE: Langchain core library
INSTALL COMMAND: npm install langchain@^0.3.21

# Tree-sitter (AST Parsing)
PACKAGE: tree-sitter
VERSION: ^0.21.1
PURPOSE: AST parser for code analysis
INSTALL COMMAND: npm install tree-sitter@^0.21.1

PACKAGE: tree-sitter-javascript
VERSION: ^0.23.1
PURPOSE: JavaScript grammar for tree-sitter
INSTALL COMMAND: npm install tree-sitter-javascript@^0.23.1

PACKAGE: tree-sitter-typescript
VERSION: ^0.23.2
PURPOSE: TypeScript grammar for tree-sitter
INSTALL COMMAND: npm install tree-sitter-typescript@^0.23.2

# Utilities
PACKAGE: zod
VERSION: 3.24.4
PURPOSE: Schema validation (already installed, verify version)
INSTALL COMMAND: npm install zod@3.24.4

PACKAGE: jsonrepair
VERSION: ^3.12.0
PURPOSE: JSON repair for malformed LLM responses
INSTALL COMMAND: npm install jsonrepair@^3.12.0
````

### 4.2 Installation Script

Create `scripts/install-roocode-deps.sh`:

```bash
#!/bin/bash
# Install all roocode-generator dependencies

echo "Installing Langchain dependencies..."
npm install @langchain/core@^0.3.44 \
            @langchain/anthropic@^0.3.17 \
            @langchain/openai@^0.5.5 \
            @langchain/google-genai@^0.2.3 \
            langchain@^0.3.21

echo "Installing tree-sitter dependencies..."
npm install tree-sitter@^0.21.1 \
            tree-sitter-javascript@^0.23.1 \
            tree-sitter-typescript@^0.23.2

echo "Installing utility dependencies..."
npm install zod@3.24.4 \
            jsonrepair@^3.12.0

echo "All dependencies installed!"
echo "Next: Run nx build workspace-intelligence to verify"
```

---

## Section 5: Integration Sequence

### Phase 1: Foundation (Week 1 - Days 1-5)

**Goal**: Set up shared utilities and verify build system

#### Task 1.1: Install Dependencies (Day 1)

```bash
# Step 1: Install all npm packages
./scripts/install-roocode-deps.sh

# Step 2: Verify installations
npm list @langchain/core @langchain/anthropic tree-sitter

# Step 3: Update Nx build targets if needed
nx build --all
```

**Verification**:

- [ ] All packages installed without errors
- [ ] No peer dependency warnings
- [ ] All existing ptah builds still pass

---

#### Task 1.2: Copy Result Type (Day 1)

```bash
# Step 1: Create utils folder
mkdir -p D:\projects\ptah-extension\libs\shared\src\lib\utils

# Step 2: Copy Result type
cp D:\projects\roocode-generator\src\core\result\result.ts \
   D:\projects\ptah-extension\libs\shared\src\lib\utils\result.ts

# Step 3: Create barrel export
cat > D:\projects\ptah-extension\libs\shared\src\lib\utils\index.ts << EOF
export { Result } from './result';
EOF

# Step 4: Update libs/shared/src/index.ts
echo "export * from './lib/utils';" >> D:\projects\ptah-extension\libs\shared\src\index.ts
```

**Verification**:

- [ ] Result class compiles without errors
- [ ] Can import via `import { Result } from '@ptah-extension/shared/utils'`
- [ ] nx build shared passes

---

#### Task 1.3: Copy Retry & JSON Utilities (Day 2)

```bash
# Copy retry utils
cp D:\projects\roocode-generator\src\core\utils\retry-utils.ts \
   D:\projects\ptah-extension\libs\shared\src\lib\utils\retry.utils.ts

# Copy JSON utils
cp D:\projects\roocode-generator\src\core\utils\json-utils.ts \
   D:\projects\ptah-extension\libs\shared\src\lib\utils\json.utils.ts

# Update utils/index.ts
cat >> D:\projects\ptah-extension\libs\shared\src\lib\utils\index.ts << EOF
export * from './retry.utils';
export * from './json.utils';
EOF
```

**Verification**:

- [ ] Utilities compile without errors
- [ ] No import errors with jsonrepair
- [ ] nx test shared passes

---

### Phase 2: AST Parsing & Workspace Intelligence (Week 1-2 - Days 3-10)

**Goal**: Add AST parsing capabilities to workspace-intelligence

#### Task 2.1: Create AST Module Structure (Day 3)

```bash
# Create folder structure
mkdir -p D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast

# Copy type definitions (no changes needed)
cp D:\projects\roocode-generator\src\core\analysis\types.ts \
   D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast.types.ts

cp D:\projects\roocode-generator\src\core\analysis\ast-analysis.interfaces.ts \
   D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast-analysis.interfaces.ts

cp D:\projects\roocode-generator\src\core\analysis\tree-sitter.config.ts \
   D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\tree-sitter.config.ts
```

**Adaptations for ast.types.ts**:

```typescript
// Extract only GenericAstNode and related types
// Remove ProjectContext, TechStack (ptah has own workspace types)

export interface GenericAstNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  isNamed: boolean;
  fieldName: string | null;
  children: GenericAstNode[];
}

// Keep SupportedLanguage type
export type SupportedLanguage = 'javascript' | 'typescript';
```

**Verification**:

- [ ] Types compile without errors
- [ ] No circular dependencies
- [ ] nx build workspace-intelligence passes

---

#### Task 2.2: Copy TreeSitterParserService (Day 4)

```bash
# Copy service
cp D:\projects\roocode-generator\src\core\analysis\tree-sitter-parser.service.ts \
   D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\tree-sitter-parser.service.ts
```

**Adaptations** (manually edit tree-sitter-parser.service.ts):

```typescript
// BEFORE (roocode):
import { Inject, Injectable } from '../di/decorators';
import { ILogger } from '../services/logger-service';

@Injectable()
export class TreeSitterParserService implements ITreeSitterParserService {
  constructor(@Inject('ILogger') logger: ILogger) {
    this.logger = logger;
  }
}

// AFTER (ptah):
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared/utils';

@injectable()
export class TreeSitterParserService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.info('TreeSitterParserService created');
  }
}
```

**Verification**:

- [ ] Service compiles with tsyringe decorators
- [ ] tree-sitter require() works (test manually)
- [ ] Can parse simple TypeScript file

---

#### Task 2.3: Copy AstAnalysisService (Day 5)

```bash
# Copy service
cp D:\projects\roocode-generator\src\core\analysis\ast-analysis.service.ts \
   D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast-analysis.service.ts
```

**Adaptations** (manually edit ast-analysis.service.ts):

```typescript
// BEFORE (roocode):
import { Injectable, Inject } from '../di/decorators';
import { ILLMAgent } from '../llm/interfaces';

@Injectable()
export class AstAnalysisService {
  constructor(@Inject('ILLMAgent') private readonly llmAgent: ILLMAgent, @Inject('ILogger') private readonly logger: ILogger) {}
}

// AFTER (ptah):
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared/utils';
// NOTE: LlmService from llm-abstraction will be injected in Phase 3
// For now, make it optional or mock it

@injectable()
export class AstAnalysisService {
  constructor(
    // @inject(TOKENS.LLM_SERVICE) private readonly llmService: ILlmService, // Phase 3
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  // Stub for Phase 3 integration
  async analyzeAst(astData: GenericAstNode, filePath: string): Promise<Result<CodeInsights, Error>> {
    this.logger.warn('AstAnalysisService: LLM integration not yet available (Phase 3)');
    // Return empty insights for now
    return Result.ok({
      functions: [],
      classes: [],
      imports: [],
    });
  }
}
```

**Verification**:

- [ ] Service compiles with stub implementation
- [ ] Can call analyzeAst (returns empty insights)
- [ ] nx build workspace-intelligence passes

---

#### Task 2.4: Update WorkspaceAnalyzerService (Day 6)

```typescript
// FILE: libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts

// Add new dependencies
constructor(
  // ... existing services
  private readonly treeParser: TreeSitterParserService,
  private readonly astAnalyzer: AstAnalysisService
) {}

// Add new method
async extractCodeInsights(filePath: string): Promise<CodeInsights> {
  const content = await this.fileSystemService.readFile(vscode.Uri.file(filePath));

  // Detect language from extension
  const language = filePath.endsWith('.ts') ? 'typescript' : 'javascript';

  // Parse AST
  const astResult = this.treeParser.parse(content, language);
  if (astResult.isErr()) {
    throw astResult.error;
  }

  // Analyze (stub for now, Phase 3 will add LLM)
  const insightsResult = await this.astAnalyzer.analyzeAst(astResult.value, filePath);
  if (insightsResult.isErr()) {
    throw insightsResult.error;
  }

  return insightsResult.value;
}
```

**Verification**:

- [ ] WorkspaceAnalyzerService compiles
- [ ] extractCodeInsights() callable (returns empty insights)
- [ ] No runtime errors when called

---

#### Task 2.5: Update DI Registration (Day 7)

```typescript
// FILE: libs/backend/workspace-intelligence/src/di/register.ts

// Add tokens to @ptah-extension/vscode-core/src/di/tokens.ts FIRST
export const TOKENS = {
  // ... existing tokens
  TREE_SITTER_PARSER_SERVICE: 'TreeSitterParserService',
  AST_ANALYSIS_SERVICE: 'AstAnalysisService',
} as const;

// Then register in workspace-intelligence
export function registerWorkspaceIntelligenceServices(container: DependencyContainer): void {
  // ... existing registrations

  // AST services
  container.registerSingleton(TOKENS.TREE_SITTER_PARSER_SERVICE, TreeSitterParserService);
  container.registerSingleton(TOKENS.AST_ANALYSIS_SERVICE, AstAnalysisService);
}
```

**Verification**:

- [ ] Services resolve from DI container
- [ ] No circular dependency errors
- [ ] Integration test: resolve WorkspaceAnalyzerService and call extractCodeInsights()

---

#### Task 2.6: Update Public API (Day 8)

```typescript
// FILE: libs/backend/workspace-intelligence/src/index.ts

// Export AST services
export { TreeSitterParserService } from './ast/tree-sitter-parser.service';
export { AstAnalysisService } from './ast/ast-analysis.service';

// Export types
export * from './ast/ast.types';
export * from './ast/ast-analysis.interfaces';
```

**Verification**:

- [ ] Can import from '@ptah-extension/workspace-intelligence'
- [ ] TypeScript resolves imports correctly
- [ ] nx build workspace-intelligence passes

---

#### Task 2.7: Write Integration Tests (Day 9-10)

```typescript
// FILE: libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.spec.ts

describe('TreeSitterParserService', () => {
  it('should parse TypeScript code to AST', () => {
    const service = new TreeSitterParserService(mockLogger);
    service.initialize();

    const code = 'function hello() { return "world"; }';
    const result = service.parse(code, 'typescript');

    expect(result.isOk()).toBe(true);
    expect(result.value.type).toBe('program');
  });
});

// FILE: libs/backend/workspace-intelligence/src/ast/ast-analysis.service.spec.ts

describe('AstAnalysisService', () => {
  it('should return empty insights in Phase 2 (stub)', async () => {
    const service = new AstAnalysisService(mockLogger);

    const ast = { type: 'program' /* ... */ };
    const result = await service.analyzeAst(ast, 'test.ts');

    expect(result.isOk()).toBe(true);
    expect(result.value.functions).toEqual([]);
  });
});
```

**Verification**:

- [ ] nx test workspace-intelligence passes
- [ ] Coverage ≥ 80%
- [ ] No flaky tests

---

### Phase 3: LLM Abstraction Library (Week 2-3 - Days 11-18)

**Goal**: Create llm-abstraction library with Langchain provider support

#### Task 3.1: Create Library Structure (Day 11)

```bash
# Generate library with Nx
nx generate @nx/node:library llm-abstraction \
  --directory=libs/backend/llm-abstraction \
  --buildable=true \
  --publishable=false \
  --unitTestRunner=jest

# Create folder structure
cd libs/backend/llm-abstraction/src
mkdir -p services interfaces errors providers registry di
```

**Verification**:

- [ ] Library scaffolded correctly
- [ ] nx build llm-abstraction passes (empty lib)
- [ ] Added to tsconfig.base.json paths

---

#### Task 3.2: Copy Core Interfaces & Errors (Day 11)

```bash
# Copy interfaces
cp D:\projects\roocode-generator\src\core\llm\interfaces.ts \
   D:\projects\ptah-extension\libs\backend\llm-abstraction\src\interfaces\llm-provider.interface.ts

# Copy errors
cp D:\projects\roocode-generator\src\core\llm\llm-provider-errors.ts \
   D:\projects\ptah-extension\libs\backend\llm-abstraction\src\errors\llm-provider.error.ts
```

**Adaptations for llm-provider.interface.ts**:

```typescript
// Rename interfaces
export interface ILlmProvider {
  // was ILLMProvider
  readonly name: string;
  getCompletion(systemPrompt: string, userPrompt: string): Promise<Result<string, LlmProviderError>>;
  getStructuredCompletion<T extends z.ZodTypeAny>(/* ... */): Promise<Result<z.infer<T>, LlmProviderError>>;
  getContextWindowSize(): Promise<number>;
  countTokens(text: string): Promise<number>;
}

export interface ILlmService {
  // was ILLMAgent
  getCompletion(/* ... */): Promise<Result<string, LlmProviderError>>;
  getStructuredCompletion<T>(/* ... */): Promise<Result<z.infer<T>, LlmProviderError>>;
  getModelContextWindow(): Promise<number>;
  countTokens(text: string): Promise<number>;
  getProvider(): Promise<Result<ILlmProvider, Error>>;
}

// Keep LLMCompletionConfig as-is (config object)
```

**Verification**:

- [ ] Interfaces compile without errors
- [ ] LlmProviderError extends Error correctly

---

#### Task 3.3: Copy Base Provider (Day 12)

```bash
cp D:\projects\roocode-generator\src\core\llm\llm-provider.ts \
   D:\projects\ptah-extension\libs\backend\llm-abstraction\src\providers\base-llm.provider.ts
```

**Adaptations**:

```typescript
// Rename class
export abstract class BaseLlmProvider implements ILlmProvider {
  protected defaultContextSize = 8000;

  abstract get name(): string;
  abstract getCompletion(/* ... */): Promise<Result<string, LlmProviderError>>;
  abstract getStructuredCompletion<T>(/* ... */): Promise<Result<z.infer<T>, LlmProviderError>>;
  abstract getContextWindowSize(): Promise<number>;
  abstract countTokens(text: string): Promise<number>;
}
```

**Verification**:

- [ ] Base class compiles
- [ ] Abstract methods defined correctly

---

#### Task 3.4: Copy Provider Implementations (Day 13-14)

**Anthropic Provider**:

```bash
cp D:\projects\roocode-generator\src\core\llm\providers\anthropic-provider.ts \
   D:\projects\ptah-extension\libs\backend\llm-abstraction\src\providers\anthropic.provider.ts
```

**Adaptations**:

```typescript
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared/utils';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import { ChatAnthropic } from '@langchain/anthropic';

@injectable()
export class AnthropicProvider extends BaseLlmProvider {
  public readonly name = 'anthropic';

  constructor(
    private readonly config: LlmConfig, // Define LlmConfig interface
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    private readonly clientFactory: () => ChatAnthropic // Factory for testability
  ) {
    super();
    // ... rest of constructor (no changes)
  }

  // ... rest of implementation (no changes)
}
```

**Repeat for**:

- `openai.provider.ts`
- `google-genai.provider.ts`
- `open-router.provider.ts`

**Verification**:

- [ ] All providers compile
- [ ] Langchain imports resolve
- [ ] No DI errors

---

#### Task 3.5: Copy Provider Registry (Day 15)

```bash
cp D:\projects\roocode-generator\src\core\llm\provider-registry.ts \
   D:\projects\ptah-extension\libs\backend\llm-abstraction\src\registry\provider-registry.ts
```

**Adaptations**:

```typescript
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';

@injectable()
export class ProviderRegistry {
  private providerFactories = new Map<string, LlmProviderFactory>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.registerDefaultProviders();
  }

  private registerDefaultProviders() {
    // Anthropic factory
    this.providerFactories.set('anthropic', (config: LlmConfig) => {
      const clientFactory = () =>
        new ChatAnthropic({
          apiKey: config.apiKey,
          model: config.model,
          temperature: config.temperature,
        });
      return Result.ok(new AnthropicProvider(config, this.logger, clientFactory));
    });

    // Register OpenAI, Google, OpenRouter similarly
  }

  async getProvider(): Promise<Result<ILlmProvider, LlmProviderError>> {
    // Read from VS Code settings
    const config = vscode.workspace.getConfiguration('ptah.llm');
    const providerName = config.get<string>('provider', 'anthropic');
    const apiKey = config.get<string>(`${providerName}.apiKey`);
    const model = config.get<string>(`${providerName}.model`);

    const factory = this.providerFactories.get(providerName);
    if (!factory) {
      return Result.err(new LlmProviderError(`Provider ${providerName} not found`, 'PROVIDER_NOT_FOUND', 'ProviderRegistry'));
    }

    return factory({ apiKey, model, temperature: 0.7 } as LlmConfig);
  }
}
```

**Verification**:

- [ ] Registry compiles
- [ ] Can create providers dynamically
- [ ] Reads VS Code settings correctly

---

#### Task 3.6: Copy LLM Service (Day 16)

```bash
cp D:\projects\roocode-generator\src\core\llm\llm-agent.ts \
   D:\projects\ptah-extension\libs\backend\llm-abstraction\src\services\llm.service.ts
```

**Adaptations**:

```typescript
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { ProviderRegistry } from '../registry/provider-registry';

@injectable()
export class LlmService implements ILlmService {
  constructor(@inject(TOKENS.LLM_PROVIDER_REGISTRY) private readonly registry: ProviderRegistry, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async getCompletion(systemPrompt: string, userPrompt: string): Promise<Result<string, LlmProviderError>> {
    const providerResult = await this.getProvider();
    if (providerResult.isErr()) {
      return Result.err(providerResult.error);
    }

    return await providerResult.value.getCompletion(systemPrompt, userPrompt);
  }

  async getStructuredCompletion<T extends z.ZodTypeAny>(prompt: BaseLanguageModelInput, schema: T, config?: LlmCompletionConfig): Promise<Result<z.infer<T>, LlmProviderError>> {
    const providerResult = await this.getProvider();
    if (providerResult.isErr()) {
      return Result.err(providerResult.error);
    }

    return await providerResult.value.getStructuredCompletion(prompt, schema, config);
  }

  async getProvider(): Promise<Result<ILlmProvider, LlmProviderError>> {
    return await this.registry.getProvider();
  }

  // ... other methods (countTokens, getModelContextWindow)
}
```

**Verification**:

- [ ] LlmService compiles
- [ ] Can resolve provider from registry
- [ ] getCompletion() and getStructuredCompletion() work

---

#### Task 3.7: DI Registration (Day 17)

```typescript
// FILE: libs/backend/llm-abstraction/src/di/register.ts

import { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { LlmService } from '../services/llm.service';
import { ProviderRegistry } from '../registry/provider-registry';

export function registerLlmAbstractionServices(container: DependencyContainer): void {
  // Register registry
  container.registerSingleton(TOKENS.LLM_PROVIDER_REGISTRY, ProviderRegistry);

  // Register service
  container.registerSingleton(TOKENS.LLM_SERVICE, LlmService);

  console.log('[LlmAbstraction] Services registered');
}

// FILE: libs/backend/llm-abstraction/src/index.ts

export { LlmService } from './services/llm.service';
export { ILlmProvider, ILlmService, LlmCompletionConfig } from './interfaces/llm-provider.interface';
export { LlmProviderError } from './errors/llm-provider.error';
export { ProviderRegistry } from './registry/provider-registry';
export { registerLlmAbstractionServices } from './di/register';
```

**Add to vscode-core TOKENS**:

```typescript
// FILE: libs/backend/vscode-core/src/di/tokens.ts

export const TOKENS = {
  // ... existing tokens
  LLM_SERVICE: 'LlmService',
  LLM_PROVIDER_REGISTRY: 'LlmProviderRegistry',
} as const;
```

**Verification**:

- [ ] Services resolve from container
- [ ] No circular dependencies
- [ ] nx build llm-abstraction passes

---

#### Task 3.8: Write Tests (Day 18)

```typescript
// FILE: libs/backend/llm-abstraction/src/services/llm.service.spec.ts

describe('LlmService', () => {
  let service: LlmService;
  let mockRegistry: jest.Mocked<ProviderRegistry>;

  beforeEach(() => {
    mockRegistry = mock<ProviderRegistry>();
    service = new LlmService(mockRegistry, mockLogger);
  });

  it('should get completion from provider', async () => {
    const mockProvider = mock<ILlmProvider>();
    mockProvider.getCompletion.mockResolvedValue(Result.ok('response'));
    mockRegistry.getProvider.mockResolvedValue(Result.ok(mockProvider));

    const result = await service.getCompletion('system', 'user');

    expect(result.isOk()).toBe(true);
    expect(result.value).toBe('response');
  });

  it('should return error if provider not found', async () => {
    mockRegistry.getProvider.mockResolvedValue(Result.err(new LlmProviderError('Not found', 'PROVIDER_NOT_FOUND', 'Registry')));

    const result = await service.getCompletion('system', 'user');

    expect(result.isErr()).toBe(true);
  });
});

// Similar tests for providers, registry
```

**Verification**:

- [ ] nx test llm-abstraction passes
- [ ] Coverage ≥ 80%
- [ ] All providers tested

---

#### Task 3.9: Connect to AstAnalysisService (Day 18)

```typescript
// FILE: libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts

// Remove stub, add real implementation
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { ILlmService } from '@ptah-extension/llm-abstraction';

@injectable()
export class AstAnalysisService {
  constructor(@inject(TOKENS.LLM_SERVICE) private readonly llmService: ILlmService, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async analyzeAst(astData: GenericAstNode, filePath: string): Promise<Result<CodeInsights, LlmProviderError>> {
    // Condense AST
    const condensed = this._condenseAst(astData);
    const condensedJson = JSON.stringify(condensed, null, 2);

    // Build prompt
    const prompt = this.buildPrompt(condensedJson);

    // Call LLM with structured output
    const result = await this.llmService.getStructuredCompletion(prompt, codeInsightsSchema);

    if (result.isErr()) {
      this.logger.error(`AST analysis failed for ${filePath}:`, result.error);
      return Result.err(result.error);
    }

    return Result.ok(result.value);
  }

  // ... rest of implementation from roocode (no changes)
}
```

**Verification**:

- [ ] AstAnalysisService calls LlmService
- [ ] Returns structured CodeInsights
- [ ] Integration test: analyze real TypeScript file

---

### Phase 4: Template Generation System (Week 3-4 - Days 19-25)

**Goal**: Create template-generation library for CLAUDE.md and agent templates

#### Task 4.1: Create Library Structure (Day 19)

```bash
# Generate library
nx generate @nx/node:library template-generation \
  --directory=libs/backend/template-generation \
  --buildable=true \
  --publishable=false \
  --unitTestRunner=jest

# Create folders
cd libs/backend/template-generation/src
mkdir -p services orchestrator template generator processor file interfaces di
```

---

#### Task 4.2: Copy Interfaces (Day 19)

```bash
# Copy all memory-bank interfaces
cp -r D:\projects\roocode-generator\src\memory-bank\interfaces/* \
      D:\projects\ptah-extension\libs\backend\template-generation\src\interfaces\
```

**Adaptations**:

- Rename MemoryBank* → Template*
- Update to use ptah types (ProjectInfo from workspace-intelligence)
- Remove RooCode-specific types

---

#### Task 4.3: Copy Core Services (Day 20-22)

**TemplateGeneratorService**:

```bash
cp D:\projects\roocode-generator\src\memory-bank\memory-bank-service.ts \
   D:\projects\ptah-extension\libs\backend\template-generation\src\services\template-generator.service.ts
```

**Adaptations**:

- Rename MemoryBankService → TemplateGeneratorService
- Use WorkspaceAnalyzerService for project context
- Generate CLAUDE.md instead of memory-bank folder

**TemplateOrchestrator**:

```bash
cp D:\projects\roocode-generator\src\memory-bank\memory-bank-orchestrator.ts \
   D:\projects\ptah-extension\libs\backend\template-generation\src\orchestrator\template-orchestrator.ts
```

**Adaptations**:

- Update to generate Ptah templates
- Remove memory-bank specific logic

**Repeat for**:

- TemplateManager (from memory-bank-template-manager.ts)
- ContentGenerator (from memory-bank-content-generator.ts)
- TemplateProcessor (from memory-bank-template-processor.ts)
- TemplateFileManager (from memory-bank-file-manager.ts)

---

#### Task 4.4: Create Template Assets (Day 23)

Create template files in extension bundle:

```bash
# Create templates folder in extension
mkdir -p D:\projects\ptah-extension\apps\ptah-extension-vscode\src\templates

# Create base CLAUDE.md template
cat > apps/ptah-extension-vscode/src/templates/claude-base.md << 'EOF'
# {{projectName}} - AI Development Guidelines

**Generated by Ptah Extension**

## Project Overview

**Type**: {{projectType}}
**Tech Stack**: {{techStack}}

## Architecture Insights

{{architectureInsights}}

## Recommended Patterns

{{recommendedPatterns}}

## Key Components

{{keyComponents}}
EOF

# Create agent templates folder
mkdir -p apps/ptah-extension-vscode/src/templates/agents

# ptah-developer.md, ptah-architect.md, etc.
```

---

#### Task 4.5: DI Registration (Day 24)

```typescript
// FILE: libs/backend/template-generation/src/di/register.ts

export function registerTemplateGenerationServices(container: DependencyContainer): void {
  container.registerSingleton(TOKENS.TEMPLATE_GENERATOR_SERVICE, TemplateGeneratorService);
  container.registerSingleton(TOKENS.TEMPLATE_ORCHESTRATOR, TemplateOrchestrator);
  container.registerSingleton(TOKENS.TEMPLATE_MANAGER, TemplateManager);
  container.registerSingleton(TOKENS.CONTENT_GENERATOR, ContentGenerator);
  container.registerSingleton(TOKENS.TEMPLATE_PROCESSOR, TemplateProcessor);
  container.registerSingleton(TOKENS.TEMPLATE_FILE_MANAGER, TemplateFileManager);
}

// FILE: libs/backend/template-generation/src/index.ts

export { TemplateGeneratorService } from './services/template-generator.service';
export { registerTemplateGenerationServices } from './di/register';
export * from './interfaces';
```

---

#### Task 4.6: VS Code Command Integration (Day 25)

```typescript
// FILE: apps/ptah-extension-vscode/src/commands/generate-templates.command.ts

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { TemplateGeneratorService } from '@ptah-extension/template-generation';
import * as vscode from 'vscode';

@injectable()
export class GenerateTemplatesCommand {
  constructor(@inject(TOKENS.TEMPLATE_GENERATOR_SERVICE) private templateGenerator: TemplateGeneratorService) {}

  async execute(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating AI templates...',
      },
      async () => {
        const result = await this.templateGenerator.generateTemplates(workspaceFolder.uri.fsPath);

        if (result.isErr()) {
          vscode.window.showErrorMessage(`Template generation failed: ${result.error.message}`);
        } else {
          vscode.window.showInformationMessage('✅ CLAUDE.md generated successfully!');
        }
      }
    );
  }
}

// Register in extension.ts
context.subscriptions.push(
  vscode.commands.registerCommand('ptah.generateTemplates', async () => {
    const command = container.resolve(GenerateTemplatesCommand);
    await command.execute();
  })
);
```

---

#### Task 4.7: Write Integration Tests (Day 25)

```typescript
describe('TemplateGeneratorService - Integration', () => {
  it('should generate CLAUDE.md from workspace', async () => {
    const service = container.resolve(TemplateGeneratorService);

    const result = await service.generateTemplates('/path/to/test-workspace');

    expect(result.isOk()).toBe(true);

    // Verify file exists
    const claudeMdPath = path.join('/path/to/test-workspace', 'CLAUDE.md');
    expect(fs.existsSync(claudeMdPath)).toBe(true);

    // Verify content
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('Project Overview');
    expect(content).toContain('Architecture Insights');
  });
});
```

---

### Phase 5: Integration & Polish (Week 4 - Days 26-28)

#### Task 5.1: Update Main Extension DI Container (Day 26)

```typescript
// FILE: apps/ptah-extension-vscode/src/extension.ts

import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';
import { registerTemplateGenerationServices } from '@ptah-extension/template-generation';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';

export async function activate(context: vscode.ExtensionContext) {
  // ... existing setup

  // Register new services
  registerLlmAbstractionServices(container);
  registerTemplateGenerationServices(container);
  registerWorkspaceIntelligenceServices(container); // Re-register with AST services

  // ... rest of activation
}
```

---

#### Task 5.2: Add VS Code Settings Schema (Day 26)

```json
// FILE: apps/ptah-extension-vscode/package.json

{
  "contributes": {
    "configuration": {
      "title": "Ptah LLM Configuration",
      "properties": {
        "ptah.llm.provider": {
          "type": "string",
          "enum": ["anthropic", "openai", "google", "openrouter"],
          "default": "anthropic",
          "description": "LLM provider for internal commands"
        },
        "ptah.llm.anthropic.apiKey": {
          "type": "string",
          "description": "Anthropic API key"
        },
        "ptah.llm.anthropic.model": {
          "type": "string",
          "default": "claude-3-5-sonnet-20241022",
          "description": "Anthropic model name"
        },
        "ptah.llm.openai.apiKey": {
          "type": "string",
          "description": "OpenAI API key"
        },
        "ptah.llm.openai.model": {
          "type": "string",
          "default": "gpt-4-turbo-preview",
          "description": "OpenAI model name"
        }
      }
    }
  }
}
```

---

#### Task 5.3: End-to-End Testing (Day 27)

```typescript
// FILE: apps/ptah-extension-vscode/src/test/integration/roocode-migration.test.ts

describe('RooCode Migration - E2E', () => {
  it('should analyze workspace with AST', async () => {
    const analyzer = container.resolve(WorkspaceAnalyzerService);
    const insights = await analyzer.extractCodeInsights('/path/to/test.ts');

    expect(insights.functions.length).toBeGreaterThan(0);
    expect(insights.classes.length).toBeGreaterThan(0);
  });

  it('should call LLM for structured output', async () => {
    const llmService = container.resolve(LlmService);

    const result = await llmService.getStructuredCompletion('Extract data from: {"name": "test"}', z.object({ name: z.string() }));

    expect(result.isOk()).toBe(true);
    expect(result.value.name).toBe('test');
  });

  it('should generate CLAUDE.md template', async () => {
    const templateGen = container.resolve(TemplateGeneratorService);

    const result = await templateGen.generateTemplates('/test-workspace');

    expect(result.isOk()).toBe(true);
    expect(fs.existsSync('/test-workspace/CLAUDE.md')).toBe(true);
  });
});
```

---

#### Task 5.4: Documentation Updates (Day 28)

````markdown
# FILE: docs/ROOCODE_MIGRATION_COMPLETE.md

# RooCode Migration - Completion Report

## What Was Migrated

### 1. AST Parsing & Code Insights (workspace-intelligence)

- TreeSitterParserService: Parses TypeScript/JavaScript to AST
- AstAnalysisService: LLM-powered code insights extraction
- Integration: WorkspaceAnalyzerService.extractCodeInsights()

### 2. Multi-Provider LLM Abstraction (llm-abstraction)

- LlmService: Main orchestration service
- Providers: Anthropic, OpenAI, Google GenAI, OpenRouter
- ProviderRegistry: Dynamic provider creation
- Result-based error handling

### 3. Template Generation System (template-generation)

- TemplateGeneratorService: Orchestrates template creation
- CLAUDE.md generation from workspace analysis
- AST-based recommendations
- Tech-stack-specific content

## How to Use

### Extract Code Insights

```typescript
const analyzer = container.resolve(WorkspaceAnalyzerService);
const insights = await analyzer.extractCodeInsights('/path/to/file.ts');
console.log(insights.functions); // FunctionInfo[]
console.log(insights.classes); // ClassInfo[]
```
````

### Call LLM for Internal Commands

```typescript
const llmService = container.resolve(LlmService);
const result = await llmService.getStructuredCompletion(prompt, schema);
```

### Generate Templates

```
Command: ptah.generateTemplates
Output: workspace/CLAUDE.md with AI-generated content
```

## Configuration

Add to VS Code settings.json:

```json
{
  "ptah.llm.provider": "anthropic",
  "ptah.llm.anthropic.apiKey": "sk-ant-...",
  "ptah.llm.anthropic.model": "claude-3-5-sonnet-20241022"
}
```

## Testing

```bash
nx test workspace-intelligence  # AST tests
nx test llm-abstraction          # LLM provider tests
nx test template-generation      # Template tests
```

```

---

## Section 6: Code Adaptation Guidelines

### 6.1 DI Container Integration

```

ADAPTATION TYPE: Dependency Injection Conversion
ROOCODE PATTERN: Custom DI with @Injectable() and @Inject('token')
PTAH PATTERN: tsyringe with @injectable() and @inject(TOKENS.\*)

HOW TO ADAPT:

1. Import Changes:
   BEFORE: import { Injectable, Inject } from '../di/decorators';
   AFTER: import { injectable, inject } from 'tsyringe';
   import { TOKENS } from '@ptah-extension/vscode-core';

2. Class Decorator:
   BEFORE: @Injectable()
   AFTER: @injectable()

3. Constructor Injection:
   BEFORE: constructor(@Inject('ILogger') logger: ILogger) {}
   AFTER: constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

4. Interface vs Concrete:
   ROOCODE: Uses interfaces (ILogger, ILLMAgent)
   PTAH: Uses concrete classes (Logger) AND interfaces for services

   RULE: Use concrete for infrastructure (Logger), interfaces for business logic

5. Registration:
   BEFORE: container.register('ILogger', LoggerService, ServiceLifetime.Singleton);
   AFTER: container.registerSingleton(TOKENS.LOGGER, Logger);

````

**Example Migration**:
```typescript
// BEFORE (roocode)
@Injectable()
export class TreeSitterParserService implements ITreeSitterParserService {
  constructor(@Inject('ILogger') logger: ILogger) {
    this.logger = logger;
  }
}

// AFTER (ptah)
@injectable()
export class TreeSitterParserService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.info('TreeSitterParserService initialized');
  }
}
````

---

### 6.2 Error Handling Pattern

```
ADAPTATION TYPE: Error Handling
ROOCODE PATTERN: Result<T, E> type with isOk()/isErr()
PTAH PATTERN: Result<T, E> type (SAME - copy directly)

HOW TO ADAPT:

1. Copy Result class to @ptah-extension/shared/utils
2. Use consistently across all migrated code
3. Never throw errors - always return Result.err()

EXAMPLE:
async parse(content: string): Promise<Result<AST, Error>> {
  try {
    const ast = parser.parse(content);
    return Result.ok(ast);
  } catch (error) {
    return Result.err(new Error(`Parse failed: ${error.message}`));
  }
}

// Caller
const result = await service.parse(code);
if (result.isErr()) {
  logger.error('Parse failed', result.error);
  return;
}
const ast = result.value; // Type-safe!
```

---

### 6.3 Logging Integration

```
ADAPTATION TYPE: Logging
ROOCODE PATTERN: ILogger interface with debug/info/warn/error
PTAH PATTERN: Logger class from @ptah-extension/vscode-core

HOW TO ADAPT:

1. Import:
   BEFORE: import { ILogger } from '../services/logger-service';
   AFTER:  import { Logger } from '@ptah-extension/vscode-core';

2. Usage (NO CHANGES):
   this.logger.debug('Message');
   this.logger.info('Message');
   this.logger.warn('Message');
   this.logger.error('Message', error);

3. Injection:
   BEFORE: @Inject('ILogger') logger: ILogger
   AFTER:  @inject(TOKENS.LOGGER) private readonly logger: Logger
```

---

### 6.4 File System Operations

```
ADAPTATION TYPE: File I/O
ROOCODE PATTERN: IFileOperations interface
PTAH PATTERN: FileSystemService from @ptah-extension/vscode-core

HOW TO ADAPT:

1. Replace IFileOperations with FileSystemService:
   BEFORE: @Inject('IFileOperations') private fileOps: IFileOperations
   AFTER:  @inject(TOKENS.FILE_SYSTEM_SERVICE) private fs: FileSystemService

2. API Differences:
   ROOCODE:               PTAH:
   fileOps.readFile()  →  fs.readFile(vscode.Uri.file(path))
   fileOps.writeFile() →  fs.writeFile(vscode.Uri.file(path), content)
   fileOps.exists()    →  fs.exists(vscode.Uri.file(path))
   fileOps.readDir()   →  fs.readDirectory(vscode.Uri.file(path))

3. Return Types:
   ROOCODE: Result<string, Error>
   PTAH: Promise<string> (throws on error)

   WRAP in try/catch and return Result:
   async readFile(path: string): Promise<Result<string, Error>> {
     try {
       const content = await this.fs.readFile(vscode.Uri.file(path));
       return Result.ok(content);
     } catch (error) {
       return Result.err(error as Error);
     }
   }
```

---

### 6.5 Configuration Access

```
ADAPTATION TYPE: Configuration
ROOCODE PATTERN: Custom config service with .env files
PTAH PATTERN: VS Code Workspace Configuration API

HOW TO ADAPT:

1. Read Settings:
   BEFORE: const apiKey = this.configService.get('ANTHROPIC_API_KEY');
   AFTER:  const config = vscode.workspace.getConfiguration('ptah.llm');
           const apiKey = config.get<string>('anthropic.apiKey');

2. Define Settings Schema:
   Add to package.json:
   {
     "contributes": {
       "configuration": {
         "properties": {
           "ptah.llm.anthropic.apiKey": {
             "type": "string",
             "description": "Anthropic API key"
           }
         }
       }
     }
   }

3. Fallback to Environment Variables:
   const apiKey = config.get<string>('anthropic.apiKey') || process.env.ANTHROPIC_API_KEY;
```

---

### 6.6 Type System Alignment

```
ADAPTATION TYPE: Type Definitions
ROOCODE PATTERN: Interfaces in each module
PTAH PATTERN: Shared types in @ptah-extension/shared, branded types

HOW TO ADAPT:

1. Shared Types → @ptah-extension/shared:
   - Result<T, E>
   - Error types
   - Common interfaces

2. Module-Specific Types → Module's types folder:
   - AST types → workspace-intelligence/src/ast/ast.types.ts
   - LLM types → llm-abstraction/src/interfaces/

3. Branded Types (if needed):
   BEFORE: sessionId: string
   AFTER:  sessionId: SessionId (branded type from @ptah-extension/shared)

   WHY: Compile-time safety prevents mixing IDs

4. Export Strategy:
   - Public API: Export from index.ts
   - Internal: Keep in module, don't export
```

---

### 6.7 Async/Await Patterns

```
ADAPTATION TYPE: Async Operations
ROOCODE PATTERN: async/await with Result type
PTAH PATTERN: SAME (no changes needed)

BEST PRACTICES:

1. Always return Result from async functions:
   async method(): Promise<Result<T, Error>> { }

2. Error Handling:
   try {
     const data = await operation();
     return Result.ok(data);
   } catch (error) {
     this.logger.error('Operation failed', error);
     return Result.err(error as Error);
   }

3. Chain Results:
   const result1 = await service1.method();
   if (result1.isErr()) return Result.err(result1.error);

   const result2 = await service2.method(result1.value);
   if (result2.isErr()) return Result.err(result2.error);

   return Result.ok(result2.value);

4. Use flatMap for chaining:
   return result1.flatMap(val1 =>
     service2.method(val1)
   );
```

---

## Quality Gates

### Before Starting Implementation

- [ ] All roocode files read and analyzed
- [ ] Dependency installation script tested
- [ ] Nx workspace builds successfully
- [ ] Team alignment on phased approach

### After Phase 1 (Foundation)

- [ ] Result type compiles and usable
- [ ] Retry/JSON utils work
- [ ] nx build shared passes
- [ ] All existing ptah tests still pass

### After Phase 2 (AST Parsing)

- [ ] TreeSitterParserService parses TypeScript
- [ ] AstAnalysisService stub returns empty insights
- [ ] WorkspaceAnalyzerService has extractCodeInsights()
- [ ] nx test workspace-intelligence passes (≥80% coverage)
- [ ] No breaking changes to existing APIs

### After Phase 3 (LLM Abstraction)

- [ ] LlmService resolves providers from registry
- [ ] At least 2 providers working (Anthropic + OpenAI)
- [ ] getStructuredCompletion() returns parsed Zod schemas
- [ ] AstAnalysisService integrated with LlmService
- [ ] nx test llm-abstraction passes (≥80% coverage)
- [ ] VS Code settings schema defined

### After Phase 4 (Template Generation)

- [ ] TemplateGeneratorService generates CLAUDE.md
- [ ] Templates include project-specific insights
- [ ] AST insights included in templates
- [ ] ptah.generateTemplates command works
- [ ] nx test template-generation passes (≥80% coverage)

### After Phase 5 (Integration)

- [ ] All 3 new libraries integrated in extension
- [ ] E2E tests pass
- [ ] Documentation complete
- [ ] No regression in existing features
- [ ] Performance acceptable (template generation < 30s)

---

## Risk Mitigation

### High Risks

**Risk 1: Tree-sitter Native Module Issues**

- **Impact**: AST parsing fails on some platforms
- **Mitigation**: Test on Windows, macOS, Linux; provide fallback (regex-based parsing)
- **Contingency**: Ship without AST parsing initially, add in Phase 2.5

**Risk 2: Langchain Version Conflicts**

- **Impact**: Provider integration breaks
- **Mitigation**: Pin exact versions from roocode; test all providers
- **Contingency**: Support only Anthropic initially, add others incrementally

**Risk 3: DI Container Integration Bugs**

- **Impact**: Circular dependencies, services not resolving
- **Mitigation**: Incremental registration, one library at a time
- **Contingency**: Manual service instantiation for problematic services

### Medium Risks

**Risk 4: Token Budget Exceeded in AST Analysis**

- **Impact**: LLM calls fail for large files
- **Mitigation**: Add condensing logic, limit AST depth
- **Contingency**: Analyze only top-level declarations

**Risk 5: Template Generation Slow**

- **Impact**: Poor UX, timeout errors
- **Mitigation**: Background processing, progress indicators
- **Contingency**: Generate templates asynchronously, notify on completion

---

## Success Criteria

### MVP (Minimum Viable Product)

- [ ] AST parsing works for TypeScript files
- [ ] At least 1 LLM provider functional (Anthropic)
- [ ] CLAUDE.md generation produces valid output
- [ ] No breaking changes to existing ptah features
- [ ] 80% test coverage on new code

### Full Success

- [ ] All 4 LLM providers working (Anthropic, OpenAI, Google, OpenRouter)
- [ ] AST analysis produces meaningful code insights
- [ ] Templates include actionable recommendations
- [ ] Performance: CLAUDE.md generation < 15s for medium projects
- [ ] User feedback: 4/5 stars on template quality

---

## Appendix A: File Mapping Reference

### Quick Reference Table

| RooCode Source                  | Ptah Target                                                  | Complexity | Dependencies                  |
| ------------------------------- | ------------------------------------------------------------ | ---------- | ----------------------------- |
| `result.ts`                     | `shared/utils/result.ts`                                     | LOW        | None                          |
| `tree-sitter-parser.service.ts` | `workspace-intelligence/ast/tree-sitter-parser.service.ts`   | MEDIUM     | tree-sitter, Logger           |
| `ast-analysis.service.ts`       | `workspace-intelligence/ast/ast-analysis.service.ts`         | HIGH       | LlmService, Zod               |
| `llm-agent.ts`                  | `llm-abstraction/services/llm.service.ts`                    | HIGH       | ProviderRegistry, Logger      |
| `anthropic-provider.ts`         | `llm-abstraction/providers/anthropic.provider.ts`            | MEDIUM     | @langchain/anthropic          |
| `memory-bank-service.ts`        | `template-generation/services/template-generator.service.ts` | HIGH       | WorkspaceAnalyzer, LlmService |

### Total File Count

- **Core Foundation**: 3 files (Result, retry, JSON utils)
- **AST Module**: 6 files (parser, analyzer, types, interfaces, config, tests)
- **LLM Abstraction**: 15 files (service, 4 providers, registry, base, interfaces, errors, tests)
- **Template Generation**: 12 files (6 services, 6 interfaces)

**TOTAL**: ~36 files to migrate/adapt

---

## Appendix B: Testing Strategy

### Unit Tests

**Coverage Target**: 80% minimum

**Key Test Suites**:

1. `tree-sitter-parser.service.spec.ts` - AST parsing
2. `ast-analysis.service.spec.ts` - LLM-powered insights
3. `llm.service.spec.ts` - Provider orchestration
4. `anthropic.provider.spec.ts` - Anthropic integration
5. `template-generator.service.spec.ts` - Template generation

### Integration Tests

**Test Scenarios**:

1. End-to-end: Workspace analysis → AST → LLM → CLAUDE.md
2. Provider switching: Anthropic → OpenAI
3. Error handling: Invalid API key, network timeout
4. Large files: 10k+ line TypeScript file

### Manual Testing Checklist

- [ ] Parse real TypeScript project (e.g., ptah-extension itself)
- [ ] Generate CLAUDE.md for different project types (React, Node.js, Angular)
- [ ] Test all 4 LLM providers with real API keys
- [ ] Verify VS Code settings integration
- [ ] Test error scenarios (no API key, invalid model, network failure)

---

## Appendix C: Troubleshooting Guide

### Tree-sitter Issues

**Problem**: `require('tree-sitter')` fails
**Solution**: Ensure native modules are compiled for your platform

```bash
cd node_modules/tree-sitter
npm rebuild
```

**Problem**: "Grammar not found" error
**Solution**: Verify language modules installed

```bash
npm list tree-sitter-typescript tree-sitter-javascript
```

### Langchain Provider Issues

**Problem**: "API key not found"
**Solution**: Check VS Code settings or environment variables

```json
{
  "ptah.llm.anthropic.apiKey": "sk-ant-..."
}
```

**Problem**: "Rate limit exceeded"
**Solution**: Implement retry logic with exponential backoff (already in retry.utils.ts)

### DI Container Issues

**Problem**: "Service not registered"
**Solution**: Ensure registration function called in extension.ts

```typescript
registerLlmAbstractionServices(container);
```

**Problem**: Circular dependency error
**Solution**: Use factory pattern or lazy initialization

```typescript
container.register(TOKENS.SERVICE, { useFactory: () => new Service() });
```

---

## Next Steps

1. **Review this document** with team
2. **Allocate resources**: 1 developer, 3-4 weeks full-time
3. **Set up tracking**: Create TASK_2025_0XX for each phase
4. **Begin Phase 1**: Install dependencies and copy Result type
5. **Daily standups**: Track progress, blockers
6. **Weekly demos**: Show working functionality to stakeholders

---

**Document Prepared By**: Claude Code (Software Architect Agent)
**Review Status**: READY FOR IMPLEMENTATION
**Estimated Total Effort**: 20-25 developer days (3-4 weeks)
**Risk Level**: MEDIUM-HIGH (new libraries, Langchain integration, native modules)
**Recommended Approach**: PHASED (incremental, with validation gates)

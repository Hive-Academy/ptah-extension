# Code Quality Review Command

**Agent Integration**: This command is executed by the code-reviewer agent as Phase 1 of the systematic triple review protocol.

**Purpose**: Universal code quality assessment that adapts to the detected technology stack and applies relevant best practices.

**Scoring**: This command contributes 40% weight to the overall review decision.

## Phase 1: Technology Stack Discovery

**Before reviewing code quality, analyze the codebase to understand:**

1. **Primary Language & Framework Detection**:

   - Examine package.json, requirements.txt, go.mod, Cargo.toml, etc.
   - Identify main dependencies and frameworks
   - Analyze file extensions and project structure
   - Detect import/require patterns

2. **Project Architecture Analysis**:
   - Monorepo vs single repo structure
   - Module organization patterns
   - Build system and tooling
   - Testing framework in use

## Phase 2: Universal Code Quality Principles

Apply these language-agnostic principles regardless of technology stack:

### 1. Type Safety & Data Integrity

- **Typed Languages**: Comprehensive type definitions, avoid escape hatches (any, Object, etc.)
- **Dynamic Languages**: Runtime validation, schema definitions, proper error handling
- **All Languages**: Input validation, data sanitization, proper null/undefined handling

### 2. Single Responsibility Principle

- Each class/function/module has one clear responsibility
- Avoid god objects and functions doing too many things
- Clear separation of concerns across architectural layers

### 3. KISS Principle (Keep It Simple)

- Avoid unnecessary complexity and over-engineering
- Prefer readable code over clever solutions
- Clear, descriptive naming conventions
- Avoid deeply nested conditional logic

### 4. DRY Principle (Don't Repeat Yourself)

- Identify code duplication and repeated patterns
- Extract common functionality to reusable utilities
- Abstract shared business logic appropriately
- Avoid copy-paste programming

### 5. Error Handling & Resilience

- Comprehensive error handling strategies
- Proper exception/error propagation
- Graceful degradation patterns
- Appropriate logging and monitoring hooks

### 6. Code Organization & Maintainability

- Consistent file and folder structure
- Clear module boundaries and dependencies
- Proper separation of configuration from logic
- Self-documenting code with minimal but effective comments

## Phase 3: Framework-Specific Best Practices

**Dynamically apply based on detected stack:**

### Frontend Architecture Patterns

- **Component Architecture**: Component composition, lifecycle management, state management patterns, performance optimization
- **Reactive Patterns**: State reactivity, change detection strategies, data binding patterns
- **Dependency Management**: Service injection, module organization, component communication
- **State Management**: Store patterns, data flow, reactivity declarations

### Backend Architecture Patterns

- **Request Processing**: Middleware patterns, async/await usage, error handling middleware
- **Service Architecture**: Decorator usage, module organization, dependency injection, guards/interceptors
- **Data Layer**: Model design, repository patterns, ORM best practices
- **API Design**: Request handling, dependency injection, async patterns, data validation
- **Enterprise Patterns**: Annotation usage, bean management, AOP patterns

### Database & ORM Patterns

- **TypeORM/Prisma**: Entity relationships, migration patterns, query optimization
- **SQLAlchemy**: Session management, relationship definitions, query construction
- **Mongoose**: Schema design, middleware hooks, population patterns
- **Sequelize**: Model associations, transaction handling, validation patterns

### Language-Specific Patterns

- **TypeScript**: Advanced type usage, generic constraints, utility types
- **Python**: PEP compliance, async/await patterns, context managers, decorators
- **JavaScript**: Module patterns, promise handling, functional programming concepts
- **Go**: Interface design, error handling, goroutine patterns, package organization
- **Rust**: Ownership patterns, error handling, trait implementations
- **Java**: SOLID principles, design patterns, exception handling, generics usage

## Review Process

### Step 1: Codebase Analysis

```markdown
## Technology Stack Analysis

**Primary Language**: [detected language]
**Framework/Platform**: [detected framework]
**Architecture Pattern**: [detected pattern - MVC, microservices, etc.]
**Dependencies**: [key dependencies identified]
**Build System**: [webpack, vite, gradle, etc.]
```

### Step 2: Universal Quality Assessment

For each file, evaluate:

- Type safety and data validation approaches
- Function/class size and complexity
- Code duplication and abstraction opportunities
- Error handling completeness
- Naming conventions and code clarity

### Step 3: Stack-Specific Evaluation

Apply framework-specific best practices based on detected technology:

- Framework-specific anti-patterns
- Performance considerations for the stack
- Security patterns relevant to the technology
- Testing patterns and coverage expectations

## Feedback Format

For each issue found, provide:

- **Location**: Specific file and line numbers
- **Problem**: Clear explanation of the issue
- **Context**: Why this matters for the detected technology stack
- **Solution**: Framework-appropriate recommended fix
- **Impact**: How this affects maintainability, performance, or security

## Scoring Guidelines

**Score Range**: 1-10 (contributes 40% to overall review score)

- **9-10**: Excellent - Exemplary adherence to both universal principles and framework best practices
- **8-8.9**: Very Good - Strong code quality with minor framework-specific improvements needed
- **7-7.9**: Good - Solid universal principles, some framework best practices could be improved
- **6-6.9**: Needs Improvement - Several quality issues, framework patterns not well followed
- **5-5.9**: Poor - Multiple critical issues, significant deviation from best practices
- **1-4.9**: Unacceptable - Major problems requiring extensive rework

## Required Output Format

````markdown
## 🔍 CODE QUALITY REVIEW RESULTS

**Technology Stack**: [Primary language/framework detected]
**Score**: [X/10]
**Weight**: 40%
**Files Analyzed**: [X files]

### 📋 Stack Analysis

- **Primary Language**: [language]
- **Framework/Platform**: [framework]
- **Architecture**: [detected pattern]
- **Key Technologies**: [list of major dependencies]

### ✅ Strengths Found

- [Specific examples with file:line references]
- [Framework-specific good practices identified]

### ⚠️ Issues Identified

**Issue [N]: [Issue Type]**

- **Location**: `file.ext:line`
- **Problem**: [Specific issue description]
- **Framework Context**: [Why this matters for detected stack]
- **Impact**: [Effect on maintainability/performance/security]
- **Solution**:

```[language]
// Current (problematic)
[current code]

// Recommended ([framework] best practice)
[improved code]
```
````

- **Why**: [Explanation tailored to detected technology]

### 📊 Quality Metrics

- **Type Safety**: [X/10] - [Language-specific assessment]
- **Single Responsibility**: [X/10]
- **KISS Principle**: [X/10]
- **DRY Principle**: [X/10]
- **Framework Adherence**: [X/10] - [Stack-specific patterns]
- **Error Handling**: [X/10]
- **Code Organization**: [X/10]

### 🎯 Framework-Specific Recommendations

- [Recommendations specific to detected technology stack]
- [Performance optimizations relevant to the framework]
- [Security considerations for the platform]

```

## Adaptive File Targeting

**Instead of hardcoded file patterns, dynamically target based on project structure:**

- **Web Projects**: Components, services, utilities, configuration files
- **API Projects**: Controllers, models, middleware, routing files
- **Library Projects**: Core modules, interfaces, utility functions
- **CLI Projects**: Command handlers, configuration, core logic
- **Desktop Apps**: Main processes, renderers, native modules

**File Discovery Strategy**:
1. Analyze git diff for changed files
2. Identify file types based on extensions and content
3. Focus review on business logic and architectural components
4. Include configuration files that affect code quality (tsconfig, eslint, etc.)
```

# Business Logic Review Command

**Agent Integration**: This command is executed by the code-reviewer agent as Phase 2 of the systematic triple review protocol.

**Purpose**: Universal business logic evaluation that identifies dummy data, placeholders, hardcoded implementations, and technical debt regardless of technology stack.

**Scoring**: This command contributes 35% weight to the overall review decision.

## Phase 1: Business Context Analysis

**Before reviewing business logic, understand the project context:**

1. **Project Domain Analysis**:

   - Analyze README, documentation, and project structure
   - Identify core business entities and workflows
   - Understand the intended user experience and value proposition
   - Determine if this is a library, application, service, or tool

2. **Implementation Stage Assessment**:
   - Development phase (MVP, feature development, production-ready)
   - Deployment environment (local, staging, production)
   - Integration requirements with external services
   - Data persistence and state management needs

## Phase 2: Universal Business Logic Principles

Apply these framework-agnostic principles to evaluate business value:

### 1. Dummy Data & Placeholder Detection

**Identify production-inappropriate content:**

- Hardcoded test values, sample data, or mock responses
- Placeholder text (Lorem ipsum, "TODO", "FIXME", generic names)
- Development-only configuration leaking into production logic
- Commented-out business logic or temporary workarounds
- Sample/default credentials or API keys

### 2. Hardcoded Implementation Patterns

**Find overly rigid or inflexible code:**

- Business rules embedded directly in presentation logic
- Magic numbers and strings without configuration options
- Hardcoded file paths, URLs, or endpoint configurations
- Fixed assumptions about data formats or external service responses
- Non-configurable business workflows or validation rules

### 3. Business Value Alignment

**Evaluate implementation against intended purpose:**

- Core functionality completeness relative to stated requirements
- User experience considerations and edge case handling
- Performance characteristics appropriate for expected usage
- Scalability considerations for anticipated growth
- Integration patterns suitable for the business domain

### 4. Technical Debt & Shortcuts

**Identify maintenance and scalability risks:**

- TODO items without clear ownership or timelines
- Temporary solutions that should be permanent implementations
- Copy-pasted business logic that should be abstracted
- Missing error handling for critical business operations
- Insufficient logging or monitoring for business-critical paths

### 5. Data Integrity & Business Rules

**Ensure business logic robustness:**

- Input validation appropriate for business context
- Business rule enforcement at appropriate architectural layers
- Data consistency and transaction boundary considerations
- Audit trail and change tracking for critical business data
- Appropriate handling of business exceptions and edge cases

## Phase 3: Domain-Specific Evaluation

**Adapt analysis based on detected project domain:**

### E-commerce/Marketplace

- Payment processing logic, order management, inventory tracking
- User authentication and authorization for different roles
- Product catalog management and search functionality
- Shopping cart persistence and checkout flow logic

### Content Management/Publishing

- Content creation, editing, and publication workflows
- User-generated content moderation and management
- SEO optimization and content discoverability
- Multi-language and localization support

### SaaS/Business Applications

- Multi-tenancy and data isolation patterns
- Subscription and billing logic implementation
- Feature flagging and role-based access control
- Integration with third-party business services

### API/Integration Services

- Data transformation and validation logic
- External service integration patterns and error handling
- Rate limiting and usage tracking implementation
- Webhook and event-driven architecture patterns

### Data Processing/Analytics

- ETL pipeline logic and data transformation rules
- Batch processing and real-time processing patterns
- Data quality validation and error recovery
- Reporting and aggregation logic implementation

## Review Process

### Step 1: Domain Context Analysis

```markdown
## Business Context Analysis

**Project Domain**: [e-commerce, content management, API service, etc.]
**Primary Business Entities**: [User, Product, Order, etc.]
**Core Workflows**: [authentication, checkout, content publishing, etc.]
**Implementation Stage**: [MVP, feature development, production-ready]
**External Dependencies**: [payment processors, APIs, databases, etc.]
```

### Step 2: Business Logic Assessment

For each file containing business logic:

- Identify core business operations and their implementations
- Check for placeholder data or temporary implementations
- Evaluate business rule enforcement and validation
- Assess error handling for business-critical operations
- Review configuration management and flexibility

### Step 3: Production Readiness Evaluation

- Verify all dummy data has been replaced with real implementations
- Confirm business rules are properly configurable
- Check logging and monitoring coverage for business operations
- Validate error handling and recovery mechanisms
- Assess scalability and performance characteristics

## Required Analysis Areas

### 1. Configuration Management

- Environment-specific settings properly externalized
- Business rules configurable without code changes
- Feature flags and A/B testing capabilities where appropriate
- API endpoints and integration configurations externalized

### 2. Business Rule Implementation

- Validation logic appropriate for business context
- Business rules enforced at correct architectural boundaries
- Error messages and user feedback appropriate for business domain
- Audit trails and change tracking for critical operations

### 3. Data Management

- Business entity relationships properly modeled
- Data validation appropriate for business requirements
- Transaction boundaries aligned with business operations
- Data migration and schema evolution considerations

### 4. Integration Patterns

- External service integration appropriate for business needs
- Error handling and retry logic for business-critical integrations
- Data synchronization patterns suitable for business requirements
- API design aligned with business domain concepts

## Subtask Generation Protocol

**For each business logic issue identified, generate actionable subtasks:**

### High Priority Subtasks (Blocking Production)

- Replace dummy data with real business logic implementations
- Remove hardcoded configuration that prevents environment flexibility
- Implement missing error handling for critical business operations
- Fix business rule violations or incomplete implementations

### Medium Priority Subtasks (Improve Business Value)

- Extract hardcoded business rules to configurable systems
- Implement missing edge case handling for business operations
- Add appropriate logging and monitoring for business metrics
- Refactor duplicated business logic into reusable components

### Low Priority Subtasks (Technical Debt)

- Document business logic and decision rationale
- Add comprehensive testing for business rule edge cases
- Optimize performance for business-critical operations
- Improve error messages and user experience feedback

## Scoring Guidelines

**Score Range**: 1-10 (contributes 35% to overall review score)

- **9-10**: Production Ready - All business logic complete, no dummy data, flexible and configurable
- **8-8.9**: Near Production Ready - Minor configuration or edge case improvements needed
- **7-7.9**: Feature Complete - Core business logic solid, some flexibility improvements needed
- **6-6.9**: Functional - Basic business requirements met, significant improvements needed
- **5-5.9**: Incomplete - Major business logic gaps or extensive dummy data present
- **1-4.9**: Not Viable - Core business functionality missing or severely compromised

## Required Output Format

```markdown
## 🧠 BUSINESS LOGIC REVIEW RESULTS

**Project Domain**: [Detected business domain]
**Score**: [X/10]
**Weight**: 35%
**Files Analyzed**: [X files]

### 📋 Business Context Analysis

- **Domain**: [business domain]
- **Core Entities**: [main business objects]
- **Primary Workflows**: [key business processes]
- **Implementation Stage**: [development phase]
- **Business Dependencies**: [external services, APIs]

### ✅ Business Value Delivered

- [Specific business requirements fulfilled]
- [Core workflows properly implemented]
- [Business rules correctly enforced]

### ⚠️ Business Logic Issues

**Issue [N]: [Issue Type - Dummy Data/Hardcoded Logic/Technical Debt]**

- **Location**: `file.ext:line`
- **Finding**: [Specific business logic issue]
- **Business Impact**: [Impact on production readiness/user experience/scalability]
- **Domain Context**: [Why this matters for the specific business domain]
- **Action Required**: [Specific implementation needed]
- **Priority**: [High/Medium/Low]
- **Effort Estimate**: [Time/complexity estimate]

### 📝 Generated Subtasks

#### High Priority (Must Fix Before Production)

1. **[Task Title]** (High Priority - [X]h)
   - [Detailed description of business logic to implement]
   - [Specific requirements and acceptance criteria]
   - [Business impact of completing this task]

#### Medium Priority (Business Value Enhancement)

2. **[Task Title]** (Medium Priority - [X]h)
   - [Configuration or flexibility improvement needed]
   - [Business benefit of the enhancement]

#### Low Priority (Technical Debt)

3. **[Task Title]** (Low Priority - [X]h)
   - [Code quality or documentation improvement]
   - [Long-term maintenance benefit]

### 📊 Business Logic Metrics

- **Implementation Completeness**: [X/10] - [Core business features present]
- **Configuration Flexibility**: [X/10] - [Adaptability to different environments]
- **Business Rule Enforcement**: [X/10] - [Validation and rule compliance]
- **Error Handling**: [X/10] - [Business operation resilience]
- **Integration Quality**: [X/10] - [External service integration patterns]
- **Production Readiness**: [X/10] - [Deployment and operational readiness]

### 🎯 Domain-Specific Recommendations

- [Recommendations specific to detected business domain]
- [Business process optimizations]
- [Integration improvements for the domain]
- [Scalability considerations for expected business growth]

### 🚀 Production Deployment Assessment

- **Ready for Production**: [YES/NO/PARTIAL]
- **Blocking Issues**: [X items requiring immediate attention]
- **Business Risk Level**: [LOW/MEDIUM/HIGH]
- **Recommended Timeline**: [When this can safely be deployed]
```

## Adaptive Domain Detection

**Instead of assuming specific business contexts, dynamically identify:**

1. **Domain Indicators**:

   - Database schema and entity relationships
   - API endpoint patterns and naming conventions
   - Configuration files and environment variables
   - Third-party service integrations
   - User interface patterns and workflows

2. **Business Logic Patterns**:

   - Payment processing implementations
   - User authentication and authorization flows
   - Content management and publishing workflows
   - Data processing and transformation logic
   - Notification and communication patterns

3. **Integration Requirements**:
   - External API dependencies
   - Database interaction patterns
   - File storage and media handling
   - Email and communication services
   - Analytics and monitoring integrations

# Security Review Command

**Agent Integration**: This command is executed by the code-reviewer agent as Phase 3 of the systematic triple review protocol.

**Purpose**: Universal security vulnerability assessment that identifies potential security issues across any technology stack and deployment environment.

**Scoring**: This command contributes 25% weight to the overall review decision.

## Phase 1: Security Context Analysis

**Before reviewing security, understand the threat landscape:**

1. **Application Type & Attack Surface**:

   - Web application, API service, desktop app, mobile app, or library
   - Public-facing vs internal/private deployment
   - Authentication requirements and user data handling
   - Integration with external services and data sources

2. **Technology Stack Security Profile**:
   - Language-specific security considerations
   - Framework-specific vulnerability patterns
   - Database and storage security requirements
   - Deployment environment and infrastructure security

## Phase 2: Universal Security Principles

Apply these technology-agnostic security assessments:

### 1. Credential & Secret Management

**Critical security exposures to identify:**

- Hardcoded API keys, passwords, tokens, or certificates
- Database connection strings with embedded credentials
- Cloud service keys and access tokens in source code
- Encryption keys or salts stored in plain text
- Development/test credentials used in production code
- Default passwords or well-known secret values

### 2. Input Validation & Sanitization

**Data integrity and injection prevention:**

- SQL injection vulnerabilities in database queries
- Cross-site scripting (XSS) risks in user input handling
- Command injection through system calls or shell execution
- Path traversal vulnerabilities in file operations
- Deserialization of untrusted data
- Regular expression denial of service (ReDoS) vulnerabilities

### 3. Authentication & Authorization

**Access control security assessment:**

- Authentication bypass opportunities
- Session management vulnerabilities
- Privilege escalation possibilities
- JWT token security (if applicable)
- Password storage and hashing practices
- Multi-factor authentication implementation gaps

### 4. Data Protection & Privacy

**Sensitive information handling:**

- Personal data exposure in logs or error messages
- Sensitive data transmission without encryption
- Improper data storage or caching of sensitive information
- Data leakage through API responses or debugging information
- Inadequate data retention and deletion practices
- Cross-tenant data access in multi-tenant applications

### 5. Network Security & Communications

**Transmission and communication security:**

- Unencrypted communications (HTTP instead of HTTPS)
- Certificate validation bypassing
- Insecure TLS/SSL configuration
- CORS misconfiguration allowing unauthorized origins
- Missing security headers (HSTS, CSP, X-Frame-Options)
- WebSocket security considerations

### 6. Business Logic Security

**Application-specific security flaws:**

- Race condition vulnerabilities in critical operations
- Business rule bypasses through parameter manipulation
- Insufficient rate limiting on sensitive operations
- Time-of-check vs time-of-use vulnerabilities
- State manipulation vulnerabilities
- Logic flaws that could lead to privilege escalation

## Phase 3: Technology-Specific Security Patterns

**Adapt security analysis based on detected technology stack:**

### Web Applications

- **Frontend**: XSS prevention, Content Security Policy, secure cookie handling
- **Backend**: CSRF protection, request validation, secure session management
- **API**: Rate limiting, input validation, response data filtering

### Database Security

- **SQL Databases**: Parameterized queries, least privilege access, encryption at rest
- **NoSQL Databases**: Injection prevention, access control, data validation
- **ORM Security**: Proper query construction, relationship security, mass assignment protection

### Cloud & Container Security

- **AWS/GCP/Azure**: IAM configuration, resource access controls, encryption settings
- **Docker/Kubernetes**: Container security, secrets management, network policies
- **Serverless**: Function permissions, environment variable security, execution context

### Mobile & Desktop Applications

- **Mobile**: Certificate pinning, local data encryption, API security
- **Desktop**: File system permissions, inter-process communication, update security
- **Electron/Web**: Context isolation, CSP implementation, secure IPC

### Language-Specific Security

- **JavaScript/Node.js**: Prototype pollution, dependency vulnerabilities, eval() usage
- **Python**: Pickle/deserialization, SQL injection, code injection
- **Java**: Deserialization vulnerabilities, XXE, path traversal
- **Go**: SQL injection, path traversal, goroutine security
- **Rust**: Unsafe code blocks, memory safety, concurrency issues

## Security Assessment Process

### Step 1: Threat Modeling

```markdown
## Security Threat Analysis

**Application Type**: [web app, API, desktop, mobile, library]
**Attack Surface**: [public, internal, hybrid]
**Sensitive Data Types**: [PII, financial, health, proprietary]
**Authentication Requirements**: [none, basic, enterprise, SSO]
**Compliance Requirements**: [GDPR, HIPAA, SOX, PCI-DSS]
```

### Step 2: Vulnerability Scanning

For each file and configuration:

- Scan for hardcoded secrets and credentials
- Analyze input handling and validation patterns
- Review authentication and authorization logic
- Check data handling and storage practices
- Evaluate external service integrations

### Step 3: Security Control Assessment

- Verify implementation of required security controls
- Check for security best practices adoption
- Assess defense-in-depth implementation
- Evaluate incident response and logging capabilities
- Review security testing and validation practices

## Critical Vulnerability Categories

### CRITICAL (Immediate Fix Required)

- Hardcoded production credentials or API keys
- SQL injection vulnerabilities
- Authentication bypass opportunities
- Remote code execution possibilities
- Sensitive data exposure in logs or responses

### HIGH (Fix Before Production)

- XSS vulnerabilities
- Privilege escalation opportunities
- Insecure direct object references
- Missing input validation on critical operations
- Insecure cryptographic implementations

### MEDIUM (Address in Security Sprint)

- Missing security headers
- Insufficient logging of security events
- Weak session management
- CORS misconfigurations
- Rate limiting gaps

### LOW (Security Hardening)

- Information disclosure in error messages
- Missing security documentation
- Suboptimal cryptographic choices
- Dependency vulnerabilities with low risk
- Security testing coverage gaps

## Scoring Guidelines

**Score Range**: 1-10 (contributes 25% to overall review score)

- **9-10**: Excellent - No critical vulnerabilities, comprehensive security controls implemented
- **8-8.9**: Very Good - Minor security improvements needed, solid security posture
- **7-7.9**: Good - Some security gaps but no critical issues, acceptable for production
- **6-6.9**: Needs Improvement - Several security issues requiring attention
- **5-5.9**: Poor - Multiple security vulnerabilities present, risky for production
- **1-4.9**: Critical - Severe security vulnerabilities, immediate remediation required

## Required Output Format

````markdown
## 🔒 SECURITY REVIEW RESULTS

**Application Type**: [Detected application type and attack surface]
**Score**: [X/10]
**Weight**: 25%
**Files Analyzed**: [X files]

### 📋 Security Context Analysis

- **Application Type**: [web app, API, desktop, etc.]
- **Attack Surface**: [public-facing, internal, hybrid]
- **Technology Stack**: [primary technologies and frameworks]
- **Data Sensitivity**: [types of sensitive data handled]
- **Compliance Requirements**: [regulatory requirements if applicable]

### ✅ Security Strengths

- [Implemented security controls and best practices]
- [Proper security patterns identified]
- [Good security design decisions]

### 🚨 Security Vulnerabilities

**CRITICAL Issue [N]: [Vulnerability Type]**

- **Location**: `file.ext:line`
- **Vulnerability**: [Specific security issue description]
- **Severity**: CRITICAL
- **Risk**: [Potential impact and attack vector]
- **Exploit Scenario**: [How an attacker could exploit this]
- **Remediation**:

```[language]
// Current (vulnerable)
[vulnerable code example]

// Secure implementation
[secure code example]
```
````

- **Verification**: [How to verify the fix works]

**HIGH Issue [N]: [Vulnerability Type]**

- **Location**: `file.ext:line`
- **Vulnerability**: [Security issue description]
- **Severity**: HIGH
- **Risk**: [Impact assessment]
- **Remediation**: [Specific fix instructions]

**MEDIUM/LOW Issues**: [Summary of lower-severity findings]

### 🛡️ Security Recommendations

#### Immediate Actions (Critical/High)

- [Critical security fixes required before production]
- [High-priority security improvements]

#### Security Hardening (Medium/Low)

- [Security improvements to implement]
- [Best practices to adopt]
- [Preventive measures to implement]

#### Security Testing & Monitoring

- [Security testing recommendations]
- [Monitoring and alerting suggestions]
- [Incident response preparations]

### 📊 Security Metrics

- **Credential Security**: [X/10] - [Secret management assessment]
- **Input Validation**: [X/10] - [Data handling security]
- **Authentication/Authorization**: [X/10] - [Access control security]
- **Data Protection**: [X/10] - [Sensitive data handling]
- **Network Security**: [X/10] - [Communication security]
- **Business Logic Security**: [X/10] - [Application-specific security]

### 🎯 Technology-Specific Security Considerations

- [Security recommendations specific to detected technology stack]
- [Framework-specific security best practices]
- [Deployment environment security considerations]

### 🚀 Production Security Readiness

- **Safe for Production**: [YES/NO/WITH FIXES]
- **Critical Issues**: [X issues blocking deployment]
- **Security Risk Level**: [MINIMAL/LOW/MEDIUM/HIGH/CRITICAL]
- **Recommended Actions**: [Next steps for security improvement]

```

## Adaptive Security Assessment

**Instead of generic security checks, dynamically adapt based on:**

1. **Application Architecture**:
   - Monolithic vs microservices security patterns
   - Client-server vs serverless security considerations
   - Database-centric vs API-first security requirements

2. **Data Classification**:
   - Public data vs sensitive personal information
   - Financial data vs healthcare information
   - Proprietary business data vs public content

3. **Deployment Context**:
   - Cloud vs on-premises security requirements
   - Container vs traditional deployment security
   - Development vs staging vs production environment risks

4. **Compliance & Regulatory Requirements**:
   - GDPR privacy requirements
   - HIPAA healthcare data protection
   - PCI-DSS payment processing security
   - SOX financial reporting controls

5. **Integration Complexity**:
   - Third-party API security requirements
   - Single sign-on implementation security
   - External data source access security
   - Inter-service communication security

## Security Testing Integration

**Recommend appropriate security testing approaches:**

- **Static Analysis**: Code scanning for vulnerability patterns
- **Dynamic Analysis**: Runtime security testing and fuzzing
- **Interactive Analysis**: Combination of static and dynamic testing
- **Dependency Scanning**: Third-party library vulnerability assessment
- **Infrastructure Scanning**: Configuration and deployment security
- **Penetration Testing**: Manual security assessment for critical applications
```

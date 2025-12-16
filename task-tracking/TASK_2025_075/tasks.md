# Development Tasks - TASK_2025_075: Simplified License Server (No Payments)

**Total Tasks**: 28 | **Batches**: 6 | **Status**: 0/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- VS Code SecretStorage API exists and provides encrypted storage: ✅ Verified (standard VS Code API)
- TSyringe DI pattern compatible with event-driven conditional registration: ✅ Verified (existing codebase uses this pattern)
- NestJS auth module exists and can be extended: ✅ Verified (auth.module.ts, ticket.service.ts exist)
- Prisma 7.1.0 driver adapters compatible with Nx monorepo: ✅ Verified (recommended in requirements)

### Risks Identified

| Risk                                       | Severity | Mitigation                                                                |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| Email delivery failure (SendGrid)          | HIGH     | Task 3.4 includes retry logic, graceful degradation, logging              |
| Extension activation flow modification     | MEDIUM   | Task 6.1 isolates license check as new step, existing flow untouched      |
| Dynamic MCP registration complexity        | MEDIUM   | Task 6.2 uses event-driven pattern (license:verified), requires reload UI |
| In-memory magic link storage (single-node) | LOW      | Documented limitation, Redis migration path defined for future            |

### Edge Cases to Handle

- [ ] Free user enters invalid license key → Task 6.3 handles with clear error message
- [ ] License expires while extension running → Task 6.2 emits license:expired event, shows warning
- [ ] Network failure during verification → Task 5.1 caches for 1 hour, graceful fallback to cached status
- [ ] Email send fails but license created → Task 3.4 returns `emailSent: false`, admin can manually resend

---

## Batch 1: Database Schema & Configuration 🔄 IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Install Prisma Dependencies 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\package.json` (MODIFY)
**Spec Reference**: implementation-plan.md (Component A1, lines 286-331)

**Implementation Requirements**:

- Add Prisma 7.1.0 with driver adapters (NO Rust binary for monorepo compatibility)
- Install `@prisma/client@7.1.0`, `@prisma/adapter-pg@7.1.0`, `pg@8.11.0`
- Add to devDependencies: `prisma@7.1.0`, `@types/pg@^8.11.0`

**Dependencies to Install**:

```json
{
  "dependencies": {
    "@prisma/client": "7.1.0",
    "@prisma/adapter-pg": "7.1.0",
    "pg": "8.11.0"
  },
  "devDependencies": {
    "prisma": "7.1.0",
    "@types/pg": "^8.11.0"
  }
}
```

**Quality Requirements**:

- Must use exact versions specified (monorepo compatibility)
- Must NOT use Prisma binary adapter (causes Nx build issues)
- Must pass: `npm install` without errors

**Verification**:

```bash
cd D:\projects\ptah-extension\apps\ptah-license-server
npm install
node -e "console.log(require('@prisma/client/package.json').version)"
```

---

### Task 1.2: Create Prisma Schema 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma` (CREATE)
**Spec Reference**: implementation-plan.md (Component A1, lines 292-331)
**Dependencies**: Task 1.1

**Implementation Requirements**:

- Define datasource with PostgreSQL provider and `DATABASE_URL` env variable
- Define generator with `previewFeatures = ["driverAdapters"]`
- Create `User` model: id (UUID), email (unique), createdAt
- Create `License` model: id, userId (FK), licenseKey (unique), plan, status, expiresAt, createdAt, createdBy
- Add indexes: licenseKey (unique), userId, [status, expiresAt]
- Use snake_case column names (PostgreSQL convention)
- Add CASCADE DELETE on userId foreign key

**Validation Notes**:

- License key format enforced at application level: `ptah_lic_{64-hex}`
- Plan values: "free" | "early_adopter" (validated in DTO, not DB constraint)
- Status values: "active" | "expired" | "revoked" (validated in DTO)

**Quality Requirements**:

- Schema must support UUIDs as primary keys (security)
- All indexes must be properly defined for query performance
- Foreign key relationships must have proper CASCADE behavior
- Must pass: `npx prisma validate`

**Verification**:

```bash
cd D:\projects\ptah-extension\apps\ptah-license-server
npx prisma validate
```

---

### Task 1.3: Run Prisma Migration 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\` (CREATE - generated)
**Spec Reference**: implementation-plan.md (Component A1, line 351)
**Dependencies**: Task 1.2

**Implementation Requirements**:

- Run `npx prisma migrate dev --name init` to create initial migration
- Migration should create `users` and `licenses` tables
- Migration should create all indexes: `licenses_license_key_key`, `licenses_userId_idx`, `licenses_status_expiresAt_idx`
- Verify migration SQL creates proper CASCADE DELETE constraints

**Validation Notes**:

- Requires DATABASE_URL in .env file (ask user to provide if missing)
- Migration files are auto-generated but must be reviewed
- If migration fails, check PostgreSQL connection and credentials

**Quality Requirements**:

- Migration must complete without errors
- Database tables must match schema exactly
- Must pass: `npx prisma migrate status`

**Verification**:

```bash
cd D:\projects\ptah-extension\apps\ptah-license-server
npx prisma migrate status
npx prisma db pull  # Verify schema matches
```

---

### Task 1.4: Create PrismaService Wrapper 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\prisma\prisma.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A1, line 352)
**Pattern to Follow**: Standard NestJS Prisma integration pattern
**Dependencies**: Task 1.3

**Implementation Requirements**:

- Create NestJS @Injectable() service extending PrismaClient
- Implement `onModuleInit()` to call `$connect()`
- Implement `onModuleDestroy()` to call `$disconnect()`
- Use driver adapters pattern: `new PrismaClient({ adapter: new PrismaPg(pool) })`
- Configure connection pool: min=2, max=10 connections
- Add error logging for connection failures

**Quality Requirements**:

- Service must implement OnModuleInit and OnModuleDestroy interfaces
- Connection pool must be properly configured
- Must handle connection errors gracefully
- Must pass: `npx nx lint ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

### Task 1.5: Create Hardcoded Plan Configuration 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A2, lines 356-411)
**Dependencies**: None (independent of database)

**Implementation Requirements**:

- Define `PLANS` const object with `as const` assertion for type safety
- Define `free` plan: expiresAfterDays=null, isPremium=false, features=[basic_cli_wrapper, session_history, permission_management, mcp_configuration]
- Define `early_adopter` plan: expiresAfterDays=60, isPremium=true, futurePrice=8, features=[all_premium_features, sdk_access, custom_tools, workspace_semantic_search, editor_context_awareness, git_workspace_info]
- Export `PlanName` type: `keyof typeof PLANS`
- Export `getPlanConfig(plan: PlanName)` helper function
- Export `calculateExpirationDate(plan: PlanName): Date | null` helper

**Validation Notes**:

- This is the ONLY source of plan metadata (no database table)
- Feature lists must match requirements exactly
- early_adopter expires after 60 days, free never expires

**Quality Requirements**:

- Must be immutable (`as const` assertion)
- Must export type-safe `PlanName` type
- Helper functions must return correct types
- calculateExpirationDate must handle null expiresAfterDays correctly

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

**Batch 1 Verification**:

- All Prisma dependencies installed: `npm list @prisma/client pg`
- Database tables exist: `npx prisma db pull`
- Build passes: `npx nx build ptah-license-server`
- Type-check passes: `npm run typecheck:all`
- PrismaService registered in app.module.ts: Manual review

---

## Batch 2: License Verification API 🔄 IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 complete

### Task 2.1: Create License DTOs 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\dto\verify-license.dto.ts` (CREATE)
**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\dto\create-license.dto.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A3, lines 570-571)

**Implementation Requirements**:

- **VerifyLicenseDto**:
  - `licenseKey`: string, @IsString(), @Matches(/^ptah*lic*[a-f0-9]{64}$/)
- **CreateLicenseDto**:
  - `email`: string, @IsEmail()
  - `plan`: string, @IsEnum(['free', 'early_adopter'])
  - `sendEmail`: boolean (optional), @IsBoolean(), @IsOptional()

**Validation Notes**:

- License key format MUST be validated: `ptah_lic_{64 hex chars}`
- Plan MUST be one of hardcoded plans (validated against PLANS config)
- Email MUST be RFC 5322 compliant (class-validator @IsEmail handles this)

**Quality Requirements**:

- Must use class-validator decorators
- Must have proper validation error messages
- Must pass: `npx nx lint ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

### Task 2.2: Create LicenseService with verifyLicense() 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A3, lines 441-551)
**Dependencies**: Task 2.1

**Implementation Requirements**:

- Inject PrismaService via constructor
- Implement `async verifyLicense(licenseKey: string)`:
  - Step 1: Find license by licenseKey (Prisma findUnique)
  - Step 2: If not found, return `{ valid: false, tier: 'free', reason: 'not_found' }`
  - Step 3: Check status - if 'revoked', return `{ valid: false, tier: 'free', reason: 'revoked' }`
  - Step 4: Check expiration - if expired, return `{ valid: false, tier: 'free', reason: 'expired' }`
  - Step 5: Calculate daysRemaining: `Math.ceil((expiresAt - now) / 86400000)`
  - Step 6: Merge with plan config from PLANS constant
  - Step 7: Return `{ valid: true, tier, plan, expiresAt, daysRemaining }`

**Validation Notes**:

- RISK: Database query must use indexed licenseKey column (performance)
- Edge case: null expiresAt (free plan) should return daysRemaining: undefined
- Edge case: Expired license must return tier: 'free' (not original plan)

**Quality Requirements**:

- Response time <200ms (p95) - use indexed queries
- Must not leak license key in logs
- Must handle database errors gracefully
- Must merge plan config correctly

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

### Task 2.3: Create LicenseService with createLicense() 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component A3, lines 500-551)
**Dependencies**: Task 2.2

**Implementation Requirements**:

- Implement `async createLicense({ email, plan })`:
  - Step 1: Find or create user (Prisma upsert or findUnique + create)
  - Step 2: Revoke existing active licenses for user (updateMany status='revoked')
  - Step 3: Generate license key: `crypto.randomBytes(32).toString('hex')` + prefix `ptah_lic_`
  - Step 4: Calculate expiration using `calculateExpirationDate(plan)` helper
  - Step 5: Create license record (Prisma create)
  - Step 6: Return `{ licenseKey, expiresAt }`
- Use transaction for steps 2-5 (Prisma.$transaction or atomic operations)

**Validation Notes**:

- RISK: License key generation MUST use crypto.randomBytes (NOT Math.random)
- Edge case: Existing user with active license → old license must be revoked
- Edge case: free plan → expiresAt should be null

**Quality Requirements**:

- License key must have 256-bit entropy (32 bytes = 64 hex chars)
- Revoke + create must be atomic (no race conditions)
- Must handle duplicate email gracefully
- Must pass: `npm run typecheck:all`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

### Task 2.4: Create LicenseController with /verify Endpoint 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A3, line 544)
**Dependencies**: Task 2.3

**Implementation Requirements**:

- NestJS @Controller('api/v1/licenses')
- Inject LicenseService
- @Post('verify') endpoint:
  - Accept VerifyLicenseDto
  - Call licenseService.verifyLicense()
  - Return result (no authentication required - public endpoint)
- @Get('me') endpoint (stub for Batch 4 - portal API):
  - Will be implemented with JWT guard later
  - For now, just export endpoint signature

**Validation Notes**:

- /verify is PUBLIC endpoint (no @UseGuards)
- Must handle validation errors (class-validator auto-validates)
- Must return 200 OK even for invalid licenses (security: no enumeration)

**Quality Requirements**:

- Endpoint must return JSON response
- Must use DTO validation
- Must handle exceptions gracefully (NestJS exception filters)
- Must pass: `npx nx lint ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
curl -X POST http://localhost:3000/api/v1/licenses/verify -d '{"licenseKey":"invalid"}' -H "Content-Type: application/json"
```

---

### Task 2.5: Create LicenseModule and Register with AppModule 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\license.module.ts` (CREATE)
**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component A3, line 569)
**Dependencies**: Task 2.4

**Implementation Requirements**:

- Create LicenseModule:
  - @Module decorator
  - imports: [PrismaModule] (if created) or provide PrismaService
  - controllers: [LicenseController]
  - providers: [LicenseService]
  - exports: [LicenseService] (for use in AdminController later)
- Modify AppModule:
  - Add LicenseModule to imports array
  - Ensure ConfigModule is imported (required for env variables)

**Quality Requirements**:

- Module must be properly structured
- Dependencies must be correctly injected
- Must pass: `npx nx build ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
# Manual: Start server and test /verify endpoint
```

---

**Batch 2 Verification**:

- License verification endpoint works: `curl POST /api/v1/licenses/verify`
- Invalid license returns free tier: `{ valid: false, tier: "free" }`
- License creation function exists: Unit test or manual call
- Build passes: `npx nx build ptah-license-server`
- No `any` types: `npm run typecheck:all`

---

## Batch 3: Admin API & Email Service 🔄 IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 2 complete

### Task 3.1: Create AdminApiKeyGuard 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\guards\admin-api-key.guard.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A4, lines 585-603)

**Implementation Requirements**:

- Implement NestJS CanActivate interface
- Inject ConfigService via constructor
- In canActivate(context):
  - Extract `x-api-key` header from request
  - Compare with `ADMIN_API_KEY` from ConfigService
  - If missing or invalid: throw UnauthorizedException('Invalid API key')
  - If valid: return true

**Validation Notes**:

- RISK: Admin API key must be 256-bit random key (user generates with `openssl rand -hex 32`)
- Edge case: Missing header → 401 Unauthorized
- Edge case: Case-sensitive comparison (lowercase header name: 'x-api-key')

**Quality Requirements**:

- Must not log API key (security)
- Must return 401 for invalid/missing keys
- Must be reusable for all admin endpoints
- Must pass: `npx nx lint ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

### Task 3.2: Create AdminController with /admin/licenses Endpoint 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\admin.controller.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A4, lines 605-662)
**Dependencies**: Task 3.1

**Implementation Requirements**:

- NestJS @Controller('api/v1/admin') with @UseGuards(AdminApiKeyGuard) at class level
- Inject LicenseService and EmailService (EmailService will be created in Task 3.3)
- @Post('licenses') endpoint:
  - Accept CreateLicenseDto
  - Call licenseService.createLicense()
  - Try to send email (if sendEmail !== false)
  - Catch email errors, set emailSent=false, log error
  - Return `{ success: true, license: { licenseKey, plan, status, expiresAt, createdAt }, emailSent, emailError? }`

**Validation Notes**:

- RISK: Email send failure must NOT fail license creation (graceful degradation)
- Edge case: sendEmail=false → skip email, return emailSent=false
- Edge case: EmailService throws → catch, log, return emailSent=false with error message

**Quality Requirements**:

- License creation MUST succeed even if email fails
- Must return license details including licenseKey (admin needs it)
- Must log email failures for manual follow-up
- Response time <1000ms (p95) including email send

**Verification**:

```bash
npx nx build ptah-license-server
# Test with valid API key
curl -X POST http://localhost:3000/api/v1/admin/licenses -H "X-API-Key: valid-key" -d '{"email":"test@example.com","plan":"early_adopter"}' -H "Content-Type: application/json"
```

---

### Task 3.3: Install SendGrid and Create EmailService 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\package.json` (MODIFY)
**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\services\email.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A6, lines 774-878)
**Dependencies**: None (independent)

**Implementation Requirements**:

- Install SendGrid: Add `"@sendgrid/mail": "^8.0.0"` to dependencies
- Create EmailService:
  - @Injectable() decorator
  - Inject ConfigService
  - Initialize SendGrid in constructor: `sgMail.setApiKey(config.get('SENDGRID_API_KEY'))`
  - Implement `async sendLicenseKey({ email, licenseKey, plan, expiresAt })`
  - Implement `async sendMagicLink({ email, magicLink })` (stub for Batch 4)
  - Implement `private async sendWithRetry(msg, attempts: number)`:
    - Loop 3 times
    - Try sgMail.send(msg)
    - On failure: wait exponentially (1s, 2s, 4s)
    - On last failure: throw error

**Validation Notes**:

- RISK: SendGrid API key must be in .env (user must provide)
- Edge case: Retry delays use exponential backoff: 2^i \* 1000ms
- Edge case: After 3 failures, throw error (caller handles)

**Quality Requirements**:

- Retry logic must use exponential backoff (1s, 2s, 4s)
- Must throw error after 3 failures (graceful degradation in caller)
- Must not log license keys or magic links (security)
- Must pass: `npm run typecheck:all`

**Verification**:

```bash
cd D:\projects\ptah-extension\apps\ptah-license-server
npm install
npx nx build ptah-license-server
```

---

### Task 3.4: Create Email HTML Templates 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\services\email.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component A6, lines 848-878)
**Dependencies**: Task 3.3

**Implementation Requirements**:

- Implement `private getLicenseKeyTemplate({ licenseKey, plan, expiresAt })`:
  - Return HTML string with:
    - Subject-like heading: "Welcome to Ptah Premium!"
    - License key display (plaintext, copyable)
    - Plan name and expiration date (formatted)
    - Setup instructions (numbered list): Open VS Code settings → Search "Ptah" → Paste license key → Reload window
    - Portal link: `${FRONTEND_URL}/portal/dashboard`
    - Support text: "Need help? Reply to this email."
- Implement `private getMagicLinkTemplate({ magicLink })`:
  - Return HTML string with:
    - Heading: "Login to Ptah Portal"
    - Magic link as clickable <a> tag
    - Expiration notice: "This link expires in 30 seconds."
    - Security notice: "Didn't request this? Ignore this email."

**Validation Notes**:

- HTML must be inline CSS (email client compatibility)
- License key must be plaintext (easy to copy)
- Expiration date must be formatted: `new Date(expiresAt).toLocaleDateString()`

**Quality Requirements**:

- Templates must render correctly in Gmail, Outlook, Apple Mail
- Must use simple HTML (no complex CSS)
- Must be mobile-responsive (basic)
- Must pass: visual inspection

**Verification**:

```bash
# Manual: Send test email and verify rendering
```

---

### Task 3.5: Create EmailModule and Update LicenseModule 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\email.module.ts` (CREATE)
**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\license.module.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component A6, line 896)
**Dependencies**: Task 3.4

**Implementation Requirements**:

- Create EmailModule:
  - @Module decorator
  - imports: [ConfigModule]
  - providers: [EmailService]
  - exports: [EmailService]
- Modify LicenseModule:
  - Add EmailModule to imports
  - AdminController can now inject EmailService

**Quality Requirements**:

- EmailService must be exported from EmailModule
- LicenseModule must import EmailModule (not just EmailService)
- Must pass: `npx nx build ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

**Batch 3 Verification**:

- Admin API key guard works: `curl POST /admin/licenses` without key → 401
- License creation with email works: Check database + inbox
- Email retry logic tested: Mock SendGrid failure, verify 3 retries
- Email templates render correctly: Visual inspection
- Build passes: `npx nx build ptah-license-server`

---

## Batch 4: Magic Link Authentication 🔄 IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 3 complete

### Task 4.1: Create MagicLinkService 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\auth\services\magic-link.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component A5, lines 688-752)

**Implementation Requirements**:

- @Injectable() decorator
- Inject ConfigService
- Implement in-memory token storage: `private tokens = new Map<string, MagicLinkToken>()`
- Interface: `MagicLinkToken { email: string; token: string; expiresAt: Date; used: boolean }`
- Implement `async createMagicLink(email: string): Promise<string>`:
  - Generate token: `crypto.randomBytes(32).toString('hex')`
  - Set expiration: `new Date(Date.now() + 30000)` (30 seconds)
  - Store in map: `{ email, token, expiresAt, used: false }`
  - Return magic link URL: `${FRONTEND_URL}/auth/verify?token=${token}`
- Implement `async validateAndConsume(token: string): Promise<{ valid: boolean; email?: string; error?: string }>`:
  - Check token exists → if not: `{ valid: false, error: 'token_not_found' }`
  - Check `used` flag → if true: `{ valid: false, error: 'token_already_used' }`
  - Check expiration → if expired: delete token, return `{ valid: false, error: 'token_expired' }`
  - Mark as used, delete token (single-use enforcement)
  - Return `{ valid: true, email }`

**Validation Notes**:

- RISK: In-memory storage is SINGLE-INSTANCE only (document limitation)
- Edge case: Expired token must be deleted from map (memory cleanup)
- Edge case: Single-use enforcement: mark used=true AND delete token

**Quality Requirements**:

- Token must have 256-bit entropy (64 hex chars)
- TTL must be exactly 30 seconds (no tolerance)
- Single-use enforcement must be strict
- Must pass: `npm run typecheck:all`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

### Task 4.2: Modify AuthController for Magic Link Endpoints 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\app\auth\auth.controller.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component A5, line 769)
**Dependencies**: Task 4.1

**Implementation Requirements**:

- Inject MagicLinkService and EmailService
- Add @Post('magic-link') endpoint:
  - Accept `{ email: string }` body
  - Validate email with @IsEmail() in DTO
  - Check if user exists in database (via PrismaService)
  - If user exists: call magicLinkService.createMagicLink(), send email
  - If user doesn't exist: still return success (security: no email enumeration)
  - Return `{ success: true, message: "Check your email for login link" }`
- Add @Get('verify') endpoint with @Query('token') token: string:
  - Call magicLinkService.validateAndConsume(token)
  - If invalid: redirect to `/auth/login?error=${error}` (token_expired, token_already_used)
  - If valid: generate JWT, set HTTP-only cookie, redirect to `/portal/dashboard`

**Validation Notes**:

- RISK: ALWAYS return success for magic link request (prevent email enumeration)
- Edge case: JWT generation uses existing AuthService (from auth.module.ts)
- Edge case: Cookie flags: httpOnly=true, secure=true (production), sameSite='strict', maxAge=7 days

**Quality Requirements**:

- Must not reveal if email exists (security)
- JWT cookie must be HTTP-only (XSS protection)
- Redirect URLs must be correct (FRONTEND_URL from config)
- Must pass: `npx nx lint ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
# Manual: Test magic link flow end-to-end
```

---

### Task 4.3: Update AuthModule to Export MagicLinkService 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\app\auth\auth.module.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component A5, line 770)
**Dependencies**: Task 4.2

**Implementation Requirements**:

- Add MagicLinkService to providers array
- Add MagicLinkService to exports array
- Verify ConfigModule is already imported (required for FRONTEND_URL)

**Quality Requirements**:

- MagicLinkService must be injectable in AuthController
- Must pass: `npx nx build ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
npm run typecheck:all
```

---

### Task 4.4: Add Portal License API Endpoint (GET /licenses/me) 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts` (MODIFY)
**Spec Reference**: task-description.md (lines 548-571)
**Dependencies**: Task 4.3

**Implementation Requirements**:

- Inject AuthService or use existing JWT guard (JwtAuthGuard from auth.module.ts)
- Add @Get('me') endpoint with @UseGuards(JwtAuthGuard):
  - Extract userId from JWT token (req.user.id)
  - Find user's active license via LicenseService
  - If found: return `{ plan, status, expiresAt, daysRemaining, email, createdAt }`
  - If not found: return `{ plan: "free", status: "none", message: "No active license found" }`
  - NEVER include licenseKey in response (security)
- Add @Post('resend') endpoint with @UseGuards(JwtAuthGuard):
  - Extract userId from JWT
  - Find user's active license
  - Send email with license key (call EmailService.sendLicenseKey)
  - Return `{ success: true, message: "License key email sent to user@example.com" }`

**Validation Notes**:

- RISK: License key must NEVER be in API response (only via email)
- Edge case: User with no license → return free tier status, HTTP 200
- Edge case: Email resend fails → return 500 with error message

**Quality Requirements**:

- Must use JWT authentication (existing JwtAuthGuard)
- Must not leak license keys in responses
- Must pass: `npx nx lint ptah-license-server`

**Verification**:

```bash
npx nx build ptah-license-server
# Test with valid JWT cookie
curl -X GET http://localhost:3000/api/v1/licenses/me --cookie "access_token=valid-jwt"
```

---

**Batch 4 Verification**:

- Magic link generation works: Check email inbox
- Magic link validation works: Click link → redirects to portal
- JWT cookie set correctly: Check browser DevTools → Cookies → httpOnly flag
- Portal /me endpoint works: Returns license status
- Build passes: `npx nx build ptah-license-server`

---

## Batch 5: VS Code LicenseService 🔄 IMPLEMENTED

**Developer**: backend-developer (or frontend-developer with VS Code extension experience)
**Tasks**: 5 | **Dependencies**: Batch 1-4 complete (server must be running)

### Task 5.1: Create LicenseService in vscode-core 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component B1, lines 901-1073)

**Implementation Requirements**:

- @singleton() decorator (TSyringe)
- Extend EventEmitter<LicenseEvents> from eventemitter3
- Inject EXTENSION_CONTEXT and LOGGER tokens
- Define interfaces: `LicenseStatus`, `LicenseEvents` (license:verified, license:expired, license:updated)
- Implement private cache: `{ status: LicenseStatus | null; timestamp: number | null }`
- Implement `async verifyLicense(): Promise<LicenseStatus>`:
  - Step 1: Check cache validity (1-hour TTL)
  - Step 2: Get license key from SecretStorage: `context.secrets.get('ptah.licenseKey')`
  - Step 3: If no key: return `{ valid: false, tier: 'free' }`
  - Step 4: POST to server: `fetch('${LICENSE_SERVER_URL}/api/v1/licenses/verify', { body: { licenseKey } })`
  - Step 5: Parse response, update cache, emit events
  - Step 6: On error: return cached status or free tier
- Implement `async setLicenseKey(key: string)`: Store in SecretStorage, invalidate cache, re-verify
- Implement `async clearLicenseKey()`: Delete from SecretStorage, set free tier
- Implement `getCachedStatus()`: Return cached status without network call
- Implement `async revalidate()`: Force cache invalidation and re-verify

**Validation Notes**:

- RISK: Network failure must fall back to cached status (graceful degradation)
- Edge case: Cache TTL is 1 hour (3600000ms)
- Edge case: SecretStorage is encrypted by VS Code (no manual encryption needed)

**Quality Requirements**:

- Cache must have 1-hour TTL
- SecretStorage key: `'ptah.licenseKey'`
- Events must emit on status changes
- Must not log license keys (security)
- Network timeout: 5 seconds

**Verification**:

```bash
npx nx build vscode-core
npm run typecheck:all
```

---

### Task 5.2: Add LICENSE_SERVICE Token to TOKENS Namespace 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component B1, line 1092)
**Dependencies**: Task 5.1

**Implementation Requirements**:

- Add `LICENSE_SERVICE: Symbol.for('LICENSE_SERVICE')` to TOKENS namespace
- Follow existing pattern (search for LOGGER, EXTENSION_CONTEXT examples)

**Quality Requirements**:

- Token must use Symbol.for() (not Symbol())
- Must follow naming convention: UPPER_SNAKE_CASE
- Must pass: `npm run typecheck:all`

**Verification**:

```bash
npm run typecheck:all
```

---

### Task 5.3: Register LicenseService in vscode-core's register.ts 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component B1, line 1093)
**Dependencies**: Task 5.2

**Implementation Requirements**:

- Import LicenseService from './services/license.service'
- In `registerVsCodeCoreServices(container, context)` function:
  - Add registration: `container.register(TOKENS.LICENSE_SERVICE, { useClass: LicenseService })`
  - Place after Logger registration (LicenseService depends on Logger)

**Quality Requirements**:

- Registration order matters: Logger → LicenseService
- Must use TOKENS.LICENSE_SERVICE (not string)
- Must pass: `npx nx build vscode-core`

**Verification**:

```bash
npx nx build vscode-core
npm run typecheck:all
```

---

### Task 5.4: Export LicenseService from vscode-core Index 🔄 IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component B1, line 1094)
**Dependencies**: Task 5.3

**Implementation Requirements**:

- Add export: `export { LicenseService } from './services/license.service';`
- Add export for types: `export type { LicenseStatus, LicenseEvents } from './services/license.service';`

**Quality Requirements**:

- Must export both class and types
- Must maintain alphabetical order (if applicable)
- Must pass: `npx nx build vscode-core`

**Verification**:

```bash
npx nx build vscode-core
npm run typecheck:all
```

---

### Task 5.5: Write Unit Tests for LicenseService ⏸️ SKIPPED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.spec.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component B1, line 1091)
**Dependencies**: Task 5.4

**NOTE**: Skipped as per task instructions (optional - skip if time constrained)

**Implementation Requirements**:

- Mock EXTENSION_CONTEXT (SecretStorage.get/store/delete)
- Mock LOGGER (no-op stubs)
- Mock fetch() for network calls
- Test cases:
  - `verifyLicense() with no license key → returns free tier`
  - `verifyLicense() with valid key → returns premium tier`
  - `verifyLicense() with expired key → returns free tier`
  - `verifyLicense() uses cache (no network call on second call)`
  - `setLicenseKey() stores in SecretStorage and re-verifies`
  - `clearLicenseKey() deletes from SecretStorage`
  - `getCachedStatus() returns cached value`
  - `revalidate() invalidates cache`

**Quality Requirements**:

- Must achieve >70% code coverage
- Must mock all external dependencies
- Must test cache behavior
- Must test event emissions

**Verification**:

```bash
npx nx test vscode-core --coverage
```

---

**Batch 5 Verification**:

- LicenseService resolves from DI: `DIContainer.resolve(TOKENS.LICENSE_SERVICE)`
- License verification with network works: Manual test with real server
- Cache works: Second call returns instantly
- SecretStorage integration works: Key stored and retrieved
- Unit tests pass: `npx nx test vscode-core`

---

## Batch 6: Conditional MCP Registration ⏸️ PENDING

**Developer**: backend-developer (or frontend-developer with extension experience)
**Tasks**: 4 | **Dependencies**: Batch 5 complete

### Task 6.1: Modify main.ts for License Verification Step ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component B2, lines 1097-1230)
**Dependencies**: Batch 5 complete

**Implementation Requirements**:

- Add NEW Step 7.5 AFTER SDK RPC handlers (line 71) and BEFORE PtahExtension creation (line 74):

```typescript
// ========================================
// NEW STEP 7.5: LICENSE VERIFICATION
// ========================================
console.log('[Activate] Step 7.5: Verifying license...');
const licenseService = DIContainer.resolve<LicenseService>(TOKENS.LICENSE_SERVICE);
const licenseStatus = await licenseService.verifyLicense();

if (licenseStatus.valid && licenseStatus.tier !== 'free') {
  logger.info('Premium license verified', {
    tier: licenseStatus.tier,
    expiresAt: licenseStatus.expiresAt,
  });
} else {
  logger.info('Free tier user (no premium features)', {
    reason: licenseStatus.reason || 'no_license',
  });
}
console.log(`[Activate] Step 7.5: License verified (tier: ${licenseStatus.tier})`);
```

- MODIFY Step 8 (lines 102-112) - Conditional MCP Registration:

```typescript
// ========================================
// MODIFIED STEP 8: CONDITIONAL MCP SERVER START
// ========================================
console.log('[Activate] Step 8: Conditional MCP Server registration...');

if (licenseStatus.valid && licenseStatus.tier !== 'free') {
  // PREMIUM USER: Register MCP Server
  logger.info('Registering premium MCP server (licensed user)');
  const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
  const mcpPort = await(codeExecutionMCP as { start: () => Promise<number> }).start();
  context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
  logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
  console.log(`[Activate] Step 8: Premium MCP Server started (port ${mcpPort})`);
} else {
  // FREE USER: Skip MCP Server Registration
  logger.info('Skipping premium MCP server (free tier user)');
  console.log('[Activate] Step 8: MCP Server skipped (free tier)');
}
```

**Validation Notes**:

- CRITICAL: Free users must NOT call `DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP)` (zero premium code)
- Edge case: License verification failure → fall back to free tier (no error, graceful degradation)
- Edge case: Network timeout → use cached status, proceed with activation

**Quality Requirements**:

- License check must happen BEFORE MCP registration
- Must not break existing activation flow
- Must handle network failures gracefully
- Must pass: `npx nx build ptah-extension-vscode`

**Verification**:

```bash
npx nx build ptah-extension-vscode
# Manual: Test extension activation with and without license key
```

---

### Task 6.2: Add License Status Event Handlers for Dynamic Registration ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts` (MODIFY)
**Spec Reference**: implementation-plan.md (Component B2, lines 1167-1206)
**Dependencies**: Task 6.1

**Implementation Requirements**:

- Add NEW Step 9 AFTER Step 8 (after MCP registration):

```typescript
// ========================================
// NEW STEP 9: LICENSE STATUS WATCHER
// ========================================
console.log('[Activate] Step 9: Setting up license status watcher...');

// Handle dynamic license changes (upgrade/expire)
licenseService.on('license:verified', async (status) => {
  logger.info('License upgraded - registering premium features', { status });
  // Dynamic registration: Start MCP server if not already running
  const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
  if (!(codeExecutionMCP as any).isRunning) {
    const mcpPort = await (codeExecutionMCP as { start: () => Promise<number> }).start();
    context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
    logger.info(`Premium MCP Server started dynamically (port ${mcpPort})`);
  }
});

licenseService.on('license:expired', (status) => {
  logger.warn('License expired - premium features disabled', { status });
  vscode.window.showWarningMessage('Your Ptah premium license has expired. Premium features are now disabled.');
  // Note: MCP server will be disposed on next activation
  // For immediate effect, would need to implement dynamic deregistration
});

console.log('[Activate] Step 9: License status watcher initialized');

// Background revalidation (every 24 hours)
const revalidationInterval = setInterval(() => licenseService.revalidate(), 24 * 60 * 60 * 1000);
context.subscriptions.push({
  dispose: () => clearInterval(revalidationInterval),
});
```

**Validation Notes**:

- RISK: Dynamic MCP registration checks `isRunning` flag (prevent double registration)
- Edge case: License expires during session → show warning, disable on next activation
- Edge case: Background revalidation every 24 hours (check for expiration)

**Quality Requirements**:

- Event handlers must not block activation
- Background revalidation must be properly disposed
- Warning message must be user-friendly
- Must pass: `npm run typecheck:all`

**Verification**:

```bash
npx nx build ptah-extension-vscode
# Manual: Change license status, verify events fire
```

---

### Task 6.3: Create LicenseCommands for Command Palette ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\commands\license-commands.ts` (CREATE)
**Spec Reference**: implementation-plan.md (Component B3, lines 1279-1378)
**Dependencies**: Task 6.2

**Implementation Requirements**:

- Create @injectable() class LicenseCommands
- Inject TOKENS.LICENSE_SERVICE
- Implement `async enterLicenseKey()`:
  - Show input box with password mode: `vscode.window.showInputBox({ password: true, validateInput })`
  - Validate format: Must start with 'ptah*lic*' (reject otherwise)
  - Call licenseService.setLicenseKey()
  - Verify license immediately
  - If valid: show success message with reload prompt
  - If invalid: show error message with reason
- Implement `async removeLicenseKey()`:
  - Show confirmation warning
  - Call licenseService.clearLicenseKey()
  - Show success message with reload prompt
- Implement `async checkLicenseStatus()`:
  - Call licenseService.verifyLicense()
  - Show info message with plan, expiration, days remaining
  - If free tier: show upgrade link
- Implement `registerCommands(context)`: Register all 3 commands

**Validation Notes**:

- Edge case: Invalid license key format → reject in input box validation
- Edge case: License verification fails → show specific error (expired, revoked, not_found)
- Edge case: Reload window prompt → user can choose to reload or not

**Quality Requirements**:

- Input validation must be immediate (no server call until valid format)
- Password mode must hide license key input
- Error messages must be user-friendly
- Must pass: `npx nx lint ptah-extension-vscode`

**Verification**:

```bash
npx nx build ptah-extension-vscode
# Manual: Test commands via Command Palette
```

---

### Task 6.4: Register License Commands and Configuration in package.json ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json` (MODIFY)
**Spec Reference**: implementation-plan.md (Component B3, lines 1245-1277, 1364-1377)
**Dependencies**: Task 6.3

**Implementation Requirements**:

- Add to `contributes.configuration.properties`:

```json
"ptah.licenseKey": {
  "type": "string",
  "default": "",
  "description": "Ptah premium license key (leave empty for free tier)",
  "markdownDescription": "Enter your Ptah premium license key here. Get your license at https://ptah.dev/pricing",
  "order": 1
}
```

- Add to `contributes.commands`:

```json
{
  "command": "ptah.enterLicenseKey",
  "title": "Ptah: Enter License Key"
},
{
  "command": "ptah.removeLicenseKey",
  "title": "Ptah: Remove License Key"
},
{
  "command": "ptah.checkLicenseStatus",
  "title": "Ptah: Check License Status"
}
```

- Modify `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts`:
  - Import LicenseCommands
  - In `registerAll()` method: Resolve and call `licenseCommands.registerCommands(context)`

**Quality Requirements**:

- Commands must appear in Command Palette
- Configuration must appear in VS Code settings
- Must pass: `npx nx build ptah-extension-vscode`

**Verification**:

```bash
npx nx build ptah-extension-vscode
# Manual: Open Command Palette → Search "Ptah" → Verify 3 new commands
# Manual: Open Settings → Search "Ptah" → Verify license key setting
```

---

**Batch 6 Verification**:

- Free users: MCP server NOT registered (check logs for "MCP Server skipped")
- Licensed users: MCP server registered and started (check logs for port number)
- License commands work: Enter key → Reload → Premium features enabled
- Dynamic registration works: Enter key while extension running → MCP starts
- Build passes: `npx nx build ptah-extension-vscode`

---

## FINAL VALIDATION CHECKLIST

### Backend (License Server)

- [ ] Database tables exist: `npx prisma db pull`
- [ ] POST /api/v1/licenses/verify returns valid/invalid in <200ms
- [ ] POST /api/v1/admin/licenses creates license with email
- [ ] Magic link authentication works (30s TTL, single-use)
- [ ] GET /api/v1/licenses/me returns license status (JWT protected)
- [ ] Email templates render correctly in Gmail/Outlook
- [ ] All endpoints pass linting: `npx nx lint ptah-license-server`
- [ ] Build passes: `npx nx build ptah-license-server`

### Frontend (VS Code Extension)

- [ ] LicenseService resolves from DI container
- [ ] Free users: MCP server NOT resolved (zero premium code)
- [ ] Licensed users: MCP server started on port
- [ ] License key stored in SecretStorage (encrypted)
- [ ] Cache works (1-hour TTL, no network call on second verify)
- [ ] Command Palette shows 3 license commands
- [ ] VS Code settings show license key field
- [ ] Build passes: `npx nx build ptah-extension-vscode`

### Integration

- [ ] End-to-end flow works:
  1. Admin creates license via API
  2. User receives email with license key
  3. User enters key in VS Code settings
  4. Extension verifies with server
  5. Premium MCP server registers
  6. Premium features work
- [ ] License expiration works: Expired license → free tier
- [ ] Dynamic registration works: Enter key while running → MCP starts
- [ ] Background revalidation works: Check logs after 24 hours

---

## GIT COMMIT STRATEGY

**Batch-Level Commits**: Create one commit per batch after all tasks in batch complete and code-logic-reviewer approves.

**Commit Message Format** (must follow commitlint rules):

```bash
# Batch 1
git commit -m "feat(vscode): add prisma schema and license database tables

- create prisma schema with users and licenses tables
- add hardcoded plan configuration (free, early_adopter)
- configure prisma driver adapters for nx monorepo compatibility"

# Batch 2
git commit -m "feat(vscode): implement license verification api

- create license verification endpoint (POST /verify)
- implement license service with verify and create methods
- add dto validation for license keys and email"

# Batch 3
git commit -m "feat(vscode): add admin api and email service

- create admin license creation endpoint with api key auth
- integrate sendgrid email service with retry logic
- add html email templates for license keys and magic links"

# Batch 4
git commit -m "feat(vscode): implement magic link authentication

- create magic link service with 30s ttl and single-use enforcement
- add auth endpoints for magic link request and verification
- add portal license status endpoint (GET /licenses/me)"

# Batch 5
git commit -m "feat(vscode): add license service to vscode extension

- create license service with secretstorage integration
- implement license verification with 1-hour cache
- add event emitters for license status changes (verified, expired, updated)"

# Batch 6
git commit -m "feat(vscode): add conditional mcp registration based on license

- modify extension activation to verify license before mcp registration
- free users: skip mcp server registration (zero premium code)
- licensed users: register and start premium mcp server
- add license commands for command palette (enter, remove, check status)
- add dynamic registration on license status changes"
```

**CRITICAL**: All commit messages must:

- Use lowercase type and scope
- Use lowercase subject (no Title Case)
- Be 100 characters or less (header)
- Use allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Use allowed scopes: `vscode`, `webview`, `vscode-lm-tools`, `deps`, `docs`

---

## Document Status

**Status**: ✅ Ready for Implementation
**Created**: 2025-12-15
**Total Tasks**: 28 tasks across 6 batches
**Estimated Time**: 12-16 hours (2-3 hours per batch)

**Next Action**: Orchestrator should invoke backend-developer with Batch 1 tasks.

---

**End of tasks.md**

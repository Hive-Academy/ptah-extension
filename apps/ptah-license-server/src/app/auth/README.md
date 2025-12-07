# Authentication Module

JWT-based authentication with WorkOS integration for the NestJS AI SaaS Starter.

## Overview

This module provides:

- **WorkOS AuthKit Integration**: Hosted authentication with support for SSO, MFA, and user management
- **JWT Session Management**: HTTP-only cookies for secure token storage -**Request User Context**: Populates `request.user` for all protected routes
- **Multi-Tenant Support**: Automatic `tenantId` extraction for isolation across Neo4j, ChromaDB, and LangGraph

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User → GET /auth/login                                   │
│    → Redirects to WorkOS AuthKit                            │
│                                                              │
│ 2. User completes authentication on WorkOS                  │
│    → WorkOS redirects to /auth/callback?code=...            │
│                                                              │
│ 3. Backend → AuthService.authenticateWithCode(code)         │
│    → Exchanges code for user info                           │
│    → Generates JWT with user + tenant data                  │
│    → Sets HTTP-only cookie: access_token                    │
│    → Redirects to frontend                                  │
│                                                              │
│ 4. Protected Routes → @UseGuards(JwtAuthGuard)              │
│    → JwtAuthGuard validates JWT from cookie                 │
│    → Attaches user to request.user                          │
│    → Request proceeds with authenticated context            │
└─────────────────────────────────────────────────────────────┘
```

## Components

### `AuthService`

- WorkOS integration (user authentication, code exchange)
- JWT generation and validation
- User mapping (roles, permissions, tier extraction)

### `JwtAuthGuard`

- JWT validation from HTTP-only cookies
- Populates `request.user` with authenticated user information
- **CRITICAL**: Fixes Neo4j "No request context available" error

### `AuthController`

- `GET /auth/login`: Initiate WorkOS login flow
- `GET /auth/callback`: Handle OAuth callback
- `POST /auth/logout`: Clear session
- `GET /auth/me`: Get current user info (protected)

### `RequestUser` Interface

```typescript
interface RequestUser {
  id: string; // User ID
  email: string; // User email
  tenantId: string; // Tenant/Organization ID
  organizationId?: string; // WorkOS Organization ID
  roles: string[]; // User roles
  permissions: string[]; // Fine-grained permissions
  tier: 'free' | 'pro' | 'enterprise'; // Subscription tier
}
```

## Usage

### 1. Protect Routes

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Controller('api')
export class MyController {
  @UseGuards(JwtAuthGuard) // ✅ Protect route
  @Get('protected')
  async protectedRoute(@Req() req: Request) {
    const userId = req.user.id; // ✅ Access user ID
    const tenantId = req.user.tenantId; // ✅ Access tenant ID
    // ...
  }
}
```

### 2. Access User Context

After applying `@UseGuards(JwtAuthGuard)`, the `request.user` object is available:

```typescript
@Req() request: Request

// Access user information
const { id, email, tenantId, roles, permissions, tier } = request.user;
```

### 3. Module Integration

#### Neo4j

Neo4j security decorators (`@RequireAuth`, `@TenantIsolation`) automatically extract user context from `request.user`.

**Before** (causing error):

```typescript
// ❌ No user context → "No request context available"
@Get('conversations')
async getConversations() {
  // Neo4j decorator fails
}
```

**After** (fixed):

```typescript
// ✅ JWT auth provides user context
@UseGuards(JwtAuthGuard)
@Get('conversations')
async getConversations(@Req() request: Request) {
  // Neo4j decorator works with request.user
}
```

#### ChromaDB

Configure `@TenantAware` decorator to extract `tenantId` from JWT:

```typescript
@TenantAware({
  namingStrategy: 'prefix',
  tenantExtraction: 'jwt',  // ← Extract from request.user.tenantId
})
async searchDocuments(query: string, @Req() request: Request) {
  // Collection: 'tenant_org123_documents'
}
```

#### LangGraph

Inject user context into workflows via `RunnableConfig`:

```typescript
const config: RunnableConfig = {
  configurable: {
    user: {
      userId: request.user.id,
      tenantId: request.user.tenantId,
      roles: request.user.roles,
      tier: request.user.tier,
    },
  },
};

await workflow.invoke(input, config);
```

## Environment Variables

See [auth-environment-variables.md](../../docs/auth-environment-variables.md) for detailed setup instructions.

```bash
# WorkOS
WORKOS_API_KEY=sk_live_xxxxx
WORKOS_CLIENT_ID=client_xxxxx
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback
WORKOS_LOGOUT_REDIRECT_URI=http://localhost:4200

# JWT
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=7d

# Frontend
FRONTEND_URL=http://localhost:4200
```

## Security Features

1. **HTTP-Only Cookies**: Prevents JavaScript access (XSS protection)
2. **SameSite Protection**: `sameSite: 'lax'` prevents CSRF attacks
3. **HTTPS in Production**: `secure: true` ensures encrypted transmission
4. **Token Expiration**: JWTs expire after 7 days (configurable)
5. **Tenant Isolation**: Automatic multi-tenant data separation

## Testing

### Manual Testing

```bash
# 1. Start server
npx nx serve dev-brand-api

# 2. Login (browser)
open http://localhost:3000/api/auth/login

# 3. Check current user
curl http://localhost:3000/api/auth/me --cookie "access_token=..."

# 4. Test protected endpoint
curl http://localhost:3000/api/research/conversation/list --cookie "access_token=..."
```

### Expected Response (`/auth/me`)

```json
{
  "id": "user_01H8...",
  "email": "user@example.com",
  "tenantId": "org_01H8...",
  "organizationId": "org_01H8...",
  "roles": ["user"],
  "permissions": ["read:docs", "write:docs"],
  "tier": "pro"
}
```

## Integration Checklist

- [x] Auth module created
- [x] JwtAuthGuard implemented
- [x] ResearchChatController updated
- [x] Cookie parser configured
- [ ] LangGraph workflow context injection
- [ ] HITL user-aware approvals
- [ ] Memory user-scoped stores
- [ ] ChromaDB tenant configuration

## Troubleshooting

### "No authentication token provided"

- Verify login flow completed
- Check `access_token` cookie in browser DevTools
- Ensure requests include credentials: `credentials: ' include'`

### "Invalid or expired token"

- Token expired (default: 7 days)
- JWT secret changed (invalidates all tokens)
- Re-authenticate via `/auth/login`

### Neo4j "No request context available" (FIXED ✅)

- Apply `@UseGuards(JwtAuthGuard)` to endpoint
- Verify `request.user` is populated
- Check that AuthModule is imported in AppModule

## Next Steps

1. **LangGraph Integration**: Create `WorkflowAuthContextService` to inject user context into `RunnableConfig`
2. **HITL Integration**: Update approval storage to scope by `userId` and `tenantId`
3. **Memory Integration**: Update `ChromaDBBaseStore` to use user-scoped namespaces
4. **ChromaDB Multi-Tenancy**: Configure tenant extraction from JWT payload
5. **Frontend Integration**: Implement login flow in Angular app

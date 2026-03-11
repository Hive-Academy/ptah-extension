# Ptah License Server E2E Tests

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **ptah-license-server-e2e** app contains end-to-end tests for the Ptah License Server API. It verifies the entire API flow from request to database and back, testing authentication, license management, and payment integration.

## Boundaries

**Belongs here**:

- API endpoint E2E tests
- Integration tests with database
- Payment webhook simulation tests
- Authentication flow tests
- Full user journey scenarios

**Does NOT belong**:

- Unit tests (belong in ptah-license-server)
- Frontend tests (belong in respective apps)
- Load/performance tests (separate test suite)

## Key Files

- `src/ptah-license-server.spec.ts` - Main E2E test suite
- `jest.config.ts` - Jest E2E configuration
- `tsconfig.spec.json` - TypeScript test configuration

## Test Scenarios

### Authentication Tests

```typescript
describe('Authentication API', () => {
  it('should register new user', async () => { ... });
  it('should login with valid credentials', async () => { ... });
  it('should reject invalid credentials', async () => { ... });
  it('should refresh JWT token', async () => { ... });
});
```

### License Management Tests

```typescript
describe('License API', () => {
  it('should create new license for user', async () => { ... });
  it('should verify valid license key', async () => { ... });
  it('should reject expired license', async () => { ... });
  it('should revoke license', async () => { ... });
});
```

### Subscription Tests

```typescript
describe('Subscription API', () => {
  it('should create monthly subscription', async () => { ... });
  it('should upgrade subscription plan', async () => { ... });
  it('should cancel subscription', async () => { ... });
  it('should handle subscription expiry', async () => { ... });
});
```

### Payment Integration Tests

```typescript
describe('Payment Webhooks', () => {
  it('should handle successful payment webhook', async () => { ... });
  it('should handle failed payment webhook', async () => { ... });
  it('should verify webhook signature', async () => { ... });
});
```

## Setup

### Test Database

Use separate test database:

```env
# .env.test
DATABASE_URL="postgresql://user:password@localhost:5432/ptah_licenses_test"
```

### Test Fixtures

```typescript
// test-utils/fixtures.ts
export const testUser = {
  email: 'test@example.com',
  password: 'TestPassword123!',
};

export const testLicense = {
  type: 'pro',
  duration: '1year',
};
```

## Commands

```bash
# Run E2E tests
nx test ptah-license-server-e2e

# Run specific test file
nx test ptah-license-server-e2e --testFile=auth.spec.ts

# Run with coverage
nx test ptah-license-server-e2e --coverage

# Watch mode
nx test ptah-license-server-e2e --watch
```

## Test Utilities

### API Client

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000',
  headers: { 'Content-Type': 'application/json' },
});

// Add JWT token to requests
api.interceptors.request.use((config) => {
  const token = getTestToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

### Database Helpers

```typescript
// Clean up database before each test
beforeEach(async () => {
  await db.payment.deleteMany();
  await db.subscription.deleteMany();
  await db.license.deleteMany();
  await db.user.deleteMany();
});
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Clean database before/after tests
3. **Mocking**: Mock external services (Paymob webhooks)
4. **Assertions**: Use meaningful assertions
5. **Test Data**: Use factories for test data generation

## Debugging

```bash
# Run with verbose output
nx test ptah-license-server-e2e --verbose

# Debug specific test
node --inspect-brk node_modules/jest/bin/jest.js --runInBand --testPathPattern=auth.spec.ts
```

## Related Documentation

- [License Server](../ptah-license-server/CLAUDE.md)

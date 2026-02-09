# Infrastructure Test Application

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **infra-test** app is a test client for infrastructure operations that require calling actual services via HTTP endpoints.

## Current Use Case: Trial Reminder Cron Test

**TASK_2025_143**: Test client for manually triggering trial expiration workflow.

This script calls the license server's admin endpoint (`/admin/trial-reminder/trigger`) to execute the actual `TrialReminderService.handleTrialReminders()` method, testing the real implementation.

### Why This Approach

Unlike duplicating the cron job logic in a test script (which doesn't test the real code), this client:

1. **Tests the actual implementation** - The real `TrialReminderService` runs
2. **Tests the NestJS integration** - Dependency injection, Prisma, Email service all work together
3. **Tests production-like conditions** - Same code path as the daily cron job

### What It Tests

When triggered, the cron job:

1. Finds all expired trials (`status: 'trialing'` AND `trialEnd < NOW()`)
2. Downgrades each user to Community plan
3. Records trial reminder to prevent duplicates
4. Sends "Welcome to Community" email
5. Then processes 7-day, 3-day, 1-day reminders for active trials

## Prerequisites

### 1. Add ADMIN_SECRET to license server

```bash
# Add to apps/ptah-license-server/.env
ADMIN_SECRET=your-test-secret-here
```

### 2. Start the license server

```bash
nx serve ptah-license-server
```

### 3. Set up test data

Either via Prisma Studio or SQL, create a user with:

- `subscription.status = 'trialing'`
- `subscription.trial_end = <past date>`
- `license.plan = 'trial_pro'`

## Commands

```bash
# Show help
npm run test:trial-cron -- --help

# Trigger the cron job (requires ADMIN_SECRET in env)
ADMIN_SECRET=your-test-secret npm run test:trial-cron

# Or with inline secret
npm run test:trial-cron -- --secret=your-test-secret

# Custom server URL
npm run test:trial-cron -- --url=http://localhost:3001 --secret=your-test-secret
```

## Example Session

```bash
# Terminal 1: Start license server
cd D:\projects\ptah-extension
nx serve ptah-license-server

# Terminal 2: Run test client
ADMIN_SECRET=my-test-secret npm run test:trial-cron
```

### Expected Output

```
============================================================
Trial Reminder Cron Test Client
============================================================

Server URL: http://localhost:3000
Endpoint: POST http://localhost:3000/admin/trial-reminder/trigger

🚀 Triggering trial reminder cron job...

✅ Cron job executed successfully!

Message: Trial reminder cron job executed successfully

────────────────────────────────────────────────────────────

Next Steps:
  1. Check license server logs for detailed execution output
  2. Verify database changes in Prisma Studio:
     npm run prisma:studio
  3. Check if downgraded users appear in extension with Community plan
```

### License Server Logs

Watch the license server terminal for detailed logs:

```
[Nest] LOG [TrialReminderService] Manually triggering trial reminder job
[Nest] LOG [TrialReminderService] Starting daily trial reminder job
[Nest] DEBUG [TrialReminderService] Processing expired trial downgrades
[Nest] DEBUG [TrialReminderService] Found 1 expired trials to downgrade
[Nest] DEBUG [TrialReminderService] Downgraded test@example.com to Community plan
[Nest] LOG [TrialReminderService] Downgraded 1 expired trials to Community
[Nest] DEBUG [TrialReminderService] Processing 1_day reminders (1 days from expiry)
...
[Nest] LOG [TrialReminderService] Trial reminder job completed: 1 downgraded, 0 reminders sent in 245ms
```

## Verifying Results

### 1. Database Check (Prisma Studio)

```bash
npm run prisma:studio
```

Look for:

- `subscriptions` table: `status` changed from `trialing` to `expired`
- `licenses` table: `plan` changed from `trial_pro` to `community`
- `trial_reminders` table: New row with `reminder_type: 'expired'`

### 2. Profile Page Check

Open the landing page profile for the test user:

- Plan should show "Community"
- Status should show "Expired" or show Community tier

### 3. Extension Check

Open VS Code extension as the test user:

- Should see "Community Upgrade Banner" if trial just ended
- Settings should show "Community" tier

## Key Files

| File                                                                                 | Purpose                 |
| ------------------------------------------------------------------------------------ | ----------------------- |
| `src/main.ts`                                                                        | Test client entry point |
| `../ptah-license-server/src/trial-reminder/controllers/trial-reminder.controller.ts` | Admin endpoint          |
| `../ptah-license-server/src/trial-reminder/services/trial-reminder.service.ts`       | Actual cron job logic   |

## Security Notes

- The `/admin/trial-reminder/trigger` endpoint requires the `X-Admin-Secret` header
- Set `ADMIN_SECRET` environment variable in the license server
- Without `ADMIN_SECRET`, the endpoint returns 401 Unauthorized
- This endpoint should **NOT** be exposed in production without proper secrets

## Boundaries

**Belongs here**:

- HTTP test clients for admin endpoints
- Infrastructure testing scripts
- Cron job trigger utilities

**Does NOT belong**:

- Duplicating business logic (use HTTP to test real implementation)
- VS Code extension tests
- Frontend component tests

## Related Documentation

- [Trial Reminder Service](../ptah-license-server/src/trial-reminder/services/trial-reminder.service.ts)
- [Trial Reminder Controller](../ptah-license-server/src/trial-reminder/controllers/trial-reminder.controller.ts)
- [License Server](../ptah-license-server/CLAUDE.md)

# TASK_2025_143: Trial Expiration & Auto-Downgrade Testing Guide

## Overview

This guide covers how to test the trial expiration workflow, including:

- Auto-downgrade expired trials to Community plan
- Trial reminder emails (7, 3, 1 days before expiry)
- UI notifications in extension and landing page

## Prerequisites

### 1. Environment Setup

```bash
# Add ADMIN_SECRET to license server .env
echo "ADMIN_SECRET=your-test-secret-here" >> apps/ptah-license-server/.env

# Optional: Set short trial duration for faster testing (default: 14 days)
# Set to 1 for 1-day trial, or leave unset for 14-day default
echo "TRIAL_DURATION_DAYS=1" >> apps/ptah-license-server/.env
```

### Configurable Trial Duration

The trial duration can be configured via the `TRIAL_DURATION_DAYS` environment variable:

| Value   | Description                     |
| ------- | ------------------------------- |
| (unset) | Default 14-day trial            |
| `1`     | 1-day trial (for quick testing) |
| `7`     | 7-day trial                     |

**Note**: This only affects **new** trial licenses. Existing trials keep their original expiration date.

### 2. Start the License Server

```bash
nx serve ptah-license-server
```

### 3. Prepare Test User

Create or modify a user with an expired trial:

**Option A: Via Prisma Studio**

```bash
npm run prisma:studio
```

- Find the test user in `users` table
- In `subscriptions` table: Set `status = 'trialing'`, `trial_end = <past date>`
- In `licenses` table: Set `plan = 'trial_pro'`

**Option B: Via SQL**

```sql
-- Replace 'test@example.com' with your test user's email
UPDATE subscriptions
SET status = 'trialing', trial_end = NOW() - INTERVAL '1 day'
WHERE user_id = (SELECT id FROM users WHERE email = 'test@example.com');

UPDATE licenses
SET plan = 'trial_pro'
WHERE user_id = (SELECT id FROM users WHERE email = 'test@example.com');
```

## Testing the Cron Job

### Method 1: Via Admin Endpoint (Recommended)

This calls the **actual cron job implementation**, testing the real code path.

```bash
# From project root - run dry test first
npm run test:trial-cron -- --help

# Trigger the actual cron job
ADMIN_SECRET=your-test-secret npm run test:trial-cron
```

**Expected Output:**

```
============================================================
Trial Reminder Cron Test Client
============================================================

Server URL: http://localhost:3000
Endpoint: POST http://localhost:3000/admin/trial-reminder/trigger

🚀 Triggering trial reminder cron job...

✅ Cron job executed successfully!

Message: Trial reminder cron job executed successfully
```

### Method 2: Via curl

```bash
curl -X POST http://localhost:3000/admin/trial-reminder/trigger \
  -H "X-Admin-Secret: your-test-secret" \
  -H "Content-Type: application/json"
```

## Verifying Results

### 1. Check License Server Logs

Watch the terminal running the license server for detailed output:

```
[TrialReminderService] Manually triggering trial reminder job
[TrialReminderService] Starting daily trial reminder job
[TrialReminderService] Processing expired trial downgrades
[TrialReminderService] Found 1 expired trials to downgrade
[TrialReminderService] Downgraded test@example.com to Community plan
[TrialReminderService] Downgraded 1 expired trials to Community
[TrialReminderService] Trial reminder job completed: 1 downgraded, 0 reminders sent
```

### 2. Verify Database Changes

```bash
npm run prisma:studio
```

Check:

- **subscriptions**: `status` changed from `trialing` to `expired`
- **licenses**: `plan` changed from `trial_pro` to `community`
- **trial_reminders**: New row with `reminder_type = 'expired'`

### 3. Verify Landing Page

1. Log in as the test user
2. Go to `/pricing` page
3. The **Community card** should show:
   - "Current Plan" badge (green)
   - Alert inside the card: "Your Pro Trial Has Ended"

### 4. Verify Profile Page

1. Go to `/profile` page
2. Check:
   - Plan shows "Community"
   - Status shows appropriate value

### 5. Verify Extension UI

1. Open VS Code
2. Authenticate as the test user
3. In the chat view:
   - Should see "Community Upgrade Banner" (if trial just ended)
   - Settings should show "Community" tier

## Testing Trial Reminder Emails

The cron job also sends reminder emails. To test:

### Setup Users at Different Trial Stages

```sql
-- User 1: Trial expires in 7 days (gets 7_day reminder)
UPDATE subscriptions
SET status = 'trialing', trial_end = NOW() + INTERVAL '7 days'
WHERE user_id = (SELECT id FROM users WHERE email = 'user1@example.com');

-- User 2: Trial expires in 3 days (gets 3_day reminder)
UPDATE subscriptions
SET status = 'trialing', trial_end = NOW() + INTERVAL '3 days'
WHERE user_id = (SELECT id FROM users WHERE email = 'user2@example.com');

-- User 3: Trial expires tomorrow (gets 1_day reminder)
UPDATE subscriptions
SET status = 'trialing', trial_end = NOW() + INTERVAL '1 day'
WHERE user_id = (SELECT id FROM users WHERE email = 'user3@example.com');

-- User 4: Trial already expired (gets downgraded + email)
UPDATE subscriptions
SET status = 'trialing', trial_end = NOW() - INTERVAL '1 hour'
WHERE user_id = (SELECT id FROM users WHERE email = 'user4@example.com');
```

### Trigger Cron and Check Emails

```bash
ADMIN_SECRET=your-test-secret npm run test:trial-cron
```

Check SendGrid dashboard or email inbox for:

- 7-day reminder email
- 3-day reminder email
- 1-day reminder email
- "Welcome to Community" downgrade email

## Idempotency Testing

The cron job is idempotent - running it twice should NOT:

- Send duplicate emails
- Re-process already downgraded users

```bash
# Run twice
ADMIN_SECRET=your-test-secret npm run test:trial-cron
ADMIN_SECRET=your-test-secret npm run test:trial-cron
```

Second run should show:

```
[TrialReminderService] Found 0 expired trials to downgrade
```

## Resetting Test Data

To re-test, delete the trial reminder record:

```sql
DELETE FROM trial_reminders
WHERE user_id = (SELECT id FROM users WHERE email = 'test@example.com')
AND reminder_type = 'expired';

-- Reset subscription status
UPDATE subscriptions
SET status = 'trialing'
WHERE user_id = (SELECT id FROM users WHERE email = 'test@example.com');

-- Reset license plan
UPDATE licenses
SET plan = 'trial_pro'
WHERE user_id = (SELECT id FROM users WHERE email = 'test@example.com');
```

## Troubleshooting

### Admin endpoint returns 401

```
❌ Authentication failed!
   Check that ADMIN_SECRET matches the license server configuration.
```

**Fix**: Ensure `ADMIN_SECRET` in your command matches the one in `apps/ptah-license-server/.env`

### Connection refused

```
❌ Connection refused!
   Cannot connect to http://localhost:3000
```

**Fix**: Start the license server: `nx serve ptah-license-server`

### No expired trials found

```
[TrialReminderService] Found 0 expired trials to downgrade
```

**Check**:

1. Is `subscription.status = 'trialing'`? (not 'expired')
2. Is `subscription.trial_end < NOW()`?
3. Was this user already processed? Check `trial_reminders` table

### Emails not sending

Check:

1. `SENDGRID_API_KEY` is set in `.env`
2. Email templates exist in `EmailService`
3. No errors in license server logs

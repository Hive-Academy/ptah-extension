# Trial Expiration Testing Workflow

## Overview

This document provides a systematic approach to test the trial expiration workflow, ensuring:

1. License becomes invalid when trial ends
2. Extension blocks premium features
3. Landing page reflects trial-ended status correctly

---

## Prerequisites

- Access to Neon database (development branch)
- Test user account registered in the system
- Landing page running locally or on staging
- VS Code extension installed and activated

---

## Test User Setup

### Option A: Use Existing Test User

Find a user with a trialing subscription:

```sql
SELECT
  u.id as user_id,
  u.email,
  u.first_name,
  l.id as license_id,
  l.license_key,
  l.plan,
  l.status as license_status,
  s.id as subscription_id,
  s.status as subscription_status,
  s.trial_end
FROM users u
LEFT JOIN licenses l ON l.user_id = u.id
LEFT JOIN subscriptions s ON s.user_id = u.id
WHERE s.status = 'trialing'
ORDER BY u.created_at DESC
LIMIT 5;
```

### Option B: Create Test User via API

```bash
# Register new user (creates trial automatically)
curl -X POST https://your-api.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "trial-test@example.com", "firstName": "Test", "lastName": "User"}'
```

---

## Test Scenarios

### Scenario 1: Active Trial (Baseline)

**Setup**: User has `subscription.trial_end` in the future

**SQL to set active trial (7 days remaining)**:

```sql
UPDATE subscriptions
SET
  status = 'trialing',
  trial_end = NOW() + INTERVAL '7 days'
WHERE user_id = 'USER_UUID';
```

**Expected Results**:
| Component | Expected Behavior |
|-----------|-------------------|
| `GET /licenses/me` | `plan: 'pro'`, `status: 'active'`, `reason: undefined` |
| Extension - Chat | No trial banner (or shows "7 days remaining") |
| Extension - Settings | Shows "Trial Active - 7 days" |
| Landing - Profile | No modal, shows Pro plan |
| Landing - Pricing | No warning banner |
| Premium Features | ACCESSIBLE |

---

### Scenario 2: Trial Just Ended (Primary Test)

**Setup**: User has `subscription.trial_end` in the past, `subscription.status = 'trialing'`

**SQL to simulate trial ended**:

```sql
UPDATE subscriptions
SET
  status = 'trialing',
  trial_end = NOW() - INTERVAL '1 hour'
WHERE user_id = 'USER_UUID';
```

**Expected Results**:
| Component | Expected Behavior |
|-----------|-------------------|
| `GET /licenses/me` | `status: 'none'`, `reason: 'trial_ended'` |
| `POST /licenses/verify` | `valid: false`, `tier: 'expired'`, `reason: 'trial_ended'` |
| Extension - Chat | Trial-ended modal appears |
| Extension - Settings | Shows "Trial Expired" with upgrade CTA |
| Landing - Profile | Trial-ended modal with "Upgrade to Pro" button |
| Landing - Pricing | Warning banner "Your Pro Trial Has Ended" |
| Premium Features | BLOCKED |

---

### Scenario 3: User Upgraded from Trial to Paid

**Setup**: User was on trial, upgraded to paid Pro. Has `subscription.status = 'active'` and `license.status = 'active'`

**SQL to simulate upgraded user**:

```sql
-- First update subscription to active (paid)
UPDATE subscriptions
SET
  status = 'active',
  trial_end = NOW() - INTERVAL '7 days'  -- Trial ended a week ago
WHERE user_id = 'USER_UUID';

-- Ensure license is active
UPDATE licenses
SET status = 'active'
WHERE user_id = 'USER_UUID';
```

**Expected Results**:
| Component | Expected Behavior |
|-----------|-------------------|
| `GET /licenses/me` | `plan: 'pro'`, `status: 'active'`, `reason: undefined` |
| Extension | No trial modals, full Pro access |
| Landing - Profile | Shows "Pro" plan, no trial messaging |
| Premium Features | ACCESSIBLE |

---

### Scenario 4: Trial Ended, User Downgraded to Community

**Setup**: User trial ended, chose to continue with Community

**SQL to simulate community user**:

```sql
-- Update subscription status
UPDATE subscriptions
SET
  status = 'canceled',
  trial_end = NOW() - INTERVAL '7 days'
WHERE user_id = 'USER_UUID';

-- Update license to community
UPDATE licenses
SET
  plan = 'community',
  status = 'active'
WHERE user_id = 'USER_UUID';
```

**Expected Results**:
| Component | Expected Behavior |
|-----------|-------------------|
| `GET /licenses/me` | `plan: 'community'`, `status: 'active'`, `reason: undefined` |
| Extension | Community features only |
| Landing - Profile | Shows "Community" plan |
| Premium Features | BLOCKED (correctly, as Community) |

---

## API Verification Commands

### Check License Status

```bash
# Get license info for authenticated user
curl -X GET https://your-api.com/api/v1/licenses/me \
  -H "Authorization: Bearer YOUR_TOKEN" | jq
```

### Verify License Key

```bash
# Verify specific license key
curl -X POST https://your-api.com/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "ptah_lic_xxxxx"}' | jq
```

---

## Extension Verification

### Check License Status in Extension

1. Open VS Code Command Palette (`Ctrl+Shift+P`)
2. Run `Ptah: Check License Status`
3. Verify the notification shows correct status

### Test Premium Feature Gating

Try these premium features after trial ends - they should be blocked:

- [ ] MCP Server configuration
- [ ] Workspace Intelligence
- [ ] OpenRouter proxy
- [ ] Custom tools

---

## Automated Test Script

Save this as `test-trial-workflow.sql` and run in Neon SQL Editor:

```sql
-- ============================================
-- TRIAL EXPIRATION TEST SCRIPT
-- ============================================

-- Step 1: Find or create test user
-- (Replace with actual test user email)
DO $$
DECLARE
  test_user_id UUID;
  test_sub_id UUID;
BEGIN
  -- Get test user
  SELECT id INTO test_user_id
  FROM users
  WHERE email = 'trial-test@example.com';

  IF test_user_id IS NULL THEN
    RAISE NOTICE 'Test user not found. Please register first.';
    RETURN;
  END IF;

  RAISE NOTICE 'Test user ID: %', test_user_id;

  -- Get subscription
  SELECT id INTO test_sub_id
  FROM subscriptions
  WHERE user_id = test_user_id;

  IF test_sub_id IS NULL THEN
    RAISE NOTICE 'No subscription found for test user.';
    RETURN;
  END IF;

  RAISE NOTICE 'Subscription ID: %', test_sub_id;

  -- Set trial to expired (1 hour ago)
  UPDATE subscriptions
  SET
    status = 'trialing',
    trial_end = NOW() - INTERVAL '1 hour'
  WHERE id = test_sub_id;

  RAISE NOTICE 'Trial set to expired. Test the UI now!';
END $$;

-- Step 2: Verify the state
SELECT
  'User' as entity,
  u.email,
  u.first_name
FROM users u
WHERE u.email = 'trial-test@example.com'

UNION ALL

SELECT
  'License' as entity,
  l.plan,
  l.status
FROM licenses l
JOIN users u ON l.user_id = u.id
WHERE u.email = 'trial-test@example.com'

UNION ALL

SELECT
  'Subscription' as entity,
  s.status,
  s.trial_end::text
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE u.email = 'trial-test@example.com';
```

---

## Reset Script

To reset test user back to active trial:

```sql
-- Reset to active trial (14 days remaining)
UPDATE subscriptions
SET
  status = 'trialing',
  trial_end = NOW() + INTERVAL '14 days'
WHERE user_id = (
  SELECT id FROM users WHERE email = 'trial-test@example.com'
);

-- Ensure license is pro and active
UPDATE licenses
SET
  plan = 'pro',
  status = 'active'
WHERE user_id = (
  SELECT id FROM users WHERE email = 'trial-test@example.com'
);
```

---

## Checklist

### Pre-Test

- [ ] Test user exists in database
- [ ] User has subscription and license records
- [ ] Landing page accessible
- [ ] Extension installed and activated

### Scenario 2 Test (Trial Ended)

- [ ] Run SQL to set trial_end in past
- [ ] API returns `reason: 'trial_ended'`
- [ ] Landing Profile shows modal
- [ ] Landing Pricing shows banner
- [ ] Extension shows trial-ended modal
- [ ] Premium features are blocked

### Post-Test

- [ ] Reset test user if needed
- [ ] Clear localStorage/sessionStorage for fresh test

---

## Troubleshooting

### Modal Not Showing

1. Check localStorage for dismissal key:
   ```javascript
   localStorage.getItem('ptah_trial_ended_dismissed');
   ```
2. Clear it to force modal to show:
   ```javascript
   localStorage.removeItem('ptah_trial_ended_dismissed');
   ```

### API Not Returning `reason`

Verify the subscription state:

```sql
SELECT
  status,
  trial_end,
  trial_end < NOW() as is_expired
FROM subscriptions
WHERE user_id = 'USER_UUID';
```

The `reason: 'trial_ended'` is only returned when:

- `subscription.status = 'trialing'`
- `subscription.trial_end < NOW()`
- `license.status != 'active'` (user hasn't upgraded)

### Extension Not Showing Modal

1. Check VS Code Developer Tools console for errors
2. Verify license status via Command Palette
3. Check if ChatStore.licenseStatus() is populated

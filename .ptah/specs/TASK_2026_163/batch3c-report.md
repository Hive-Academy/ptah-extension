# TASK_2026_163 Batch 3c — CLI/TUI License Copy Repoint Report

**Scope:** Repoint CLI/TUI license-related copy from premium-gating framing to Ptah Builders membership framing. Backend gating already removed; no runtime behavior changes to the `ptah license` command family.

**Branch:** `ak/elevate-video-and-tasks`

---

## Files touched

| File                                                       | Change summary                                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-cli/src/cli/router.ts`                          | Removed `premium-gated` wording from `ptah prompts` command description and `regenerate` subcommand description/comment.                     |
| `apps/ptah-cli/src/cli/commands/prompts.ts`                | Removed `premium-gated` and `premium gate` wording from file header JSDoc.                                                                   |
| `apps/ptah-cli/src/cli/commands/doctor.ts`                 | Rewrote license hint to neutral Builders-membership framing.                                                                                 |
| `apps/ptah-cli/src/cli/commands/init.ts`                   | Rewrote license step copy, intro note, and `stepLicense` prompts/labels to membership framing; removed raw tier display from success note.   |
| `apps/ptah-cli/src/cli/commands/license.ts`                | **Reviewed, no changes.** No premium/gating wording present; command family identity kept as `license`.                                      |
| `apps/ptah-tui/src/components/settings/LicenseSection.tsx` | Replaced Pro/Trial/Community labels with membership labels, removed trial countdown UI, switched key actions/messages to membership wording. |
| `apps/ptah-cli/src/cli/jsonrpc/types.ts`                   | **Kept unchanged.** `license_required` wire enum retained per instructions.                                                                  |

---

## Before / after copy snippets

### 1. `apps/ptah-cli/src/cli/router.ts`

**Before:**

```typescript
// Backed by shared EnhancedPromptsRpcHandlers. The `regenerate`
// sub-subcommand is premium-gated (license_required is surfaced by the
// backend and converted to a task.error).
const prompts = program.command('prompts').description('manage Enhanced Prompts (status / enable / disable / regenerate / show / download) — premium-gated');
```

**After:**

```typescript
// Backed by shared EnhancedPromptsRpcHandlers.
const prompts = program.command('prompts').description('manage Enhanced Prompts (status / enable / disable / regenerate / show / download)');
```

**Before:**

```typescript
    .description(
      'regenerate the project prompt via enhancedPrompts:regenerate (premium-gated; streams via setup-wizard:enhance-stream)',
    )
```

**After:**

```typescript
    .description(
      'regenerate the project prompt via enhancedPrompts:regenerate (streams via setup-wizard:enhance-stream)',
    )
```

### 2. `apps/ptah-cli/src/cli/commands/prompts.ts`

**Before:**

```typescript
/**
 * `ptah prompts` command — Enhanced Prompts management (premium-gated).
 *
 * ...
 *   regenerate            RPC `enhancedPrompts:regenerate` (premium gate;
 *                                                          streams via
 *                                                          `setup-wizard:enhance-stream`)
```

**After:**

```typescript
/**
 * `ptah prompts` command — Enhanced Prompts management.
 *
 * ...
 *   regenerate            RPC `enhancedPrompts:regenerate` (streams via
 *                                                          `setup-wizard:enhance-stream`)
```

### 3. `apps/ptah-cli/src/cli/commands/doctor.ts`

**Before:**

```typescript
if (license.valid === false) {
  hints.push('Set your Ptah license: `ptah license set --key ptah_lic_...`');
}
```

**After:**

```typescript
if (license.valid === false) {
  hints.push('Optional: link your Ptah Builders membership with `ptah license set --key ptah_lic_...`');
}
```

### 4. `apps/ptah-cli/src/cli/commands/init.ts`

**Before:**

```typescript
  steps.push({
    id: 'license',
    description:
      'Set a Ptah license key (optional — Community tier works without one)',
    command: 'ptah license set --key ptah_lic_...',
```

**After:**

```typescript
  steps.push({
    id: 'license',
    description:
      'Link a Ptah Builders membership key (optional — Community tier works without one)',
    command: 'ptah license set --key ptah_lic_...',
```

**Before:**

```typescript
  p.note(
    [
      'Three things get you running:',
      '  1. A Ptah license (optional — Community tier works without one)',
      ...
```

**After:**

```typescript
  p.note(
    [
      'Three things get you running:',
      '  1. A Ptah Builders membership key (optional — Community tier works without one)',
      ...
```

**Before:**

```typescript
  const hasLicense = await p.confirm({
    message: 'Do you have a Ptah license key?',
    ...
  });
  if (hasLicense !== true) {
    p.log.info(
      'Community tier is fine for most usage — continuing without a license.',
    );
  }
  const key = await p.password({
    message: 'Paste your license key (ptah_lic_...)',
  });
  spin.start('Validating license key');
  spin.stop('License check complete');
  ...
  p.note(
    `Tier: ${status?.tier ?? result.tier ?? 'unknown'}`,
    'License activated',
  );
  } else {
    p.log.error(
      `License rejected: ${result?.error ?? 'invalid key'}. Continuing on Community tier.`,
    );
```

**After:**

```typescript
  const hasLicense = await p.confirm({
    message: 'Do you have a Ptah Builders membership key?',
    ...
  });
  if (hasLicense !== true) {
    p.log.info(
      'Community tier is fine for most usage — continuing without a membership key.',
    );
  }
  const key = await p.password({
    message: 'Paste your membership key (ptah_lic_...)',
  });
  spin.start('Validating membership key');
  spin.stop('Membership check complete');
  ...
  p.note(
    'Your Ptah Builders membership key is now linked.',
    'Membership key linked',
  );
  } else {
    p.log.error(
      `Membership key rejected: ${result?.error ?? 'invalid key'}. Continuing on Community tier.`,
    );
```

### 5. `apps/ptah-tui/src/components/settings/LicenseSection.tsx`

**Before:**

```typescript
interface LicenseStatus {
  valid: boolean;
  tier: string;
  isPremium: boolean;
  isCommunity: boolean;
  daysRemaining: number | null;
  trialActive: boolean;
  trialDaysRemaining: number | null;
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  reason?: 'expired' | 'trial_ended' | 'no_license';
  ...
}

const ACTIONS = ['Enter License Key', 'Clear License'] as const;

function tierBadgeVariant(tier: string): BadgeVariant {
  if (tier === 'pro') return 'success';
  if (tier === 'trial_pro') return 'warning';
  if (tier === 'community') return 'ghost';
  return 'ghost';
}

function tierLabel(tier: string): string {
  if (tier === 'pro') return 'Pro';
  if (tier === 'trial_pro') return 'Trial';
  if (tier === 'community') return 'Community';
  return tier;
}
```

**After:**

```typescript
interface LicenseStatus {
  valid: boolean;
  tier: string;
  daysRemaining: number | null;
  plan?: {
    name: string;
  };
  ...
}

const ACTIONS = ['Enter Membership Key', 'Clear Membership Key'] as const;

function tierBadgeVariant(tier: string): BadgeVariant {
  if (tier === 'pro') return 'success';
  if (tier === 'community') return 'ghost';
  return 'ghost';
}

function tierLabel(tier: string): string {
  if (tier === 'pro') return 'Builders member';
  if (tier === 'community') return 'Community';
  return tier;
}
```

**Before:**

```tsx
        <Box gap={1}>
          <Text>Tier:</Text>
          <Badge variant={tierBadgeVariant(tier)}>{tierLabel(tier)}</Badge>
          <Badge variant={status?.valid ? 'success' : 'error'}>
            {status?.valid ? 'Valid' : 'Invalid'}
          </Badge>
        </Box>

        ...

        {status?.trialActive && status.trialDaysRemaining !== null && (
          <Box>
            <Text color={theme.status.warning}>Trial: </Text>
            <Text>{status.trialDaysRemaining} days remaining</Text>
          </Box>
        )}
```

**After:**

```tsx
<Box gap={1}>
  <Text>Membership:</Text>
  <Badge variant={tierBadgeVariant(tier)}>{tierLabel(tier)}</Badge>
  <Badge variant={status?.valid ? 'success' : 'error'}>{status?.valid ? 'Active' : 'Invalid'}</Badge>
</Box>;

{
  /* trial countdown block removed */
}
```

User-facing messages/spinner labels were also updated:

- `License key activated successfully` → `Membership key linked`
- `License key cleared` → `Membership key cleared`
- `Loading license status...` → `Loading membership status...`
- `Verifying license key...` → `Verifying membership key...`
- placeholder `Paste license key and press Enter` → `Paste membership key and press Enter`

---

## Acceptance verification

### Grep for prohibited premium-gating phrases

Command run (equivalent to the requested shell command, excluding `*.spec.ts`):

```bash
grep -rniE "premium.gated|pro.only|upgrade to pro" apps/ptah-cli/src apps/ptah-tui/src
```

**Result:** `No matches found` in both directories.

### `ptah license` command family intact

`apps/ptah-cli/src/cli/commands/license.ts` was not modified. The `status`/`set`/`clear` subcommands, their RPC method names (`license:getStatus`, `license:setKey`, `license:clearKey`), and the `license_required` error code in `apps/ptah-cli/src/cli/jsonrpc/types.ts` remain unchanged.

### Typecheck

```bash
npx nx run ptah-cli:typecheck
```

Result: `Successfully ran target typecheck for project ptah-cli`

```bash
npx nx run ptah-tui:typecheck
```

Result: `Successfully ran target typecheck for project ptah-tui`

---

## Notes / out-of-scope

- `apps/ptah-cli/src/cli/commands/config.ts` contains an internal YOLO-mode regex (`/pro subscription|pro tier|pro-?required/i`) used to detect legacy gate messages so the bypass can act on them. It is not user-facing copy, not premium-gating framing, and not in the target file list; left untouched.
- `license.ts` had no premium/gating wording; left untouched.
- `license_required` wire enum in `apps/ptah-cli/src/cli/jsonrpc/types.ts` kept as instructed.
- No `.spec.ts` files were modified.
- No git commit was made.

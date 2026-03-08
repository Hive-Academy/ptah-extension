# Development Tasks - TASK_2025_142

**Total Tasks**: 16 | **Batches**: 5 | **Status**: 5/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- [x] `license:getStatus` RPC returns `trialActive`, `trialDaysRemaining`, `reason` fields - VERIFIED in `rpc.types.ts:677-706`
- [x] Banner pattern exists (signal inputs, DaisyUI alert) - VERIFIED in `compaction-notification.component.ts`
- [x] Modal pattern exists (DaisyUI modal-box) - VERIFIED in `confirmation-dialog.component.ts`
- [x] EmailService has retry logic and template pattern - VERIFIED in `email.service.ts:104-134`
- [x] NestJS module import pattern - VERIFIED in `app.module.ts:35-72`
- [x] Prisma schema supports new models - VERIFIED in `schema.prisma`

### Risks Identified

| Risk                                               | Severity | Mitigation                                         |
| -------------------------------------------------- | -------- | -------------------------------------------------- |
| ChatStore does not expose licenseStatus signal     | MEDIUM   | Task 1.1 adds license status signal to ChatStore   |
| app-shell.component has no license status fetching | MEDIUM   | Task 1.4 adds license status fetching to app-shell |
| @nestjs/schedule not installed                     | LOW      | Task 2.1 adds npm dependency                       |
| sendWithRetry method is private                    | LOW      | Refactor in Task 3.4 to reuse existing method      |

### Edge Cases to Handle

- [ ] User dismisses banner, then trial expires -> Should show modal (handled in Task 1.3)
- [ ] Trial ends at exactly 0 days -> Banner shows "expires today" (handled in Task 1.1)
- [ ] User upgrades during trial -> No reminder emails sent (handled in Task 3.2 query filter)
- [ ] Cron job runs while previous job still running -> Use @Cron mutex (handled in Task 3.2)
- [ ] SendGrid rate limiting -> Batch processing with delays (handled in Task 3.2)

---

## Batch 1: Frontend Components (Chat Store + Trial Banner + Modal) - COMPLETE

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Add License Status Signal to ChatStore

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`

**Spec Reference**: implementation-plan.md:346-385 (Data Flow section)

**Pattern to Follow**: `settings.component.ts:243-279` (fetchLicenseStatus pattern)

**Description**: Add a `licenseStatus` signal to ChatStore that holds the license status response. Add a method `fetchLicenseStatus()` that calls `license:getStatus` RPC and updates the signal. This is needed because chat-view needs license data for the trial banner.

**Quality Requirements**:

- Signal must be readonly for external consumers
- Method must handle RPC errors gracefully
- Should be called on ChatStore initialization

**Implementation Details**:

- Import: `LicenseGetStatusResponse` from `@ptah-extension/shared`
- Add signal: `private readonly _licenseStatus = signal<LicenseGetStatusResponse | null>(null)`
- Add readonly: `readonly licenseStatus = this._licenseStatus.asReadonly()`
- Add method: `async fetchLicenseStatus(): Promise<void>` using `ClaudeRpcService`
- Call in initialization (existing init method or add one)

**Acceptance Criteria**:

- [ ] `licenseStatus` signal exposed from ChatStore
- [ ] `fetchLicenseStatus()` method calls `license:getStatus` RPC
- [ ] Error handling does not crash the app (sets null on error)
- [ ] Signal updates trigger change detection in consuming components

---

### Task 1.2: Create Trial Banner Component

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\trial-banner.component.ts`

**Spec Reference**: implementation-plan.md:237-343 (Component Specification)

**Pattern to Follow**: `compaction-notification.component.ts:1-57`

**Description**: Create a new TrialBannerComponent that displays trial countdown at top of chat view with urgency-based styling. Follows the exact specification in the implementation plan.

**Quality Requirements**:

- Use signal inputs (Angular 20+ pattern)
- Use ChangeDetectionStrategy.OnPush
- Use DaisyUI alert classes (alert-info, alert-warning, alert-error)
- Session-scoped dismissal via sessionStorage
- Click banner opens pricing page via RPC

**Implementation Details**:

- Imports: `LucideAngularModule`, `Clock`, `X` from lucide-angular
- Inputs: `trialActive: input<boolean>(false)`, `trialDaysRemaining: input<number | null>(null)`
- Internal signal: `dismissed = signal(false)`
- Computed signals: `shouldShow()`, `urgencyLevel()`, `bannerText()`
- Method: `openPricing()` using ClaudeRpcService `command:execute` with `ptah.openPricing`
- Method: `dismiss(event: Event)` with `event.stopPropagation()`
- SessionStorage key: `ptah_trial_banner_dismissed`

**Acceptance Criteria**:

- [ ] Banner shows when `trialActive=true` AND `trialDaysRemaining > 0` AND not dismissed
- [ ] Banner uses `alert-info` when days > 3
- [ ] Banner uses `alert-warning` when days <= 3
- [ ] Banner uses `alert-error` when days <= 1
- [ ] Banner text shows "X days remaining in your Pro trial"
- [ ] Banner text shows "Trial expires tomorrow - Upgrade now" when days = 1
- [ ] Banner text shows "Trial expires today - Upgrade now" when days = 0
- [ ] Clicking banner opens pricing page
- [ ] Dismiss button hides banner for session
- [ ] Dismiss persists to sessionStorage

---

### Task 1.3: Integrate Trial Banner into Chat View

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`

**Spec Reference**: implementation-plan.md:359-373

**Pattern to Follow**: `CompactionNotificationComponent` integration in same file

**Description**: Import TrialBannerComponent and add it to the chat-view template after the session stats summary and before the message list.

**Quality Requirements**:

- Pass `trialActive` and `trialDaysRemaining` from `chatStore.licenseStatus()`
- Use null-safe access (licenseStatus may be null)
- Banner should be inside a padding wrapper for consistent spacing

**Implementation Details**:

- Add import: `TrialBannerComponent` from `../molecules/trial-banner.component`
- Add to imports array in @Component decorator
- Template: Add `<div class="px-3">` wrapper after session stats
- Template: Add `<ptah-trial-banner [trialActive]="..." [trialDaysRemaining]="..." />`

**Acceptance Criteria**:

- [ ] TrialBannerComponent imported and added to component imports
- [ ] Banner appears in chat view when trial is active
- [ ] Banner positioned after session stats, before message list
- [ ] Banner receives correct data from ChatStore.licenseStatus()

---

### Task 1.4: Create Trial Ended Modal Component

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\trial-ended-modal.component.ts`

**Spec Reference**: implementation-plan.md:389-536 (Component Specification)

**Pattern to Follow**: `confirmation-dialog.component.ts`

**Description**: Create a modal component that appears when the user's trial has ended. Shows feature comparison and upgrade/continue CTAs. Has 24-hour dismissal cooldown stored in localStorage.

**Quality Requirements**:

- Use DaisyUI modal pattern (modal, modal-open, modal-box)
- Use signal inputs for `reason`
- 24-hour dismissal via localStorage with TTL check
- Primary CTA: "Upgrade to Pro" opens pricing
- Secondary CTA: "Continue with Community" dismisses

**Implementation Details**:

- Imports: `LucideAngularModule`, `Clock`, `Sparkles`, `Zap`, `Shield`, `Bot` from lucide-angular
- Input: `reason: input<string | undefined>(undefined)`
- Internal signal: `isOpen = signal(false)`
- LocalStorage key: `ptah_trial_ended_dismissed_at`
- TTL constant: `DISMISS_TTL_MS = 24 * 60 * 60 * 1000`
- OnInit: Check if reason is 'trial_ended' AND not dismissed within TTL
- Methods: `upgradeToPro()`, `continueWithCommunity()`, `dismiss()`

**Acceptance Criteria**:

- [ ] Modal appears when `reason === 'trial_ended'`
- [ ] Modal does NOT appear if dismissed within 24 hours
- [ ] Modal shows after 24-hour cooldown expires
- [ ] "Upgrade to Pro" button opens pricing page via RPC
- [ ] "Continue with Community" button dismisses modal and sets localStorage
- [ ] Modal displays Pro features list (4 items as per spec)
- [ ] Backdrop click dismisses modal

---

### Task 1.5: Integrate Trial Ended Modal into App Shell

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`

**Spec Reference**: implementation-plan.md:539-565

**Pattern to Follow**: `ConfirmationDialogComponent` integration in same file

**Description**: Import TrialEndedModalComponent, add license status fetching to app-shell, and add the modal to the template. The modal needs the `reason` field from license status to determine when to show.

**Quality Requirements**:

- Add license status fetching similar to settings.component.ts
- Create `licenseReason` signal to pass to modal
- Modal should be at end of template (after main content, before closing div)

**Implementation Details**:

- Add import: `TrialEndedModalComponent` from `../molecules/trial-ended-modal.component`
- Add signals: `licenseReason = signal<string | undefined>(undefined)`
- Add method: `fetchLicenseStatus()` similar to settings.component.ts pattern
- Call `fetchLicenseStatus()` in constructor or use `afterNextRender`
- Template: Add `<ptah-trial-ended-modal [reason]="licenseReason()" />` at end

**Acceptance Criteria**:

- [ ] TrialEndedModalComponent imported and added to component imports
- [ ] License status fetched on app-shell initialization
- [ ] `licenseReason` signal populated from `license:getStatus` response
- [ ] Modal rendered in template with reason input bound
- [ ] Modal appears when trial has ended and not dismissed within 24 hours

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build ptah-extension-webview`
- code-logic-reviewer approved
- Edge cases: Banner dismissal + trial expiry shows modal

---

## Batch 2: Enhanced Settings Trial Status Section - COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None (can run parallel with Batch 1)

### Task 2.1: Add Trial Status Computed Signals to Settings Component

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts`

**Spec Reference**: implementation-plan.md:569-627

**Pattern to Follow**: Existing computed signals in same file (e.g., `tierDisplayName`, `showTrialInfo`)

**Description**: Add new computed signals to the settings component for enhanced trial status display: `trialEndDate`, `trialProgress`, `trialUrgencyLevel`, `trialStatusText`.

**Quality Requirements**:

- All new computed signals must be readonly
- Date formatting should use `toLocaleDateString` with 'en-US' locale
- Progress calculation: `(days / 14) * 100`, clamped 0-100

**Implementation Details**:

- `trialEndDate = computed(() => {...})` - Returns formatted date string or null
- `trialProgress = computed(() => {...})` - Returns 0-100 percentage
- `trialUrgencyLevel = computed((): 'info' | 'warning' | 'error' => {...})`
- `trialStatusText = computed(() => {...})` - Returns "X days remaining" or "Expires today/tomorrow"

**Acceptance Criteria**:

- [ ] `trialEndDate` computed signal returns human-readable date
- [ ] `trialProgress` computed signal returns 0-100 percentage
- [ ] `trialUrgencyLevel` returns 'error' for days <= 1, 'warning' for days <= 3, 'info' otherwise
- [ ] `trialStatusText` returns appropriate text based on days remaining
- [ ] All signals are readonly and computed from existing `trialDaysRemaining` signal

---

### Task 2.2: Update Settings Template with Enhanced Trial Status Section

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html`

**Spec Reference**: implementation-plan.md:630-706

**Pattern to Follow**: Existing trial info section at lines 107-115

**Description**: Replace the simple trial info display with an enhanced section featuring: urgency-based border/background colors, progress bar, end date, and upgrade CTA. Also add a "Trial Expired" section for when `licenseTier() === 'expired' && licenseReason() === 'trial_ended'`.

**Quality Requirements**:

- Use DaisyUI classes for styling (border-info, border-warning, border-error, bg-info/5, etc.)
- Progress bar should use matching urgency colors
- Maintain compact VS Code sidebar design (text-sm, text-xs, btn-xs)

**Implementation Details**:

- Add `licenseReason = signal<string | undefined>(undefined)` to component
- Populate `licenseReason` from `fetchLicenseStatus()` response
- Replace lines 107-115 with enhanced trial status section
- Add conditional "Trial Expired" section after the enhanced section
- Progress bar: `<div class="w-full h-2 bg-base-300 rounded-full"><div [style.width.%]="trialProgress()" .../></div>`

**Acceptance Criteria**:

- [ ] Trial status section shows progress bar with urgency-based color
- [ ] Trial status section shows end date in human-readable format
- [ ] Trial status section shows badge with "X days remaining" or "Expires today/tomorrow"
- [ ] Border and background colors match urgency level (info/warning/error)
- [ ] "Upgrade to Pro" button present and functional
- [ ] "Trial Expired" section shows when trial has ended

---

**Batch 2 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build ptah-extension-webview`
- code-logic-reviewer approved
- Visual verification of progress bar and urgency styling

---

## Batch 3: Backend Database Schema + npm Dependency - COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None (can run parallel with frontend batches)

### Task 3.1: Install @nestjs/schedule Package

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\package.json` (root)

**Spec Reference**: implementation-plan.md:711-718

**Description**: Install the `@nestjs/schedule` package which provides cron job functionality for NestJS. This is required for the daily trial reminder job.

**Quality Requirements**:

- Use npm install (not yarn)
- Verify package.json is updated

**Implementation Details**:

- Run: `npm install @nestjs/schedule`
- Verify: `@nestjs/schedule` appears in package.json dependencies

**Acceptance Criteria**:

- [ ] `@nestjs/schedule` package installed
- [ ] package.json updated with dependency
- [ ] No npm audit vulnerabilities introduced

---

### Task 3.2: Add TrialReminder Model to Prisma Schema

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`

**Spec Reference**: implementation-plan.md:724-755

**Pattern to Follow**: `FailedWebhook` model in same file (lines 78-96)

**Description**: Add a new `TrialReminder` model to track sent reminder emails and prevent duplicates. Also add a `trialReminders` relation to the `User` model.

**Quality Requirements**:

- Use UUID for id field
- Use snake_case for database column names (@map decorator)
- Add unique constraint on (userId, reminderType)
- Add indexes for common query patterns

**Implementation Details**:

```prisma
model TrialReminder {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  reminderType String   @map("reminder_type") // "7_day" | "3_day" | "1_day" | "expired"
  sentAt       DateTime @default(now()) @map("sent_at")
  emailSentTo  String   @map("email_sent_to")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, reminderType])
  @@index([userId])
  @@index([reminderType])
  @@map("trial_reminders")
}
```

- Add `trialReminders TrialReminder[]` to User model

**Acceptance Criteria**:

- [ ] TrialReminder model added with all specified fields
- [ ] Unique constraint on (userId, reminderType)
- [ ] Indexes on userId and reminderType
- [ ] User model has trialReminders relation
- [ ] Schema is valid (prisma format passes)

---

### Task 3.3: Run Prisma Migration

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\*` (new migration)

**Spec Reference**: implementation-plan.md:2517

**Pattern to Follow**: Existing migrations in same directory

**Description**: Run `prisma migrate dev` to create a new migration for the TrialReminder model and regenerate the Prisma client.

**Quality Requirements**:

- Migration should be named descriptively (e.g., "add_trial_reminder")
- Client should be regenerated after migration
- Migration should not break existing data

**Implementation Details**:

- Run: `npx prisma migrate dev --name add_trial_reminder` from `apps/ptah-license-server` directory
- Verify: Migration file created in `prisma/migrations/`
- Verify: `generated-prisma-client` updated

**Acceptance Criteria**:

- [ ] Migration file created with proper SQL
- [ ] Migration applies without errors
- [ ] Prisma client regenerated with TrialReminder model
- [ ] `npx prisma generate` completes successfully

---

**Batch 3 Verification**:

- npm install completed
- Prisma schema valid
- Migration applied successfully
- Prisma client regenerated

---

## Batch 4: Backend Trial Reminder Services - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 3 (Prisma schema must exist)

### Task 4.1: Create TrialReminderModule

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\trial-reminder\trial-reminder.module.ts`

**Spec Reference**: implementation-plan.md:760-794

**Pattern to Follow**: `license.module.ts` or `email.module.ts`

**Description**: Create a new NestJS module that imports ScheduleModule.forRoot(), PrismaModule, and EmailModule. Provides TrialReminderService.

**Quality Requirements**:

- Use ScheduleModule.forRoot() for cron support
- Import existing PrismaModule and EmailModule
- Export TrialReminderService for testing

**Implementation Details**:

```typescript
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, EmailModule],
  providers: [TrialReminderService],
  exports: [TrialReminderService],
})
export class TrialReminderModule {}
```

**Acceptance Criteria**:

- [ ] Module file created at specified path
- [ ] ScheduleModule.forRoot() imported
- [ ] PrismaModule and EmailModule imported
- [ ] TrialReminderService provided and exported

---

### Task 4.2: Create TrialReminderService with Cron Job

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\trial-reminder\services\trial-reminder.service.ts`

**Spec Reference**: implementation-plan.md:799-998

**Pattern to Follow**: EmailService patterns for logging and error handling

**Description**: Create the TrialReminderService with a daily cron job at 9:00 AM UTC. The job queries for trials expiring at 7, 3, 1, and 0 days, filters out users who already received that reminder type, sends emails, and records sent reminders.

**Quality Requirements**:

- Cron runs daily at 9:00 AM UTC
- Batch processing (50 emails per batch) with 30-second delays
- Idempotent: No duplicate emails (unique constraint + pre-check)
- Error handling: Log errors but continue processing
- Rate limiting: 100 emails/minute max

**Implementation Details**:

- Use `@Cron('0 9 * * *', { name: 'trial-reminder-job', timeZone: 'UTC' })`
- ReminderType: `'7_day' | '3_day' | '1_day' | 'expired'`
- Query pattern: Find subscriptions WHERE status='trialing' AND trialEnd in date range
- Filter: Exclude users with existing TrialReminder for that type
- Methods: `handleTrialReminders()`, `processReminderType()`, `sendReminderEmail()`, `sleep()`
- Add `triggerManually()` for testing

**Acceptance Criteria**:

- [ ] Cron job scheduled for 9:00 AM UTC daily
- [ ] Processes 7-day, 3-day, 1-day, and expired reminders
- [ ] Queries Prisma for eligible users correctly
- [ ] Excludes users who already received reminder
- [ ] Excludes users who have upgraded (non-trialing status)
- [ ] Sends appropriate email via EmailService
- [ ] Creates TrialReminder record after successful send
- [ ] Batch processing with delays for rate limiting
- [ ] Errors logged but do not stop processing
- [ ] `triggerManually()` method for testing

---

### Task 4.3: Add Trial Reminder Email Methods to EmailService

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\email\services\email.service.ts`

**Spec Reference**: implementation-plan.md:1004-1128

**Pattern to Follow**: Existing `sendLicenseKey()` and `sendMagicLink()` methods

**Description**: Add four new public methods to EmailService: `sendTrialReminder7Day()`, `sendTrialReminder3Day()`, `sendTrialReminder1Day()`, `sendTrialExpired()`. Each method creates a MailDataRequired object and calls `sendWithRetry()`.

**Quality Requirements**:

- Follow existing sendLicenseKey pattern exactly
- Use sendWithRetry with 3 attempts
- Log sending and success messages
- Use config for from email/name

**Implementation Details**:

- Method signature: `async sendTrialReminder7Day(params: { email: string; firstName: string | null; trialEnd: Date }): Promise<void>`
- Similar for 3-day, 1-day
- `sendTrialExpired` does not need `trialEnd` parameter
- Subject lines as per spec
- Call corresponding private template methods

**Acceptance Criteria**:

- [ ] `sendTrialReminder7Day()` method added
- [ ] `sendTrialReminder3Day()` method added
- [ ] `sendTrialReminder1Day()` method added
- [ ] `sendTrialExpired()` method added
- [ ] All methods use `sendWithRetry()` with 3 attempts
- [ ] All methods log sending and success messages
- [ ] All methods use ConfigService for from email/name

---

### Task 4.4: Add Trial Reminder Email Templates to EmailService

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\email\services\email.service.ts`

**Spec Reference**: implementation-plan.md:1130-1417

**Pattern to Follow**: Existing `getLicenseKeyTemplate()` and `getMagicLinkTemplate()` methods

**Description**: Add four private template methods: `getTrialReminder7DayTemplate()`, `getTrialReminder3DayTemplate()`, `getTrialReminder1DayTemplate()`, `getTrialExpiredTemplate()`. Each returns an HTML string with the email content.

**Quality Requirements**:

- Use consistent styling with existing templates
- Include personalized greeting (firstName or "Hi there")
- Include CTA button linking to pricing page
- Use FRONTEND_URL from config
- Format dates using toLocaleDateString

**Implementation Details**:

- 7-day template: Blue countdown badge, feature list, "Upgrade Now" CTA
- 3-day template: Amber/orange badge, Pro vs Community comparison table, "Upgrade to Pro" CTA
- 1-day template: Red urgent badge, warning box, prominent "Upgrade Now" CTA
- Expired template: Status box, community info, "View Plans" CTA
- All templates follow existing CSS styling conventions

**Acceptance Criteria**:

- [ ] `getTrialReminder7DayTemplate()` returns valid HTML with 7-day styling
- [ ] `getTrialReminder3DayTemplate()` returns valid HTML with comparison table
- [ ] `getTrialReminder1DayTemplate()` returns valid HTML with urgent styling
- [ ] `getTrialExpiredTemplate()` returns valid HTML with expired status
- [ ] All templates have personalized greeting
- [ ] All templates have working CTA buttons with pricing URL
- [ ] Date formatting is human-readable

---

**Batch 4 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build ptah-license-server`
- code-logic-reviewer approved
- Cron job can be triggered manually for testing

---

## Batch 5: Module Integration + Component Exports - COMPLETE

**Developer**: backend-developer (first task) + frontend-developer (second task)
**Tasks**: 2 | **Dependencies**: Batch 4 (services must exist)

### Task 5.1: Import TrialReminderModule in AppModule

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts`

**Spec Reference**: implementation-plan.md:1424-1445

**Pattern to Follow**: Existing module imports in same file

**Description**: Import the TrialReminderModule in the root AppModule to enable the cron job.

**Quality Requirements**:

- Add import statement
- Add to imports array
- Add comment referencing TASK_2025_142

**Implementation Details**:

```typescript
import { TrialReminderModule } from '../trial-reminder/trial-reminder.module';

@Module({
  imports: [
    // ... existing imports
    TrialReminderModule, // TASK_2025_142: Trial reminder email notifications
  ],
})
```

**Acceptance Criteria**:

- [ ] Import statement added
- [ ] TrialReminderModule added to imports array
- [ ] Comment references task ID
- [ ] Server starts without errors

---

### Task 5.2: Export New Components from Chat Library Index

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\index.ts`

**Spec Reference**: implementation-plan.md:1668

**Pattern to Follow**: Existing component exports in same file

**Description**: Export the new TrialBannerComponent and TrialEndedModalComponent from the chat library's component index file so they can be imported by other libraries if needed.

**Quality Requirements**:

- Export both components
- Maintain alphabetical ordering of exports

**Implementation Details**:

- Add: `export * from './molecules/trial-banner.component';`
- Add: `export * from './molecules/trial-ended-modal.component';`

**Acceptance Criteria**:

- [ ] TrialBannerComponent exported
- [ ] TrialEndedModalComponent exported
- [ ] Build passes: `npx nx build chat`

---

**Batch 5 Verification**:

- All imports/exports correct
- Backend server starts: `npx nx serve ptah-license-server`
- Frontend builds: `npx nx build ptah-extension-webview`
- No circular dependency errors

---

## Status Icons Reference

| Status      | Meaning                         | Who Sets              |
| ----------- | ------------------------------- | --------------------- |
| PENDING     | Not started                     | team-leader (initial) |
| IN PROGRESS | Assigned to developer           | team-leader           |
| IMPLEMENTED | Developer done, awaiting verify | developer             |
| COMPLETE    | Verified and committed          | team-leader           |
| FAILED      | Verification failed             | team-leader           |

---

## Files Summary

### CREATE (New Files)

| File                                                                             | Batch |
| -------------------------------------------------------------------------------- | ----- |
| `libs/frontend/chat/src/lib/components/molecules/trial-banner.component.ts`      | 1     |
| `libs/frontend/chat/src/lib/components/molecules/trial-ended-modal.component.ts` | 1     |
| `apps/ptah-license-server/src/trial-reminder/trial-reminder.module.ts`           | 4     |
| `apps/ptah-license-server/src/trial-reminder/services/trial-reminder.service.ts` | 4     |

### MODIFY (Existing Files)

| File                                                                       | Batch | Changes                       |
| -------------------------------------------------------------------------- | ----- | ----------------------------- |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                        | 1     | Add licenseStatus signal      |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`   | 1     | Import and add TrialBanner    |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` | 1     | Add trial banner element      |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`   | 1     | Add license status fetching   |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` | 1     | Add trial ended modal         |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`                | 2     | Add computed signals          |
| `libs/frontend/chat/src/lib/settings/settings.component.html`              | 2     | Enhanced trial status section |
| `package.json`                                                             | 3     | Add @nestjs/schedule          |
| `apps/ptah-license-server/prisma/schema.prisma`                            | 3     | Add TrialReminder model       |
| `apps/ptah-license-server/src/email/services/email.service.ts`             | 4     | Add email methods + templates |
| `apps/ptah-license-server/src/app/app.module.ts`                           | 5     | Import TrialReminderModule    |
| `libs/frontend/chat/src/lib/components/index.ts`                           | 5     | Export new components         |

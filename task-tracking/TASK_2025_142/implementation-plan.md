# Implementation Plan - TASK_2025_142

## Trial Subscription Experience Enhancement

---

## 1. Architecture Overview

```
                                    FRONTEND (Extension Webview)
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Chat View (chat-view.component.ts)                                   │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │ NEW: TrialBannerComponent (dismissible, session-scoped)        │ │   │
│  │  │ - Shows "X days remaining in trial"                            │ │   │
│  │  │ - Color changes at 3/1 day thresholds                          │ │   │
│  │  │ - Click → external pricing page                                │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │ Message List / Chat Content                                     │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ App Shell (app-shell.component.ts)                                   │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │ NEW: TrialEndedModalComponent (modal dialog)                    │ │   │
│  │  │ - Shows when license status returns reason: 'trial_ended'      │ │   │
│  │  │ - 24-hour dismissal cooldown via localStorage                  │ │   │
│  │  │ - Primary CTA: "Upgrade to Pro"                                │ │   │
│  │  │ - Secondary CTA: "Continue with Community"                      │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Settings (settings.component.ts)                                     │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │ ENHANCED: Trial Status Section                                  │ │   │
│  │  │ - Visual progress bar for trial days                           │ │   │
│  │  │ - Human-readable end date                                      │ │   │
│  │  │ - Warning/error styling at thresholds                          │ │   │
│  │  │ - Upgrade CTA                                                  │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Data Source: license:getStatus RPC (existing)                              │
│  Returns: { trialActive, trialDaysRemaining, reason, tier, ... }           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ RPC (license:getStatus)
                                          ▼
                                    BACKEND (VS Code Extension)
┌─────────────────────────────────────────────────────────────────────────────┐
│  License RPC Handlers → License Server API                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ HTTPS (verify endpoint)
                                          ▼
                                    LICENSE SERVER (NestJS)
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ NEW: TrialReminderModule                                             │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │ TrialReminderService                                           │ │   │
│  │  │ - @Cron('0 9 * * *') - Daily at 9:00 AM UTC                    │ │   │
│  │  │ - Query trials expiring at 7, 3, 1, 0 days                     │ │   │
│  │  │ - Send reminder emails via EmailService                        │ │   │
│  │  │ - Track sent reminders (prevent duplicates)                    │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │ EmailService (enhanced)                                        │ │   │
│  │  │ - NEW: sendTrialReminder7Day()                                 │ │   │
│  │  │ - NEW: sendTrialReminder3Day()                                 │ │   │
│  │  │ - NEW: sendTrialReminder1Day()                                 │ │   │
│  │  │ - NEW: sendTrialExpired()                                      │ │   │
│  │  │ - NEW: Private templates for each type                         │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Database: PostgreSQL via Prisma                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ NEW: TrialReminder model                                             │   │
│  │ - userId (FK → User)                                                │   │
│  │ - reminderType (enum: 7_day, 3_day, 1_day, expired)                 │   │
│  │ - sentAt (DateTime)                                                 │   │
│  │ - Unique constraint: (userId, reminderType)                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Codebase Investigation Summary

### Libraries Discovered

| Library                  | Purpose            | Key Patterns                                  |
| ------------------------ | ------------------ | --------------------------------------------- |
| `@ptah-extension/chat`   | Chat UI components | Atomic Design, signal-based state, DaisyUI    |
| `@ptah-extension/core`   | Frontend services  | ClaudeRpcService for RPC calls, VSCodeService |
| `@ptah-extension/shared` | Type contracts     | LicenseGetStatusResponse, RpcMethodRegistry   |
| `ptah-license-server`    | Backend API        | NestJS modules, Prisma ORM, EmailService      |

### Existing Patterns Verified

**Frontend Banner Pattern** (Evidence: `compaction-notification.component.ts:1-57`)

```typescript
// Pattern: Signal input, DaisyUI alert, conditional rendering
@Component({
  selector: 'ptah-compaction-notification',
  imports: [LucideAngularModule],
  template: `
    @if (isCompacting()) {
    <div class="alert alert-warning shadow-lg mb-4 py-2 px-3 animate-pulse">...</div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactionNotificationComponent {
  readonly isCompacting = input.required<boolean>();
}
```

**Modal Pattern** (Evidence: `confirmation-dialog.component.ts:1-55`)

```typescript
// Pattern: DaisyUI modal with service-driven state
@Component({
  template: `
    <dialog #dialog class="modal" [class.modal-open]="dialogService.isOpen()">
      <div class="modal-box max-w-sm">
        ...
        <div class="modal-action">
          <button class="btn btn-ghost" (click)="handleCancel()">Cancel</button>
          <button class="btn btn-primary" (click)="handleConfirm()">Confirm</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button (click)="handleCancel()">close</button>
      </form>
    </dialog>
  `,
})
```

**License Status Pattern** (Evidence: `settings.component.ts:243-279`)

```typescript
// Pattern: Fetch via RPC, update signals
private async fetchLicenseStatus(): Promise<void> {
  this.isLoadingLicenseStatus.set(true);
  try {
    const result = await this.rpcService.call('license:getStatus', {});
    if (result.isSuccess() && result.data) {
      const data = result.data as LicenseGetStatusResponse;
      this.trialActive.set(data.trialActive);
      this.trialDaysRemaining.set(data.trialDaysRemaining);
      // ...
    }
  } finally {
    this.isLoadingLicenseStatus.set(false);
  }
}
```

**NestJS Module Pattern** (Evidence: `app.module.ts:1-73`)

```typescript
// Pattern: Feature modules with ConfigModule, ThrottlerModule
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([...]),
    EventEmitterModule.forRoot(),
    PrismaModule,
    LicenseModule,
    EmailModule,
  ],
})
export class AppModule {}
```

**Email Template Pattern** (Evidence: `email.service.ts:153-213`)

```typescript
// Pattern: Private method returning HTML string
private getLicenseKeyTemplate(params: {
  licenseKey: string;
  plan: string;
  expiresAt: Date | null;
}): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <style>
        body { font-family: -apple-system, ...; }
        .license-key { background-color: #F7FAFC; ... }
      </style>
    </head>
    <body>
      <h1>Welcome to Ptah Premium!</h1>
      ...
    </body>
    </html>
  `;
}
```

### RPC Types Verified (Evidence: `rpc.types.ts:677-706`)

```typescript
export interface LicenseGetStatusResponse {
  valid: boolean;
  tier: LicenseTier;
  isPremium: boolean;
  isCommunity: boolean;
  daysRemaining: number | null;
  trialActive: boolean;
  trialDaysRemaining: number | null;
  plan?: { name: string; description: string; features: string[] };
  reason?: 'expired' | 'trial_ended' | 'no_license';
  user?: { email: string; firstName: string | null; lastName: string | null };
}
```

---

## 3. Component Design

### 3.1 Trial Countdown Banner Component

**File Location**: `libs/frontend/chat/src/lib/components/molecules/trial-banner.component.ts`

**Purpose**: Display trial countdown at top of chat view with urgency-based styling

**Component Specification**:

```typescript
/**
 * TrialBannerComponent - Trial countdown banner for chat view
 *
 * TASK_2025_142: Requirement 1
 *
 * Displays trial days remaining with urgency-based styling:
 * - Green/info (> 3 days): Informational countdown
 * - Amber/warning (3 days): Urgency indicator
 * - Red/error (1 day): Critical urgency
 *
 * Behavior:
 * - Dismissible per session (sessionStorage)
 * - Click banner → open pricing page
 * - Only shows when trialActive && trialDaysRemaining > 0
 *
 * Complexity Level: 1 (Simple molecule with conditional styling)
 */
@Component({
  selector: 'ptah-trial-banner',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shouldShow()) {
    <div class="alert shadow-sm mb-2 py-2 px-3 cursor-pointer" [class.alert-info]="urgencyLevel() === 'info'" [class.alert-warning]="urgencyLevel() === 'warning'" [class.alert-error]="urgencyLevel() === 'error'" (click)="openPricing()" role="button" tabindex="0" (keydown.enter)="openPricing()" aria-label="Trial banner - click to view pricing">
      <div class="flex items-center justify-between w-full gap-2">
        <div class="flex items-center gap-2">
          <lucide-angular [img]="ClockIcon" class="w-4 h-4 flex-shrink-0" />
          <span class="text-sm font-medium">
            {{ bannerText() }}
          </span>
        </div>
        <button class="btn btn-ghost btn-xs" (click)="dismiss($event)" aria-label="Dismiss trial banner">
          <lucide-angular [img]="XIcon" class="w-3 h-3" />
        </button>
      </div>
    </div>
    }
  `,
})
export class TrialBannerComponent {
  // Inputs from parent (chat-view)
  readonly trialActive = input<boolean>(false);
  readonly trialDaysRemaining = input<number | null>(null);

  // Internal state
  private readonly dismissed = signal(false);

  // Icons
  protected readonly ClockIcon = Clock;
  protected readonly XIcon = X;

  // Session storage key
  private readonly DISMISS_KEY = 'ptah_trial_banner_dismissed';

  constructor() {
    // Check if dismissed this session
    this.dismissed.set(sessionStorage.getItem(this.DISMISS_KEY) === 'true');
  }

  // Computed: Should the banner be displayed?
  readonly shouldShow = computed(() => {
    return this.trialActive() && this.trialDaysRemaining() !== null && this.trialDaysRemaining()! > 0 && !this.dismissed();
  });

  // Computed: Urgency level for styling
  readonly urgencyLevel = computed((): 'info' | 'warning' | 'error' => {
    const days = this.trialDaysRemaining();
    if (days === null) return 'info';
    if (days <= 1) return 'error';
    if (days <= 3) return 'warning';
    return 'info';
  });

  // Computed: Banner text
  readonly bannerText = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return '';
    if (days === 1) return 'Trial expires tomorrow - Upgrade now';
    if (days === 0) return 'Trial expires today - Upgrade now';
    return `${days} days remaining in your Pro trial`;
  });

  // RPC service for opening pricing
  private readonly rpcService = inject(ClaudeRpcService);

  async openPricing(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }

  dismiss(event: Event): void {
    event.stopPropagation();
    this.dismissed.set(true);
    sessionStorage.setItem(this.DISMISS_KEY, 'true');
  }
}
```

**Integration Point**: `chat-view.component.ts` and `chat-view.component.html`

```typescript
// Add to imports
import { TrialBannerComponent } from '../molecules/trial-banner.component';

// Add to @Component imports array
imports: [
  // ...existing imports
  TrialBannerComponent,
],
```

```html
<!-- chat-view.component.html - Add after session stats, before message list -->
<div class="flex flex-col h-full">
  <!-- Session Stats Summary -->
  @if (chatStore.messages().length > 0) { ... }

  <!-- NEW: Trial Banner -->
  <div class="px-3">
    <ptah-trial-banner [trialActive]="chatStore.licenseStatus()?.trialActive ?? false" [trialDaysRemaining]="chatStore.licenseStatus()?.trialDaysRemaining ?? null" />
  </div>

  <!-- Message List -->
  <div class="flex-1 overflow-y-auto ..."></div>
</div>
```

**Data Flow**:

```
ChatStore.licenseStatus (signal)
    ↓
ChatViewComponent (passes to child)
    ↓
TrialBannerComponent (renders conditionally)
    ↓
User clicks → command:execute RPC → ptah.openPricing
```

---

### 3.2 Trial-Ended Modal Component

**File Location**: `libs/frontend/chat/src/lib/components/molecules/trial-ended-modal.component.ts`

**Purpose**: Modal dialog shown when trial has ended, prompting upgrade

**Component Specification**:

```typescript
/**
 * TrialEndedModalComponent - Modal for trial expiration
 *
 * TASK_2025_142: Requirement 2
 *
 * Displays when license:getStatus returns reason: 'trial_ended'
 * - Primary CTA: "Upgrade to Pro" → open pricing page
 * - Secondary CTA: "Continue with Community" → dismiss for 24 hours
 * - Feature comparison snippet
 *
 * 24-hour dismissal tracked in localStorage with TTL
 *
 * Complexity Level: 2 (Modal with localStorage TTL logic)
 */
@Component({
  selector: 'ptah-trial-ended-modal',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="modal" [class.modal-open]="isOpen()">
      <div class="modal-box max-w-md">
        <!-- Header -->
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-full bg-warning/20 flex items-center justify-center">
            <lucide-angular [img]="ClockIcon" class="w-6 h-6 text-warning" />
          </div>
          <div>
            <h3 class="font-bold text-lg">Your Pro Trial Has Ended</h3>
            <p class="text-sm text-base-content/70">Your 14-day Pro trial period has concluded</p>
          </div>
        </div>

        <!-- Feature comparison -->
        <div class="bg-base-200 rounded-lg p-4 mb-4">
          <h4 class="font-semibold text-sm mb-2">Pro features you'll miss:</h4>
          <ul class="space-y-2 text-sm">
            <li class="flex items-center gap-2">
              <lucide-angular [img]="SparklesIcon" class="w-4 h-4 text-primary" />
              <span>Advanced multi-agent orchestration</span>
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular [img]="ZapIcon" class="w-4 h-4 text-primary" />
              <span>Priority API access & faster responses</span>
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular [img]="ShieldIcon" class="w-4 h-4 text-primary" />
              <span>Extended context window & memory</span>
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular [img]="BotIcon" class="w-4 h-4 text-primary" />
              <span>Custom agent creation & MCP tools</span>
            </li>
          </ul>
        </div>

        <!-- Community tier info -->
        <p class="text-sm text-base-content/70 mb-4">You can continue using Ptah with the Community tier, which includes basic AI assistance and standard features.</p>

        <!-- Actions -->
        <div class="modal-action flex-col sm:flex-row gap-2">
          <button class="btn btn-ghost flex-1" (click)="continueWithCommunity()">Continue with Community</button>
          <button class="btn btn-primary flex-1" (click)="upgradeToPro()">
            <lucide-angular [img]="SparklesIcon" class="w-4 h-4" />
            Upgrade to Pro
          </button>
        </div>
      </div>

      <!-- Backdrop -->
      <form method="dialog" class="modal-backdrop">
        <button (click)="continueWithCommunity()">close</button>
      </form>
    </dialog>
  `,
})
export class TrialEndedModalComponent implements OnInit {
  // Input: License status reason
  readonly reason = input<string | undefined>(undefined);

  // Internal state
  readonly isOpen = signal(false);

  // Icons
  protected readonly ClockIcon = Clock;
  protected readonly SparklesIcon = Sparkles;
  protected readonly ZapIcon = Zap;
  protected readonly ShieldIcon = Shield;
  protected readonly BotIcon = Bot;

  // LocalStorage key and TTL (24 hours)
  private readonly DISMISS_KEY = 'ptah_trial_ended_dismissed_at';
  private readonly DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  private readonly rpcService = inject(ClaudeRpcService);

  ngOnInit(): void {
    this.checkAndShowModal();
  }

  private checkAndShowModal(): void {
    // Only show if reason is 'trial_ended'
    if (this.reason() !== 'trial_ended') {
      this.isOpen.set(false);
      return;
    }

    // Check if dismissed within TTL
    const dismissedAt = localStorage.getItem(this.DISMISS_KEY);
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      const now = Date.now();
      if (now - dismissedTime < this.DISMISS_TTL_MS) {
        // Still within 24-hour cooldown
        this.isOpen.set(false);
        return;
      }
    }

    // Show modal
    this.isOpen.set(true);
  }

  async upgradeToPro(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
    this.dismiss();
  }

  continueWithCommunity(): void {
    this.dismiss();
  }

  private dismiss(): void {
    this.isOpen.set(false);
    localStorage.setItem(this.DISMISS_KEY, Date.now().toString());
  }
}
```

**Integration Point**: `app-shell.component.ts`

```typescript
// Add to imports
import { TrialEndedModalComponent } from './molecules/trial-ended-modal.component';

// Add to template (at end, before closing </div>)
template: `
  <div class="h-full flex flex-col">
    <!-- Existing content -->
    ...

    <!-- Trial Ended Modal -->
    <ptah-trial-ended-modal [reason]="licenseReason()" />
  </div>
`;
```

**Trigger Logic**:

```
App initializes → app-shell.component fetches license:getStatus
    ↓
If response.reason === 'trial_ended'
    ↓
TrialEndedModalComponent shows (unless dismissed < 24 hours ago)
```

---

### 3.3 Enhanced Settings Trial Status Section

**File Location**: `libs/frontend/chat/src/lib/settings/settings.component.ts` (existing)
**File Location**: `libs/frontend/chat/src/lib/settings/settings.component.html` (existing)

**Purpose**: Enhanced trial status display with progress indicator and urgency styling

**Changes Required**:

```typescript
// settings.component.ts - Add new computed signals

/**
 * Computed: Trial end date in human-readable format
 */
readonly trialEndDate = computed(() => {
  const days = this.trialDaysRemaining();
  if (days === null) return null;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  return endDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
});

/**
 * Computed: Trial progress percentage (for visual indicator)
 * 14 days = 100%, 0 days = 0%
 */
readonly trialProgress = computed(() => {
  const days = this.trialDaysRemaining();
  if (days === null) return 0;
  return Math.max(0, Math.min(100, (days / 14) * 100));
});

/**
 * Computed: Trial urgency level for styling
 */
readonly trialUrgencyLevel = computed((): 'info' | 'warning' | 'error' => {
  const days = this.trialDaysRemaining();
  if (days === null) return 'info';
  if (days <= 1) return 'error';
  if (days <= 3) return 'warning';
  return 'info';
});

/**
 * Computed: Trial status text
 */
readonly trialStatusText = computed(() => {
  const days = this.trialDaysRemaining();
  if (days === null) return '';
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `${days} days remaining`;
});
```

```html
<!-- settings.component.html - Replace trial info section (lines 107-115) -->

<!-- Enhanced Trial Status Section -->
@if (showTrialInfo()) {
<div
  class="border rounded-md p-3 mb-2"
  [class.border-info]="trialUrgencyLevel() === 'info'"
  [class.border-warning]="trialUrgencyLevel() === 'warning'"
  [class.border-error]="trialUrgencyLevel() === 'error'"
  [class.bg-info/5]="trialUrgencyLevel() === 'info'"
  [class.bg-warning/5]="trialUrgencyLevel() === 'warning'"
  [class.bg-error/5]="trialUrgencyLevel() === 'error'"
>
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-1.5">
      <lucide-angular [img]="ClockIcon" class="w-4 h-4" />
      <span class="text-sm font-medium">Pro Trial Status</span>
    </div>
    <span
      class="badge badge-xs"
      [class.badge-info]="trialUrgencyLevel() === 'info'"
      [class.badge-warning]="trialUrgencyLevel() === 'warning'"
      [class.badge-error]="trialUrgencyLevel() === 'error'"
    >
      {{ trialStatusText() }}
    </span>
  </div>

  <!-- Progress bar -->
  <div class="w-full h-2 bg-base-300 rounded-full overflow-hidden mb-2">
    <div
      class="h-full transition-all duration-300"
      [class.bg-info]="trialUrgencyLevel() === 'info'"
      [class.bg-warning]="trialUrgencyLevel() === 'warning'"
      [class.bg-error]="trialUrgencyLevel() === 'error'"
      [style.width.%]="trialProgress()"
    ></div>
  </div>

  <!-- End date -->
  @if (trialEndDate()) {
  <p class="text-xs text-base-content/60 mb-2">
    Ends on {{ trialEndDate() }}
  </p>
  }

  <!-- Upgrade CTA -->
  <button
    class="btn btn-primary btn-xs w-full gap-1"
    (click)="openPricing()"
  >
    <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
    Upgrade to Pro
  </button>
</div>
}

<!-- Trial Expired Status (when reason === 'trial_ended') -->
@if (licenseTier() === 'expired' && licenseReason() === 'trial_ended') {
<div class="border border-error rounded-md p-3 mb-2 bg-error/5">
  <div class="flex items-center gap-1.5 mb-2">
    <lucide-angular [img]="ClockIcon" class="w-4 h-4 text-error" />
    <span class="text-sm font-medium text-error">Trial Expired</span>
  </div>
  <p class="text-xs text-base-content/60 mb-2">
    Your 14-day Pro trial has ended. Upgrade to restore Pro features.
  </p>
  <button
    class="btn btn-primary btn-xs w-full gap-1"
    (click)="openPricing()"
  >
    <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
    Upgrade to Pro
  </button>
</div>
}
```

---

## 4. Backend Changes (License Server)

### 4.1 Install @nestjs/schedule Package

**Command**:

```bash
npm install @nestjs/schedule
```

**File**: `apps/ptah-license-server/package.json` - Add dependency

---

### 4.2 Prisma Schema Update

**File**: `apps/ptah-license-server/prisma/schema.prisma`

```prisma
// Add after FailedWebhook model (line 96)

// TrialReminder model - tracks sent trial reminder emails to prevent duplicates
// TASK_2025_142: Trial expiration email notifications
model TrialReminder {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  reminderType String   @map("reminder_type") // "7_day" | "3_day" | "1_day" | "expired"
  sentAt       DateTime @default(now()) @map("sent_at")
  emailSentTo  String   @map("email_sent_to") // Email address at time of send

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Unique constraint: only one reminder of each type per user
  @@unique([userId, reminderType])
  @@index([userId])
  @@index([reminderType])
  @@map("trial_reminders")
}

// Update User model to add relation
model User {
  // ... existing fields
  trialReminders TrialReminder[]
  // ...
}
```

---

### 4.3 TrialReminderModule

**File**: `apps/ptah-license-server/src/trial-reminder/trial-reminder.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { TrialReminderService } from './services/trial-reminder.service';

/**
 * TrialReminderModule - Scheduled trial reminder email notifications
 *
 * TASK_2025_142: Requirement 4
 *
 * Provides:
 * - ScheduleModule for cron job support
 * - TrialReminderService with daily cron job
 * - EmailService integration for sending reminders
 *
 * Cron Schedule: Daily at 9:00 AM UTC
 *
 * Reminder Types:
 * - 7_day: 7 days before trial expires
 * - 3_day: 3 days before trial expires
 * - 1_day: 1 day before trial expires
 * - expired: Day trial expires
 */
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, EmailModule],
  providers: [TrialReminderService],
  exports: [TrialReminderService],
})
export class TrialReminderModule {}
```

---

### 4.4 TrialReminderService

**File**: `apps/ptah-license-server/src/trial-reminder/services/trial-reminder.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';

/**
 * Reminder type enum for type safety
 */
type ReminderType = '7_day' | '3_day' | '1_day' | 'expired';

/**
 * TrialReminderService - Daily cron job for trial expiration email reminders
 *
 * TASK_2025_142: Requirement 4
 *
 * Runs daily at 9:00 AM UTC to:
 * 1. Find trials expiring at 7, 3, 1, and 0 days
 * 2. Filter out users who already received that reminder type
 * 3. Filter out users who have already upgraded (non-trialing status)
 * 4. Send appropriate reminder email
 * 5. Record sent reminder to prevent duplicates
 *
 * Rate limiting: Batches of 50 emails, 100 emails/minute max
 */
@Injectable()
export class TrialReminderService {
  private readonly logger = new Logger(TrialReminderService.name);

  // Batch size for email sends (memory efficiency)
  private readonly BATCH_SIZE = 50;
  // Delay between batches (rate limiting: 100/minute = ~600ms between 50-email batches)
  private readonly BATCH_DELAY_MS = 30000; // 30 seconds for safety margin

  constructor(private readonly prisma: PrismaService, private readonly emailService: EmailService) {}

  /**
   * Daily cron job - runs at 9:00 AM UTC
   *
   * CronExpression format: second minute hour day-of-month month day-of-week
   * '0 9 * * *' = At 09:00 every day
   */
  @Cron('0 9 * * *', {
    name: 'trial-reminder-job',
    timeZone: 'UTC',
  })
  async handleTrialReminders(): Promise<void> {
    this.logger.log('Starting daily trial reminder job');

    const startTime = Date.now();
    let totalSent = 0;

    try {
      // Process each reminder type in sequence
      const reminderConfigs: { type: ReminderType; daysFromExpiry: number }[] = [
        { type: 'expired', daysFromExpiry: 0 },
        { type: '1_day', daysFromExpiry: 1 },
        { type: '3_day', daysFromExpiry: 3 },
        { type: '7_day', daysFromExpiry: 7 },
      ];

      for (const config of reminderConfigs) {
        const sent = await this.processReminderType(config.type, config.daysFromExpiry);
        totalSent += sent;
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Trial reminder job completed: ${totalSent} emails sent in ${duration}ms`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Trial reminder job failed: ${errorMessage}`);
    }
  }

  /**
   * Process a specific reminder type (7_day, 3_day, 1_day, expired)
   *
   * @param type - Reminder type to process
   * @param daysFromExpiry - Days from trial expiry (0 = expiring today)
   * @returns Number of emails sent
   */
  private async processReminderType(type: ReminderType, daysFromExpiry: number): Promise<number> {
    this.logger.debug(`Processing ${type} reminders (${daysFromExpiry} days from expiry)`);

    // Calculate target date range (start of day to end of day for the target date)
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysFromExpiry);

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Find subscriptions with trialing status where trialEnd is within target date
    // Exclude users who already received this reminder type
    const eligibleUsers = await this.prisma.subscription.findMany({
      where: {
        status: 'trialing',
        trialEnd: {
          gte: startOfDay,
          lte: endOfDay,
        },
        user: {
          // Exclude users who already received this reminder
          trialReminders: {
            none: {
              reminderType: type,
            },
          },
        },
      },
      include: {
        user: true,
      },
      take: 1000, // Safety limit
    });

    this.logger.debug(`Found ${eligibleUsers.length} eligible users for ${type} reminder`);

    if (eligibleUsers.length === 0) {
      return 0;
    }

    // Process in batches
    let sentCount = 0;
    for (let i = 0; i < eligibleUsers.length; i += this.BATCH_SIZE) {
      const batch = eligibleUsers.slice(i, i + this.BATCH_SIZE);

      for (const subscription of batch) {
        try {
          await this.sendReminderEmail(type, subscription.user.email, subscription.user.firstName, subscription.trialEnd!);

          // Record sent reminder (prevent duplicates)
          await this.prisma.trialReminder.create({
            data: {
              userId: subscription.userId,
              reminderType: type,
              emailSentTo: subscription.user.email,
            },
          });

          sentCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(`Failed to send ${type} reminder to ${subscription.user.email}: ${errorMessage}`);
          // Continue processing other users
        }
      }

      // Delay between batches for rate limiting
      if (i + this.BATCH_SIZE < eligibleUsers.length) {
        await this.sleep(this.BATCH_DELAY_MS);
      }
    }

    this.logger.debug(`Sent ${sentCount} ${type} reminders`);
    return sentCount;
  }

  /**
   * Send the appropriate reminder email based on type
   */
  private async sendReminderEmail(type: ReminderType, email: string, firstName: string | null, trialEnd: Date): Promise<void> {
    switch (type) {
      case '7_day':
        await this.emailService.sendTrialReminder7Day({ email, firstName, trialEnd });
        break;
      case '3_day':
        await this.emailService.sendTrialReminder3Day({ email, firstName, trialEnd });
        break;
      case '1_day':
        await this.emailService.sendTrialReminder1Day({ email, firstName, trialEnd });
        break;
      case 'expired':
        await this.emailService.sendTrialExpired({ email, firstName });
        break;
    }
  }

  /**
   * Sleep utility for batch delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for testing (not exposed via controller)
   * Can be called via CLI or test framework
   */
  async triggerManually(): Promise<void> {
    this.logger.log('Manually triggering trial reminder job');
    await this.handleTrialReminders();
  }
}
```

---

### 4.5 EmailService Enhancement

**File**: `apps/ptah-license-server/src/email/services/email.service.ts`

Add the following methods after `sendMagicLink`:

```typescript
// ============================================================
// Trial Reminder Email Methods (TASK_2025_142)
// ============================================================

/**
 * Send 7-day trial reminder email
 *
 * @param params - Email, firstName, trialEnd date
 * @throws Error after 3 failed retry attempts
 */
async sendTrialReminder7Day(params: {
  email: string;
  firstName: string | null;
  trialEnd: Date;
}): Promise<void> {
  const { email, firstName, trialEnd } = params;

  const msg: MailDataRequired = {
    to: email,
    from: {
      email:
        this.config.get<string>('SENDGRID_FROM_EMAIL') || 'help@ptah.live',
      name: this.config.get<string>('SENDGRID_FROM_NAME') || 'Ptah Team',
    },
    subject: 'Your Ptah Pro trial ends in 7 days',
    html: this.getTrialReminder7DayTemplate({ firstName, trialEnd }),
  };

  this.logger.log(`Sending 7-day trial reminder to ${email}`);
  await this.sendWithRetry(msg, 3);
  this.logger.log(`7-day trial reminder sent successfully to ${email}`);
}

/**
 * Send 3-day trial reminder email
 *
 * @param params - Email, firstName, trialEnd date
 * @throws Error after 3 failed retry attempts
 */
async sendTrialReminder3Day(params: {
  email: string;
  firstName: string | null;
  trialEnd: Date;
}): Promise<void> {
  const { email, firstName, trialEnd } = params;

  const msg: MailDataRequired = {
    to: email,
    from: {
      email:
        this.config.get<string>('SENDGRID_FROM_EMAIL') || 'help@ptah.live',
      name: this.config.get<string>('SENDGRID_FROM_NAME') || 'Ptah Team',
    },
    subject: '3 days left in your Ptah Pro trial',
    html: this.getTrialReminder3DayTemplate({ firstName, trialEnd }),
  };

  this.logger.log(`Sending 3-day trial reminder to ${email}`);
  await this.sendWithRetry(msg, 3);
  this.logger.log(`3-day trial reminder sent successfully to ${email}`);
}

/**
 * Send 1-day trial reminder email
 *
 * @param params - Email, firstName, trialEnd date
 * @throws Error after 3 failed retry attempts
 */
async sendTrialReminder1Day(params: {
  email: string;
  firstName: string | null;
  trialEnd: Date;
}): Promise<void> {
  const { email, firstName, trialEnd } = params;

  const msg: MailDataRequired = {
    to: email,
    from: {
      email:
        this.config.get<string>('SENDGRID_FROM_EMAIL') || 'help@ptah.live',
      name: this.config.get<string>('SENDGRID_FROM_NAME') || 'Ptah Team',
    },
    subject: 'Your Ptah Pro trial ends tomorrow',
    html: this.getTrialReminder1DayTemplate({ firstName, trialEnd }),
  };

  this.logger.log(`Sending 1-day trial reminder to ${email}`);
  await this.sendWithRetry(msg, 3);
  this.logger.log(`1-day trial reminder sent successfully to ${email}`);
}

/**
 * Send trial expired notification email
 *
 * @param params - Email, firstName
 * @throws Error after 3 failed retry attempts
 */
async sendTrialExpired(params: {
  email: string;
  firstName: string | null;
}): Promise<void> {
  const { email, firstName } = params;

  const msg: MailDataRequired = {
    to: email,
    from: {
      email:
        this.config.get<string>('SENDGRID_FROM_EMAIL') || 'help@ptah.live',
      name: this.config.get<string>('SENDGRID_FROM_NAME') || 'Ptah Team',
    },
    subject: 'Your Ptah Pro trial has ended',
    html: this.getTrialExpiredTemplate({ firstName }),
  };

  this.logger.log(`Sending trial expired notification to ${email}`);
  await this.sendWithRetry(msg, 3);
  this.logger.log(`Trial expired notification sent successfully to ${email}`);
}

// ============================================================
// Trial Reminder Email Templates (TASK_2025_142)
// ============================================================

/**
 * 7-day trial reminder email template
 */
private getTrialReminder7DayTemplate(params: {
  firstName: string | null;
  trialEnd: Date;
}): string {
  const { firstName, trialEnd } = params;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
  const endDate = trialEnd.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const frontendUrl =
    this.config.get<string>('FRONTEND_URL') || 'https://ptah.dev';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Ptah Pro trial ends in 7 days</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #4A5568; margin-bottom: 20px; }
        .countdown-badge { display: inline-block; background-color: #3182CE; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
        .feature-list { background-color: #F7FAFC; border-radius: 8px; padding: 16px; margin: 20px 0; }
        .feature-item { display: flex; align-items: center; margin-bottom: 8px; }
        .feature-icon { width: 20px; height: 20px; margin-right: 8px; color: #48BB78; }
        .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
      </style>
    </head>
    <body>
      <h1>${greeting},</h1>

      <div class="countdown-badge">7 days remaining</div>

      <p>Your Ptah Pro trial will end on <strong>${endDate}</strong>.</p>

      <p>You've been enjoying these Pro features:</p>

      <div class="feature-list">
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span>Advanced multi-agent orchestration</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span>Priority API access & faster responses</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span>Extended context window & memory</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span>Custom agent creation & MCP tools</span>
        </div>
      </div>

      <p>Upgrade now to keep using these features after your trial ends.</p>

      <a href="${frontendUrl}/pricing" class="cta-button">Upgrade Now</a>

      <div class="footer">
        <p>If you have any questions, just reply to this email.</p>
        <p>- The Ptah Team</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * 3-day trial reminder email template
 */
private getTrialReminder3DayTemplate(params: {
  firstName: string | null;
  trialEnd: Date;
}): string {
  const { firstName, trialEnd } = params;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
  const endDate = trialEnd.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const frontendUrl =
    this.config.get<string>('FRONTEND_URL') || 'https://ptah.dev';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>3 days left in your Ptah Pro trial</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #4A5568; margin-bottom: 20px; }
        .countdown-badge { display: inline-block; background-color: #ED8936; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
        .comparison-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .comparison-table th, .comparison-table td { padding: 12px; text-align: left; border-bottom: 1px solid #E2E8F0; }
        .comparison-table th { background-color: #F7FAFC; }
        .check { color: #48BB78; }
        .cross { color: #E53E3E; }
        .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
      </style>
    </head>
    <body>
      <h1>${greeting},</h1>

      <div class="countdown-badge">Only 3 days left</div>

      <p>Your Ptah Pro trial ends on <strong>${endDate}</strong>. Here's what changes after your trial:</p>

      <table class="comparison-table">
        <tr>
          <th>Feature</th>
          <th>Pro</th>
          <th>Community</th>
        </tr>
        <tr>
          <td>Multi-agent orchestration</td>
          <td class="check">✓ Full</td>
          <td class="cross">✗ Limited</td>
        </tr>
        <tr>
          <td>Context window</td>
          <td class="check">✓ Extended</td>
          <td class="cross">✗ Standard</td>
        </tr>
        <tr>
          <td>Custom agents & MCP</td>
          <td class="check">✓ Unlimited</td>
          <td class="cross">✗ None</td>
        </tr>
        <tr>
          <td>Priority support</td>
          <td class="check">✓ Yes</td>
          <td class="cross">✗ No</td>
        </tr>
      </table>

      <a href="${frontendUrl}/pricing" class="cta-button">Upgrade to Pro</a>

      <div class="footer">
        <p>Questions? Reply to this email and we'll help you out.</p>
        <p>- The Ptah Team</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * 1-day trial reminder email template (urgent)
 */
private getTrialReminder1DayTemplate(params: {
  firstName: string | null;
  trialEnd: Date;
}): string {
  const { firstName, trialEnd } = params;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
  const endDate = trialEnd.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const frontendUrl =
    this.config.get<string>('FRONTEND_URL') || 'https://ptah.dev';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Ptah Pro trial ends tomorrow</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #E53E3E; margin-bottom: 20px; }
        .urgent-badge { display: inline-block; background-color: #E53E3E; color: white; padding: 6px 16px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
        .warning-box { background-color: #FFF5F5; border-left: 4px solid #E53E3E; padding: 16px; margin: 20px 0; border-radius: 4px; }
        .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; font-size: 16px; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
      </style>
    </head>
    <body>
      <h1>${greeting}, this is your last chance!</h1>

      <div class="urgent-badge">⚠️ Trial ends tomorrow</div>

      <p>Your Ptah Pro trial expires on <strong>${endDate}</strong>.</p>

      <div class="warning-box">
        <strong>What happens tomorrow:</strong><br>
        You'll be moved to the Community tier with limited features. Upgrade now to keep full access to Pro features without interruption.
      </div>

      <a href="${frontendUrl}/pricing" class="cta-button">Upgrade Now</a>

      <p style="color: #718096; font-size: 14px;">
        Not ready to upgrade? No worries - you can continue using Ptah with the Community tier,
        and upgrade anytime to restore Pro features.
      </p>

      <div class="footer">
        <p>Questions? Reply to this email.</p>
        <p>- The Ptah Team</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Trial expired notification email template
 */
private getTrialExpiredTemplate(params: {
  firstName: string | null;
}): string {
  const { firstName } = params;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
  const frontendUrl =
    this.config.get<string>('FRONTEND_URL') || 'https://ptah.dev';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Ptah Pro trial has ended</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #4A5568; margin-bottom: 20px; }
        .status-box { background-color: #F7FAFC; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center; }
        .status-icon { font-size: 48px; margin-bottom: 12px; }
        .community-info { background-color: #EBF8FF; border-radius: 8px; padding: 16px; margin: 20px 0; }
        .cta-button { display: inline-block; background-color: #4F46E5; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; color: #718096; }
      </style>
    </head>
    <body>
      <h1>${greeting},</h1>

      <div class="status-box">
        <div class="status-icon">📅</div>
        <p><strong>Your 14-day Pro trial has ended</strong></p>
      </div>

      <div class="community-info">
        <p><strong>What's changed:</strong></p>
        <p>You now have access to Ptah's Community tier, which includes basic AI assistance
        and standard features. You can continue using Ptah for free!</p>
      </div>

      <p>Want to restore full Pro access? Upgrade anytime to unlock all premium features:</p>

      <ul>
        <li>Advanced multi-agent orchestration</li>
        <li>Extended context window & memory</li>
        <li>Custom agent creation & MCP tools</li>
        <li>Priority support</li>
      </ul>

      <a href="${frontendUrl}/pricing" class="cta-button">View Plans</a>

      <div class="footer">
        <p>Thank you for trying Ptah Pro! If you have feedback, we'd love to hear it.</p>
        <p>- The Ptah Team</p>
      </div>
    </body>
    </html>
  `;
}
```

---

### 4.6 AppModule Update

**File**: `apps/ptah-license-server/src/app/app.module.ts`

```typescript
import { TrialReminderModule } from '../trial-reminder/trial-reminder.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([...]),
    EventEmitterModule.forRoot(),
    PrismaModule,
    LicenseModule,
    AuthModule,
    PaddleModule,
    EventsModule,
    SubscriptionModule,
    TrialReminderModule, // NEW: TASK_2025_142
  ],
  // ...
})
export class AppModule {}
```

---

## 5. Integration Points

### 5.1 Frontend Integration

| Component                  | Data Source                     | Integration                           |
| -------------------------- | ------------------------------- | ------------------------------------- |
| `TrialBannerComponent`     | `ChatStore.licenseStatus()`     | Signal input from `ChatViewComponent` |
| `TrialEndedModalComponent` | `license:getStatus` RPC         | Input from `AppShellComponent`        |
| `SettingsComponent`        | Existing `fetchLicenseStatus()` | Existing pattern, enhanced display    |

### 5.2 Backend Integration

| Service                | Dependencies                           | Purpose                             |
| ---------------------- | -------------------------------------- | ----------------------------------- |
| `TrialReminderService` | `PrismaService`, `EmailService`        | Cron job, DB queries, email sending |
| `EmailService`         | `ConfigService`, `SendGridMailService` | Email delivery with retry           |

### 5.3 Data Flow

```
[Daily Cron Job @ 9:00 AM UTC]
    │
    ▼
TrialReminderService.handleTrialReminders()
    │
    ├─► Query Prisma: subscriptions WHERE status='trialing' AND trialEnd IN (7,3,1,0 days)
    │
    ├─► Filter: Exclude users with existing TrialReminder for that type
    │
    ├─► For each eligible user:
    │     ├─► EmailService.sendTrialReminderXDay()
    │     └─► Create TrialReminder record (idempotency)
    │
    └─► Log completion metrics
```

---

## 6. Implementation Batches

### Batch 1: Frontend Components (Priority: High)

**Batch 1.1: Trial Banner Component**

- Create `trial-banner.component.ts`
- Add to `chat-view.component.ts` imports
- Update `chat-view.component.html` template
- Unit tests for banner logic

**Batch 1.2: Trial-Ended Modal Component**

- Create `trial-ended-modal.component.ts`
- Integrate with `app-shell.component.ts`
- Unit tests for modal logic and localStorage TTL

**Batch 1.3: Settings Enhancement**

- Add computed signals to `settings.component.ts`
- Update `settings.component.html` with enhanced trial section
- Unit tests for computed signals

### Batch 2: Backend Infrastructure (Priority: High)

**Batch 2.1: Database Schema**

- Add `TrialReminder` model to `schema.prisma`
- Add relation to `User` model
- Run `prisma migrate dev`
- Regenerate Prisma client

**Batch 2.2: Install Dependencies**

- Add `@nestjs/schedule` to `package.json`
- `npm install`

### Batch 3: Backend Services (Priority: High)

**Batch 3.1: TrialReminderModule**

- Create `trial-reminder.module.ts`
- Create `trial-reminder.service.ts`
- Add to `app.module.ts` imports

**Batch 3.2: EmailService Enhancement**

- Add 4 new public methods
- Add 4 private template methods
- Unit tests for email methods

### Batch 4: Testing & Validation (Priority: High)

**Batch 4.1: Unit Tests**

- `trial-banner.component.spec.ts`
- `trial-ended-modal.component.spec.ts`
- `trial-reminder.service.spec.ts`

**Batch 4.2: Integration Tests**

- Cron job execution test
- Email delivery test (mock SendGrid)
- Full flow test: subscription → reminder → email

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Frontend Components**:

```typescript
// trial-banner.component.spec.ts
describe('TrialBannerComponent', () => {
  it('should show banner when trialActive=true and trialDaysRemaining > 0', () => {});
  it('should hide banner when dismissed', () => {});
  it('should use alert-warning class when days <= 3', () => {});
  it('should use alert-error class when days <= 1', () => {});
  it('should call command:execute RPC on click', () => {});
  it('should persist dismissal to sessionStorage', () => {});
});

// trial-ended-modal.component.spec.ts
describe('TrialEndedModalComponent', () => {
  it('should show modal when reason is trial_ended', () => {});
  it('should not show modal when dismissed within 24 hours', () => {});
  it('should show modal after 24-hour cooldown', () => {});
  it('should call command:execute RPC on upgrade click', () => {});
  it('should dismiss and set localStorage on continue', () => {});
});
```

**Backend Services**:

```typescript
// trial-reminder.service.spec.ts
describe('TrialReminderService', () => {
  it('should find subscriptions expiring in 7 days', () => {});
  it('should exclude users who already received reminder', () => {});
  it('should send email and create TrialReminder record', () => {});
  it('should handle batch processing with rate limiting', () => {});
  it('should log errors and continue processing on failure', () => {});
});

// email.service.spec.ts (additions)
describe('EmailService - Trial Reminders', () => {
  it('should send 7-day reminder with correct template', () => {});
  it('should send 3-day reminder with correct template', () => {});
  it('should send 1-day reminder with correct template', () => {});
  it('should send expired notification with correct template', () => {});
});
```

### 7.2 Integration Tests

```typescript
// trial-reminder.integration.spec.ts
describe('TrialReminderService Integration', () => {
  it('should process full reminder cycle without duplicates', async () => {
    // 1. Create test user with trial subscription
    // 2. Run cron job for 7-day reminder
    // 3. Verify email sent and TrialReminder created
    // 4. Run cron job again
    // 5. Verify no duplicate email sent
  });

  it('should skip users who have upgraded', async () => {
    // 1. Create test user with active (non-trialing) subscription
    // 2. Run cron job
    // 3. Verify no email sent
  });
});
```

### 7.3 Manual Testing Checklist

**Frontend**:

- [ ] Banner shows with correct urgency styling at 7, 3, 1 days
- [ ] Banner dismisses and stays dismissed for session
- [ ] Banner reappears on new session
- [ ] Modal shows when trial has ended
- [ ] Modal dismisses for 24 hours
- [ ] Settings shows enhanced trial status with progress bar
- [ ] All CTAs open pricing page correctly

**Backend**:

- [ ] Cron job runs at scheduled time
- [ ] Emails sent only to eligible users
- [ ] No duplicate emails on repeated runs
- [ ] Rate limiting prevents SendGrid throttling
- [ ] Errors logged but don't stop processing

---

## 8. Files Affected Summary

### CREATE

| File                                                                                  | Type              |
| ------------------------------------------------------------------------------------- | ----------------- |
| `libs/frontend/chat/src/lib/components/molecules/trial-banner.component.ts`           | Angular Component |
| `libs/frontend/chat/src/lib/components/molecules/trial-ended-modal.component.ts`      | Angular Component |
| `apps/ptah-license-server/src/trial-reminder/trial-reminder.module.ts`                | NestJS Module     |
| `apps/ptah-license-server/src/trial-reminder/services/trial-reminder.service.ts`      | NestJS Service    |
| `libs/frontend/chat/src/lib/components/molecules/trial-banner.component.spec.ts`      | Jest Test         |
| `libs/frontend/chat/src/lib/components/molecules/trial-ended-modal.component.spec.ts` | Jest Test         |
| `apps/ptah-license-server/src/trial-reminder/services/trial-reminder.service.spec.ts` | Jest Test         |

### MODIFY

| File                                                                       | Changes                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`   | Add TrialBannerComponent import                 |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` | Add trial banner to template                    |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`   | Add TrialEndedModalComponent                    |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`                | Add computed signals for enhanced trial display |
| `libs/frontend/chat/src/lib/settings/settings.component.html`              | Add enhanced trial status section               |
| `libs/frontend/chat/src/lib/components/index.ts`                           | Export new components                           |
| `apps/ptah-license-server/prisma/schema.prisma`                            | Add TrialReminder model                         |
| `apps/ptah-license-server/src/email/services/email.service.ts`             | Add trial reminder email methods                |
| `apps/ptah-license-server/src/app/app.module.ts`                           | Import TrialReminderModule                      |
| `apps/ptah-license-server/package.json`                                    | Add @nestjs/schedule dependency                 |

---

## 9. Risk Mitigation

| Risk                   | Mitigation                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| SendGrid rate limiting | Batch processing (50 emails/batch), 30s delay between batches                 |
| Duplicate emails       | Unique constraint on (userId, reminderType) + pre-check query                 |
| Cron job failure       | Idempotent design - can re-run safely, errors logged but processing continues |
| Modal feels aggressive | "Continue with Community" secondary CTA, 24-hour cooldown                     |
| Banner intrusive       | Session-scoped dismissal, subtle info styling for early days                  |

---

## 10. Architecture Delivery Checklist

- [x] All components specified with evidence citations
- [x] All patterns verified from codebase examples
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (performance, reliability, security)
- [x] Integration points documented with data flow
- [x] Files affected list complete (CREATE/MODIFY)
- [x] Implementation batches ordered by priority
- [x] Testing strategy with unit/integration coverage
- [x] No step-by-step implementation (team-leader's responsibility)
- [x] Evidence-based decisions throughout

# 🎯 Simplified Premium Architecture: Launch in 4 Weeks

**Key Simplifications**:

1. ❌ **NO OAuth token storage** - Users set `ANTHROPIC_API_KEY` OR `CLAUDE_CODE_OAUTH_TOKEN` in VS Code settings
2. ✅ **Dual authentication support** - SDK works with either API key or OAuth token
3. ✅ **Simple license key system** - Just verify premium status
4. ✅ **VS Code auth** - Users enter license key in extension
5. ✅ **Minimal backend** - Just license validation + Paymob webhooks

---

## 🏗️ Simplified Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS CODE EXTENSION                         │
│                                                               │
│  User sets in VS Code settings:                             │
│  • ptah.anthropicApiKey = "sk-ant-..."                      │
│  • ptah.licenseKey = "ptah_lic_abc123..."                   │
│                                                               │
│  Extension reads settings directly (no server needed!)      │
└────────────────────────┬────────────────────────────────────┘
                         │ Only for license validation
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              SIMPLE LICENSE API (NestJS)                     │
│                                                               │
│  Just 2 endpoints:                                          │
│  • POST /licenses/verify  (check if key is premium)        │
│  • POST /webhooks/paymob  (handle payments)                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL (3 tables only)                      │
│  • users                                                     │
│  • subscriptions                                             │
│  • licenses                                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 How It Works (Simplified)

### 1. User Buys Premium

```
User visits → https://ptah.dev/pricing
  ↓
Click "Buy Premium ($8/month)"
  ↓
Paymob checkout (email + payment)
  ↓
Paymob webhook → License server
  ↓
Generate license key: "ptah_lic_abc123..."
  ↓
Email license key to user
```

### 2. User Activates in VS Code

```
User installs extension
  ↓
VS Code Settings:
  • ptah.licenseKey = "ptah_lic_abc123..." (from email)
  • ptah.anthropicApiKey = "sk-ant-..." (Option 1: Direct API key)
  OR
  • ptah.claudeOAuthToken = "claude_oauth_..." (Option 2: Pro/Max subscription)
  ↓
Extension verifies license key with API
  ↓
If premium: Enable custom tools with user's chosen auth method
If free: Show upgrade prompt
```

### 3. Premium Features Use User's API Key

```typescript
// Extension reads user's auth credentials from settings (DUAL AUTH SUPPORT)
const config = vscode.workspace.getConfiguration('ptah');
const apiKey = config.get<string>('anthropicApiKey');
const oauthToken = config.get<string>('claudeOAuthToken');

// Use SDK with USER'S credentials (not ours!)
// User can choose: API key OR OAuth token
const authKey = oauthToken || apiKey; // OAuth token takes precedence if provided
const client = new Anthropic({ apiKey: authKey });

// Premium features only if license is valid
if (licenseManager.isPremium()) {
  const customTools = createCustomTools(); // workspace_semantic_search, etc.
}
```

**KEY INSIGHTS**:

1. We NEVER store or proxy user's credentials
2. Users choose their preferred auth method (API key OR OAuth token)
3. OAuth token allows using Claude Pro/Max subscription benefits
4. API key is the simpler option for new users

---

## 🗄️ Simplified Database (3 Tables Only)

```sql
-- Users (email only - no passwords!)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Subscriptions (synced with Paymob)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  paymob_subscription_id VARCHAR(255) UNIQUE,
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'canceled', 'past_due'
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Licenses (simple key validation)
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  license_key VARCHAR(255) UNIQUE NOT NULL, -- "ptah_lic_abc123..."
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'revoked'
  expires_at TIMESTAMP, -- NULL = never expires (for lifetime licenses)
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_licenses_key ON licenses(license_key);
```

**That's it! No OAuth tokens, no devices table, no audit logs (for MVP).**

---

## 🔌 Minimal API (2 Endpoints)

### 1. POST `/api/v1/licenses/verify`

**Purpose**: Check if license key is premium

**Request**:

```json
{
  "licenseKey": "ptah_lic_abc123..."
}
```

**Response**:

```json
{
  "valid": true,
  "tier": "premium",
  "email": "user@example.com",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

**Implementation**:

```typescript
@Controller('api/v1/licenses')
export class LicensesController {
  @Post('verify')
  async verify(@Body() body: { licenseKey: string }) {
    const license = await this.licensesService.findByKey(body.licenseKey);

    if (!license || license.status !== 'active') {
      return { valid: false, tier: 'free' };
    }

    // Check if subscription is still active
    const subscription = await this.subscriptionsService.findByUserId(license.userId);
    if (subscription.status !== 'active') {
      return { valid: false, tier: 'free' };
    }

    return {
      valid: true,
      tier: 'premium',
      email: license.user.email,
      expiresAt: subscription.currentPeriodEnd,
    };
  }
}
```

### 2. POST `/api/v1/webhooks/paymob`

**Purpose**: Handle Paymob payments and generate license keys

**Implementation**:

```typescript
@Controller('api/v1/webhooks')
export class WebhooksController {
  @Post('paymob')
  async handlePaymob(@Body() payload: any, @Headers('x-paymob-signature') signature: string) {
    // Verify signature
    this.verifySignature(payload, signature);

    if (payload.type === 'TRANSACTION' && payload.obj.success) {
      const email = payload.obj.billing_data.email;

      // Create or find user
      let user = await this.usersService.findByEmail(email);
      if (!user) {
        user = await this.usersService.create({ email });
      }

      // Create subscription
      const subscription = await this.subscriptionsService.create({
        userId: user.id,
        paymobSubscriptionId: payload.obj.subscription_id,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });

      // Generate license key
      const licenseKey = this.generateLicenseKey();
      await this.licensesService.create({
        userId: user.id,
        licenseKey,
        status: 'active',
      });

      // Send license key via email
      await this.emailService.sendLicenseKey(email, licenseKey);
    }

    return { received: true };
  }

  private generateLicenseKey(): string {
    // Generate random license key
    const random = crypto.randomBytes(16).toString('hex');
    return `ptah_lic_${random}`;
  }
}
```

---

## 📱 VS Code Authentication Flow

### Method 1: Manual License Key Entry (Simplest)

**User Flow**:

1. Install extension
2. Open VS Code settings (`Cmd+,`)
3. Search "Ptah"
4. Enter license key: `ptah_lic_abc123...`
5. Enter Anthropic API key: `sk-ant-...`
6. Reload window
7. Premium features unlocked!

**Extension Code**:

```typescript
// package.json - Configuration contribution
{
  "contributes": {
    "configuration": {
      "title": "Ptah",
      "properties": {
        "ptah.licenseKey": {
          "type": "string",
          "default": "",
          "description": "Your Ptah Premium license key (from email). Leave empty for free tier.",
          "order": 1
        },
        "ptah.anthropicApiKey": {
          "type": "string",
          "default": "",
          "description": "Your Anthropic API key (sk-ant-...). Get it from https://console.anthropic.com/. Use this OR OAuth token below.",
          "order": 2
        },
        "ptah.claudeOAuthToken": {
          "type": "string",
          "default": "",
          "description": "Your Claude OAuth token (claude_oauth_...). Use this to utilize your Claude Pro/Max subscription. Use this OR API key above.",
          "order": 3
        }
      }
    }
  }
}
```

**Extension Activation**:

```typescript
export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('ptah');
  const licenseKey = config.get<string>('licenseKey');
  const apiKey = config.get<string>('anthropicApiKey');
  const oauthToken = config.get<string>('claudeOAuthToken');

  // Check if user provided auth credentials (either API key OR OAuth token)
  const authKey = oauthToken || apiKey;
  if (!authKey) {
    vscode.window.showWarningMessage('⚠️ Ptah: Please set either anthropicApiKey or claudeOAuthToken in VS Code settings');
    return;
  }

  // Verify license key
  const license = await verifyLicense(licenseKey);

  if (license.tier === 'premium') {
    // Register premium provider (SDK with custom tools, using user's auth)
    registerPremiumProvider(authKey, context);
    vscode.window.showInformationMessage('✨ Ptah Premium activated!');
  } else {
    // Register free provider (CLI only)
    registerFreeProvider(context);

    // Show upgrade prompt
    const action = await vscode.window.showInformationMessage('💡 Upgrade to Ptah Premium for custom workspace tools!', 'Get Premium', 'Dismiss');

    if (action === 'Get Premium') {
      vscode.env.openExternal(vscode.Uri.parse('https://ptah.dev/pricing'));
    }
  }
}

async function verifyLicense(licenseKey: string | undefined): Promise<License> {
  if (!licenseKey) {
    return { tier: 'free', valid: false };
  }

  try {
    const response = await fetch('https://license.ptah.dev/api/v1/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });

    return await response.json();
  } catch (error) {
    console.error('License verification failed:', error);
    return { tier: 'free', valid: false };
  }
}
```

---

### Method 2: In-Extension License Input (Better UX)

**User Flow**:

1. Install extension
2. Extension shows webview: "Enter your license key"
3. User pastes key from email
4. Extension saves to VS Code settings
5. Premium unlocked!

**Extension Code**:

```typescript
// Show license input dialog on first activation
export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('ptah');
  let licenseKey = config.get<string>('licenseKey');

  // If no license key, show input dialog
  if (!licenseKey) {
    const action = await vscode.window.showInformationMessage('Welcome to Ptah! Do you have a premium license?', 'Enter License Key', 'Use Free Tier', 'Buy Premium');

    if (action === 'Enter License Key') {
      licenseKey = await vscode.window.showInputBox({
        prompt: 'Enter your Ptah Premium license key',
        placeHolder: 'ptah_lic_...',
        ignoreFocusOut: true,
      });

      if (licenseKey) {
        // Save to settings
        await config.update('licenseKey', licenseKey, vscode.ConfigurationTarget.Global);
      }
    } else if (action === 'Buy Premium') {
      vscode.env.openExternal(vscode.Uri.parse('https://ptah.dev/pricing'));
      return;
    }
  }

  // Verify license and activate
  const license = await verifyLicense(licenseKey);
  activateProvider(license, context);
}
```

---

### Method 3: Web-Based Activation (Most Polished)

**User Flow**:

1. User buys premium on website
2. After payment, redirect to: `vscode://ptah.ptah-extension/activate?key=ptah_lic_abc123`
3. VS Code opens, extension receives license key via deep link
4. Extension saves key and activates premium
5. Done!

**Extension Code**:

```typescript
// package.json - Register URI handler
{
  "contributes": {
    "uriHandlers": [
      {
        "name": "ptah",
        "schemes": ["vscode"]
      }
    ]
  }
}

// Handle deep link activation
export class UriHandler implements vscode.UriHandler {
  async handleUri(uri: vscode.Uri): Promise<void> {
    // Parse: vscode://ptah.ptah-extension/activate?key=ptah_lic_abc123
    if (uri.path === '/activate') {
      const params = new URLSearchParams(uri.query);
      const licenseKey = params.get('key');

      if (licenseKey) {
        // Verify license
        const license = await verifyLicense(licenseKey);

        if (license.valid) {
          // Save to settings
          const config = vscode.workspace.getConfiguration('ptah');
          await config.update('licenseKey', licenseKey, vscode.ConfigurationTarget.Global);

          // Activate premium
          await activatePremium();

          vscode.window.showInformationMessage('✨ Ptah Premium activated!');
        } else {
          vscode.window.showErrorMessage('Invalid license key');
        }
      }
    }
  }
}
```

**Website Payment Success Page**:

```html
<!-- https://ptah.dev/success?license=ptah_lic_abc123 -->
<script>
  const params = new URLSearchParams(window.location.search);
  const licenseKey = params.get('license');

  // Auto-redirect to VS Code
  window.location.href = `vscode://ptah.ptah-extension/activate?key=${licenseKey}`;
</script>

<p>Activating Ptah Premium in VS Code...</p>
<p>If VS Code doesn't open, copy this license key:</p>
<code id="license">{licenseKey}</code>
```

---

## 🚀 Simplified 4-Week Roadmap

### Week 1: Minimal Backend

**Goal**: License API + Paymob webhooks

**Tasks**:

- [ ] Create NestJS project (just 3 files!)
  - `licenses.controller.ts` - Verify endpoint
  - `webhooks.controller.ts` - Paymob handler
  - `database.module.ts` - 3 tables
- [ ] Deploy to DigitalOcean
- [ ] Test with dummy license key

**Deliverable**: Working license API

---

### Week 2: VS Code License Integration

**Goal**: Extension can verify premium status

**Tasks**:

- [ ] Add `ptah.licenseKey` setting
- [ ] Add `ptah.anthropicApiKey` setting
- [ ] Implement license verification in extension
- [ ] Show upgrade prompt for free users

**Deliverable**: Extension knows if user is premium

---

### Week 3: Premium SDK Integration

**Goal**: Premium users can use SDK with custom tools

**Tasks**:

- [ ] Implement `SdkAgentAdapter` (uses user's API key!)
- [ ] Implement 3 custom tools:
  - `workspace_semantic_search`
  - `editor_context`
  - `git_workspace_info`
- [ ] Premium feature gate (check `licenseManager.isPremium()`)

**Deliverable**: Premium features work with user's API key

---

### Week 4: Launch!

**Goal**: Public launch with payment flow

**Tasks**:

- [ ] Create pricing page (Paymob checkout)
- [ ] Email service (send license keys)
- [ ] Demo video
- [ ] VS Code Marketplace submission
- [ ] Product Hunt launch

**Deliverable**: Live and accepting payments!

---

## 💰 Even Simpler Pricing Page

**Landing page** (https://ptah.dev):

```html
<h1>Ptah - Premium Claude Code for VS Code</h1>

<div class="pricing">
  <div class="free">
    <h2>Free</h2>
    <p>Beautiful UI for Claude CLI</p>
    <ul>
      <li>Session history</li>
      <li>Permission management</li>
      <li>MCP configuration</li>
    </ul>
    <a href="vscode:extension/ptah.ptah-extension">Install Free</a>
  </div>

  <div class="premium">
    <h2>Premium - $8/month</h2>
    <p>SDK-powered workspace tools</p>
    <ul>
      <li>Everything in Free</li>
      <li>Workspace semantic search (LSP)</li>
      <li>Editor context awareness</li>
      <li>Git workspace info</li>
    </ul>
    <a href="/checkout">Get Premium</a>
  </div>
</div>
```

**Checkout page** (https://ptah.dev/checkout):

```html
<!-- Embed Paymob iframe -->
<iframe src="https://accept.paymob.com/iframe/{INTEGRATION_ID}"></iframe>

<!-- After payment success, Paymob redirects to: -->
<!-- https://ptah.dev/success?license=ptah_lic_abc123 -->

<!-- Success page auto-activates in VS Code -->
<script>
  const license = new URLSearchParams(location.search).get('license');
  window.location.href = `vscode://ptah.ptah-extension/activate?key=${license}`;
</script>
```

---

## 📊 Cost Comparison

### Old Architecture (Complicated)

- NestJS server: 10+ files
- PostgreSQL: 6 tables
- OAuth token encryption
- Device management
- Audit logs
- **Implementation**: 8 weeks

### New Architecture (Simple)

- NestJS server: 3 files
- PostgreSQL: 3 tables
- No OAuth storage
- No device tracking
- No audit logs
- **Implementation**: 4 weeks

**Savings**: 50% faster to market! 🚀

---

## ✅ Why This Works

### 1. No Security Risk

- We NEVER see user's API key
- User manages their own Claude subscription
- License key is just a UUID (no sensitive data)

### 2. Simple for Users

- Buy premium → Get license key via email → Paste in VS Code → Done!
- No OAuth flows, no account creation, no password management

### 3. Lower Infrastructure Costs

- No API key proxying → No bandwidth costs
- Simple license validation → Minimal compute
- 3 tables → Small database

### 4. Faster Development

- No WorkOS integration needed
- No OAuth encryption logic
- No complex JWT issuance
- Just license key validation

### 5. Better UX

- Users use their own API keys (already have them)
- One-time license key entry
- Works offline (cached license validation)

---

## 🔐 Security Considerations

### License Key Security

**Q**: What if someone shares their license key?
**A**: Each license key is tied to an email. We can add device fingerprinting later if needed, but for MVP, we accept some sharing risk.

**Q**: What if someone reverse engineers the API?
**A**: License verification API is public (no auth needed). Anyone can check if a key is valid. That's okay! The value is in the premium features, not the license system.

### API Key Security

**Q**: Is it safe to store API key in VS Code settings?
**A**: Yes! VS Code settings are stored locally on user's machine. Same as how users store other API keys (GitHub, AWS, etc.).

**Q**: What if user doesn't want to store API key?
**A**: They can use environment variable `ANTHROPIC_API_KEY` instead:

```typescript
const apiKey = vscode.workspace.getConfiguration('ptah').get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;
```

---

## 🎯 Final Implementation Checklist

### Backend (2 days)

- [ ] NestJS project with 2 endpoints
- [ ] PostgreSQL with 3 tables
- [ ] Paymob webhook integration
- [ ] License key generation
- [ ] Email service (send keys)
- [ ] Deploy to DigitalOcean

### Extension (1 week)

- [ ] Add `ptah.licenseKey` setting
- [ ] Add `ptah.anthropicApiKey` setting
- [ ] License verification on activation
- [ ] Premium feature gates
- [ ] SDK adapter with custom tools
- [ ] Upgrade prompts for free users

### Website (3 days)

- [ ] Landing page (pricing)
- [ ] Checkout page (Paymob iframe)
- [ ] Success page (auto-activate)
- [ ] Demo video
- [ ] Deploy to Vercel

### Launch (2 days)

- [ ] VS Code Marketplace submission
- [ ] Product Hunt launch
- [ ] Reddit/Twitter posts

**Total**: 4 weeks 🚀

---

**Document Status**: Simplified and ready for rapid implementation
**Implementation Time**: 4 weeks (vs 8 weeks before)
**Complexity**: LOW (vs HIGH before)
**Cost**: $20/month DigitalOcean (vs $40/month before)

# 🚀 8-Week Accelerated Launch Roadmap: Ptah Premium

**Strategy**: Launch Fast with Custom VS Code Tools (Your Moat!)
**Goal**: Launch free tier + 1 killer premium feature in 8 weeks
**Tech Stack**: NestJS + WorkOS + Paymob + DigitalOcean + Claude Agent SDK

---

## 🎯 Launch Strategy

### What We're Building (8 Weeks)

**Free Tier** (Already exists):

- ✅ VS Code UI for Claude Code CLI
- ✅ Session history
- ✅ Permission management
- ✅ MCP configuration

**Premium Tier** (Week 1-8 - NEW):

- 💎 Custom VS Code Tools (workspace_semantic_search, editor_context, git_info)
- 🔐 OAuth token proxy (users use their Claude subscription)
- 💳 Stripe subscriptions ($8/month)
- 🏛️ License server (NestJS + WorkOS + Paymob)

**Defer to Post-Launch** (Weeks 9+):

- Session forking
- Structured outputs
- Dynamic permission modes
- Team tier

---

## 📅 Week-by-Week Breakdown

### Week 1: License Server Foundation (Backend)

**Goal**: Set up NestJS server + WorkOS authentication + PostgreSQL

#### Day 1-2: NestJS Project Setup

```bash
# Initialize NestJS project
npm i -g @nestjs/cli
nest new ptah-license-server --package-manager npm

# Install dependencies
cd ptah-license-server
npm install @nestjs/typeorm typeorm pg
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install @workos-inc/node
npm install class-validator class-transformer
npm install dotenv

# Dev dependencies
npm install -D @types/passport-jwt
```

**Create project structure**:

```bash
nest g module auth
nest g module users
nest g module licenses
nest g module oauth-tokens
nest g module devices
nest g module audit
nest g module database
```

#### Day 3-4: Database Schema

**Tasks**:

- Create TypeORM entities (User, Subscription, License, OAuthToken, Device, AuditLog)
- Set up local PostgreSQL (docker-compose)
- Run migrations

**File**: `docker-compose.yml`

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: ptah_license
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

```bash
docker-compose up -d
npm run migration:generate -- CreateInitialSchema
npm run migration:run
```

#### Day 5: WorkOS Integration

**Tasks**:

- Create WorkOS account (https://workos.com/)
- Get API keys (test mode)
- Implement AuthService with WorkOS SDK
- Create signup/signin endpoints

**Test**:

```bash
curl -X POST http://localhost:3000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","name":"Test User"}'
```

#### Day 6-7: OAuth Token Vault

**Tasks**:

- Implement AES-256-GCM encryption (TokenVault class)
- Create OAuthTokensService
- Add store/retrieve/delete endpoints
- Write unit tests

**Test encryption**:

```typescript
// test/token-vault.spec.ts
const vault = new TokenVault();
const encrypted = vault.encrypt('claude_oauth_abc123');
const decrypted = vault.decrypt(encrypted.encrypted, encrypted.iv, encrypted.authTag);
expect(decrypted).toBe('claude_oauth_abc123');
```

**Deliverable**: Working license server with auth + encrypted OAuth storage

---

### Week 2: Paymob Integration + License Verification (Backend)

**Goal**: Integrate Paymob subscriptions + implement license JWT issuance

#### Day 1-3: Paymob Subscriptions

**Tasks**:

- Create Paymob account (https://paymob.com/)
- Get API keys (test mode)
- Create SubscriptionsModule
- Implement create subscription endpoint (returns Paymob checkout URL)
- Implement webhook handler (verify HMAC signature)

**File**: `src/subscriptions/subscriptions.service.ts`

```typescript
@Injectable()
export class SubscriptionsService {
  async createSubscription(userId: string, tier: 'premium' | 'team') {
    // Call Paymob API to create subscription
    const response = await fetch('https://accept.paymob.com/api/acceptance/subscription', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYMOB_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount_cents: tier === 'premium' ? 800 : 2000,
        currency: 'USD',
        billing_cycle: 'monthly',
        user_id: userId,
      }),
    });

    const data = await response.json();

    // Store subscription in database
    await this.saveSubscription(userId, data.subscription_id, tier);

    return {
      subscriptionId: data.subscription_id,
      checkoutUrl: data.iframe_url,
    };
  }
}
```

**Test webhook locally**:

```bash
# Install ngrok for local webhook testing
ngrok http 3000

# Update Paymob webhook URL to ngrok URL
https://abc123.ngrok.io/api/v1/subscriptions/webhooks
```

#### Day 4-5: License JWT Issuance

**Tasks**:

- Create LicensesModule
- Implement JWT issuance (sign with secret)
- Add device tracking (max 3 devices)
- Implement verify endpoint

**File**: `src/licenses/licenses.service.ts`

```typescript
@Injectable()
export class LicensesService {
  constructor(private jwtService: JwtService) {}

  async issueLicense(userId: string, deviceId: string): Promise<string> {
    // Check device limit
    const devicesUsed = await this.countActiveDevices(userId);
    if (devicesUsed >= 3) {
      throw new Error('Device limit reached (max 3)');
    }

    // Register device
    await this.registerDevice(userId, deviceId);

    // Get user's subscription
    const subscription = await this.getSubscription(userId);

    // Determine features based on tier
    const features = subscription.tier === 'premium' ? ['custom_tools'] : [];

    // Issue JWT
    const payload = {
      userId,
      email: subscription.email,
      subscription: subscription.tier,
      features,
      deviceId,
    };

    return this.jwtService.sign(payload, {
      expiresIn: '90d', // 90-day expiry
    });
  }

  async verifyLicense(token: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(token);

      // Check if subscription still active
      const subscription = await this.getSubscription(payload.userId);
      if (subscription.status !== 'active') {
        throw new Error('Subscription inactive');
      }

      return {
        userId: payload.userId,
        subscription: {
          tier: subscription.tier,
          status: subscription.status,
        },
        features: payload.features,
        expiresAt: new Date(payload.exp * 1000),
      };
    } catch (error) {
      throw new Error('Invalid license token');
    }
  }
}
```

#### Day 6-7: E2E Testing

**Tasks**:

- Write E2E tests for auth flow
- Write E2E tests for subscription creation
- Write E2E tests for license verification
- Test Paymob webhook handling

**Deliverable**: Full backend API tested and working

---

### Week 3: VS Code Extension Integration (Frontend)

**Goal**: Add license manager, premium feature gates, upgrade UI

#### Day 1-2: License Manager Service

**File**: `libs/backend/vscode-core/src/services/license-manager.service.ts`

```typescript
@injectable()
export class LicenseManager {
  private cachedLicense: PremiumLicense | null = null;
  private readonly licenseServerUrl = 'https://license.ptah.dev'; // DigitalOcean URL

  constructor(@inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager, @inject(TOKENS.LOGGER) private logger: Logger) {}

  async checkLicense(): Promise<PremiumLicense> {
    // Check for cached license (7-day offline grace period)
    const cached = this.getCachedLicense();
    if (cached && !this.isExpired(cached)) {
      return cached;
    }

    // Get stored access token from VS Code settings
    const accessToken = this.config.get<string>('ptah.accessToken');
    if (!accessToken) {
      return this.freeTierLicense();
    }

    // Verify license with server
    try {
      const response = await fetch(`${this.licenseServerUrl}/api/v1/licenses/verify`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return this.freeTierLicense();
      }

      const license = await response.json();
      this.cacheLicense(license);
      return license;
    } catch (error) {
      this.logger.error('License verification failed', error);
      return cached || this.freeTierLicense();
    }
  }

  async issueLicense(deviceId: string): Promise<string> {
    const accessToken = this.config.get<string>('ptah.accessToken');

    const response = await fetch(`${this.licenseServerUrl}/api/v1/licenses/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId,
        deviceName: this.getDeviceName(),
        osType: os.platform(),
        vscodeVersion: vscode.version,
        extensionVersion: this.getExtensionVersion(),
      }),
    });

    const data = await response.json();
    return data.licenseToken;
  }

  hasPremium(userId: string): boolean {
    const license = this.cachedLicense;
    return license && license.subscription.tier !== 'free';
  }

  private freeTierLicense(): PremiumLicense {
    return {
      userId: 'guest',
      subscription: { tier: 'free', status: 'active' },
      features: [],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    };
  }
}
```

#### Day 3-4: Premium Feature Gates

**File**: `libs/backend/agent-abstractions/src/adapters/sdk-agent-adapter.ts`

```typescript
export class SdkAgentAdapter implements IAgentProvider {
  constructor(private readonly userId: string, private readonly licenseToken: string, private readonly workspacePath: string, private readonly licenseManager: LicenseManager) {}

  async start(prompt: string, options?: AgentProviderOptions): Promise<void> {
    // Verify premium license
    if (!this.licenseManager.hasPremium(this.userId)) {
      throw new PremiumFeatureError('SDK features require Ptah Premium');
    }

    // Get user's Claude OAuth token
    const oauthToken = await this.fetchOAuthToken();
    if (!oauthToken) {
      throw new Error('No Claude OAuth token connected. Please sign in and connect your Claude account.');
    }

    // Initialize Anthropic SDK with user's token
    const client = new Anthropic({
      apiKey: oauthToken,
    });

    // Register custom VS Code tools (premium-only)
    const customTools = this.createCustomTools();

    // Start SDK conversation
    this.activeConversation = await client.messages.stream({
      model: options?.model || 'claude-sonnet-4-20250514',
      max_tokens: 8096,
      messages: [{ role: 'user', content: prompt }],
      tools: customTools, // Custom VS Code tools!
    });

    this.setupStreamHandlers();
  }

  private async fetchOAuthToken(): Promise<string | null> {
    const response = await fetch(`${this.licenseServerUrl}/api/v1/oauth-tokens`, {
      headers: {
        Authorization: `Bearer ${this.licenseToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.token;
  }

  private createCustomTools() {
    return [
      {
        name: 'workspace_semantic_search',
        description: 'Search workspace using LSP symbols (understands code structure)',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            type: { type: 'string', enum: ['class', 'function', 'interface', 'variable', 'all'] },
          },
          required: ['query'],
        },
      },
      {
        name: 'editor_context',
        description: 'Get current editor context (selected code, cursor position, diagnostics)',
        input_schema: {
          type: 'object',
          properties: {
            includeSelection: { type: 'boolean', default: true },
            includeDiagnostics: { type: 'boolean', default: true },
          },
        },
      },
      {
        name: 'git_workspace_info',
        description: 'Get Git context (current branch, uncommitted changes, recent commits)',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }
}
```

#### Day 5-7: Upgrade UI Flow

**Tasks**:

- Create sign-in webview (WorkOS authentication)
- Create subscription checkout flow (redirect to Paymob)
- Add premium badge indicators in UI
- Create "Connect Claude Account" flow (OAuth token storage)

**File**: `libs/frontend/core/src/lib/services/auth.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class AuthService {
  private licenseSignal = signal<PremiumLicense | null>(null);

  async signIn(email: string, password: string): Promise<void> {
    const response = await this.vscodeService.sendRpc('auth:signin', { email, password });

    if (response.success) {
      // Store access token
      await this.vscodeService.sendRpc('config:set', {
        key: 'ptah.accessToken',
        value: response.accessToken,
      });

      // Update license signal
      this.licenseSignal.set(response.license);
    }
  }

  async upgradeToPremium(): Promise<void> {
    const response = await this.vscodeService.sendRpc('subscription:create', {
      tier: 'premium',
    });

    if (response.success) {
      // Open Paymob checkout in browser
      vscode.env.openExternal(vscode.Uri.parse(response.checkoutUrl));
    }
  }

  async connectClaudeAccount(oauthToken: string): Promise<void> {
    await this.vscodeService.sendRpc('oauth:store-token', {
      claudeOAuthToken: oauthToken,
    });
  }

  isPremium(): boolean {
    const license = this.licenseSignal();
    return license?.subscription.tier === 'premium';
  }
}
```

**Deliverable**: Extension can authenticate, subscribe, and verify premium features

---

### Week 4: Custom VS Code Tools Implementation (Premium Feature)

**Goal**: Implement 3 killer custom tools (workspace_semantic_search, editor_context, git_info)

#### Day 1-2: Workspace Semantic Search

**File**: `libs/backend/agent-sdk-core/src/tools/workspace-semantic-search.tool.ts`

```typescript
import * as vscode from 'vscode';

export async function workspaceSemanticSearch(args: { query: string; type?: 'class' | 'function' | 'interface' | 'variable' | 'all' }): Promise<any> {
  // Execute VS Code's workspace symbol provider
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', args.query);

  // Filter by type if specified
  let filtered = symbols;
  if (args.type && args.type !== 'all') {
    const symbolKindMap = {
      class: vscode.SymbolKind.Class,
      function: vscode.SymbolKind.Function,
      interface: vscode.SymbolKind.Interface,
      variable: vscode.SymbolKind.Variable,
    };
    const targetKind = symbolKindMap[args.type];
    filtered = symbols.filter((s) => s.kind === targetKind);
  }

  // Format results for Claude
  const results = filtered.map((symbol) => ({
    name: symbol.name,
    kind: vscode.SymbolKind[symbol.kind],
    file: symbol.location.uri.fsPath,
    line: symbol.location.range.start.line + 1,
    containerName: symbol.containerName,
  }));

  return {
    content: [
      {
        type: 'text',
        text: `Found ${results.length} symbols:\n\n${JSON.stringify(results, null, 2)}`,
      },
    ],
  };
}
```

#### Day 3-4: Editor Context Tool

**File**: `libs/backend/agent-sdk-core/src/tools/editor-context.tool.ts`

```typescript
export async function editorContext(args: { includeSelection?: boolean; includeDiagnostics?: boolean }): Promise<any> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return {
      content: [
        {
          type: 'text',
          text: 'No active editor',
        },
      ],
    };
  }

  const context = {
    fileName: editor.document.fileName,
    language: editor.document.languageId,
    lineCount: editor.document.lineCount,
    selection: null as string | null,
    cursorPosition: {
      line: editor.selection.active.line + 1,
      character: editor.selection.active.character + 1,
    },
    diagnostics: null as any[] | null,
  };

  // Include selected text if requested
  if (args.includeSelection) {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      context.selection = editor.document.getText(selection);
    }
  }

  // Include diagnostics if requested
  if (args.includeDiagnostics) {
    const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
    context.diagnostics = diagnostics.map((d) => ({
      severity: vscode.DiagnosticSeverity[d.severity],
      message: d.message,
      line: d.range.start.line + 1,
      source: d.source,
    }));
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(context, null, 2),
      },
    ],
  };
}
```

#### Day 5-6: Git Workspace Info Tool

**File**: `libs/backend/agent-sdk-core/src/tools/git-workspace-info.tool.ts`

```typescript
export async function gitWorkspaceInfo(): Promise<any> {
  try {
    // Get VS Code Git extension
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      return {
        content: [
          {
            type: 'text',
            text: 'Git extension not available',
          },
        ],
      };
    }

    const git = gitExtension.exports.getAPI(1);
    const repo = git.repositories[0];

    if (!repo) {
      return {
        content: [
          {
            type: 'text',
            text: 'No Git repository found in workspace',
          },
        ],
      };
    }

    // Get Git info
    const branch = repo.state.HEAD?.name;
    const uncommittedChanges = repo.state.workingTreeChanges.length;
    const stagedChanges = repo.state.indexChanges.length;

    // Get recent commits
    const commits = await repo.log({ maxEntries: 5 });
    const recentCommits = commits.map((commit) => ({
      hash: commit.hash.substring(0, 7),
      message: commit.message.split('\n')[0],
      author: commit.authorName,
      date: commit.authorDate?.toISOString(),
    }));

    const gitInfo = {
      branch,
      uncommittedChanges,
      stagedChanges,
      recentCommits,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(gitInfo, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
}
```

#### Day 7: Tool Integration with SDK

**File**: `libs/backend/agent-sdk-core/src/sdk-tool-executor.ts`

```typescript
export class SdkToolExecutor {
  async executeTool(toolName: string, toolInput: any): Promise<any> {
    // Map tool names to implementations
    switch (toolName) {
      case 'workspace_semantic_search':
        return await workspaceSemanticSearch(toolInput);

      case 'editor_context':
        return await editorContext(toolInput);

      case 'git_workspace_info':
        return await gitWorkspaceInfo();

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

// In SdkAgentAdapter, handle tool use events
this.activeConversation.on('tool_use', async (toolUse) => {
  // Execute custom tool
  const result = await this.toolExecutor.executeTool(toolUse.name, toolUse.input);

  // Send result back to SDK
  // (SDK will automatically include in next API call)
});
```

**Deliverable**: 3 working custom tools that give Claude workspace awareness

---

### Week 5: DigitalOcean Deployment + OAuth Flow

**Goal**: Deploy license server to production + implement OAuth token connection flow

#### Day 1-2: DigitalOcean Deployment

**Tasks**:

- Create DigitalOcean account
- Create App Platform app from GitHub
- Create managed PostgreSQL database
- Set environment variables (secrets)
- Run database migrations
- Test production endpoints

**Deployment checklist**:

```bash
# 1. Push code to GitHub
git add .
git commit -m "chore: prepare for deployment"
git push origin main

# 2. Create app in DigitalOcean dashboard
# - Connect GitHub repo
# - Select "Web Service"
# - Build command: npm run build
# - Run command: npm run start:prod
# - Port: 3000

# 3. Create PostgreSQL database
# - Engine: PostgreSQL 15
# - Size: 1GB RAM, 1 vCPU ($15/month)
# - Region: Same as app

# 4. Set environment variables in dashboard
WORKOS_API_KEY=sk_live_...
PAYMOB_API_KEY=...
ENCRYPTION_MASTER_KEY=...
JWT_SECRET=...

# 5. Run migrations via console
npm run migration:run

# 6. Test production URL
curl https://ptah-license-server-abc123.ondigitalocean.app/health
```

#### Day 3-5: OAuth Token Connection Flow

**Tasks**:

- Add "Connect Claude Account" button in extension
- Create input dialog for OAuth token
- Send token to license server (encrypted storage)
- Show success confirmation
- Test end-to-end OAuth flow

**File**: `apps/ptah-extension-vscode/src/commands/connect-claude-account.command.ts`

```typescript
export async function connectClaudeAccountCommand(container: DependencyContainer): Promise<void> {
  const licenseManager = container.resolve<LicenseManager>(TOKENS.LICENSE_MANAGER);
  const oauthTokensService = container.resolve<OAuthTokensService>(TOKENS.OAUTH_TOKENS_SERVICE);

  // Check if user is signed in
  const license = await licenseManager.checkLicense();
  if (license.subscription.tier === 'free') {
    vscode.window.showErrorMessage('Please sign in to Ptah first');
    return;
  }

  // Prompt for Claude OAuth token
  const token = await vscode.window.showInputBox({
    prompt: 'Enter your Claude OAuth token (CLAUDE_CODE_OAUTH_TOKEN)',
    password: true,
    placeHolder: 'claude_oauth_...',
    ignoreFocusOut: true,
  });

  if (!token) {
    return;
  }

  // Validate token format
  if (!token.startsWith('claude_oauth_')) {
    vscode.window.showErrorMessage('Invalid token format');
    return;
  }

  // Store token on license server (encrypted)
  try {
    await oauthTokensService.storeToken(token);
    vscode.window.showInformationMessage('✅ Claude account connected! Premium features unlocked.');
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to connect account: ${error.message}`);
  }
}
```

#### Day 6-7: E2E Testing

**Tasks**:

- Test complete user journey:
  1. Install extension
  2. Sign up via WorkOS
  3. Subscribe via Paymob
  4. Connect Claude OAuth token
  5. Use custom tools in chat
- Fix bugs
- Write user documentation

**Deliverable**: Production license server + OAuth flow working end-to-end

---

### Week 6: Beta Testing + Bug Fixes

**Goal**: Invite 10 beta users, collect feedback, fix critical bugs

#### Day 1-2: Beta Invitation

**Tasks**:

- Create beta invite list (10 users)
- Send email with:
  - Installation instructions
  - Test promo code (free premium for 1 month)
  - Feedback form (Google Form)
- Set up Discord channel for beta testers

#### Day 3-5: Bug Fixing

**Monitor**:

- Error logs (DigitalOcean dashboard)
- User feedback (Discord, Google Form)
- Crash reports (VS Code extension logs)

**Common issues to fix**:

- OAuth token expiry handling
- Device limit edge cases
- Paymob webhook failures
- Custom tool errors (LSP timeout, Git not found)

#### Day 6-7: Performance Optimization

**Tasks**:

- Add caching (license verification cached for 5 minutes)
- Optimize database queries (add indexes)
- Add rate limiting (prevent abuse)
- Improve error messages

**Deliverable**: Stable beta with 10 active users

---

### Week 7: Marketing Preparation + Free Tier Polish

**Goal**: Prepare for public launch (landing page, docs, video)

#### Day 1-3: Marketing Website

**Tasks**:

- Create landing page (use Next.js or Astro)
- Add sections:
  - Hero (Beautiful VS Code UI for Claude Code)
  - Features (Free vs Premium comparison table)
  - Pricing ($8/month for custom tools)
  - Demo video (1-2 minutes showing custom tools)
  - FAQ
  - Sign up button (redirects to WorkOS)
- Deploy to Vercel

#### Day 4-5: Documentation

**Tasks**:

- Create docs site (use Docusaurus or VitePress)
- Write guides:
  - Getting Started (install extension)
  - Sign Up & Subscribe
  - Connect Claude Account (OAuth token)
  - Using Custom Tools (with examples)
  - FAQ & Troubleshooting
- Deploy to Vercel

#### Day 6-7: Demo Video

**Tasks**:

- Record 2-minute demo video showing:
  1. Install extension from marketplace
  2. Sign in with email
  3. Upgrade to premium ($8/month)
  4. Connect Claude account (OAuth token)
  5. Use workspace_semantic_search tool
  6. Use editor_context tool (show selected code analysis)
  7. Use git_workspace_info tool
- Upload to YouTube
- Add to landing page

**Deliverable**: Marketing website, docs, and demo video ready

---

### Week 8: Public Launch 🚀

**Goal**: Launch on VS Code Marketplace + Product Hunt

#### Day 1-2: VS Code Marketplace Submission

**Tasks**:

- Create marketplace listing:
  - Title: "Ptah - VS Code UI for Claude Code CLI"
  - Description: Premium features with custom workspace tools
  - Screenshots (5-10 high-quality images)
  - README with installation instructions
  - Categories: AI, Productivity, Tools
- Submit for review (typically 1-2 days)

#### Day 3: Product Hunt Launch

**Tasks**:

- Create Product Hunt listing:
  - Title: "Ptah - Premium Claude Code for VS Code"
  - Tagline: "Beautiful UI + workspace-aware AI with custom tools"
  - Thumbnail image (eye-catching)
  - Demo video (YouTube link)
  - First comment (explain problem, solution, unique value)
- Schedule launch for Tuesday or Thursday (best days)
- Ask friends/beta testers to upvote

#### Day 4-5: Community Outreach

**Post on**:

- Reddit: r/ClaudeAI, r/vscode, r/MachineLearning
- Twitter/X: Tag @AnthropicAI, @code
- Hacker News: Show HN post
- Dev.to: Write launch blog post
- Discord: Claude AI Discord, VS Code Discord

**Message template**:

```
🚀 Just launched Ptah - a VS Code extension that gives Claude Code
workspace awareness with custom LSP tools!

Free tier: Beautiful UI for Claude CLI
Premium ($8/mo): Custom tools that understand your workspace
- Semantic code search (LSP-powered)
- Editor context (selected code + diagnostics)
- Git workspace info

Check it out: [VS Code Marketplace link]
```

#### Day 6-7: Monitor & Iterate

**Tasks**:

- Monitor analytics (installs, sign-ups, conversions)
- Respond to Product Hunt comments
- Answer Reddit questions
- Fix urgent bugs
- Collect feature requests

**Success metrics** (Week 8 end):

- 500+ marketplace installs
- 50+ sign-ups
- 5-10 premium subscribers ($40-80 MRR)
- Product Hunt: Top 10 of the day

**Deliverable**: Public launch complete! 🎉

---

## 📊 Success Metrics (8-Week Target)

| Metric                   | Target                | Rationale                     |
| ------------------------ | --------------------- | ----------------------------- |
| **Marketplace Installs** | 500                   | Organic search + Product Hunt |
| **Sign-Ups**             | 50 (10% conversion)   | Free → Premium funnel         |
| **Premium Subscribers**  | 5-10 (10% conversion) | $40-80 MRR                    |
| **Daily Active Users**   | 100                   | 20% DAU/MAU ratio             |
| **Custom Tool Usage**    | 80%                   | Premium users using tools     |

---

## 💰 Financial Projection (8 Weeks)

### Costs

| Item                            | Cost    |
| ------------------------------- | ------- |
| **DigitalOcean** (2 months)     | $40     |
| **Domain** (ptah.dev)           | $12     |
| **WorkOS** (free tier)          | $0      |
| **Paymob** (free until revenue) | $0      |
| **Total**                       | **$52** |

### Revenue (Conservative)

| Week | Premium Subs      | MRR |
| ---- | ----------------- | --- |
| 1-5  | 0 (beta testing)  | $0  |
| 6    | 2 (beta converts) | $16 |
| 7    | 5 (3 new)         | $40 |
| 8    | 10 (5 new)        | $80 |

**Week 8 MRR**: **$80**
**Break-even**: Week 7 (MRR > infrastructure costs)

---

## 🎯 Post-Launch (Weeks 9-12)

### Add More Premium Features

- **Session forking** (Week 9-10)
- **Structured outputs** (Week 11-12)
- **Dynamic permission modes** (Week 13-14)

### Scale User Base

- **Target**: 5,000 installs, 500 sign-ups, 50 premium ($400 MRR)
- **Strategy**: Content marketing, SEO, partnerships

### Prepare Team Tier

- **Target**: 5 team subscriptions ($100 MRR)
- **Strategy**: B2B outreach, sales calls

---

## ✅ Daily Checklist (For You)

### Every Morning

- [ ] Check DigitalOcean logs (errors?)
- [ ] Check Paymob dashboard (new subscriptions?)
- [ ] Respond to user feedback (Discord, email)
- [ ] Review analytics (installs, sign-ups, conversions)

### Every Week

- [ ] Ship 1 new feature or improvement
- [ ] Write 1 blog post or tutorial
- [ ] Post on social media (Twitter, Reddit)
- [ ] Review financial metrics (MRR, churn, CAC)

---

**Document Status**: Ready for execution
**Estimated Effort**: 40 hours/week × 8 weeks = 320 hours
**Launch Date**: 8 weeks from start (set a date!)
**First Revenue**: Week 6 (beta converts to paid)

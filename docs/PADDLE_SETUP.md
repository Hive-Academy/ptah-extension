# Paddle Setup Guide for Ptah License System

This guide walks you through setting up Paddle Billing v2 for the Ptah license system, including creating products, configuring webhooks, and integrating price IDs.

## Prerequisites

- Paddle account (Sandbox for testing, Production for live)
- Backend license server running on accessible URL (for webhook testing)
- Admin access to Paddle dashboard

---

## Step 1: Create Paddle Account

### Sandbox (Testing)
1. Go to https://sandbox-vendors.paddle.com/
2. Create account or sign in
3. Complete business profile setup

### Production (Live)
1. Go to https://vendors.paddle.com/
2. Create account or sign in
3. Complete business verification (required before going live)

---

## Step 2: Get API Key

1. Navigate to **Developer Tools** → **Authentication**
2. Click **"Create API Key"** or **"Generate API Key"**
3. Name it: `Ptah License Server`
4. Copy the API key:
   - Sandbox: starts with `pdl_sbox_`
   - Production: starts with `pdl_live_`
5. Add to `.env.local`:
   ```bash
   PADDLE_API_KEY=pdl_sbox_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

**Security**: Keep this secret! Never commit to Git.

---

## Step 3: Create Products

### 3.1 Early Adopter (Lifetime License)

1. Navigate to **Catalog** → **Products**
2. Click **"Create Product"**
3. Fill in details:
   - **Name**: Ptah Early Adopter License
   - **Description**: Lifetime access to Ptah VS Code extension with all premium features
   - **Tax Category**: `standard` (or appropriate category)
   - **Image**: Upload Early Adopter badge (optional)
4. Click **"Create Product"**

#### Add Price for Early Adopter

1. In the product page, go to **Prices** tab
2. Click **"Add Price"**
3. Configure price:
   - **Name**: Early Adopter - Lifetime
   - **Billing Type**: `one_time` (not recurring)
   - **Amount**: `49.00`
   - **Currency**: `USD` (add more currencies if needed)
   - **Trial Period**: None
4. Click **"Create Price"**
5. **Copy the Price ID** (starts with `pri_`)
   - Example: `pri_01jqbkwnq87abc123def456`
6. Save this for later use

### 3.2 Pro (Monthly Subscription)

1. Navigate to **Catalog** → **Products**
2. Click **"Create Product"**
3. Fill in details:
   - **Name**: Ptah Pro License
   - **Description**: Monthly subscription with team collaboration and enterprise features
   - **Tax Category**: `standard`
4. Click **"Create Product"**

#### Add Price for Pro

1. In the product page, go to **Prices** tab
2. Click **"Add Price"**
3. Configure price:
   - **Name**: Pro - Monthly
   - **Billing Type**: `subscription`
   - **Billing Interval**: `monthly` (1 month)
   - **Amount**: `99.00`
   - **Currency**: `USD`
   - **Trial Period**: Optional (e.g., 7 days)
4. Click **"Create Price"**
5. **Copy the Price ID**
6. Save this for later use

---

## Step 4: Configure Webhooks

### 4.1 Create Webhook Destination

1. Navigate to **Developer Tools** → **Webhooks**
2. Click **"New Destination"**
3. Configure webhook:
   - **Name**: Ptah License Server
   - **URL**: `https://your-domain.com/webhooks/paddle`
     - For local testing with ngrok: `https://abc123.ngrok.io/webhooks/paddle`
     - For DigitalOcean: `https://ptah-license-server.ondigitalocean.app/webhooks/paddle`
   - **Description**: Handles subscription lifecycle events for license provisioning

### 4.2 Select Events

Select the following events (critical for license system):

**Subscription Events** (required):
- ✅ `subscription.created` - New subscription purchased
- ✅ `subscription.activated` - Subscription became active (PRIMARY event)
- ✅ `subscription.updated` - Plan change or renewal
- ✅ `subscription.canceled` - User canceled subscription
- ✅ `subscription.past_due` - Payment failed
- ✅ `subscription.paused` - Subscription paused
- ✅ `subscription.resumed` - Subscription resumed

**Optional Events** (for future use):
- `transaction.completed` - One-time purchases
- `transaction.payment_failed` - Failed payments

### 4.3 Get Webhook Secret

1. After creating destination, **copy the webhook secret**
   - Starts with: `pdl_ntfset_`
   - Example: `pdl_ntfset_01HXYZ123ABC456DEF789`
2. Add to `.env.local`:
   ```bash
   PADDLE_WEBHOOK_SECRET=pdl_ntfset_XXXXXXXXXXXXXXXXXXXXXXXX
   ```

### 4.4 Test Webhook (Local Development)

For local testing, use **ngrok** to expose your local server:

```bash
# Install ngrok (if not installed)
npm install -g ngrok

# Start your license server
cd apps/ptah-license-server
npm run dev  # Runs on port 3000

# In another terminal, expose port 3000
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Use this URL in Paddle webhook configuration:
# https://abc123.ngrok.io/webhooks/paddle
```

**Test the webhook**:
1. Go to **Developer Tools** → **Webhooks** → Your destination
2. Click **"Send test event"**
3. Select `subscription.activated`
4. Click **"Send Event"**
5. Check your license server logs for incoming webhook

---

## Step 5: Update Environment Variables

Update `apps/ptah-license-server/.env.local` with your Paddle configuration:

```bash
# ============================================
# PADDLE PAYMENT INTEGRATION
# ============================================
PADDLE_API_KEY=pdl_sbox_YOUR_ACTUAL_API_KEY_HERE
PADDLE_WEBHOOK_SECRET=pdl_ntfset_YOUR_ACTUAL_SECRET_HERE

# Price IDs from Step 3
PADDLE_PRICE_ID_EARLY_ADOPTER=pri_01jqbkwnq87abc123def456
PADDLE_PRICE_ID_PRO=pri_01jqbkwnq87ghi789jkl012
```

---

## Step 6: Update Frontend Price IDs

Update the pricing grid component with real Paddle price IDs:

**File**: `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`

Find lines 83 and 101, replace placeholder IDs:

```typescript
// Line 83 - Early Adopter
priceId: 'pri_01jqbkwnq87abc123def456', // ✅ Real Paddle price ID

// Line 101 - Pro
priceId: 'pri_01jqbkwnq87ghi789jkl012', // ✅ Real Paddle price ID
```

---

## Step 7: Update Environment Files

**File**: `apps/ptah-landing-page/src/environments/environment.ts` (Development)

```typescript
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000', // License server URL

  paddle: {
    environment: 'sandbox' as const,
    priceIdEarlyAdopter: 'pri_01jqbkwnq87abc123def456',
    priceIdPro: 'pri_01jqbkwnq87ghi789jkl012',
  },
};
```

**File**: `apps/ptah-landing-page/src/environments/environment.production.ts` (Production)

```typescript
export const environment = {
  production: true,
  apiBaseUrl: 'https://license.ptah.io', // Production license server URL

  paddle: {
    environment: 'production' as const,
    priceIdEarlyAdopter: 'pri_LIVE_EARLY_ADOPTER_ID',
    priceIdPro: 'pri_LIVE_PRO_ID',
  },
};
```

---

## Step 8: Verify Webhook Integration

### 8.1 Check Webhook Signature Verification

The backend already implements Paddle Billing v2 best practices:

**File**: `apps/ptah-license-server/src/paddle/paddle.service.ts`

```typescript
// ✅ Paddle SDK initialization (lines 36-44)
private readonly paddle: Paddle;

constructor(...) {
  const apiKey = this.configService.get<string>('PADDLE_API_KEY');
  const environment = this.configService.get<string>('NODE_ENV') === 'production'
    ? Environment.production
    : Environment.sandbox;

  if (apiKey) {
    this.paddle = new Paddle(apiKey, { environment });
  }
}

// ✅ SDK-based webhook verification (lines 78-97)
async unmarshalWebhook(signature: string, rawBody: string): Promise<EventEntity | null> {
  if (!this.paddle) {
    throw new Error('Paddle SDK not initialized');
  }

  try {
    const secretKey = this.configService.get<string>('PADDLE_WEBHOOK_SECRET');
    if (!secretKey) {
      throw new Error('PADDLE_WEBHOOK_SECRET not configured');
    }

    // Use Paddle SDK for verification
    const eventData = this.paddle.webhooks.unmarshal(rawBody, secretKey, signature);
    return eventData as EventEntity;
  } catch (error) {
    this.logger.error('Webhook signature verification failed', error);
    return null;
  }
}
```

### 8.2 Test End-to-End Flow

1. **Start Backend**:
   ```bash
   cd apps/ptah-license-server
   npm run dev
   ```

2. **Start Frontend**:
   ```bash
   npx nx serve ptah-landing-page
   ```

3. **Send Test Event** from Paddle dashboard:
   - Go to **Developer Tools** → **Webhooks** → Your destination
   - Click **"Send test event"**
   - Select `subscription.activated`
   - Verify backend logs show successful processing

4. **Test Real Checkout** (Sandbox only):
   - Click "Get Early Adopter" on pricing page
   - Use Paddle test card: `4242 4242 4242 4242`
   - Verify license created in database

---

## Step 9: Production Checklist

Before going live with production Paddle:

### Backend
- [ ] Replace sandbox API key with production key (`pdl_live_`)
- [ ] Update `NODE_ENV=production` in `.env`
- [ ] Verify webhook URL is HTTPS and publicly accessible
- [ ] Test webhook signature verification with production secret
- [ ] Enable Prisma connection pooling for production
- [ ] Set up database backups

### Frontend
- [ ] Replace sandbox price IDs with production price IDs
- [ ] Update `environment.production.ts` with production API URL
- [ ] Test checkout flow on staging environment
- [ ] Verify email delivery (SendGrid production)

### Paddle Dashboard
- [ ] Complete business verification
- [ ] Add payment methods (bank account for payouts)
- [ ] Configure tax settings (Paddle handles this)
- [ ] Set up payout schedule
- [ ] Enable production mode

### Security
- [ ] Rotate all secrets (JWT_SECRET, ADMIN_API_KEY)
- [ ] Enable HTTPS for license server (Let's Encrypt on DigitalOcean)
- [ ] Configure CORS properly
- [ ] Enable rate limiting on webhook endpoint
- [ ] Set up monitoring and alerts (Sentry, LogRocket)

---

## Troubleshooting

### Webhook Returns 401 Unauthorized

**Cause**: Signature verification failed

**Fix**:
1. Verify `PADDLE_WEBHOOK_SECRET` matches Paddle dashboard
2. Check backend logs for signature mismatch
3. Ensure raw body is preserved (configured in `main.ts`)
4. Test with Paddle's "Send test event" feature

### License Not Created After Purchase

**Cause**: Webhook not received or event handler failed

**Fix**:
1. Check Paddle dashboard → Webhooks → Event log
2. Verify webhook URL is correct and accessible
3. Check backend logs for errors in `paddle.service.ts`
4. Ensure database connection is working
5. Test `handleSubscriptionActivated` method

### Wrong Price Displayed in Checkout

**Cause**: Frontend using old/wrong price ID

**Fix**:
1. Verify price IDs in `pricing-grid.component.ts`
2. Clear browser cache
3. Rebuild frontend: `npx nx build ptah-landing-page`
4. Check Paddle dashboard → Products → Prices

### Webhook Timeout (5 seconds)

**Cause**: Database operation too slow

**Fix**:
1. Add database indexes (already configured in Prisma schema)
2. Use transactions for atomic operations (already implemented)
3. Offload email sending to background job queue
4. Optimize Prisma queries

---

## Environment Variables Reference

**Backend** (`apps/ptah-license-server/.env.local`):
```bash
PADDLE_API_KEY=pdl_sbox_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_WEBHOOK_SECRET=pdl_ntfset_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_EARLY_ADOPTER=pri_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO=pri_YYYYYYYYYYYYYYYYYYYYYYYY
```

**Frontend** (`apps/ptah-landing-page/src/environments/environment.ts`):
```typescript
paddle: {
  environment: 'sandbox' as const,
  priceIdEarlyAdopter: 'pri_XXXXXXXXXXXXXXXXXXXXXXXX',
  priceIdPro: 'pri_YYYYYYYYYYYYYYYYYYYYYYYY',
}
```

---

## Testing Checklist

- [ ] Sandbox API key configured
- [ ] Webhook secret configured
- [ ] Products created (Early Adopter, Pro)
- [ ] Prices created and IDs copied
- [ ] Webhook destination created
- [ ] Webhook events selected (7 subscription events)
- [ ] Webhook test event sent successfully
- [ ] Backend receives and verifies webhook signature
- [ ] Frontend displays correct price IDs
- [ ] Test purchase completes successfully
- [ ] License created in database
- [ ] User receives email with license key

---

## Next Steps

After Paddle setup is complete:

1. **Implement Paddle Checkout Integration** (frontend)
   - Add Paddle.js script to index.html
   - Implement checkout initiation in `pricing-grid.component.ts`
   - Handle success/error callbacks

2. **Test Subscription Lifecycle**
   - Create subscription
   - Update subscription (upgrade/downgrade)
   - Cancel subscription
   - Pause/resume subscription

3. **Deploy to Production**
   - Follow [DIGITALOCEAN.md](./deployment/DIGITALOCEAN.md)
   - Switch to production Paddle account
   - Update all environment variables

---

## Support Resources

- **Paddle Documentation**: https://developer.paddle.com/
- **Paddle Billing API**: https://developer.paddle.com/api-reference/overview
- **Webhook Reference**: https://developer.paddle.com/webhooks/overview
- **Paddle Support**: https://www.paddle.com/support

---

**Setup Date**: {{ FILL_IN_DATE }}
**Paddle Environment**: Sandbox | Production
**Status**: In Progress | Complete

# Paddle Setup Guide - Simplified Pricing Model

**Updated Pricing Strategy:**

- **Free Trial**: 14 days, all features, no credit card (handled by backend)
- **Pro Monthly**: $8/month subscription
- **Pro Yearly**: $80/year subscription (save ~17%)

**Optional Promotions** (configured in Paddle dashboard):

- First 3 months discount: $5/month instead of $8/month
- Seasonal discounts

---

## Prerequisites

- Paddle account (Sandbox for testing, Production for live)
- Backend license server accessible via HTTPS (for webhooks)

---

## Step 1: Create Paddle Account

### Sandbox (Testing)

1. Go to <https://sandbox-vendors.paddle.com/>
2. Sign up and complete business profile

### Production (Live)

1. Go to <https://vendors.paddle.com/>
2. Complete business verification

---

## Step 2: Get API Key

1. Navigate to **Developer Tools** → **Authentication**
2. Click **"Create API Key"**
3. Name: `Ptah License Server`
4. Copy the API key:
   - Sandbox: `pdl_sbox_XXXXX`
   - Production: `pdl_live_XXXXX`
5. Add to `.env`:

   ```bash
   PADDLE_API_KEY=pdl_sbox_YOUR_KEY_HERE
   ```

---

## Step 3: Create Pro Product

1. Navigate to **Catalog** → **Products**
2. Click **"Create Product"**
3. Configure product:
   - **Name**: Ptah Pro
   - **Description**: Full workspace intelligence for Ptah VS Code extension
   - **Tax Category**: `standard` (software/SaaS)
4. Click **"Create Product"**

---

## Step 4: Add Prices

### 4.1 Monthly Price ($8/month)

1. In the Pro product, click **Prices** tab
2. Click **"Add Price"**
3. Configure:
   - **Name**: Pro - Monthly
   - **Billing Type**: `subscription`
   - **Billing Interval**: `monthly` (1 month)
   - **Amount**: `8.00`
   - **Currency**: `USD`
   - **Trial Period**: `14 days` (free trial)
4. Click **"Create Price"**
5. **Copy the Price ID**: `pri_XXXXX`

### 4.2 Yearly Price ($80/year)

1. Click **"Add Price"** again
2. Configure:
   - **Name**: Pro - Yearly
   - **Billing Type**: `subscription`
   - **Billing Interval**: `yearly` (12 months)
   - **Amount**: `80.00`
   - **Currency**: `USD`
   - **Trial Period**: `14 days` (free trial)
3. Click **"Create Price"**
4. **Copy the Price ID**: `pri_YYYYY`

---

## Step 5: Optional - First 3 Months Discount

To offer $5/month for the first 3 months:

1. Go to **Catalog** → **Products** → Ptah Pro → **Prices**
2. Find your Monthly price, click **"..."** → **"Edit"**
3. Scroll to **"Promotional pricing"**
4. Click **"Add promotional price"**
5. Configure:
   - **Discounted amount**: `5.00`
   - **Duration**: `3 billing cycles`
   - **Start date**: Now (or future date)
   - **End date**: Optional (when to stop offering this promotion)
6. Save

**Alternative**: Create a **Discount Code** instead:

1. Go to **Discounts** → **"Create Discount"**
2. Type: `Percentage` or `Fixed amount`
3. Value: `37.5%` or `$3.00 off`
4. Applies to: First 3 billing cycles
5. Code: `LAUNCH3M` (or auto-generate)

---

## Step 6: Configure Webhooks

1. Navigate to **Developer Tools** → **Webhooks**
2. Click **"New Destination"**
3. Configure:

   - **Name**: Ptah License Server
   - **URL**: `https://your-domain.com/webhooks/paddle`
     - Local testing: `https://abc123.ngrok.io/webhooks/paddle`
   - **Description**: Subscription lifecycle events

4. **Select Events** (critical):

   - ✅ `subscription.created`
   - ✅ `subscription.activated` (PRIMARY)
   - ✅ `subscription.updated`
   - ✅ `subscription.canceled`
   - ✅ `subscription.past_due`
   - ✅ `subscription.paused`
   - ✅ `subscription.resumed`

5. **Copy Webhook Secret**: `pdl_ntfset_XXXXX`

---

## Step 7: Update Environment Variables

### Backend (.env)

```bash
# Paddle API Configuration
PADDLE_API_KEY=pdl_sbox_YOUR_API_KEY
PADDLE_WEBHOOK_SECRET=pdl_ntfset_YOUR_SECRET

# Price IDs (from Step 4)
PADDLE_PRICE_ID_PRO_MONTHLY=pri_MONTHLY_ID_HERE
PADDLE_PRICE_ID_PRO_YEARLY=pri_YEARLY_ID_HERE
```

### Frontend (environment.ts)

```typescript
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000',

  paddle: {
    environment: 'sandbox' as const,
    priceIdMonthly: 'pri_MONTHLY_ID_HERE',
    priceIdYearly: 'pri_YEARLY_ID_HERE',
  },
};
```

---

## Step 8: Update Frontend Pricing Component

File: `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`

Replace lines 98 and 115:

```typescript
// Line 98 - Pro Monthly
priceId: 'pri_MONTHLY_ID_HERE',

// Line 115 - Pro Yearly
priceId: 'pri_YEARLY_ID_HERE',
```

---

## Step 9: Test Webhook Locally

### Using ngrok

```bash
# Terminal 1: Start backend
cd apps/ptah-license-server
npm run dev

# Terminal 2: Expose via ngrok
ngrok http 3000
# Copy HTTPS URL: https://abc123.ngrok.io
```

### Update Paddle Webhook URL

- Paddle Dashboard → Webhooks → Your destination
- Update URL to: `https://abc123.ngrok.io/webhooks/paddle`

### Send Test Event

1. Click **"Send test event"**
2. Select `subscription.activated`
3. Verify backend logs show successful processing

---

## Step 10: Test Checkout Flow

### Test Card Numbers (Sandbox)

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- Any future expiry date, any CVV

### Test Flow

1. Start frontend: `npx nx serve ptah-landing-page`
2. Click "Subscribe Monthly" or "Subscribe Yearly"
3. Enter test card details
4. Complete checkout
5. Verify:
   - Webhook received in backend logs
   - License created in database
   - User can access Pro features

---

## Production Checklist

### Before Going Live

**Paddle:**

- [ ] Complete business verification
- [ ] Add bank account for payouts
- [ ] Switch to Production mode
- [ ] Update webhook URL to production domain

**Backend:**

- [ ] Replace `PADDLE_API_KEY` with production key (`pdl_live_`)
- [ ] Update `PADDLE_WEBHOOK_SECRET` with production secret
- [ ] Set `NODE_ENV=production`
- [ ] Verify HTTPS enabled

**Frontend:**

- [ ] Update `environment.production.ts` with production price IDs
- [ ] Update `apiBaseUrl` to production license server
- [ ] Test checkout on staging environment

---

## Pricing Summary

| Plan                 | Price        | Trial   | Paddle Config                        |
| -------------------- | ------------ | ------- | ------------------------------------ |
| **Free Trial**       | $0           | 14 days | Handled by backend, no Paddle        |
| **Pro Monthly**      | $8/month     | 14 days | Price ID: `pri_MONTHLY`              |
| **Pro Yearly**       | $80/year     | 14 days | Price ID: `pri_YEARLY`               |
| **Promo (Optional)** | $5/month × 3 | 14 days | Discount code or promotional pricing |

---

## Environment Variables Reference

```bash
# Backend: apps/ptah-license-server/.env
PADDLE_API_KEY=pdl_sbox_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_WEBHOOK_SECRET=pdl_ntfset_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO_MONTHLY=pri_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO_YEARLY=pri_YYYYYYYYYYYYYYYYYYYYYYYY

# Frontend: apps/ptah-landing-page/src/environments/environment.ts
paddle: {
  environment: 'sandbox',
  priceIdMonthly: 'pri_XXXXXXXXXXXXXXXXXXXXXXXX',
  priceIdYearly: 'pri_YYYYYYYYYYYYYYYYYYYYYYYY',
}
```

---

## Next Steps

1. **Create Paddle account and products** (Steps 1-4)
2. **Configure webhooks** (Step 6)
3. **Update environment variables** (Step 7)
4. **Test locally with ngrok** (Step 9)
5. **Test checkout flow** (Step 10)
6. **Implement Paddle.js frontend integration** (future task)

---

## Support

- **Paddle Docs**: <https://developer.paddle.com/>
- **Webhook Reference**: <https://developer.paddle.com/webhooks/overview>
- **Pricing Guide**: <https://developer.paddle.com/concepts/sell/prices>

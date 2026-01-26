# Paddle Dashboard Setup Guide - TASK_2025_121

## Overview

This document provides step-by-step instructions for configuring the Paddle Dashboard to support the two-tier paid extension model (Basic + Pro plans).

---

## Products to Create

### Product 1: Ptah Basic

| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| **Name**         | Ptah Basic                                                                 |
| **Description**  | Visual interface for Claude Code - core features for individual developers |
| **Tax Category** | `saas`                                                                     |
| **Type**         | Standard                                                                   |
| **Image**        | (optional) Ptah logo                                                       |

### Product 2: Ptah Pro

| Field            | Value                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| **Name**         | Ptah Pro                                                                            |
| **Description**  | Full workspace intelligence suite - MCP server, advanced features, priority support |
| **Tax Category** | `saas`                                                                              |
| **Type**         | Standard                                                                            |
| **Image**        | (optional) Ptah logo with "Pro" badge                                               |

---

## Prices to Create

### Basic Plan Prices

#### Basic Monthly

| Field             | Value                                          |
| ----------------- | ---------------------------------------------- |
| **Product**       | Ptah Basic                                     |
| **Name**          | Monthly                                        |
| **Description**   | Basic plan - monthly subscription              |
| **Unit Price**    | $3.00 USD (amount: `300`, currencyCode: `USD`) |
| **Billing Cycle** | Monthly (interval: `month`, frequency: `1`)    |
| **Trial Period**  | 14 days (interval: `day`, frequency: `14`)     |
| **Type**          | Standard                                       |

#### Basic Yearly

| Field             | Value                                            |
| ----------------- | ------------------------------------------------ |
| **Product**       | Ptah Basic                                       |
| **Name**          | Yearly                                           |
| **Description**   | Basic plan - yearly subscription (save ~17%)     |
| **Unit Price**    | $30.00 USD (amount: `3000`, currencyCode: `USD`) |
| **Billing Cycle** | Yearly (interval: `year`, frequency: `1`)        |
| **Trial Period**  | 14 days (interval: `day`, frequency: `14`)       |
| **Type**          | Standard                                         |

### Pro Plan Prices

#### Pro Monthly

| Field             | Value                                          |
| ----------------- | ---------------------------------------------- |
| **Product**       | Ptah Pro                                       |
| **Name**          | Monthly                                        |
| **Description**   | Pro plan - monthly subscription                |
| **Unit Price**    | $5.00 USD (amount: `500`, currencyCode: `USD`) |
| **Billing Cycle** | Monthly (interval: `month`, frequency: `1`)    |
| **Trial Period**  | 14 days (interval: `day`, frequency: `14`)     |
| **Type**          | Standard                                       |

#### Pro Yearly

| Field             | Value                                            |
| ----------------- | ------------------------------------------------ |
| **Product**       | Ptah Pro                                         |
| **Name**          | Yearly                                           |
| **Description**   | Pro plan - yearly subscription (save ~17%)       |
| **Unit Price**    | $50.00 USD (amount: `5000`, currencyCode: `USD`) |
| **Billing Cycle** | Yearly (interval: `year`, frequency: `1`)        |
| **Trial Period**  | 14 days (interval: `day`, frequency: `14`)       |
| **Type**          | Standard                                         |

---

## Environment Configuration

After creating products and prices in Paddle, update the following files with the actual Price IDs:

### License Server (.env)

```env
# Basic Plan Price IDs
PADDLE_PRICE_ID_BASIC_MONTHLY=pri_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_BASIC_YEARLY=pri_XXXXXXXXXXXXXXXXXXXXXXXX

# Pro Plan Price IDs
PADDLE_PRICE_ID_PRO_MONTHLY=pri_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO_YEARLY=pri_XXXXXXXXXXXXXXXXXXXXXXXX
```

### Landing Page (environment.ts / environment.production.ts)

```typescript
paddle: {
  environment: 'sandbox', // or 'production'
  basicPriceIdMonthly: 'pri_XXXXXXXXXXXXXXXXXXXXXXXX',
  basicPriceIdYearly: 'pri_XXXXXXXXXXXXXXXXXXXXXXXX',
  proPriceIdMonthly: 'pri_XXXXXXXXXXXXXXXXXXXXXXXX',
  proPriceIdYearly: 'pri_XXXXXXXXXXXXXXXXXXXXXXXX',
},
```

---

## Checklist

### Paddle Dashboard Setup

- [ ] Create "Ptah Basic" product
- [ ] Create "Ptah Pro" product
- [ ] Create Basic Monthly price ($3/month, 14-day trial)
- [ ] Create Basic Yearly price ($30/year, 14-day trial)
- [ ] Create Pro Monthly price ($5/month, 14-day trial)
- [ ] Create Pro Yearly price ($50/year, 14-day trial)
- [ ] Configure webhook endpoint URL
- [ ] Copy webhook secret to license server .env

### Environment Configuration

- [ ] Update `apps/ptah-license-server/.env` with 4 Price IDs
- [ ] Update `apps/ptah-landing-page/src/environments/environment.ts` with 4 Price IDs
- [ ] Update `apps/ptah-landing-page/src/environments/environment.production.ts` with 4 Price IDs

### Database Migration

- [ ] Run `docker-compose -f docker-compose.db.yml up -d` to start database
- [ ] Run `cd apps/ptah-license-server && npx prisma migrate dev` to apply migrations
- [ ] Verify `trialEnd` field exists in `subscriptions` table

### Verification

- [ ] Test Basic Monthly checkout flow
- [ ] Test Basic Yearly checkout flow
- [ ] Test Pro Monthly checkout flow
- [ ] Test Pro Yearly checkout flow
- [ ] Verify webhook receives subscription.created event
- [ ] Verify license key is generated and emailed
- [ ] Verify extension activates with license key

---

## Price ID Placeholder Template

Copy this template and replace with actual Price IDs from Paddle Dashboard:

```
BASIC_MONTHLY: pri_________________________________
BASIC_YEARLY:  pri_________________________________
PRO_MONTHLY:   pri_________________________________
PRO_YEARLY:    pri_________________________________
```

---

## Notes

1. **Tax Category**: Using `saas` for both products as Ptah is a software-as-a-service VS Code extension

2. **Trial Period**: 14-day trial is configured at the price level, handled automatically by Paddle

3. **Webhook Events**: Ensure these events are enabled in Paddle:

## Notes

1. **Tax Category**: Using `saas` for both products as Ptah is a software-as-a-service VS Code extension

2. **Trial Period**: 14-day trial is configured at the price level, handled automatically by Paddle

3. **Webhook Events**: Ensure these events are enabled in Paddle:

   - `subscription.created`
   - `subscription.activated`
   - `subscription.updated`
   - `subscription.canceled`
   - `subscription.past_due`
   - `subscription.paused`
   - `subscription.resumed`

4. **Testing**: Use Paddle Sandbox environment for testing before production deployment

---
title: License Issues
description: Activation, offline use, and revalidation problems.
---

import { Aside } from '@astrojs/starlight/components';

Ptah's Pro tier uses an online license with a generous offline grace period.

## How licensing works

- Activation validates your key with the license server and stores a signed receipt locally.
- Every 24 hours the app revalidates in the background.
- If validation fails (network outage, server down), the app keeps running on the cached receipt for up to **7 days**.
- After 7 days with no successful revalidation, Pro features are disabled until the next successful check-in.

## Common problems

**Symptom:** "Invalid license key" on activation.
**Likely cause:** Typo, leading/trailing whitespace, or the key has been revoked.
**Fix:** Copy the key directly from your purchase email. If the problem persists, check the Customer Portal — a key may have been deactivated to move seats.

---

**Symptom:** "This key is already activated on another machine."
**Likely cause:** You're over the seat limit for your plan.
**Fix:** Sign in to the Customer Portal and deactivate an older machine, or upgrade to a plan with more seats.

---

**Symptom:** Pro features grayed out after a week of air-gapped use.
**Likely cause:** The 7-day offline grace period has expired.
**Fix:** Connect to the internet once. Validation happens automatically within a minute and Pro features re-enable immediately. No reactivation is needed.

---

**Symptom:** License check fails every 24h behind a corporate proxy.
**Likely cause:** Proxy blocks `https://license.ptah.live` or strips the TLS chain.
**Fix:** Whitelist `license.ptah.live` and ensure the proxy passes Ptah's client certificate. If TLS interception is mandatory, add the proxy's root CA to the system trust store.

---

**Symptom:** Repeated "license revalidation required" prompts.
**Likely cause:** System clock is off by more than a few hours.
**Fix:** Enable automatic time sync on your OS. License receipts are signed with timestamps and drift breaks verification.

<Aside type="tip">
To see the current license status, open **Settings → License**. The page shows your tier, seat count, expiry, and the timestamp of the last successful revalidation.
</Aside>

## Transferring between machines

1. On the old machine: **Settings → License → Deactivate**.
2. On the new machine: enter the same key in **Settings → License → Activate**.

If you no longer have access to the old machine, deactivate it from the Customer Portal instead.

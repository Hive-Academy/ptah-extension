---
title: Provider Errors
description: API key rejection, quota, rate limits, and network problems.
---

## Authentication

**Symptom:** `401 Unauthorized` or "Invalid API key" on every request.
**Likely cause:** The key is wrong, or the provider revoked it.
**Fix:** Make a new key on the dashboard of the provider. Open **Settings → Providers**, open the connection, and replace the key on the **Credentials** tab. Test the connection.

---

**Symptom:** A sign-in provider (Claude Code, Codex, Copilot, Kimi Code) stops working.
**Likely cause:** The sign-in expired.
**Fix:** Sign in again from the connection in **Settings → Providers**. For Claude Code, sign in in a terminal.

---

**Symptom:** `403 Forbidden` with a message about a region or country.
**Likely cause:** Your account cannot use the model in your region.
**Fix:** Select a different model, or ask the provider to enable the region.

## Quota and billing

**Symptom:** `429 Too Many Requests` with a quota message, or `payment_required`.
**Likely cause:** You used your token or spend limit, or a payment failed.
**Fix:** Change the limit or the billing on the dashboard of the provider. Or switch to a different provider.

## Rate limits

**Symptom:** `429` errors during heavy use, then recovery.
**Likely cause:** A rate limit of the provider (requests or tokens per minute, or concurrent requests).
**Fix:** Wait, run fewer agents at the same time, change to a higher plan, or move some work to a second provider.

## Network

**Symptom:** `ECONNRESET`, `ETIMEDOUT`, or "request aborted" errors.
**Likely cause:** An unstable network, a VPN, or a proxy.
**Fix:** Examine your network connection, then try again.

## Model not available

**Symptom:** "Model `<name>` not found" in a chat that worked before.
**Likely cause:** The provider removed the model id.
**Fix:** Select a current model in the model selector. If the model came from a tier, open the connection, select **Models & Tiers**, and pick a current model.

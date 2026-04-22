---
title: Provider Errors
description: API key rejection, quota, rate limits, and network issues.
---

## Authentication

**Symptom:** `401 Unauthorized` or "Invalid API key" on every request.
**Likely cause:** Key was typed incorrectly, or it was revoked on the provider's dashboard.
**Fix:** Regenerate the key on the provider's dashboard and paste it into **Settings → Providers**. Verify with the status indicator in the chat footer.

---

**Symptom:** `403 Forbidden` with a message mentioning "region" or "country."
**Likely cause:** Your account's region is not enabled for the model you requested.
**Fix:** Pick a different model, or contact the provider to enable the region.

## Quota and billing

**Symptom:** `429 Too Many Requests` with a quota message.
**Likely cause:** You've hit your monthly token or spend cap.
**Fix:** Raise the cap in the provider dashboard, wait for the billing cycle to reset, or switch to a different provider for the remainder of the month.

---

**Symptom:** `payment_required` or `billing_hard_limit_reached`.
**Likely cause:** Card on file was declined, or a spend limit is enforced.
**Fix:** Update billing on the provider's dashboard. Ptah will retry automatically once the account is in good standing.

## Rate limits

**Symptom:** `429` spikes during heavy usage, then recovers.
**Likely cause:** Provider-side rate limit (requests per minute, tokens per minute, or concurrent requests).
**Fix:** Ptah automatically backs off and retries. If it happens frequently:

- Lower concurrency in **Settings → Providers → [Provider] → Max concurrent requests**.
- Switch to a higher tier of the provider's plan.
- Route some workload to a second provider via **Settings → Default routing**.

## Network

**Symptom:** `ECONNRESET`, `ETIMEDOUT`, or "request aborted" errors.
**Likely cause:** Intermittent network, VPN, or corporate proxy.
**Fix:** Check connectivity. If behind a proxy, set the `HTTPS_PROXY` environment variable before launching Ptah:

```bash
# Windows (PowerShell)
$env:HTTPS_PROXY = "http://proxy.company.com:8080"

# macOS / Linux
export HTTPS_PROXY=http://proxy.company.com:8080
```

---

**Symptom:** TLS error: "unable to verify the first certificate."
**Likely cause:** Corporate proxy performs TLS interception with a private CA.
**Fix:** Add the proxy's root certificate to your OS trust store. Ptah inherits the system trust store on all three platforms.

## Model not available

**Symptom:** "Model `<name>` not found" on a previously-working chat.
**Likely cause:** The provider deprecated the model ID.
**Fix:** Open the chat header dropdown and pick a current model. Update `defaultModel` in `~/.ptah/settings.json` if needed.

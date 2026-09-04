---
name: "qaa-elhamour-art-direction"
description: "Voice, visual direction, and IP guardrails for the Qaa El-Hamour project. Use when writing any user-facing copy, naming a landmark or UI element, choosing colours or fog values, adding Arabic/English content, or deciding how far to lean on SpongeBob imagery. Encodes the discovery decisions that would otherwise drift across sessions."
source: harness
---

# Qaa El-Hamour — Art Direction and Voice

Project-specific judgement calls settled during discovery. They exist here because they are
the kind of decision that silently drifts when work is spread across many sessions.

Read alongside `.ptah/scope-decisions.md` and `.ptah/roadmap.md`.

## What the project is

An interactive WebGL brand site built on the August 2026 Egyptian trend **"Qaa El-Hamour"**
(قاع الهامور) — in which roughly 1.8 million people joined a Facebook group that reframed
Egyptian bureaucratic and economic frustration as municipal complaints filed from an
underwater town.

The joke is **not** "SpongeBob is funny." The joke is **bureaucracy relocated underwater**:
a Sardine President issuing municipal statements, a Pineapple Residential Complex advertising
5% down payments, a Ministry of Education extending the school year, complaints about the
price of a Krabby Patty against stagnant wages. Satire as a coping mechanism, in a tradition
of Egyptian political humour going back decades.

Copy that forgets this and reaches for cartoon references instead of civic ones is off-voice.

## The IP guardrail

The bundled models are CC-BY-4.0 — but that licence covers the **mesh files**, not the
characters. SpongeBob is Nickelodeon/Paramount intellectual property.

**Lean on the trend's vocabulary, not the cartoon's branding.**

| Prefer | Avoid |
|---|---|
| قاع الهامور / Qaa El-Hamour | "Bikini Bottom" as the site's name |
| The Sardine President (الرئيس السرديني) | Named cartoon characters in copy |
| Municipal Complaints Bureau | "Krusty Krab" as a headline brand |
| "We reached the bottom" (بقينا في القاع) | Show logos, title cards, official artwork |
| The pineapple, the tiki head — as *places* | Character dialogue or catchphrases |

Geometry that reads as the trend is fine; that is what the whole meme is. Copy that reads as
licensed merchandise is not. The no-monetisation decision materially reduces this exposure —
if monetisation is ever revisited, revisit this section first.

## Voice

Deadpan municipal bureaucracy. The humour comes from **treating the absurd as routine**, not
from signalling that a joke is happening.

- Write UI copy as official notices: "Complaint filed.", "Your application is under review
  by the municipal council.", "Reference number issued."
- Never explain the joke. No winking, no "😂", no "get it?".
- Forms ask for a *Sea Species* where a normal form asks for a role. Straight-faced.
- Errors stay in character: "The Bureau is closed for maintenance." beats "Error 500".
- Keep it warm. The trend is people laughing together about shared difficulty — not
  cynicism, and never punching at the people doing the complaining.

## Bilingual

Arabic is not a translation layer here; much of the comedy only lands in Arabic. Treat
Arabic as a first-class locale:

- Full RTL layout for Arabic overlays — direction, not just text.
- Egyptian colloquial, not Modern Standard Arabic. The trend is عامية مصرية.
- Some phrases stay Arabic in both locales because they are proper nouns of the meme:
  قاع الهامور, الرئيس السرديني, بقينا في القاع.
- Never machine-translate the jokes. An untranslated line beats a flattened one.

## Visual direction

**Deep, murky, and legible.** The scene should read as pressure and depth — not a bright
cartoon aquarium.

- Base water: deep oceanic navy (`#0a1e3f` region). Exponential fog, not linear — it falls
  off the way water actually does.
- Fog density is the primary mood control. Too thin and the scene reads as air; too thick
  and landmarks vanish before they can be recognised. Tune it against the point where a
  landmark first becomes identifiable, not against a screenshot.
- Light comes from **above**, always. Caustics on the floor and visible god-rays sell the
  surface without needing to render it.
- Landmarks are the only saturated colour in frame. Everything else desaturates with
  distance, which makes the environment do the work of directing attention.
- Bubbles and plankton drift *upward and slowly*. Fast particles read as snow.

## Overlays

The 3D scene is the world; overlays are **documents from that world**. Never a generic modal.

- Bio → a Citizenship Card for Qaa El-Hamour (بطاقة شخصية مائية), with skills as
  "underwater specialties".
- Résumé → Performance Reviews written by past managers, in the register of a grudging
  supervisor.
- Services → a menu board with prices, read as a restaurant menu.
- Contact → a paper complaint scroll, submitted under a Sardine Municipal Stamp.

Overlays should look printed, stamped, and slightly waterlogged — never like a web form
sitting on top of a canvas.

## Attribution

CC-BY credit for all four models must be **visible on the live site**, not only in the
README. Render it in-world — a municipal notice board is the on-theme solution — driven from
the attribution records in `libs/world/domain`, never hardcoded.

## Accessibility is part of the art direction

A scroll-driven dive is the whole navigation model, which means it excludes people with
vestibular sensitivity and anyone without working WebGL. That is a design problem, not a
compliance checkbox.

- Honour `prefers-reduced-motion`: no dive animation, jump directly between landmarks.
- Every piece of content must be reachable with WebGL disabled.
- The fallback should still carry the voice. A plain 2D page of municipal notices is
  perfectly on-brand — do not ship a stripped, apologetic version.


# Video Script: Ptah Harness Builder — Nagaty Use Case

## Metadata

- **Length**: ~2:00 minutes
- **Type**: Product Demo / Problem-Solution
- **Audience**: Developers, AI enthusiasts, tech founders (Arabic-speaking LinkedIn audience)
- **Language**: Egyptian Arabic narration (Arabic script)
- **Style**: LinkedIn-native vertical/square video, screen recording + face cam overlay
- **Tone**: Casual-professional, like explaining to a smart friend over coffee

---

## Source Evidence

- **Library**: `libs/frontend/harness-builder/`, `libs/backend/rpc-handlers/`
- **Key Types**: `rpc-harness.types.ts` — 17 RPC methods, 5 config dimensions
- **PRD Reference**: `D:\projects\intelligent-venture-building\docs\social-media-sentiment.md`
- **Screenshot**: `docs/fix-harness-builder-config-ui.png` (Config panel showing Nagaty harness)
- **Features Grounded In**: HarnessConfig (Persona, Agents, Skills, System Prompt, MCP Servers, CLAUDE.md)

---

## HOOK (0:00 — 0:15)

### Visual

Face cam — presenter with a knowing smile, leaning into the camera like sharing a secret. Quick cut to LinkedIn feed scrolling, then to Ptah harness builder UI.

### Narration

> **"عشان أهاك الـ ألجوريزم بتاع لينكدإن وأجيب ڤيوز أكتر — زي ما كل الناس بتعمل — هذكر واحد من ألطف الناس في مجال الـ إيه آي والـ تِك في مصر."**
>
> **"محمد نجاتي — سي إي أو أوف إكزيتس مينا، اللي عنده 236 ألف فولوور على لينكدإن."**
>
> **"بس مش هذكره وخلاص — أنا عملتله هارنس كامل بالـ إيه آي. خليني أوريك."**

### On-Screen Text (Overlay)

`To hack the LinkedIn algorithm...`
`I'll mention one of Egypt's kindest AI influencers.`
`But I actually built something for him.`

---

## WHAT IS THE HARNESS? (0:12 — 0:40)

### Visual

Screen recording: Ptah extension open in VS Code. Show the Harness Builder interface — the conversational chat area on the left, config preview panel on the right.

### Narration

> **"أولاً، إيه هو الـ هارنس؟"**
>
> **"الـ هارنس في بتاح هو ويزارد ذكي — بتوصفله أنت بتعمل إيه، وهو بيبنيلك إنڤايرومنت كاملة للـ إيه آي إيچنتس بتوعك."**
>
> **"بيعمل كونفيجر لخمس حاجات مع بعض:"**

### Visual — Quick Animated List (appear one by one)

1. **بيرسونا** — مين أنت وإيه أهدافك
2. **إيچنتس** — أنهي إيچنتس شغالين ومعاهم صب-إيچنتس مخصصين
3. **سكيلز** — موديولز بتعلم الـ إيه آي يعمل تاسكس معينة
4. **سيستم برومبت** — الـ إيه آي بيولّد برومبت مخصوص ليك
5. **إم سي بي سيرڤرز** — تولز وإنتجريشنز خارجية

### Narration (continues)

> **"يعني مش بس بتكلم إيه آي — أنت بتبني إنفراستركتشر كاملة ليه."**

---

## THE NAGATY EXAMPLE (0:40 — 1:25)

### Visual

Screen recording: Type in the harness conversational input. Show the freeform text being entered describing Nagaty's persona and goals.

### Narration

> **"طيب، خلينا نشوف ده عملي."**
>
> **"كتبت للـ هارنس: 'أنا عايز أعمل سوشيال ميديا أوركستريتور لـ نجاتي — سي إي أو أوف إكزيتس مينا. عنده لينكدإن، إنستجرام، و إكس. محتاج كونتنت چينيريشن، سينتيمنت أناليسيس، و ليد راوتينج.'"**

### Visual

Show the harness streaming response — the execution view with thinking blocks and tool calls appearing in real-time. Then cut to the Config panel showing the result.

### Narration

> **"في ثواني، الـ إيه آي عمل أنالايز للـ إنتنت بتاعي وبنالي كونفيج كامل."**

### Visual — Show Config Panel (match the screenshot)

Point to each section:

> **"شوف — عملي بيرسونا: 'نجاتي براند إنتيليچنس هارنس' — بروداكشن-جريد سوشيال ميديا أوركستريتور."**
>
> **"صمملي 3 كاستم سكيلز:"**

### Visual — Zoom on Skills Tags

Show the three green skill tags: `podcast-transcript-analyzer`, `vibe-mimic-writing`, `intent-scorer`

> **"الأولى بتحلل بودكاست ترانسكريبتس وتطلع كونتنت ناجتس."**
>
> **"التانية بتحافظ على صوت نجاتي الحقيقي في كل بوست."**
>
> **"والتالتة بتعمل سكورينج للـ كومنتس عشان تلاقي إم أند إيه ليدز وسط الـ نويز."**

### Visual — Show System Prompt Preview

> **"وكمان ولّد سيستم برومبت كامل — فيه بيرسونا كومبلاينس، جاردريلز، والـ أبروڤال جيتس عشان مفيش حاجة تتنشر من غير موافقة."**

---

## THE POWER MOMENT (1:25 — 1:45)

### Visual

Show the "Apply to Workspace" button. Click it. Show the files being generated — skills created at `~/.ptah/plugins/`, CLAUDE.md updated, system prompt written.

### Narration

> **"ودلوقتي — أبلاي تو ووركسبيس."**
>
> **"الـ هارنس كتب كل حاجة: سكيل فايلز، سيستم برومبت، كلود إم دي — كلهم في الـ ووركسبيس بتاعك."**
>
> **"يعني لما تفتح بتاح تاني، الـ إيچنتس بتوعك أولريدي كونفيجرد وجاهزين يشتغلوا."**

### Visual

Quick montage: Show Ptah chat with the Nagaty persona active. Show a sample interaction where the agent drafts a LinkedIn post in Nagaty's voice.

> **"مش بس سيتأب — ده سيستم شغال. الـ إيچنت بيكتب بصوت نجاتي، بيحلل الـ إنجيچمنت، وبيعمل راوت للـ ليدز."**

---

## CTA (1:45 — 2:00)

### Visual

Face cam — presenter wraps up. Ptah logo and links on screen.

### Narration

> **"الـ هارنس بيلدر ده فيتشر واحد من فيتشرز كتير في بتاح."**
>
> **"بتاح بيخليك تربط كل الـ إيه آي سابسكريبشنز بتاعتك — كلود، كوبايلوت، كوديكس، چيميناي — في أبّ واحد، وتستخدمهم كلهم مع بعض."**
>
> **"الـ بروچيكت أوبن سورس — لينك في أول كومنت."**
>
> **"جربه وقولي رأيك."**

### On-Screen Text

```
Ptah — The Coding Orchestra
Open Source | VS Code + Electron
github.com/[repo-link]
```

---

## B-ROLL SHOT LIST

| Timestamp | Description                          | Source                                   |
| --------- | ------------------------------------ | ---------------------------------------- |
| 0:05      | Harness Builder UI — full view       | `HarnessBuilderViewComponent`            |
| 0:15      | Config panel with 5 dimensions       | `HarnessConfigPreviewComponent`          |
| 0:25      | Animated list of 5 config items      | Motion graphics overlay                  |
| 0:45      | Freeform input typing                | Harness conversational input             |
| 0:55      | Streaming execution view             | `HarnessExecutionViewComponent`          |
| 1:05      | Config panel — Nagaty result         | `docs/fix-harness-builder-config-ui.png` |
| 1:10      | Skill tags zoom                      | Config preview — skills section          |
| 1:20      | System prompt preview                | Config preview — prompt section          |
| 1:30      | Apply button click + file generation | Harness apply flow                       |
| 1:40      | Agent drafting LinkedIn post         | Ptah chat interface                      |
| 1:50      | Ptah logo + CTA links                | Brand assets                             |

## TECHNICAL REQUIREMENTS

### Screen Recordings Needed

1. **Harness Builder full flow** — open harness, type Nagaty description, show streaming, show config result
2. **Apply to Workspace** — click apply, show file generation output
3. **Agent in action** — Ptah chat with Nagaty persona, drafting a sample post

### UI Screenshots

1. Config panel showing Nagaty persona + skills + prompt (already captured: `docs/fix-harness-builder-config-ui.png`)
2. Execution view with streaming blocks

### Motion Graphics

1. Animated list of 5 config dimensions (Persona, Agents, Skills, Prompt, MCP)
2. End card with Ptah branding and links

---

## PRODUCTION NOTES

### Pacing

- **Hook (0:00-0:12)**: Fast, punchy — grab attention with the Nagaty name drop
- **Explainer (0:12-0:40)**: Steady, clear — educate without losing momentum
- **Demo (0:40-1:25)**: Deliberate — let the viewer see the UI and absorb results
- **Power Moment (1:25-1:45)**: Exciting — show the payoff
- **CTA (1:45-2:00)**: Warm, inviting — not salesy

### Egyptian Arabic Style Notes

- Use casual Egyptian dialect, not formal MSA — sounds more authentic on LinkedIn
- Mix Arabic with English tech terms naturally (harness, agents, skills, config) — that's how Egyptian devs actually talk
- Avoid over-explaining English terms — the audience is technical
- Tone: Like a senior dev showing a cool project to a colleague, not a salesperson

### LinkedIn Video Format

- **Aspect ratio**: 1:1 (square) or 4:5 (vertical) for mobile-first feed
- **Captions**: Mandatory — both Arabic and English subtitles (LinkedIn videos autoplay muted)
- **Hook text**: First 3 seconds must have on-screen text hook in English: "I built a harness for Nagaty."
- **Thumbnail**: Split screen — Nagaty's LinkedIn profile on one side, Ptah Config panel on the other

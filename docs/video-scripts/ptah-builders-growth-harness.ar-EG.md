# Ptah Builders Growth Harness — Google Search + Exa + HubSpot — السكريبت الكامل (مصري)

**المدة:** 5.5–6.5 دقيقة · **الـ Runtime:** Ptah Desktop (Electron) · **الـ Orchestrator:** (الموديل الافتراضي بتاع الديسكتوب — [VERIFY: الـ badge على الكاميرا])
**الهدف:** نستخدم Ptah إننا نبني الفريق اللي بيسوّق لـ Ptah — نلاقي solo founders وفرق صغيرة بيبنوا SaaS بـ TypeScript، نحط المناسبين منهم في HubSpot، ونكتب LinkedIn posts ورسايل مباشرة بتعزمهم على الـ early access بتاع Ptah Builders، ببلاش.
**الفكرة الحاكمة:** أنا بنيت coding agent، وبستخدمه إني أبني بيه SaaS. دلوقتي بستخدم نفس الـ harness builder إني أشغّل الـ outreach بتاع البرنامج نفسه. الـ search جوه Ptah أصلاً — Google عن طريق Serper، وExa للـ semantic search. ولسه في بني آدم بيوافق على كل رسالة قبل ما أي حاجة تخرج.

> ده promo مستقل، مش جزء من سلسلة SaaS-on-open-weights. ماشي على `SCRIPT-STYLE-GUIDE.md` في الصوت والفورمات. مرجع الصوت: بلوك "Voice notes" في أول `sales-harness-apollo-hubspot-zernio.md` — بضمير المتكلم، كلمة "يعني" هي كلمة الـ reset (مقابل "basically")، الأرقام بتتقال عادي من غير تهويل، وصفر صفات hype.
>
> السكريبت ده بيحل محل `sales-harness-apollo-hubspot-zernio.md`. القديم كان بيبني pipeline تجريبي على Apollo وZernio. ده بيبني الـ pipeline الحقيقي لـ Ptah Builders.
>
> **الترجمة:** نفس اللي في `ptah-builders-growth-harness.md` بالإنجليزي. الـ VO بالعامية المصرية. أسماء المنتجات والأدوات والملفات فضلت بحروف لاتينية زي ما هي. الـ prompt اللي بيتلزق في الـ AI Team Builder فضل بالإنجليزي عشان ده اللي بيتكتب على الشاشة فعلاً.

## العرض، بنقوله مرة واحدة عشان كل المشاهد تتفق

- **الـ early access بتاع Ptah Builders ببلاش.** مفيش checkout على الكاميرا. مفيش سعر على الشاشة. [VERIFY: الصيغة بالظبط بتاعة العرض، عدد المقاعد لو في، والـ landing URL. ما تقولش "محدود" غير لو في حد حقيقي.]
- الـ Builder بياخد إيه: مقعد في كورس الـ SaaS الأساسي بتاع 8 أسابيع، بيتدرّس على تطبيق production حقيقي واحد؛ الـ Ptah workflow اللي بناه (agents وskills وorchestrations وspecs)؛ الجلسة الـ live الأسبوعية؛ الـ Builders Lounge الخاص على `community.ptah.live`. [VERIFY: كل بند على حالة البرنامج الحالية قبل التسجيل — الـ course modules لسه ما اتكتبتش لحد 2026-08-25؛ قول "الكورس بيتكتب مع أول cohort" مش "الكورس جاهز".]
- لمين: solo founders وفرق صغيرة بيبنوا SaaS على TypeScript — Nx وNestJS وAngular أو React وPrisma. ده الـ ICP اللي الـ harness بيدوّر عليه.

## Checklist قبل التسجيل

- **الـ web search provider متظبط.** افتح Ptah settings ← Web Search. اختار الـ provider **Serper** (Google Search API) وحط الـ key. دوس زرار "Test" الجاهز لحد ما الـ status يقول connected. بعدين كرر مع **Exa**. [VERIFY: الـ provider selector بيمسك provider واحد active في المرة (`web-search-config.component.ts`). الـ harness ما يقدرش ينادي الاتنين مع بعض من `ptah_web_search`. خيارين: (a) سجّل مشهد الـ discovery مرتين مع تبديل الـ provider، أو (b) وصّل Exa كـ MCP server لوحده من Connected Apps عشان الاتنين يبقوا live. قرر ده بعيد عن الكاميرا. الخيار (b) أنضف كمشهد — أداة بتعمل Google، وأداة بتعمل semantic.]
- **HubSpot MCP متوصّل** — الـ endpoint هو `mcp.hubspot.com`، OAuth 2.0. محتاج user-level app بصلاحيات read **وwrite** (contacts وcompanies) على HubSpot Developer Platform. استخدم HubSpot **sandbox/test portal**، عمرك ما تستخدم حساب عميل حقيقي. وصّله من Connected Apps في Ptah قبل التسجيل — مشهد الـ build بيوري الـ builder وهو بيكتشفه، مش إنت وإنت بتظبطه.
- **مفيش secrets نعمل لها blur.** الـ search keys بتتكتب في الـ settings قبل التسجيل وعمرها ما بتظهر. HubSpot بيتوصّل عن طريق RFC 9728 / 8414 / 7591 discovery — إنت بتوافق في المتصفح. مفيش حاجة بتتكتب على الشاشة.
- **Draft وqueue بس، وبني آدم في النص — مفيش نقاش.** شروط LinkedIn بتمنع الأتمتة. GDPR وCAN-SPAM بيحكموا الـ cold contact. الـ search والـ enrichment من صفحات عامة قراية بس ودي تمام. خطوة كتابة الـ outreach بتستهدف **الـ test contacts اللي المؤسس حطها بنفسه** في الـ HubSpot sandbox، عمرها ما تستهدف الناس الحقيقيين اللي اتلاقوا في مشهد الـ discovery. الـ drafts بتتكتب في ملفات. الموافقة بتنقل الملف من `drafts/` لـ `queued/`، عمرها ما تنقله لـ "sent". مفيش send tool في الـ harness ده خالص — ده كل الموضوع في مشهد الـ allowlist.
- **جرّب الـ harness قبل التسجيل.** ابنيه مرة بعيد عن الكاميرا. افتح كل `.claude/agents/*.md` اتولّد. اقرا سطر `tools:` في الـ frontmatter في كل واحد. اتأكد إنه مش فاضي (الـ array الفاضي بيشيل السطر، وده بيدي كل الأدوات بدل ولا أداة). اتأكد إن مفيش HubSpot tool فيها `send` أو `enroll` أو `sequence` أو `email` في اسمها على `outreach-drafter`. اكتب السطر بالظبط عشان تعرف بتشاور على إيه على الكاميرا.
- **حط تلات test contacts** في الـ HubSpot sandbox بإيميلات إنت صاحبها. حتى لو حصل write بالغلط، هيوصل لك إنت بس.
- **الـ workspace جاهز.** افتح `D:\projects\ptah-growth` كـ workspace active قبل ما تفتح الـ AI Team Builder. الـ builder بيتثبت على الـ workspace اللي active وقت ما يبدأ ومفيش عنده directory picker. [VERIFY: اسم الفولدر؛ اعمله فاضي بـ README سطر واحد قبل التصوير.]
- **الـ Builders landing page شغالة** على الـ URL اللي بتقوله في الـ CTA. [VERIFY: مسار الـ early access المجاني لازم يشتغل من غير ما نقلب الـ Paddle checkout. `BUILDERS_CHECKOUT_ENABLED` لسه false حسب `OPERATIONS.md` بتاع Seshat. اتأكد من مسار الـ provisioning اللي بيحط Builder مجاني في جروب `builders-founding` على Discourse قبل ما تنشر الفيديو.]
- الـ prompt بتاع الـ harness builder جاهز للّزق (شوفه تحت).

## الـ Assets / Overlays

- Lower-thirds لكل subagent وهو بيتعمل: `founder-finder` و`fit-analyst` و`crm-sync` و`content-drafter` و`outreach-drafter`.
- Badge ثابت "Draft بس — بني آدم بيوافق"، ظاهر من أول لحظة `outreach-drafter` يظهر فيها لحد مشهد الموافقة.
- Callout box على الـ HubSpot record اللي اتعمل — ده فريم "الكتابة دي في CRM حقيقي".
- Callout box على سطر `tools:` في الـ frontmatter بتاع `outreach-drafter.md`.
- Caption صغير "Google عن طريق Serper · Exa semantic — جوه Ptah" أول مرة أدوات الـ search تظهر.
- End card: لوجو Ptah · GitHub repo URL · "Ptah Builders — early access، ببلاش ← [VERIFY URL]".

---

### [00:00–00:25] الافتتاحية

- **VISUAL:** شات Ptah Desktop. الـ model badge ظاهر. Connected-app tile واحد في لستة الأدوات: HubSpot. حالة الـ web search بتقول connected.
- **VO:** "أنا بقالي سنة ونص ببني coding agent، وبستخدمه إني أبني بيه SaaS application. المشروع open source. دلوقتي أنا فاتح برنامج حواليه اسمه Ptah Builders — مجموعة صغيرة بتبني SaaS معايا على مدار تمن أسابيع، والـ early access ببلاش. فأنا محتاج ألاقي الناس دي وأكلمهم. يعني، هستخدم Ptah إني أبني الفريق اللي يعمل ده، وأنا اللي بوافق على كل رسالة بنفسي قبل ما أي حاجة تخرج."
- **ON-SCREEN:** (مفيش)

### [00:25–01:00] الترحيب — إيه اللي هيحصل في الفيديو

> مشهد جديد. كل الأوقات بعده في السكريبت ده هي أوقات السكريبت الإنجليزي الأصلي؛ زوّد عليها 35 ثانية في المونتاج. مواصفات الـ timeline graphic في `ptah-builders-growth-harness-assets-and-welcome.md` (الـ asset `OVERLAY-01-TIMELINE-STRIP`).

- **VISUAL:** Ptah Desktop يفضل على الشاشة ويتعتم شوية. شريط timeline أفقي من 7 خطوات بيظهر في النص، وكل خطوة بتنوّر وهي بتتقال: (1) Search + HubSpot متوصّلين، (2) AI Team Builder بيصمّم 5 subagents، (3) founder discovery live، (4) score + دفع لـ HubSpot، (5) تلات LinkedIn posts، (6) رسايل مباشرة للـ test contacts، (7) approve = queued، مفيش إرسال. في الآخر الشريط بيتصغّر وبيثبت في أعلى الشاشة كـ progress bar.
- **VO:** "قبل ما أبني أي حاجة، ده اللي هيحصل في الفيديو. الـ search وHubSpot متوصّلين أصلاً. أنا بوصف الشغل للـ AI Team Builder وهو بيصمّم خمس subagents. بعدين بشغّله live: بنلاقي founders، بنديهم score وبنحط المناسبين في HubSpot، بنكتب تلات LinkedIn posts، وبنكتب أول الرسايل. يعني، كل رسالة بتفضل draft لحد ما أقراها. الـ approve بينقل الملف لـ queued. مفيش حاجة بتتبعت على الكاميرا. الرسايل المباشرة بتروح لتلات test contacts أنا حطيتهم بنفسي. والـ early access بتاع Ptah Builders ببلاش."
- **ON-SCREEN (timeline strip):** "1. Search + CRM" · "2. AI Team Builder" · "3. Founder Discovery" · "4. Score + HubSpot" · "5. LinkedIn Posts" · "6. Direct Messages" · "7. Approve = Queued". تحته تلات pills: "Draft بس" · "مفيش إرسال تلقائي" · "Early access ببلاش".

### [00:25–00:55] إيه اللي متوصّل أصلاً

- **VISUAL:** افتح Ptah settings ← Web Search. ورّي الـ provider dropdown: Tavily وSerper وExa. Serper مختار، الـ status connected. بعدين Connected Apps وHubSpot مكتوب عليه "Connected". [VERIFY: أسماء الـ navigation بالظبط على الكاميرا.]
- **VO:** "الـ search جوه Ptah أصلاً. Serper بيجيبلي نتايج Google. Exa بيجيبلي semantic search — 'هاتلي صفحات شبه دي' بدل الـ keywords. الاتنين مجرد key في الـ settings، وخلاص. للـ CRM وصّلت HubSpot. ده عبارة عن URL وتاب في المتصفح — Ptah بيلاقي الـ auth server، بيسجّل client، وبيتعامل مع الـ token. مفيش حاجة بتتكتب على الشاشة."
- **ON-SCREEN (lower-third):** "Google عن طريق Serper · Exa semantic — جوه Ptah" وبعدها "HubSpot — OAuth، صفر إعداد يدوي"

### [00:55–01:15] افتح الـ AI Team Builder

- **VISUAL:** Setup Hub ← كارت "AI Team Builder" ← شاشة الـ builder بتفتح ("Describe your AI team").
- **VO:** "ده الـ AI Team Builder. أنا مش هعمل configure لكل agent لوحده. أنا بوصف الشغل وهو بيصمّم الفريق."
- **ON-SCREEN:** (مفيش)

### [01:15–01:55] الـ Prompt

- **VISUAL:** الزق الـ growth-harness prompt في message box بتاع الـ builder. اعمله scroll بسرعة — الـ ICP، الخمس subagents، وبند الـ draft-only.
- **VO:** "أهو الشغل. لاقي solo founders وفرق صغيرة بيبنوا SaaS على TypeScript — Nx وNestJS وAngular وPrisma. اعرف مين فيهم مناسب لـ Builders. حط المناسبين في HubSpot. اكتب الـ LinkedIn posts وأول الرسايل. وعمرك ما تبعت حاجة من غيري."
- **VISUAL:** Submit.
- **ON-SCREEN:** الـ prompt اللي اتلزق ظاهر.

### [01:55–02:40] الـ Build

- **VISUAL:** الـ build بيتعرض في الـ execution tree — اكتشاف الأدوات، اقتراحات الـ subagents، ملفات الـ skills بتتعمل، نداءات `proposeConfig` بتملا الـ config preview في الـ side panel.
- **VO:** "هو شايف إن الـ web search وHubSpot موجودين أصلاً وبيختار كل subagent محتاج إيه. founder finder بيعمل الـ searches. fit analyst بيقرا اللي اتلاقى وبيديله score على الـ profile. CRM sync agent. content drafter للـ posts العامة. outreach drafter للرسايل المباشرة. كمان بيكتب skills جنبهم — الـ Builder شكله إيه، إزاي تكتب أول رسالة ما تبقاش شكلها template، وقواعد الصوت بتاعتي من الـ transcripts بتاعتي."
- **ON-SCREEN (lower-thirds، كل واحد وهو بيظهر):** "founder-finder" · "fit-analyst" · "crm-sync" · "content-drafter" · "outreach-drafter"
- **VISUAL:** بانر "Configuration looks ready to apply" ← دوس **Apply to Workspace**.
- **VO:** "Apply بيكتبه في الـ workspace — CLAUDE.md وملفات الـ agents والـ skills. من هنا الموضوع بقى مجرد إننا نشغّله."

### [02:40–03:05] الـ Tool Allowlist

- **VISUAL:** افتح `.claude/agents/outreach-drafter.md` اللي لسه اتكتب في الـ editor. اثبت على سطر `tools:` في الـ frontmatter.
- **VO:** "الـ agent ده بياخد لستة. يقرا HubSpot contact. يكتب ملف. وخلاص. مفيش send فيها، لأن مفيش send tool في الـ harness ده أصلاً. ده مش سطر في الـ prompt بتاعي — ده في الملف. لو الأداة مش في اللستة دي، الـ agent مش هيقدر يناديها."
- **ON-SCREEN (callout):** علّم على سطر `tools:`؛ الـ caption — "كل subagent بياخد الـ allowlist بتاعته."

### [03:05–03:50] نلاقي founders — live، search حقيقي

- **VISUAL:** اكتب طلب الـ discovery على الكاميرا في الـ harness اللي اتبنى.
- **VO:** "طلب حقيقي: لاقي solo founders وفرق صغيرة بيبنوا SaaS على Nx مع NestJS وAngular أو React، وبيكتبوا عن ده علني — blog posts وGitHub READMEs ومقالات LinkedIn وShow HN posts من السنة دي."
- **VISUAL:** نداءات الـ search بتتعرض — Google queries عن طريق Serper، بعدين نداءات Exa "find similar" بتتفرّع من أول النتايج. لستة قصيرة بتظهر: الاسم، الشركة أو المشروع، الـ URL اللي بيثبت إنه مناسب، وسبب في سطر واحد.
- **VO:** "Google بيجيبلي الواضحين. Exa بياخد نتيجة كويسة واحدة وبيلاقي صفحات شبهها — ومن هنا بييجي الناس اللي محدش سمع عنهم. ده قراية صفحات عامة. مفيش حاجة بتخرج لحد."
- **ON-SCREEN (callout):** علّم على اللستة وعمود الـ evidence URL.

### [03:50–04:20] Score وادفع لـ HubSpot — live، كتابة حقيقية في الـ CRM

- **VISUAL:** اطلب منه يدي score للّستة ويحط المناسبين في HubSpot.
- **VO:** "دلوقتي اديهم score على الـ Builder profile، واللي يعدّي حطه في HubSpot كـ contact، مع لينك الدليل على الـ record."
- **VISUAL:** التأكيد بيتعرض؛ قطع على الـ HubSpot sandbox portal وهو بيوري الـ contact records الجديدة والـ source URL في property.
- **ON-SCREEN (callout):** علّم على الـ HubSpot contact record الجديد.

### [04:20–04:50] كتابة الـ posts العامة

- **VISUAL:** اطلب من `content-drafter` تلات LinkedIn posts عن الـ Builders early access.
- **VO:** "تلات posts. واحدة عن ليه البرنامج موجود. واحدة عن إنت بتخرج بإيه فعلاً — الـ codebase الشغال والـ Ptah setup اللي بناه. وواحدة بتقول بس إن الـ early access ببلاش وإزاي تدخل. بصوتي أنا، من الـ transcript بتاعي، مش بصوت marketing."
- **VISUAL:** الـ drafts بتتكتب في `content/posts/`. اعمل scroll لواحدة على الشاشة.
- **ON-SCREEN (callout):** علّم على سطر فيه اسم ملف حقيقي أو رقم حقيقي من الـ repo — الدليل إنه قرا المصدر.

### [04:50–05:30] كتابة الرسايل المباشرة — test contacts بس

- **VISUAL:** غيّر الهدف بشكل صريح. شاور على التلات test contacts في الـ HubSpot sandbox.
- **VO:** "للرسايل المباشرة أنا مش هلمس الـ founders اللي لسه لاقيناهم — ده هيبقى outreach حقيقي لناس حقيقيين على الكاميرا، ومش ده اللي بنعمله. التلاتة دول test contacts أنا اللي حطيتهم بنفسي. كل حاجة من هنا بتروح ليهم هما."
- **VISUAL:** اطلب من `outreach-drafter` يكتب أول رسالة لكل واحد، بالإشارة للـ evidence link اللي على الـ record.
- **VISUAL:** تلات drafts بتتكتب في `content/outreach/drafts/`. كل واحدة بتبدأ بالحاجة المحددة اللي الشخص ده بناها.
- **ON-SCREEN (badge، ثابت من هنا):** "Draft بس — بني آدم بيوافق"

### [05:30–06:00] الموافقة — بتتحط في الطابور، مش بتتبعت

- **VISUAL:** افتح draft واحدة. عدّل سطر شكله template. شغّل أمر الـ approve؛ الملف بيتنقل لـ `content/outreach/queued/`.
- **VO:** "أنا بقرا كل واحدة قبل ما تتحرك. الـ approve مش بيبعت — بيحط في الطابور. اللي في الـ queue أنا بحطه في LinkedIn بنفسي، بإيدي، بعدين. مفيش حاجة بتخرج من Ptah لوحدها."
- **ON-SCREEN (callout):** علّم على فولدر `queued/`. مفيش حالة "sent" بتظهر في أي حتة.

### [06:00–06:30] الـ CTA / شاشة النهاية

- **VISUAL:** الـ README بتاع الـ GitHub repository، بعدين الـ Builders landing page.
- **VO:** "الفريق كله في الـ repo — الـ prompt اللي بناه والـ harness اللي طلع منه. Ptah open source؛ لو عايز تستخدمه أو تشتغل عليه معايا، الكود موجود. ولو بتبني SaaS على TypeScript وعايز تبني واحد معايا على مدار تمن أسابيع، الـ Builders early access ببلاش. اللينك تحت. وإنت اللي تقرر لو ده مناسب لطريقة شغلك."
- **ON-SCREEN:** End card — لوجو Ptah · repo URL · "Ptah Builders — early access، ببلاش ← [VERIFY URL]".

---

## الـ prompt بتاع الـ harness builder

النص بالظبط اللي بيتلزق في الـ AI Team Builder على الكاميرا (بالإنجليزي، زي ما هو):

```
Be the growth lead for Ptah Builders, a free early-access program where
solo founders and small teams build a production SaaS with me over eight
weeks using Ptah, an open-source coding orchestra.

Ideal profile: solo founders and teams of one to five who build SaaS on
TypeScript — Nx workspaces, NestJS, Angular or React, Prisma — and who
write about their work in public: blog posts, GitHub READMEs, LinkedIn
articles, Show HN posts.

Build five subagents:
- founder-finder — runs web searches to find people matching the profile.
  Use Google search for keyword queries and Exa for "find pages like this
  one" from the good hits. Every result must carry the URL that proves
  the fit.
- fit-analyst — reads each result and scores it against the profile with
  a one-line reason. Drops anyone without public evidence.
- crm-sync — pushes qualified people into HubSpot as contacts, with the
  evidence URL stored on the record.
- content-drafter — writes LinkedIn posts about Builders early access in
  my voice. Read my voice rules from the skill before writing. Output to
  content/posts/.
- outreach-drafter — writes short first messages to specific contacts,
  each opening with the concrete thing that person built. Output to
  content/outreach/drafts/.

Use only what is already wired: Ptah web search and the connected HubSpot
server. Give each subagent only the tools it needs.

Draft-only, always. No subagent may have any tool that sends, enrolls,
sequences, or emails. Every message is a file in drafts/ and stops there.
I approve by hand and move it to queued/. Build the team so that is the
only way a message can ever leave.
```

---

## Shot list (ملخص سريع للتصوير)

1. الافتتاحية: Ptah Desktop، الـ model badge، الـ HubSpot tile، الـ web search connected.
2. Settings ← Web Search: الـ provider dropdown، Serper connected. Connected Apps: HubSpot "Connected".
3. Setup Hub ← كارت "AI Team Builder" ← الـ builder بيفتح.
4. الزق الـ growth-harness prompt؛ scroll على الـ ICP / الخمس subagents / بند الـ draft-only.
5. Submit؛ الـ build بيتعرض — اكتشاف الأدوات، اقتراحات الـ subagents والـ skills، الـ config preview بيتملا.
6. الـ subagents بتظهر — lower-thirds لكل agent.
7. "Configuration looks ready to apply" ← Apply to Workspace.
8. افتح `.claude/agents/outreach-drafter.md` — علّم على سطر `tools:`، مفيش send tool.
9. Live: founder discovery — Serper queries، بعدين Exa fan-out — callout على عمود الـ evidence URL.
10. Live: score + دفع لـ HubSpot — قطع على الـ sandbox والـ contact records الجديدة والـ source URL.
11. Live: تلات LinkedIn posts في `content/posts/` — callout على ملف حقيقي أو رقم حقيقي.
12. تغيير الهدف للـ test contacts — اشرح على الكاميرا ليه.
13. Live: تلات أول رسايل في `content/outreach/drafts/` — الـ badge شغال.
14. مراجعة + تعديل draft واحدة، approve — الملف بيتنقل لـ `queued/`. مفيش حالة "sent".
15. الـ README بتاع GitHub repository، الـ Builders landing page.
16. End card.

## علامات [VERIFY]

- **Provider اتنين للـ search في نفس الوقت.** `web-search-config.component.ts` بيمسك provider واحد active لـ `ptah_web_search`. اتأكد لو الـ harness يقدر يوصل لـ Serper وExa في نفس الـ run. لو لأ، وصّل Exa كـ MCP server منفصل من Connected Apps، أو سجّل مشهد الـ discovery لكل provider واقطع بينهم. ما تزوّرش أداة واحدة بتعمل الاتنين.
- **مسار الـ early access المجاني.** سجل `OPERATIONS.md` بتاع Seshat بيوري إن بوابة الإطلاق (`BUILDERS_CHECKOUT_ENABLED`) لسه مقفولة وجروب الـ Builders بيتزامن من Paddle webhooks. الـ Builder المجاني محتاج مسار provisioning ما يعدّيش على الـ checkout. اتأكد إنه موجود وشغال قبل ما الفيديو يبقى عام. سجّل القرار ده في `D:\projects\seshat\OPERATIONS.md` كـ D5.
- **صيغة العرض.** عدد المقاعد، مدة الـ "early access"، والـ landing URL. ما تقولش "محدود" من غير حد حقيقي.
- **حالة الكورس.** لحد 2026-08-25 مفيش أي week module اتكتب (جدول الـ curriculum في `OPERATIONS.md`). قول إن الكورس بيتكتب مع أول cohort. ما تورّيش ولا توعد بـ modules جاهزة.
- **الـ subagent tool allowlist تنفيذ حقيقي، بس بشرطين.** `HarnessSubagentDesignService.designSubagentFleet` (`libs/backend/rpc-handlers/src/lib/harness/ai/harness-subagent-design.service.ts`) بيطلب `tools: string[]` لكل subagent. `HarnessAgentFileWriterService.composeAgentFile` (`libs/backend/rpc-handlers/src/lib/harness/config/harness-agent-file-writer.service.ts:75-86`) بيكتبها في الـ frontmatter بس `if (tools.length > 0)` — الـ array الفاضي بيشيل السطر وبيدي كل الأدوات. (1) اتأكد إن الـ array مش فاضي لـ `outreach-drafter`. (2) ده الـ convention بتاع ملفات الـ subagent في Claude Code؛ بيشتغل بس لو الـ orchestrator هو Claude Code session. باقي الـ CLI providers مش مضمون إنها تحترم `tools:` بنفس الطريقة. الـ config preview (`harness-config-preview.component.ts`) بيوري أسماء الـ subagents بس، فالمكان الوحيد اللي تصوّر فيه الـ allowlist هو الملف المكتوب بعد Apply.
- **صلاحيات الـ HubSpot sandbox.** اتأكد إن الـ developer portal المجاني بيدي read + write على contacts وcompanies يوم التسجيل. اتأكد إن الـ custom property بتاعة الـ evidence URL موجودة في الـ sandbox.
- **السلوك بالظبط لـ `proposeConfig` / `createSkill` على الشاشة** في الـ execution tree — اتأكد لو بيتعرضوا كـ cards منفصلة عشان الـ callouts في مشهد الـ build تطابق.
- **مسارات الـ navigation بالظبط لـ Settings ← Web Search وMarketplace ← Connected Apps** والنصوص اللي بتتكتب على الكاميرا. `oauth-surface.component.ts` بيجي معاه quick-connect chips لـ Sentry / Notion / Linear بس — HubSpot بيتلزق كـ URL.
- **"AI Team Builder" هو الاسم اللي على الشاشة** واللي بيتقال بصوت عالي، مش "harness builder".
- **الـ latency بتاعة الـ search وHubSpot.** سخّن الاتنين قبلها. اعمل speed-ramp لمشاهد الـ discovery والـ build لو بطيئة.
- مفيش outreach حقيقي على الكاميرا في أي لحظة. الـ badge "Draft بس — بني آدم بيوافق" يفضل ظاهر طول تسلسل الكتابة والموافقة. مفيش حالة "sent" تظهر في التسجيل.

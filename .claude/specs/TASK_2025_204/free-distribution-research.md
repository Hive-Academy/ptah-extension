# Research Report: Distributing Electron Apps Without Expensive Code Signing

**Task**: TASK_2025_204
**Date**: 2026-03-17
**Confidence Level**: 90% (based on 20+ sources, cross-validated)
**Scope**: Real-world strategies for indie/early-stage Electron app distribution

---

## Executive Summary

Code signing is NOT a binary choice between "pay $300+/year or ship unsigned." There is a practical, progressive path from zero-cost beta distribution to fully-signed production releases. The landscape changed significantly in 2024-2025: EV certificates no longer provide instant SmartScreen reputation, Microsoft launched Azure Trusted Signing at $9.99/month, and macOS Sequoia 15.1 tightened unsigned app restrictions. The optimal strategy for an indie developer is to start with unsigned GitHub Releases for beta testers, then graduate to Azure Trusted Signing ($120/year) or Certum OSS certificates (~$30/year renewal) when approaching public launch.

---

## 1. What Open-Source Electron Apps Actually Do

### Corporate-Backed Apps (Always Signed)

| App      | Backing                       | Signed?           | Certificate Type         |
| -------- | ----------------------------- | ----------------- | ------------------------ |
| VS Code  | Microsoft                     | Yes, from day one | Microsoft internal certs |
| Slack    | Salesforce                    | Yes               | Corporate EV/OV          |
| Discord  | Discord Inc                   | Yes               | Corporate certs          |
| Obsidian | Dynalist Inc (revenue-funded) | Yes               | Paid certificates        |
| Insomnia | Kong Inc (acquired)           | Yes               | Corporate certs          |

These apps were never truly "indie" - they had corporate backing or significant funding from the start.

### Genuinely Independent/OSS Apps

| App            | Status                    | Signing Approach                                                                |
| -------------- | ------------------------- | ------------------------------------------------------------------------------- |
| Mark Text      | OSS, community-maintained | Shipped unsigned for years; users had to bypass SmartScreen/Gatekeeper manually |
| Notable        | OSS (now archived)        | Shipped unsigned; relied on user trust via GitHub                               |
| Hyper          | Vercel-backed             | Signed (corporate backing)                                                      |
| Beaker Browser | OSS (discontinued)        | Initially unsigned, later signed via grants                                     |

**Key Finding**: Most genuinely independent Electron apps ship unsigned early on and only invest in signing after gaining traction or funding. The user friction is real but manageable for a technical audience.

---

## 2. Free and Cheap Alternatives to Traditional Code Signing

### 2.1 Self-Signing on Windows

Self-signing on Windows is **not useful for distribution**. Self-signed certificates are not trusted by Windows and will trigger the same SmartScreen warnings as unsigned apps. Self-signing only helps for internal/development use.

### 2.2 SignPath Foundation (Free for Open Source)

**Verdict: Best free option if your project qualifies.**

SignPath Foundation provides free code signing certificates (including Windows Authenticode) for qualifying open-source projects.

**Eligibility Requirements**:

- OSI-approved open-source license (no commercial dual-licensing)
- No proprietary components in the signed artifacts
- Project must be actively maintained and already released
- Functionality must be documented on download page
- All team members must use MFA for SignPath and source code repos
- Must publish a code signing policy page on your project
- Binaries must be built from source in a verifiable way (CI/CD)
- Every release requires manual approval for signing

**Restrictions**:

- Cannot sign proprietary/commercial software
- Cannot sign security vulnerability tools
- Team must be the actual developers (no signing third-party code)
- Must attribute SignPath Foundation in your docs

**Process**: Apply via their website, get approved (discretionary), configure CI pipeline, submit releases for signing approval.

**Practical Assessment**: Excellent for purely open-source projects. NOT suitable for Ptah if it has any commercial/proprietary components or dual-licensing. The requirement for no proprietary code is strict.

### 2.3 Certum Open Source Code Signing

**Verdict: Cheapest paid option for OSS developers.**

- **Initial cost**: ~EUR 69 (smartcard + reader) + ~EUR 35 shipping = ~EUR 104 first year
- **Renewal**: ~EUR 29/year
- **Requirements**: Open-source project, identity verification (photo ID + selfie video), utility bill for address verification
- **SmartScreen**: Yes, provides standard OV-level SmartScreen reputation building
- **Gotchas**: Physical smartcard requirement is annoying for CI/CD; setup takes about a full working day; Windows key provider integration can be tricky

### 2.4 Microsoft Azure Trusted Signing (formerly Artifact Signing)

**Verdict: Best option for Windows-focused distribution at $9.99/month.**

- **Cost**: $9.99/month ($120/year), Basic tier
- **SmartScreen**: Provides INSTANT reputation - reputation is tied to your verified identity, not a particular certificate. This is the single biggest advantage.
- **Requirements**: Azure account, identity verification via Microsoft Authenticator
- **Geographic restrictions (as of 2025)**: Organizations in US, Canada, EU, UK. Individual developers only in US and Canada.
- **CI/CD**: Native GitHub Actions integration via `azure/trusted-signing-action`
- **Electron integration**: Works with electron-builder via `azureSignOptions` configuration
- **Gotchas**: Setup is confusing (Microsoft naming conventions), identity validation can take hours to weeks, requires .NET 6.0+ runtime, 64-bit signtool required

### 2.5 Let's Encrypt for Code Signing

**Does not exist.** Let's Encrypt only issues TLS/SSL certificates for web servers. There is no free ACME-based code signing certificate authority.

### 2.6 GitHub Student/OSS Programs

No major code signing certificate programs exist through GitHub Education or GitHub Sponsors. The closest option is using SignPath Foundation (above) which integrates with GitHub Actions.

### Summary Comparison

| Option                  | Cost Year 1 | Renewal     | Windows SmartScreen | macOS | Open Source Required? |
| ----------------------- | ----------- | ----------- | ------------------- | ----- | --------------------- |
| SignPath Foundation     | Free        | Free        | Yes (OV-level)      | No    | Yes (strict)          |
| Certum OSS              | ~EUR 104    | ~EUR 29/yr  | Yes (OV-level)      | No    | Yes                   |
| Azure Trusted Signing   | $120        | $120/yr     | Yes (INSTANT)       | No    | No                    |
| Traditional OV cert     | $216-500    | $216-500/yr | Yes (2-8 weeks)     | No    | No                    |
| Apple Developer Program | $99         | $99/yr      | N/A                 | Yes   | No                    |

---

## 3. Windows SmartScreen Reputation: Deep Dive

### How SmartScreen Works

SmartScreen is a reputation-based system built into Windows that evaluates downloaded executables before allowing them to run. It considers:

1. **Digital signature**: Is the file signed? By whom?
2. **Download volume**: How many Windows users have downloaded this file?
3. **File hash reputation**: Has this specific binary been seen before?
4. **URL reputation**: Where was it downloaded from?
5. **Publisher reputation**: How established is this signing identity?

### Critical 2024 Change: EV No Longer Provides Instant Reputation

**Before August 2024**: EV (Extended Validation) certificates provided instant SmartScreen bypass. This was the main reason developers paid $250-700/year for EV certs.

**After August 2024**: Microsoft removed all EV Code Signing OIDs from the Trusted Root Program. EV and OV certificates are now treated identically. Both must build reputation organically through downloads.

**This is a game-changer**: The primary justification for expensive EV certificates is gone. An OV cert at $216/year now provides the same SmartScreen experience as an EV cert at $500+/year.

### The Exception: Azure Trusted Signing

Azure Trusted Signing (now Artifact Signing) provides instant SmartScreen reputation because reputation is tied to your verified Microsoft identity, not a certificate. This makes the $9.99/month service effectively superior to traditional EV certificates for SmartScreen purposes.

### Building Reputation Without Any Certificate (Unsigned)

- SmartScreen WILL show a scary blue warning: "Windows protected your PC"
- Users must click "More info" then "Run anyway"
- Reputation builds over "thousands of downloads" and "months" (Microsoft does not publish exact numbers)
- Unofficial estimates: 2-8 weeks for signed apps; much longer for unsigned
- Microsoft has never published official thresholds

### Can You Build Reputation Without ANY Certificate?

Technically yes, but it takes significantly longer and the warnings are more severe (red shield vs. yellow warning). The warning text is also scarier for unsigned apps, specifically mentioning "unrecognized app."

---

## 4. macOS Without Apple Developer Program ($99/year)

### Current State (macOS Sequoia 15.x, 2025-2026)

Apple has progressively tightened restrictions on unsigned apps:

**macOS 15.0 (Sequoia)**: Removed the Control+click bypass for Gatekeeper. Users could no longer simply right-click and "Open" to bypass warnings.

**macOS 15.1+**: Further restrictions. The only remaining methods to run unsigned apps:

1. **System Settings method**: Attempt to open the app (it fails), then go to System Settings > Privacy & Security, scroll down, find the blocked app, click "Open Anyway"
2. **Terminal xattr method**: Run `xattr -d com.apple.quarantine /path/to/App.app` to strip the quarantine flag before first launch
3. **Disable Gatekeeper entirely** (not recommended): `sudo spctl --master-disable`

### Ad-Hoc Signing

Ad-hoc signing (signing without a Developer ID) is applied automatically to ARM/Apple Silicon builds. However:

- It does NOT bypass Gatekeeper for downloaded apps
- It only satisfies the code signature requirement for local execution on ARM Macs
- Users still need to use the workarounds above

### What Homebrew Cask Does

Homebrew Cask apps that are not notarized typically rely on the `xattr` quarantine removal as part of the Cask installation process. Homebrew can strip quarantine flags automatically during installation, making unsigned apps transparent to end users who install via `brew install --cask`.

### Practical Reality for macOS Distribution

- **For technical users** (developers, beta testers): The xattr workaround is well-known and acceptable
- **For general users**: The multi-step System Settings flow is confusing and creates significant friction
- **The $99/year Apple Developer Program is effectively mandatory** for any app targeting non-technical macOS users

### Developer Community Reaction

Open-source developers have expressed significant frustration. Some projects have abandoned macOS support entirely due to the combined costs (Apple hardware for building + $99/year program fee + infrastructure for notarization). International developers note the $99 fee is a much larger burden in many countries.

---

## 5. Practical Distribution Strategies for Early-Stage Apps

### 5.1 GitHub Releases with Unsigned Builds

**The actual user experience:**

**Windows**:

1. User downloads `.exe` or `.msi` from GitHub Releases
2. Browser may warn: "This file is not commonly downloaded"
3. On launch, SmartScreen shows blue screen: "Windows protected your PC - Microsoft Defender SmartScreen prevented an unrecognized app from starting"
4. User clicks "More info" link (easy to miss)
5. User clicks "Run anyway"
6. App runs normally after that

**macOS**:

1. User downloads `.dmg` from GitHub Releases
2. User opens DMG, drags app to Applications
3. On launch: "App can't be opened because Apple cannot check it for malicious software"
4. User must go to System Settings > Privacy & Security > scroll down > "Open Anyway"
5. OR run: `xattr -d com.apple.quarantine /Applications/YourApp.app`

**Linux**: No signing issues. AppImage, deb, rpm all work without warnings.

### 5.2 Bypass Instructions Template for Your README

```markdown
## Installation Notes

### Windows

When you first run the installer, Windows SmartScreen may show a warning because the
app is new and hasn't built reputation yet. This is normal for new software.

1. Click "More info" on the SmartScreen dialog
2. Click "Run anyway"
3. The app will run normally after this one-time step

### macOS

On first launch, macOS may block the app. To open it:

**Method 1 (GUI):**

1. Try to open the app (it will be blocked)
2. Open System Settings > Privacy & Security
3. Scroll down and click "Open Anyway" next to the app name

**Method 2 (Terminal):**
Run this command before first launch:
```

xattr -d com.apple.quarantine /Applications/YourApp.app

```

### Linux
No additional steps required.
```

### 5.3 Portable/ZIP Distribution vs. Installer

**Key insight**: ZIP distribution can actually REDUCE SmartScreen friction on Windows.

When a user downloads a ZIP file and extracts it, the individual files inside may not carry the "Mark of the Web" (MOTW) quarantine flag, depending on the extraction tool:

- **Windows built-in extraction**: Preserves MOTW on extracted files (SmartScreen still triggers)
- **7-Zip**: Does NOT set MOTW on extracted files (SmartScreen bypassed)
- **WinRAR**: Strips MOTW from extracted executables

This means distributing as a ZIP with instructions to "extract with 7-Zip" can effectively bypass SmartScreen for users who follow the instructions. However, this is not a reliable strategy for a broad audience.

**Portable app advantages**:

- No installer = no admin privileges required
- No registry changes
- Users can run from any folder
- Easier for beta testing

**Portable app disadvantages**:

- No Start Menu shortcuts automatically
- No auto-update (unless you build it in)
- No file associations automatically
- User must manage updates manually

### 5.4 How Modern AI Editors Handled Early Distribution

**Cursor**: Founded in 2022, launched publicly in 2023 with $8M seed funding. Had corporate backing and funding from OpenAI Startup Fund from the start. They likely had code signing from their earliest public release since they had resources.

**Zed**: Founded in 2021 by former Atom creators, secured funding within two weeks of starting. Also had VC backing from the beginning. macOS-only initially, so they needed Apple Developer Program ($99) from day one.

**Windsurf (Codeium)**: Backed by significant VC funding ($150M+). Never had an "indie" phase.

**Key Takeaway**: None of these apps had a true "bootstrapped indie" phase. They all had funding before public distribution. This is NOT representative of the typical indie developer experience.

---

## 6. SignPath Foundation: Detailed Analysis

### What It Is

SignPath Foundation is a non-profit that provides free code signing services (including Windows Authenticode certificates) to qualifying open-source projects. They use their own HSM-backed infrastructure, so you don't need a physical smartcard.

### Full Requirements

1. **License**: OSI-approved open source, no commercial dual-licensing
2. **Code**: 100% open source, no proprietary components (system libraries OK)
3. **Activity**: Actively maintained and already released
4. **Documentation**: Download page must describe functionality
5. **Build process**: Binaries must be reproducibly built from source (CI/CD)
6. **Security**: All team members must use MFA everywhere
7. **Roles**: Must define Authors, Reviewers, and Approvers
8. **Policy page**: Must publish a code signing policy on your project website/repo
9. **Attribution**: Must credit SignPath Foundation
10. **Manual approval**: Every release must be manually approved for signing

### Practical Assessment for Ptah

**Likely NOT eligible** because:

- Ptah has commercial licensing considerations (subscription model)
- The "no commercial dual-licensing" requirement is strict
- Any proprietary backend components would disqualify

**Would be eligible if**: Ptah were released under a pure OSI-approved license with no commercial tier, and all signed components were fully open source.

---

## 7. Progressive Cost Path: From Beta Testers to Thousands of Users

### Phase 1: Pre-Launch / Alpha (0-50 users) - Cost: $0

**Strategy**: Unsigned builds distributed via GitHub Releases or direct download links.

- Target audience: Fellow developers, beta testers who understand security warnings
- Provide clear bypass instructions in README
- Distribute as ZIP/portable on Windows to minimize friction
- macOS users: provide `xattr` command in installation docs
- Linux: no issues at all
- **Auto-update**: Use electron-updater with GitHub Releases as the update source (works without signing)

### Phase 2: Early Adopters (50-500 users) - Cost: $120/year

**Strategy**: Sign Windows builds with Azure Trusted Signing.

- $9.99/month for instant SmartScreen reputation on Windows
- Integrates with GitHub Actions for automated CI/CD signing
- macOS: Still unsigned unless you also pay for Apple Developer Program
- **Consider**: If many users are on macOS, add Apple Developer Program ($99/year) bringing total to ~$220/year

**Alternative for open-source**: Certum OSS certificate (~EUR 29/year renewal after EUR 104 initial) for Windows signing, but NO instant SmartScreen reputation (2-8 weeks building time).

### Phase 3: Growing User Base (500-5000 users) - Cost: $220-320/year

**Strategy**: Sign on both platforms.

- Windows: Azure Trusted Signing ($120/year) - instant SmartScreen
- macOS: Apple Developer Program ($99/year) - signed + notarized
- Total: ~$220/year
- **Optional**: Traditional OV cert ($216-500/year) if you need to sign other platforms or want a fallback

### Phase 4: Production Scale (5000+ users) - Cost: $220-500/year

**Strategy**: Full signing on all platforms with automated CI/CD.

- Same as Phase 3 but with more robust release infrastructure
- Consider EV cert ONLY if your business requires it for other reasons (not for SmartScreen, since EV no longer helps there)
- At this scale, the $220/year cost is negligible

### Decision Matrix

| User Count | Windows Signing       | macOS Signing      | Annual Cost | SmartScreen                   |
| ---------- | --------------------- | ------------------ | ----------- | ----------------------------- |
| 0-50       | None                  | None               | $0          | Warning (bypass instructions) |
| 50-500     | Azure Trusted Signing | Optional Apple Dev | $120-220    | Instant (Azure)               |
| 500-5000   | Azure Trusted Signing | Apple Developer    | $220        | Clean                         |
| 5000+      | Azure + optional OV   | Apple Developer    | $220-500    | Clean                         |

---

## Risk Analysis

### Risk 1: User Abandonment from Security Warnings

- **Probability**: HIGH for non-technical users, LOW for developer audience
- **Impact**: Lost conversions at install time
- **Mitigation**: Target developers first (they understand warnings), invest in signing before marketing to general audience
- **Data point**: Technical users (your target for an AI coding tool) are far more tolerant of SmartScreen warnings than general consumers

### Risk 2: Azure Trusted Signing Geographic Restrictions

- **Probability**: MEDIUM (only US/Canada individuals currently)
- **Impact**: May not be available for non-US developers
- **Mitigation**: Certum OSS certificate as fallback ($29/year renewal), or use a US-registered business entity
- **Note**: EU/UK organizations ARE supported, just not individual developers in those regions

### Risk 3: macOS Sequoia Breaking Changes

- **Probability**: HIGH (Apple tightens restrictions every release)
- **Impact**: Unsigned macOS builds become progressively harder for users
- **Mitigation**: Budget $99/year for Apple Developer Program before targeting macOS users seriously

### Risk 4: SmartScreen Algorithm Changes

- **Probability**: MEDIUM
- **Impact**: Even signed apps could face new reputation requirements
- **Mitigation**: Azure Trusted Signing provides the most resilient SmartScreen reputation since it's Microsoft's own service

---

## Key Recommendations for Ptah Electron App

1. **Start unsigned for internal/beta testing** - Your current development phase does not need signing. Ship via GitHub Releases with bypass instructions.

2. **When ready for early adopters, invest $9.99/month in Azure Trusted Signing** - This is the single best ROI for Windows distribution. Instant SmartScreen reputation at $120/year is dramatically cheaper than traditional certificates and provides better results.

3. **Add Apple Developer Program ($99/year) when macOS users matter** - Given that Ptah is a developer tool, many users will be on macOS. The $99/year is worth it for a smooth install experience.

4. **Do NOT waste money on traditional EV certificates** - Since August 2024, they provide no SmartScreen advantage over OV certs. Azure Trusted Signing is superior for less money.

5. **SignPath Foundation is likely not an option** for Ptah due to commercial licensing requirements.

6. **Certum OSS (~EUR 29/year renewal) is a viable budget fallback** if Azure Trusted Signing is not available in your region, but setup is more complex and SmartScreen reputation builds over 2-8 weeks rather than instantly.

7. **Total realistic annual cost for full coverage: ~$220/year** ($120 Azure Trusted Signing + $99 Apple Developer Program). This is dramatically less than traditional approaches ($500+ for EV cert + $99 Apple = $600+).

---

## Sources

- [SignPath Foundation Terms & Conditions](https://signpath.org/terms.html)
- [SignPath Free Code Signing for OSS](https://signpath.io/solutions/open-source-community)
- [Certum Open Source Code Signing Experience](https://piers.rocks/2025/10/30/certum-open-source-code-sign.html)
- [Azure Artifact Signing Pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [Azure Trusted Signing Individual Developer Setup](https://learn.microsoft.com/en-au/answers/questions/2238411/how-do-i-do-trusted-signing-identity-verification)
- [Code Signing with Azure Trusted Signing on GitHub Actions (Hendrik Erz)](https://hendrik-erz.de/post/code-signing-with-azure-trusted-signing-on-github-actions)
- [Code Signing on Windows with Azure Trusted Signing (Melatonin)](https://melatonin.dev/blog/code-signing-on-windows-with-azure-trusted-signing/)
- [Authenticode in 2025 - Azure Trusted Signing (Eric Law)](https://textslashplain.com/2025/03/12/authenticode-in-2025-azure-trusted-signing/)
- [SmartScreen Reputation: OV vs EV Certificates (Microsoft Q&A)](https://learn.microsoft.com/en-us/answers/questions/417016/reputation-with-ov-certificates-and-are-ev-certifi)
- [EV Code Sign OID Removal - August 2024 (Microsoft Q&A)](https://learn.microsoft.com/en-us/answers/questions/1846647/program-requirements-microsoft-trusted-root-progra)
- [How to Prevent SmartScreen Warning (Advanced Installer)](https://www.advancedinstaller.com/prevent-smartscreen-from-appearing.html)
- [macOS Sequoia 15.1 Unsigned App Changes (Hackaday)](https://hackaday.com/2024/11/01/apple-forces-the-signing-of-applications-in-macos-sequoia-15-1/)
- [Unsigned Electron Apps Guide (daltonmenezes)](https://github.com/daltonmenezes/electron-app/blob/main/docs/UNSIGNED_APPS.md)
- [macOS Unsigned App Workaround (ordonez.tv)](https://ordonez.tv/2024/11/04/how-to-run-unsigned-apps-in-macos-15-1/)
- [Electron Code Signing Documentation](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Electron Forge Code Signing Guide](https://www.electronforge.io/guides/code-signing)
- [Cheap Code Signing Certificates (SignMyCode)](https://signmycode.com/cheap-code-signing-certificates)
- [SSL Insights: OV vs EV Code Signing Guide](https://sslinsights.com/best-code-signing-certificate-windows-applications/)
- [Rick Strahl: Setting up Microsoft Trusted Signing](https://weblog.west-wind.com/posts/2025/Jul/20/Fighting-through-Setting-up-Microsoft-Trusted-Signing)
- [Scott Hanselman: Signing with Azure Trusted Signing](https://www.hanselman.com/blog/automatically-signing-a-windows-exe-with-azure-trusted-signing-dotnet-sign-and-github-actions)

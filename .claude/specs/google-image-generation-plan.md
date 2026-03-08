# Google Gemini Image Generation - Integration Plan

**Date**: 2026-02-18
**Branch**: `feature/sdk-only-migration`
**Status**: Research complete, awaiting implementation approval

---

## Research Summary

### Key Findings

1. **Langchain is NOT viable** for image generation - `@langchain/google-genai` is built on deprecated `@google/generative-ai` SDK (EOL Aug 2025). Use `@google/genai` (v1.41.0+) directly.

2. **Two Image Generation Approaches**:

| Approach              | Model ID                        | API Method                                                 | Best For                                        |
| --------------------- | ------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| **Gemini Native**     | `gemini-2.5-flash-image`        | `generateContent` with `responseModalities: [TEXT, IMAGE]` | Conversational editing, text+image mixed output |
| **Gemini 3 Pro**      | `gemini-3-pro-image-preview`    | `generateContent` (same as above)                          | Highest quality (preview)                       |
| **Imagen 4 Fast**     | `imagen-4.0-fast-generate-001`  | `generateImages`                                           | Cheapest ($0.02/image)                          |
| **Imagen 4 Standard** | `imagen-4.0-generate-001`       | `generateImages`                                           | Best balance quality/cost ($0.04/image)         |
| **Imagen 4 Ultra**    | `imagen-4.0-ultra-generate-001` | `generateImages`                                           | Max photorealism ($0.06/image)                  |

1. **Same API key** - Google AI Studio key works for both text and image generation. Already stored as `ptah.llm.google-genai.apiKey` in VS Code SecretStorage.

2. **Response format** - Both return base64-encoded image bytes:

   - Gemini Native: `response.candidates[0].content.parts[n].inlineData.data`
   - Imagen: `response.generatedImages[n].image.imageBytes`

3. **Imagen 3 is shut down** - Only Imagen 4 models are available now.

4. **Free tier severely limited** (after Dec 2025 changes) - Imagen 4 has no free tier. Production use requires paid tier.

### Pricing

| Model                  | Cost per Image |
| ---------------------- | -------------- |
| Gemini 2.5 Flash Image | ~$0.04         |
| Imagen 4 Fast          | $0.02          |
| Imagen 4 Standard      | $0.04          |
| Imagen 4 Ultra         | $0.06          |

---

## Implementation Plan

### Step 1: Install `@google/genai` SDK

```bash
npm install @google/genai
```

This is the new unified Google GenAI SDK (replaces deprecated `@google/generative-ai`). Note: The existing `@langchain/google-genai` dependency stays for text chat; image generation uses `@google/genai` directly.

### Step 2: Create Image Generation Service

**New file**: `libs/backend/vscode-lm-tools/src/lib/code-execution/services/image-generation.service.ts`

Service that wraps both Gemini native and Imagen 4 APIs:

```typescript
import { GoogleGenAI, Modality } from '@google/genai';

interface ImageGenerationRequest {
  prompt: string;
  model?: string; // default: 'gemini-2.5-flash-image'
  numberOfImages?: number; // 1-4 (Imagen only)
  aspectRatio?: string; // '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
  negativePrompt?: string; // What to avoid (Imagen only)
}

interface ImageGenerationResult {
  images: Array<{
    data: string; // base64
    mimeType: string; // 'image/png'
  }>;
  text?: string; // Optional text from Gemini native
}
```

**Two code paths based on model selection**:

- Models starting with `gemini-` → use `generateContent` with `responseModalities: [TEXT, IMAGE]`
- Models starting with `imagen-` → use `generateImages`

### Step 3: Register `ptah_generate_image` MCP Tool

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`

Add a new first-class MCP tool (tool #10):

```
ptah_generate_image
  - prompt (string, required): Image description
  - model (string, optional): Model ID (default: gemini-2.5-flash-image)
  - numberOfImages (number, optional): 1-4 images (Imagen only)
  - aspectRatio (string, optional): Aspect ratio
  - negativePrompt (string, optional): What to avoid (Imagen only)
```

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`

Add handler that:

1. Gets Google API key from SecretStorage (`ptah.llm.google-genai.apiKey`)
2. Calls ImageGenerationService
3. Returns base64 images + saves to workspace temp folder
4. Returns file paths so Claude Code can reference/display them

### Step 4: Add `ptah.image` API Namespace (for `execute_code`)

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`

Add 16th namespace `ptah.image`:

```typescript
ptah.image.generate(prompt, options?)  // Generate image(s)
ptah.image.listModels()                // List available image models
```

This allows users in `execute_code` scripts to programmatically generate images.

### Step 5: Settings UI - Image Generation Model Selection

**File**: `libs/frontend/chat/src/lib/settings/settings.component.ts` (or new sub-component)

Add an "Image Generation" section in settings:

- Model dropdown: Gemini 2.5 Flash Image, Gemini 3 Pro Image (preview), Imagen 4 Fast/Standard/Ultra
- Uses the same Google GenAI API key (already configured in LLM provider settings)
- Show warning if Google API key not configured with link to set it up

**Shared types**: Add `ImageGenerationModel` type and `ImageGenerationSettings` to `rpc.types.ts`

### Step 6: Wire Up Google API Key in LLM Settings

The Google API key is already manageable via `llm:setApiKey` / `llm:getApiKeyStatus` RPCs. Verify:

- Key validation: length >= 30 (already implemented in `LlmSecretsService`)
- Settings UI already shows Google GenAI provider in LLM provider list
- May need to add a note in the UI: "This key is also used for image generation"

### Step 7: Image Display in Chat

When the MCP tool returns image data:

- Save base64 to a temp file in workspace `.ptah/generated-images/`
- Return the file path in the tool result
- Claude Code will display inline if the terminal supports it, or reference the path

---

## Code Examples (SDK Usage)

### Gemini Native Image Generation

```typescript
import { GoogleGenAI, Modality } from '@google/genai';

const ai = new GoogleGenAI({ apiKey });

const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash-image',
  contents: prompt,
  config: {
    responseModalities: [Modality.TEXT, Modality.IMAGE],
  },
});

for (const part of response.candidates[0].content.parts) {
  if (part.text) {
    console.log('Text:', part.text);
  } else if (part.inlineData) {
    // part.inlineData.data = base64 string
    // part.inlineData.mimeType = 'image/png'
    const imageBytes = Buffer.from(part.inlineData.data, 'base64');
    fs.writeFileSync('output.png', imageBytes);
  }
}
```

### Imagen 4 Dedicated Generation

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey });

const response = await ai.models.generateImages({
  model: 'imagen-4.0-generate-001',
  prompt: prompt,
  config: {
    numberOfImages: 1,
    aspectRatio: '16:9',
    includeRaiReason: true,
  },
});

for (const img of response.generatedImages) {
  const imageBytes = Buffer.from(img.image.imageBytes, 'base64');
  fs.writeFileSync('output.png', imageBytes);
}
```

---

## Key Files to Modify/Create

| File                                                                        | Action  | Purpose                                     |
| --------------------------------------------------------------------------- | ------- | ------------------------------------------- |
| `package.json` (root)                                                       | Modify  | Add `@google/genai` dependency              |
| `libs/backend/vscode-lm-tools/.../services/image-generation.service.ts`     | **NEW** | Image generation service wrapping both APIs |
| `libs/backend/vscode-lm-tools/.../mcp-handlers/tool-description.builder.ts` | Modify  | Add `ptah_generate_image` tool schema       |
| `libs/backend/vscode-lm-tools/.../mcp-handlers/protocol-handlers.ts`        | Modify  | Add tool handler routing                    |
| `libs/backend/vscode-lm-tools/.../ptah-api-builder.service.ts`              | Modify  | Add `ptah.image` namespace                  |
| `libs/shared/src/lib/types/rpc.types.ts`                                    | Modify  | Add image generation types                  |
| `libs/frontend/chat/src/lib/settings/`                                      | Modify  | Image generation model selector             |
| `libs/backend/llm-abstraction/.../services/llm-secrets.service.ts`          | Verify  | Google key already handled                  |

---

## Open Questions

1. **Should we also support OpenAI DALL-E?** - Could make the image generation provider-agnostic (Google Imagen / Gemini + OpenAI DALL-E + future providers)
2. **Image storage**: Save to workspace `.ptah/` folder? Or temp directory? Or let the user choose?
3. **Max image size**: Should we limit resolution to save bandwidth/cost?
4. **Rate limiting**: Should we add client-side rate limiting to avoid API quota exhaustion?
5. **Imagen 4 has no free tier**: Should we default to Gemini 2.5 Flash Image (has limited free tier) for new users?

---

## References

- [Google Gemini Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation)
- [Imagen 4 API Docs](https://ai.google.dev/gemini-api/docs/imagen)
- [@google/genai npm](https://www.npmjs.com/package/@google/genai)
- [Google AI Studio API Keys](https://aistudio.google.com/app/apikey)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)

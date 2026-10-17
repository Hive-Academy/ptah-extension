/**
 * Boundary schemas of the decision-model catalog (Component 8).
 *
 * Ollama `/api/tags` (daemon and ollama.com) and daemon `/api/show` bodies are
 * host input. Every object is `.passthrough()`: a host may add fields, and the
 * catalog reads only the ones named here. The tag list is parsed in two steps
 * — the envelope, then each entry — so one malformed entry makes that model
 * undetermined instead of failing the whole listing.
 */
import { z } from 'zod';

/** Longest model id the catalog accepts from a host. */
export const OLLAMA_CATALOG_MAX_ID_CHARS = 128;

const ModelIdSchema = z.string().min(1).max(OLLAMA_CATALOG_MAX_ID_CHARS);

/** Envelope of `GET /api/tags`; entries are parsed one by one. */
export const OllamaTagsResponseSchema = z
  .object({
    models: z.array(z.unknown()),
  })
  .passthrough();

/** One `/api/tags` entry. `name` wins over `model` when both are present. */
export const OllamaTagEntrySchema = z
  .object({
    name: ModelIdSchema.optional(),
    model: ModelIdSchema.optional(),
    digest: z.string().max(OLLAMA_CATALOG_MAX_ID_CHARS).optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .passthrough();

/** Body of `POST /api/show`; older daemons omit `capabilities`. */
export const OllamaShowResponseSchema = z
  .object({
    capabilities: z.array(z.string()).optional(),
  })
  .passthrough();

export type OllamaTagEntry = z.infer<typeof OllamaTagEntrySchema>;
export type OllamaShowResponse = z.infer<typeof OllamaShowResponseSchema>;

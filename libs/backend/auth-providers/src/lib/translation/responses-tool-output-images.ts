/**
 * Responses tool-output image downgrade: the request translator emits an
 * array `function_call_output.output` (with `input_image` parts) whenever a
 * tool result carries an image. Only providers with evidence that they accept
 * that wire format keep it; every other provider gets this post-pass, which
 * turns each array back into a string with a text placeholder per image.
 *
 * Pure: the input request is never mutated. Text-only outputs are already
 * strings and pass through untouched. Library-internal.
 */

import type {
  OpenAIResponsesRequest,
  ResponsesInputItem,
} from './responses-request-translator';

export const TOOL_OUTPUT_IMAGE_PLACEHOLDER =
  '[image omitted: this provider does not accept images in tool results]';

/** Replaces every array `function_call_output.output` with its string form. */
export function downgradeToolOutputImages(
  request: OpenAIResponsesRequest,
): OpenAIResponsesRequest {
  const input = request.input.map((item): ResponsesInputItem => {
    if (
      !('type' in item) ||
      item.type !== 'function_call_output' ||
      typeof item.output === 'string'
    ) {
      return item;
    }
    const output = item.output
      .map((part) =>
        part.type === 'input_text' ? part.text : TOOL_OUTPUT_IMAGE_PLACEHOLDER,
      )
      .join('\n');
    return { ...item, output };
  });
  return { ...request, input };
}

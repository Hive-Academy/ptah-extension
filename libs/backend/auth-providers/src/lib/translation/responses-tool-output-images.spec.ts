import {
  downgradeToolOutputImages,
  TOOL_OUTPUT_IMAGE_PLACEHOLDER,
} from './responses-tool-output-images';
import {
  translateAnthropicToResponses,
  type OpenAIResponsesRequest,
  type ResponsesFunctionCallOutputItem,
} from './responses-request-translator';
import type { AnthropicMessagesRequest } from './openai-translation.types';

const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
const PNG_URL = `data:image/png;base64,${PNG_1X1_B64}`;

const request = (): OpenAIResponsesRequest => ({
  model: 'gpt-5.4',
  store: false,
  stream: true,
  instructions: 'be brief',
  input: [
    { role: 'developer', content: 'be brief' },
    { role: 'user', content: [{ type: 'input_text', text: 'look' }] },
    { type: 'function_call', call_id: 'c1', name: 'shot', arguments: '{}' },
    {
      type: 'function_call_output',
      call_id: 'c1',
      output: [
        { type: 'input_text', text: 'Error: before' },
        { type: 'input_image', image_url: PNG_URL },
        { type: 'input_text', text: 'after' },
        { type: 'input_image', image_url: PNG_URL },
      ],
    },
    { type: 'function_call', call_id: 'c2', name: 'read', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c2', output: 'plain text' },
  ],
  tools: [
    { type: 'function', name: 'shot', parameters: {}, strict: false },
    { type: 'function', name: 'read', parameters: {}, strict: false },
  ],
});

describe('downgradeToolOutputImages', () => {
  it('turns an array output into a string with one placeholder per image, joined by newlines', () => {
    const out = downgradeToolOutputImages(request());
    expect(out.input[3]).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: [
        'Error: before',
        TOOL_OUTPUT_IMAGE_PLACEHOLDER,
        'after',
        TOOL_OUTPUT_IMAGE_PLACEHOLDER,
      ].join('\n'),
    });
    expect(TOOL_OUTPUT_IMAGE_PLACEHOLDER).toBe(
      '[image omitted: this provider does not accept images in tool results]',
    );
  });

  it('downgrades an image-only output to the bare placeholder', () => {
    const req: OpenAIResponsesRequest = {
      model: 'gpt-5.4',
      input: [
        {
          type: 'function_call_output',
          call_id: 'c1',
          output: [{ type: 'input_image', image_url: PNG_URL }],
        },
      ],
    };
    expect(downgradeToolOutputImages(req).input).toEqual([
      {
        type: 'function_call_output',
        call_id: 'c1',
        output: TOOL_OUTPUT_IMAGE_PLACEHOLDER,
      },
    ]);
  });

  // Pins today's edge-case semantics (code-logic-review-b5.md minor 1).
  it.each<[string, ResponsesFunctionCallOutputItem['output'], string]>([
    [
      'only an unsupported-media placeholder part',
      [{ type: 'input_text', text: '[image omitted: unsupported media type]' }],
      '[image omitted: unsupported media type]',
    ],
    [
      'only images',
      [
        { type: 'input_image', image_url: PNG_URL },
        { type: 'input_image', image_url: PNG_URL },
      ],
      `${TOOL_OUTPUT_IMAGE_PLACEHOLDER}\n${TOOL_OUTPUT_IMAGE_PLACEHOLDER}`,
    ],
    ['an empty array', [], ''],
    [
      'a text-only array',
      [
        { type: 'input_text', text: 'a' },
        { type: 'input_text', text: 'b' },
      ],
      'a\nb',
    ],
    ['a string', 'kept as is', 'kept as is'],
  ])('downgrades %s', (_name, output, expected) => {
    const req: OpenAIResponsesRequest = {
      model: 'gpt-5.4',
      input: [{ type: 'function_call_output', call_id: 'c1', output }],
    };
    expect(downgradeToolOutputImages(req).input).toEqual([
      { type: 'function_call_output', call_id: 'c1', output: expected },
    ]);
  });

  it('keeps every other item and field deep-equal, including string outputs', () => {
    const original = request();
    const out = downgradeToolOutputImages(original);
    const { input: outInput, ...outRest } = out;
    const { input: originalInput, ...originalRest } = original;
    expect(outRest).toEqual(originalRest);
    expect(outInput).toHaveLength(originalInput.length);
    for (const index of [0, 1, 2, 4, 5]) {
      expect(outInput[index]).toEqual(originalInput[index]);
    }
    expect(outInput[5]).toEqual({
      type: 'function_call_output',
      call_id: 'c2',
      output: 'plain text',
    });
  });

  it('returns a deep-equal request when no output is an array', () => {
    const req = request();
    req.input.splice(3, 1);
    expect(downgradeToolOutputImages(req)).toEqual(req);
  });

  it('never mutates the input request', () => {
    const original = request();
    const snapshot = JSON.parse(JSON.stringify(original));
    const out = downgradeToolOutputImages(original);
    expect(original).toEqual(snapshot);
    expect(out).not.toBe(original);
    expect(out.input).not.toBe(original.input);
    expect(out.input[3]).not.toBe(original.input[3]);
  });

  it('downgrades translator output while keeping replayed call_id pairing and order', () => {
    const anthropic: AnthropicMessagesRequest = {
      model: 'gpt-5.4',
      max_tokens: 1000,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'shot_1', name: 'shot', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'shot_1',
              content: [
                { type: 'text', text: 'captured' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: PNG_1X1_B64,
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const out = downgradeToolOutputImages(
      translateAnthropicToResponses(anthropic),
    );
    expect(out.input).toEqual([
      {
        type: 'function_call',
        call_id: 'shot_1',
        name: 'shot',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'shot_1',
        output: `captured\n${TOOL_OUTPUT_IMAGE_PLACEHOLDER}`,
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('input_image');
  });
});

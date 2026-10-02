import { OsaError } from '../../kernel/src/contracts.js';
import type { Source } from '../../kernel/src/contracts.js';
interface ResponseData {
  id?: string;
  output?: {
    type: string;
    content?: {
      type: string;
      text?: string;
      annotations?: { type: string; url?: string; title?: string }[];
    }[];
  }[];
  usage?: Record<string, unknown>;
}
export class OpenAIAdapter {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY,
    private model = process.env.OPENAI_MODEL,
  ) {}
  configured() {
    return (
      !!this.apiKey &&
      !!this.model &&
      process.env.OSA_AI_PROVIDER !== 'disabled'
    );
  }
  async generate(context: {
    instruction: string;
    input: string;
    webSearch?: boolean;
    image?: string;
    signal: AbortSignal;
  }) {
    if (!this.configured())
      throw new OsaError(
        'PROVIDER_NOT_CONFIGURED',
        'Skonfiguruj OSA_AI_PROVIDER=openai, OPENAI_API_KEY i OPENAI_MODEL. Lokalny kernel, prompt i raport nie wymagają klucza.',
        503,
      );
    const input = context.image
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: context.input },
              {
                type: 'input_image',
                image_url: 'data:image/jpeg;base64,' + context.image,
              },
            ],
          },
        ]
      : context.input;
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: context.signal,
      headers: {
        Authorization: 'Bearer ' + this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        instructions: context.instruction,
        input,
        store: false,
        max_output_tokens: 3500,
        ...(context.webSearch ? { tools: [{ type: 'web_search' }] } : {}),
      }),
    });
    if (!res.ok)
      throw new OsaError(
        'PROVIDER_HTTP',
        `OpenAI zwróciło HTTP ${res.status}.`,
        502,
        res.status === 429 || res.status >= 500,
      );
    const data = (await res.json()) as ResponseData;
    let result = '';
    const sources: Source[] = [];
    for (const item of data.output || [])
      for (const block of item.content || []) {
        if (block.type === 'output_text') result += (block.text || '') + '\n';
        for (const annotation of block.annotations || [])
          if (
            annotation.type === 'url_citation' &&
            annotation.url?.startsWith('https://') &&
            !sources.some((s) => s.url === annotation.url)
          )
            sources.push({
              url: annotation.url,
              title: annotation.title || annotation.url,
              capturedAt: new Date().toISOString(),
            });
      }
    if (!result.trim())
      throw new OsaError(
        'EMPTY_PROVIDER_RESULT',
        'Model nie zwrócił treści.',
        502,
      );
    return {
      text: result.trim(),
      sources,
      producer: 'openai/' + this.model,
      metadata: { responseId: data.id || '', usage: data.usage || {} },
    };
  }
}

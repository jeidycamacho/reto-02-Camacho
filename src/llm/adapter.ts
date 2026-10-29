import { GoogleGenAI } from '@google/genai';

export type Role = 'user' | 'model' | 'system';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface LlmGenerateOptions {
  temperature?: number;
  systemInstruction?: string;
}

export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  generateText(prompt: string, options?: LlmGenerateOptions): Promise<string>;
  chat(messages: readonly ChatMessage[], options?: LlmGenerateOptions): Promise<string>;
}

export class GeminiLlmAdapter implements LlmAdapter {
  public readonly provider = 'google';
  public readonly model: string;
  private readonly client: GoogleGenAI;

  public constructor(model = 'gemini-3.8-flash') {
    this.model = model;
    const apiKey = process.env['GEMINI_API_KEY'] ?? '';
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public async generateText(prompt: string, options?: LlmGenerateOptions): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: options?.systemInstruction,
        temperature: options?.temperature,
      },
    });

    return response.text ?? '';
  }

  public async chat(messages: readonly ChatMessage[], options?: LlmGenerateOptions): Promise<string> {
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemMsg = messages.find((m) => m.role === 'system');
    const systemInstruction = options?.systemInstruction ?? systemMsg?.content;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        temperature: options?.temperature,
      },
    });

    return response.text ?? '';
  }
}

export function createLlmAdapter(model = 'gemini-3.8-flash'): LlmAdapter {
  return new GeminiLlmAdapter(model);
}

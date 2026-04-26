// Thin wrapper around the @google/generative-ai SDK. Production code calls
// `createGeminiCaller(apiKey)` once and passes the returned function as the
// `callGemini` dep on every agent. Tests inject their own callable to avoid
// burning quota.

import { GoogleGenerativeAI } from '@google/generative-ai';

export type GeminiCaller = (prompt: string) => Promise<string>;

export interface GeminiCallerConfig {
  apiKey: string;
  modelName?: string;
}

export function createGeminiCaller(config: GeminiCallerConfig): GeminiCaller {
  const client = new GoogleGenerativeAI(config.apiKey);
  const modelName = config.modelName ?? 'gemini-2.5-flash';

  return async (prompt: string): Promise<string> => {
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        // Disable Gemini 2.5's "thinking" phase. With thinking on, each
        // call adds 10-30s of internal reasoning before responding, which
        // blows our 2 s vitals refresh budget (NFR2). For real-time
        // simulator use we want fast direct JSON output.
        thinkingConfig: { thinkingBudget: 0 },
      } as Record<string, unknown>,
    });
    const response = await model.generateContent(prompt);
    return response.response.text();
  };
}

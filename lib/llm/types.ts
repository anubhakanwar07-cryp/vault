export type Tier = 'fast' | 'strong';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type CompletionRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
};

export type CompletionResponse = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** One provider SDK behind a common shape. Only lib/llm may import provider SDKs. */
export interface LLMProvider {
  readonly name: 'anthropic' | 'openai' | 'fake';
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

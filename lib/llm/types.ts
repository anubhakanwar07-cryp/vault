export type Tier = 'fast' | 'strong';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export type CompletionRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  /** Reasoning models only. 'none' keeps latency/cost low and lets temperature apply. */
  reasoningEffort?: ReasoningEffort;
  /** Per-request timeout; the SDK retries timed-out requests with backoff. */
  timeoutMs?: number;
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

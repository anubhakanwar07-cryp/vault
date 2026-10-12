// USD per 1M tokens. Source: OpenAI list prices as published by aggregators (Oct 2026); verify at
// https://developers.openai.com/api/docs/pricing. Unknown models cost 0 and are flagged in logs.
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: 'gpt-5.4-mini', input: 0.75, output: 4.5 },
  { prefix: 'gpt-5.4', input: 2.5, output: 15 },
];

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES.find((x) => model.startsWith(x.prefix));
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

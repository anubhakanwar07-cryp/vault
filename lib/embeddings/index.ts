import 'server-only';
import OpenAI from 'openai';
import { serverEnv } from '@/lib/env';

export const EMBEDDING_DIMS = 1536;
const BATCH_SIZE = 50;

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export function createOpenAIEmbedder(apiKey: string, model: string): Embedder {
  const client = new OpenAI({ apiKey, maxRetries: 4 });
  return {
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const res = await client.embeddings.create({
          model,
          input: batch,
          dimensions: EMBEDDING_DIMS,
        });
        out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
      }
      return out;
    },
  };
}

let embedder: Embedder | undefined;

export function defaultEmbedder(): Embedder {
  if (embedder) return embedder;
  const env = serverEnv();
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for embeddings');
  embedder = createOpenAIEmbedder(env.OPENAI_API_KEY, env.EMBEDDING_MODEL);
  return embedder;
}

export { buildEmbeddingText, type EmbeddingSource } from './text';

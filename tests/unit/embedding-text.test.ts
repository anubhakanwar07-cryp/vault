import { expect, it } from 'vitest';
import { buildEmbeddingText } from '@/lib/embeddings/text';

it('matches the SPEC §6.5 format exactly', () => {
  expect(
    buildEmbeddingText({
      action: 'Built an eval harness',
      result: 'Cut regressions by 30%',
      skills: ['evals', 'python'],
      tools: ['pytest'],
      functionTags: ['ai-ml'],
      domainTags: ['edtech'],
      project: { name: 'Tutor bot', oneLiner: 'LLM tutor for students' },
      role: { title: 'PM', company: 'Acme' },
    }),
  ).toBe(
    'Built an eval harness. Cut regressions by 30%. Skills: evals, python. Tools: pytest. ' +
      'Functions: ai-ml. Domain: edtech. Project: Tutor bot — LLM tutor for students. Role: PM at Acme.',
  );
});

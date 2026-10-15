// Dev helper: cost/latency breakdown of the most recent pipeline run. Usage: pnpm cost:last
import { config } from 'dotenv';
import postgres from 'postgres';
import { costUsd } from '@/lib/llm/pricing';

config({ path: '.env.local', quiet: true });

async function main() {
  const pg = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    await report(pg);
  } finally {
    await pg.end();
  }
}

async function report(pg: postgres.Sql) {
  const [run] =
    await pg`select id, duration_ms from pipeline_runs order by created_at desc limit 1`;
  if (!run) return console.log('No pipeline runs yet.');
  const rows =
    await pg`select stage, model, count(*)::int n, sum(input_tokens)::int i, sum(output_tokens)::int o,
                               max(latency_ms)::int maxlat
                        from llm_runs where pipeline_run_id=${run.id} group by stage, model order by stage`;
  let total = 0;
  for (const r of rows) {
    const c = costUsd(r.model, r.i, r.o);
    total += c;
    console.log(
      `${String(r.stage).padEnd(14)} ${String(r.n).padStart(3)} calls  in ${String(r.i).padStart(6)}  out ${String(r.o).padStart(5)}  $${c.toFixed(4)}  max ${r.maxlat}ms`,
    );
  }
  console.log(`total $${total.toFixed(4)} | duration ${run.duration_ms} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export function ComingSoon({ title, phase, what }: { title: string; phase: number; what: string }) {
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{what}</p>
      <p className="text-xs text-muted-foreground">Coming in Phase {phase}.</p>
    </div>
  );
}

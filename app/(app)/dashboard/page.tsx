import { requireUser } from '@/lib/auth';

export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-sm text-muted-foreground">Signed in as {user.email}.</p>
    </div>
  );
}

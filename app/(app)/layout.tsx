import { Suspense, type ReactNode } from 'react';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { isAdmin, requireUser } from '@/lib/auth';

// Every page here depends on the signed-in user, so navigations block on the server.
// SPEC-QUESTION: revisit with `use cache: private` if navigation latency becomes a problem.
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b p-3 md:w-56 md:border-r md:border-b-0 md:p-4">
        <div className="px-3 text-sm font-semibold">Resume Tailor</div>
        <Suspense fallback={<SidebarNav showAdmin={false} />}>
          <SidebarNavForUser />
        </Suspense>
        <Suspense>
          <AccountBox />
        </Suspense>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}

async function SidebarNavForUser() {
  const user = await requireUser();
  return <SidebarNav showAdmin={isAdmin(user)} />;
}

async function AccountBox() {
  const user = await requireUser();
  return (
    <div className="mt-auto hidden flex-col gap-1 px-3 text-xs text-muted-foreground md:flex">
      <span className="truncate">{user.email}</span>
      <form action="/auth/signout" method="post">
        <button type="submit" className="underline-offset-4 hover:underline">
          Sign out
        </button>
      </form>
    </div>
  );
}

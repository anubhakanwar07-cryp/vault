import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">Resume Tailor</h1>
      <p className="text-lg text-muted-foreground">
        Store your work history once. For each job, get a one-page resume tailored to the role —
        every line traced back to something you actually did.
      </p>
      <div>
        <Link href="/login" className={buttonVariants()}>
          Get started
        </Link>
      </div>
    </main>
  );
}

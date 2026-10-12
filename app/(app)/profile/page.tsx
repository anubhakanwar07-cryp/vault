import { requireUser } from '@/lib/auth';
import { getProfile } from '@/lib/db/queries/vault';
import { ProfileForm } from './profile-form';

export default async function ProfilePage() {
  const user = await requireUser();
  const p = await getProfile(user.id);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          These details appear in the header of every resume.
        </p>
      </div>
      <ProfileForm
        values={{
          fullName: p?.fullName ?? '',
          email: p?.email ?? user.email ?? '',
          phone: p?.phone ?? '',
          location: p?.location ?? '',
          links: (p?.links ?? []).map((l) => l.url),
          targetRoleFamilies: p?.targetRoleFamilies ?? [],
          baseSummary: p?.baseSummary ?? '',
        }}
      />
    </div>
  );
}

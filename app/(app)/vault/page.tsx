import { VaultView } from '@/components/vault/vault-view';
import { requireUser } from '@/lib/auth';
import { getVaultTree } from '@/lib/db/queries/vault';

// Depends on the signed-in user; navigation blocks on the server (see app/(app)/layout.tsx).
export const instant = false;

export default async function VaultPage() {
  const user = await requireUser();
  const tree = await getVaultTree(user.id);
  return <VaultView tree={tree} />;
}

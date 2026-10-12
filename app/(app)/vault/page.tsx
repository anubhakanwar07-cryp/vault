import { VaultView } from '@/components/vault/vault-view';
import { requireUser } from '@/lib/auth';
import { getVaultTree } from '@/lib/db/queries/vault';

export default async function VaultPage() {
  const user = await requireUser();
  const tree = await getVaultTree(user.id);
  return <VaultView tree={tree} />;
}

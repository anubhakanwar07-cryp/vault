// One-page guarantee (product rule): the order in which bullets are dropped when a page overflows. Pure.

/**
 * `plan` lists the chosen projects best-first, each with its bullet ids strongest-first. Returns the
 * next bullet to drop: the weakest remaining bullet of project #3, then #2, then #1 — never a
 * project's last bullet. Null when every project is down to one bullet.
 */
export function nextBulletToDrop(plan: string[][], dropped: ReadonlySet<string>): string | null {
  for (let i = plan.length - 1; i >= 0; i--) {
    const left = plan[i]!.filter((id) => !dropped.has(id));
    if (left.length > 1) return left[left.length - 1]!;
  }
  return null;
}

/**
 * Drops bullets in `nextBulletToDrop` order until `fits` says the page fits (or nothing more can go).
 * `remove` returns the document without one bullet. Returns the final document and what was dropped.
 */
export async function fitToOnePage<D>(
  doc: D,
  plan: string[][],
  fits: (doc: D) => Promise<boolean>,
  remove: (doc: D, bulletId: string) => D,
): Promise<{ doc: D; dropped: string[]; fits: boolean }> {
  const dropped = new Set<string>();
  let current = doc;
  for (;;) {
    if (await fits(current)) return { doc: current, dropped: [...dropped], fits: true };
    const next = nextBulletToDrop(plan, dropped);
    if (!next) return { doc: current, dropped: [...dropped], fits: false };
    dropped.add(next);
    current = remove(current, next);
  }
}

/** `match` is the path prefix that highlights the item (defaults to `href`). */
export const NAV_ITEMS: readonly { href: string; label: string; match?: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/vault', label: 'Career vault' },
  // Confirm, run and editor pages live under /tailor/[jobId]/… and belong to this item too.
  { href: '/tailor/new', label: 'Tailor a resume', match: '/tailor' },
  { href: '/applications', label: 'Applications' },
  { href: '/profile', label: 'Profile' },
];

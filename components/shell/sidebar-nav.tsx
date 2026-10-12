'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav';

export function SidebarNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const items = showAdmin ? [...NAV_ITEMS, { href: '/admin/runs', label: 'Admin' }] : NAV_ITEMS;
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-muted',
              active && 'bg-muted font-medium',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

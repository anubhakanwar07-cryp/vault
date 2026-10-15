'use client';

import { ThemeProvider as NextThemes } from 'next-themes';
import type { ReactNode } from 'react';

/** Light / dark / system theme via a `.dark` class on <html> (globals.css defines both palettes). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      // The inline theme script only needs to run from the server HTML. React 19 warns about
      // <script> rendered on the client, so it's inert there (next-themes suppresses the mismatch).
      scriptProps={typeof window === 'undefined' ? undefined : { type: 'application/json' }}
    >
      {children}
    </NextThemes>
  );
}

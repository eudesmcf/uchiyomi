'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adultMode, setAdultMode } from '@/lib/adult';

/** Deep links into any adult screen must enter the same session context as the adult home. */
export default function AdultLayout({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!adultMode()) {
      setAdultMode(true);
      qc.clear();
    }
  }, [qc]);
  return <>{children}</>;
}

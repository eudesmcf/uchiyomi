'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { adultMode, setAdultMode } from '@/lib/adult';
import { Page, Series } from '@/lib/types';
import { SeriesTile } from '@/components/cards';
import { AdultExit, AdultSourcesLink } from '@/components/AdultToggle';
import { IcGrid, IcSearch, IcSparkle, IcBookmark, IcRefresh, IcBell } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

const destinations = [
  { href: '/library', label: 'Library', detail: 'Your separate 18+ shelf', Icon: IcGrid },
  { href: '/search', label: 'Search', detail: 'Find in the adult library', Icon: IcSearch },
  { href: '/browse', label: 'Browse', detail: 'Explore adult genres', Icon: IcSparkle },
  { href: '/collections', label: 'Lists', detail: 'Your adult collections', Icon: IcBookmark },
  { href: '/history', label: 'History', detail: 'Continue where you left off', Icon: IcRefresh },
  { href: '/updates', label: 'Updates', detail: 'New adult chapters', Icon: IcBell },
];

export default function AdultHomePage() {
  const qc = useQueryClient();
  const [ready, setReady] = useState(adultMode());
  useEffect(() => {
    if (!adultMode()) setAdultMode(true);
    setReady(true);
    qc.invalidateQueries();
  }, [qc]);
  const { data, isLoading } = useQuery({
    queryKey: ['adult-home'],
    enabled: ready,
    queryFn: () => api<Page<Series>>('/api/series/search', { json: { page: 0, size: 12, sort: 'updated,desc' } }),
  });

  return (
    <div className="min-h-screen-d px-4 lg:px-0">
      <header className="safe-top sticky top-0 z-30 -mx-4 bg-ink-950/90 px-4 pb-5 pt-4 backdrop-blur-xl lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pt-7 lg:backdrop-blur-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-rose-300">
              <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,.8)]" /> 18+ mode
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight text-fog-50 lg:text-5xl">{tr('Your adult library')}</h1>
            <p className="mt-2 max-w-xl text-sm text-fog-400">{tr('A separate space for your 18+ collection, sources and reading history.')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2"><AdultSourcesLink /><AdultExit /></div>
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {destinations.map(({ href, label, detail, Icon }) => (
          <Link key={href} href={href} className="group card flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:border-rose-400/40 hover:bg-rose-400/5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-400/10 text-rose-300 transition group-hover:bg-rose-400/20"><Icon width={21} height={21} /></span>
            <span className="min-w-0"><span className="block font-display font-semibold text-fog-100">{tr(label)}</span><span className="mt-0.5 block text-xs text-fog-500">{tr(detail)}</span></span>
          </Link>
        ))}
      </section>
      <section className="pt-10">
        <div className="mb-4 flex items-baseline justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-300">18+</p><h2 className="font-display text-xl font-semibold">{tr('Recently updated')}</h2></div><Link href="/library?sort=updated" className="text-xs text-rose-300 hover:text-rose-200">{tr('See all')}</Link></div>
        {isLoading ? <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />)}</div> : data?.content?.length ? <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5 lg:grid-cols-8">{data.content.map((s, i) => <SeriesTile key={s.id} series={s} eager={i < 8} />)}</div> : <div className="card p-8 text-center text-sm text-fog-400">{tr('Your 18+ library is empty.')}</div>}
      </section>
    </div>
  );
}

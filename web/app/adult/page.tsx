'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SourceCard, SourceItem } from '@/components/cards';
import { AddSeriesDialog, AddSeed } from '@/components/AddSeriesDialog';
import { EmptyState } from '@/components/EmptyState';
import { IcSearch } from '@/components/icons';
import { t as tr } from '@/lib/i18n';
import type { Src } from '@/lib/sourceGroups';
import { ART } from '@/lib/art';

export default function AdultSourcesPage() {
  const { data: sourcesData, isLoading: loadingSources } = useQuery({
    queryKey: ['adult-sources'],
    queryFn: () => api<{ content: Src[] }>('/api/sources?adultSources=1'),
    staleTime: 30_000,
  });
  const sources = useMemo(() => sourcesData?.content ?? [], [sourcesData]);
  const [sourceId, setSourceId] = useState('');
  const [sourceLang, setSourceLang] = useState('pt-br');
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [seed, setSeed] = useState<AddSeed | null>(null);

  const languageBase = (value?: string | null) => value?.trim().toLowerCase().replace('_', '-').split('-')[0] ?? '';
  const languageOptions = useMemo(() => {
    const values = new Set<string>();
    for (const source of sources) if (source.lang?.trim()) values.add(source.lang.trim());
    values.add('pt-br');
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [sources]);
  const filteredSources = useMemo(() => {
    if (sourceLang === 'all') return sources;
    const wanted = languageBase(sourceLang);
    return sources.filter((source) => languageBase(source.lang) === 'all' || languageBase(source.lang) === wanted);
  }, [sources, sourceLang]);

  useEffect(() => {
    if (!sourceId && filteredSources[0]) setSourceId(filteredSources[0].id);
    if (sourceId && !filteredSources.some((s) => s.id === sourceId)) setSourceId(filteredSources[0]?.id || '');
  }, [filteredSources, sourceId]);

  const selected = filteredSources.find((s) => s.id === sourceId);
  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['adult-source-latest', sourceId, sourceLang],
    queryFn: () => api<{ content: SourceItem[] }>(`/api/sources/latest?adultSources=1&source=${encodeURIComponent(sourceId)}&page=1${sourceLang !== 'all' ? `&lang=${encodeURIComponent(sourceLang)}` : ''}`),
    enabled: !!sourceId && !submitted,
    staleTime: 60_000,
  });
  const { data: searched, isFetching: searching } = useQuery({
    queryKey: ['adult-source-search', sourceId, submitted],
    queryFn: () => api<{ content: SourceItem[] }>(`/api/sources/search?adultSources=1&source=${encodeURIComponent(sourceId)}&q=${encodeURIComponent(submitted)}`),
    enabled: !!sourceId && submitted.length > 0,
    staleTime: 30_000,
  });
  const items = submitted ? (searched?.content ?? []) : (latest?.content ?? []);

  if (!loadingSources && !sources.length) {
    return (
      <div className="min-h-screen-d px-4 lg:px-0">
        <EmptyState art={ART.emptyLibrary} title={tr('18+ sources unavailable')}
          sub={tr('Your account is not allowed to view adult sources, or none are installed yet.')} />
      </div>
    );
  }

  return (
    <div className="min-h-screen-d px-4 lg:px-0">
      <header className="safe-top sticky top-0 z-30 -mx-4 bg-ink-950/90 px-4 pb-4 pt-4 backdrop-blur-xl lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pt-7 lg:backdrop-blur-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-300">
              18+
            </p>
            <h1 className="font-display text-2xl font-bold tracking-tight lg:text-3xl">{tr('Adult sources')}</h1>
            <p className="mt-1 max-w-xl text-sm text-fog-400">{tr('This area is separate from normal discovery and only shows sources marked 18+.')}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="field flex items-center gap-2 py-0 text-sm">
            <span className="text-xs text-fog-500">{tr('Language')}</span>
            <select value={sourceLang} onChange={(e) => { setSourceLang(e.target.value); setSourceId(''); setSubmitted(''); setTerm(''); }}
              className="cursor-pointer bg-ink-900 py-2.5 text-fog-100 outline-none [color-scheme:dark]" aria-label={tr('Language')}>
              <option value="all">{tr('All languages')}</option>
              {languageOptions.map((lang) => {
                const base = lang.toLowerCase().split('-')[0];
                const label = base === 'pt' ? 'Português' : base === 'en' ? 'English' : lang;
                return <option key={lang} value={lang}>{label}{lang.includes('-') ? ` (${lang})` : ''}</option>;
              })}
            </select>
          </label>
          <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setSubmitted(''); setTerm(''); }}
            className="field min-w-0 flex-1 bg-ink-900 text-sm text-fog-100 outline-none [color-scheme:dark]" aria-label={tr('Adult source')}>
            {loadingSources ? <option>{tr('Loading…')}</option> : filteredSources.map((s) => <option key={s.id} value={s.id}>{s.name}{s.lang ? ` · ${s.lang}` : ''}</option>)}
          </select>
          <form onSubmit={(e) => { e.preventDefault(); setSubmitted(term.trim()); }} className="field flex min-w-0 flex-1 items-center gap-2 py-0 sm:max-w-md">
            <IcSearch width={17} height={17} className="shrink-0 text-fog-500" />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tr('Search adult source…')} aria-label={tr('Search adult source…')}
              className="w-full bg-transparent py-2.5 text-sm text-fog-50 outline-none placeholder:text-fog-500" />
            {submitted && <button type="button" onClick={() => { setSubmitted(''); setTerm(''); }} className="text-xs text-fog-500">{tr('Clear')}</button>}
          </form>
        </div>
      </header>

      <div className="mb-3 mt-6 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fog-50">
          {submitted ? `${tr('Results')} · ${submitted}` : `${tr('Latest')} · ${selected?.name || ''}`}
        </h2>
        {(loadingLatest || searching) && <span className="text-xs text-fog-500">{tr('Loading…')}</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {items.map((item, i) => (
          <SourceCard key={`${item.source}:${item.sourceId}`} item={item} sourceName={selected?.name} eager={i < 12}
            onAdd={() => setSeed({ kind: 'result', provider: { source: item.source, name: selected?.name || item.source, sourceId: item.sourceId, title: item.title, coverUrl: item.coverUrl, lang: selected?.lang || undefined } })} />
        ))}
      </div>

      {!loadingLatest && !searching && !items.length && (
        <div className="card mt-4 p-8 text-center text-sm text-fog-400">{tr('No results from this adult source.')}</div>
      )}

      {seed && <AddSeriesDialog seed={seed} sources={selected ? [selected.id] : []} onClose={() => setSeed(null)} onAdded={() => {}} />}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal, msgOf } from '@/components/ConfirmDialog';
import { Img, ProgressBar } from '@/components/ui';
import { sourceCover } from '@/components/cards';
import { Switch } from '@/components/Switch';
import { useToast } from '@/components/Toast';
import { IcCheck, IcChevronLeft } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

export interface Provider { source: string; name: string; sourceId: string; title: string; coverUrl?: string; lang?: string }
interface Detail {
  source: string; sourceId: string; title: string; summary: string; coverUrl: string | null;
  genres: string[]; status: string; count: number; first: number | null; last: number | null;
    language?: string | null; chapterUrl?: string; seriesUrl?: string; chapters: { sourceId: string; number: number; title?: string }[];
}
interface Job { folder: string; title: string; total: number; done: number; status: string }

export type AddSeed =
  | { kind: 'trending'; title: string }
  | { kind: 'result'; provider: Provider }
  | { kind: 'group'; title: string; providers: Provider[] };

/** Never render a swept-up <style>/<script> block as a description. The BFF guards this too. */
const looksCss = (s: string) =>
  s.length > 2500 || /<\/?(?:style|script)\b|\.[a-z][\w-]*\s*[{,]|@import|gtag\(|wp-manga|woocommerce|datalayer/i.test(s);

/**
 * Adding a series, in the app's own dialog.
 *
 * The old one was a hand-rolled div: no `role="dialog"`, no `aria-modal`, no Escape, no focus management,
 * and the page scrolled behind it. `Modal` has all of that, including the fix that stops a dialog closing
 * itself when you type a space into one of its fields.
 *
 * It also did not survive the thing it existed for: after a successful add you got a toast and nothing else.
 * The server returns `folder`, which is the key into `/api/sources/jobs`, so the dialog can stay open and
 * show the real download rather than dismissing itself and hoping.
 */
export function AddSeriesDialog({ seed, sources, onClose, onAdded }: {
  seed: AddSeed;
  /** Which sources to look in. Unscoped, one tap is an outbound request to every source on the server. */
  sources: string[];
  onClose: () => void;
  onAdded: (r: { title: string; folder: string; chapters: number; seriesId?: string }) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [providers, setProviders] = useState<Provider[] | null>(seed.kind === 'group' ? seed.providers : null);
  const [picked, setPicked] = useState<Provider | null>(
    seed.kind === 'result' ? seed.provider : seed.kind === 'group' && seed.providers.length === 1 ? seed.providers[0] : null,
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<'none' | 'first' | 'ten' | 'all'>('none');
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [adding, setAdding] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; folder: string; chapters: number; started?: boolean; seriesId?: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const title = seed.kind === 'result' ? seed.provider.title : seed.title;

  // Which request the state belongs to. Picking source A then B and having A land last used to overwrite B.
  const want = useRef(0);

  useEffect(() => {
    if (seed.kind !== 'trending') return;
    const mine = ++want.current;
    setLoading(true);
    api<{ content: Provider[] }>(`/api/sources/find?q=${encodeURIComponent(seed.title)}&sources=${encodeURIComponent(sources.join(','))}`)
      .then((r) => { if (mine === want.current) { setProviders(r.content); if (r.content.length === 1) setPicked(r.content[0]); } })
      .catch(() => { if (mine === want.current) setProviders([]); })
      .finally(() => { if (mine === want.current) setLoading(false); });
  }, [seed, sources]);

  useEffect(() => {
    if (!picked) return;
    const mine = ++want.current;
    setLoading(true); setDetail(null);
    api<Detail>(`/api/sources/detail?source=${encodeURIComponent(picked.source)}&sourceId=${encodeURIComponent(picked.sourceId)}${picked.lang ? `&lang=${encodeURIComponent(picked.lang)}` : ''}`)
      .then((d) => { if (mine === want.current) { setDetail(d); setSelection('none'); } })
      .catch(() => { if (mine === want.current) setDetail(null); })
      .finally(() => { if (mine === want.current) setLoading(false); });
  }, [picked]);

  // Only while the dialog is showing a live download.
  const { data: jobs } = useQuery({
    queryKey: ['source-jobs'],
    queryFn: () => api<{ content: Job[] }>('/api/sources/jobs'),
    enabled: !!done && done.chapters > 0,
    refetchInterval: 2000,
  });
  const job = done ? (jobs?.content ?? []).find((j) => j.folder === done.folder) : undefined;

  const add = async (force = false) => {
    if (!picked) return;
    setAdding(true); setDup(null);
    try {
      const r = await api<{ title: string; folder: string; chapters: number; started?: boolean; seriesId?: string }>('/api/sources/add', {
        json: { source: picked.source, sourceId: picked.sourceId,
          chapterCount: selection === 'first' ? 1 : selection === 'ten' ? 10 : selection === 'all' ? undefined : undefined,
          download: selection !== 'none', libraryOnly: selection === 'none', autoUpdate, force, lang: picked.lang },
        // The client has never set a timeout anywhere, so the only bound was the proxy's 120s -- which
        // turned a slow-but-working add into "Add failed. Try another source." while the download carried
        // on. The request now answers in seconds, so this is a backstop rather than the usual path.
        signal: AbortSignal.timeout(45_000),
      });
      setDone(r);
      onAdded(r);
    } catch (e: any) {
      let body: any = {};
      try { body = JSON.parse(e?.body || '{}'); } catch { /* not JSON */ }
      if (body.error === 'duplicate') setDup(body.message || tr('You already have this title.'));
      else toast(msgOf(e, tr('Add failed. Try another source.')), 'error');
    }
    setAdding(false);
  };

  const openIt = async () => {
    if (!done) return;
    setOpening(true);
    qc.invalidateQueries({ queryKey: ['library'] });
    // The server returns the exact created/reused row. A title search can select an older work with the
    // same spelling, and push leaves Discover behind the new series on the back stack.
    router.replace(done.seriesId ? `/series/?id=${done.seriesId}` : '/library');
  };

  // ---------------------------------------------------------------- done
  if (done) {
    return (
      <Modal title={tr('Added to your library')} onClose={onClose}>
        <div className="space-y-4 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
            <IcCheck width={26} height={26} />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-fog-50">{done.title}</p>
            <p className="mt-0.5 text-sm text-fog-400">
              {done.chapters > 0 ? tr('Downloading {n} chapters', { n: done.chapters }) : tr('Already in your library')}
            </p>
          </div>
          {done.chapters > 0 && (
            <>
              <ProgressBar value={job && job.total ? job.done / job.total : 0.02} />
              <p className="text-xs tabular-nums text-fog-500">{job ? `${job.done}/${job.total}` : '…'}</p>
            </>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">{tr('Done')}</button>
            <button onClick={openIt} disabled={opening} className="btn-accent flex-1 py-2.5 text-sm disabled:opacity-50">
              {tr('Open in library')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------------------------------------------------------------- pick a source
  if (!picked) {
    return (
      <Modal title={title} onClose={onClose}>
        {loading ? (
          <p className="py-8 text-center text-sm text-fog-500">{tr('Searching…')}</p>
        ) : !providers?.length ? (
          <p className="py-8 text-center text-sm text-fog-500">{tr('Not found on any source yet — try searching manually.')}</p>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Available on — pick a source')}</p>
            <div className="space-y-1">
              {providers.map((p, i) => (
                <button key={`${p.source}:${p.sourceId}`} onClick={() => setPicked(p)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start hover:bg-ink-800/60">
                  <Img src={sourceCover(p.source, p.coverUrl)} alt="" fallbackSrc={p.coverUrl}
                    className="h-14 w-10 shrink-0 rounded" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fog-100">{p.name}</span>
                    <span className="block truncate text-[11px] text-fog-500">{p.title}</span>
                  </span>
                  {i === 0 && <span className="chip shrink-0 text-[10px]">{tr('preferred')}</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </Modal>
    );
  }

  // ---------------------------------------------------------------- options
  const summary = detail?.summary && !looksCss(detail.summary) ? detail.summary : '';
  const selectedCount = selection === 'none' ? 0 : selection === 'first' ? Math.min(1, detail?.count || 0) : selection === 'ten' ? Math.min(10, detail?.count || 0) : detail?.count || 0;

  return (
    // Not dismissable while the request is in flight. Escape or a backdrop click used to unmount the dialog
    // mid-add: the add still completed, but `setDone` and `onAdded` ran against nothing, so there was no
    // confirmation and the tile was never marked as added -- the worst possible version of "did that work?"
    <Modal title={detail?.title || title} onClose={adding ? () => {} : onClose}>
      {loading || !detail ? (
        <p className="py-10 text-center text-sm text-fog-500">{tr('Loading…')}</p>
      ) : (
        <div className="sm:flex sm:gap-4">
          <div className="mb-3 shrink-0 sm:mb-0 sm:w-28">
            <Img src={sourceCover(detail.source, detail.coverUrl)} alt="" fallbackSrc={detail.coverUrl || undefined}
              className="aspect-[2/3] w-24 rounded-xl border border-ink-700 sm:w-28" />
          </div>
          <div className="min-w-0 flex-1">
            {providers && providers.length > 1 && (
              <button onClick={() => { setPicked(null); setDetail(null); }} className="chip mb-2 text-xs">
                <IcChevronLeft width={13} height={13} />{tr('Change source')}
              </button>
            )}
            <p className="text-xs text-fog-500">
              {detail.count} {detail.count === 1 ? tr('chapter') : tr('chapters')}
              {detail.first != null && detail.last != null && <> · {detail.first}–{detail.last}</>}
            </p>
            <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-2 text-[11px] text-fog-400">
              <p><span className="font-semibold text-fog-300">{tr('Language consulted')}:</span> {detail.language || picked.lang || tr('source default')}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {detail.chapterUrl ? <a href={detail.chapterUrl} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-full border border-accent/50 px-2 text-[10px] font-medium text-accent hover:bg-accent/10" title={tr('Open feed URL')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3h7v7M10 14 21 3M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" /></svg>{tr('Feed URL')}
                </a> : <span>{tr('Feed URL')}: {tr('Not provided by this source')}</span>}
                {detail.seriesUrl && <a href={detail.seriesUrl} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-full border border-accent/50 px-2 text-[10px] font-medium text-accent hover:bg-accent/10" title={tr('Open work link')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3h7v7M10 14 21 3M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" /></svg>{tr('Work link')}
                </a>}
              </div>
            </div>
            {(detail.chapterUrl || detail.seriesUrl) && (
              <p className="mt-1 text-[11px] text-fog-500">{tr('The link opens the official source request in a new tab.')}</p>
            )}
            {detail.count === 0 && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
              {tr('This source returned no chapters in the selected language. Choose another language or source.')}
            </p>}
            {detail.genres.length > 0 && (
              <p className="mt-1 line-clamp-1 text-[11px] text-fog-500">{detail.genres.slice(0, 4).join(' · ')}</p>
            )}
            {summary && <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-fog-400">{summary}</p>}

            <label className="mb-1 mt-4 block text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Download selection')}</label>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSelection('none')} className={`chip ${selection === 'none' ? 'border-accent text-accent' : ''}`}>{tr('No download')}</button>
              <button onClick={() => setSelection('first')} className={`chip ${selection === 'first' ? 'border-accent text-accent' : ''}`}>{tr('Download first chapter')}</button>
              <button onClick={() => setSelection('ten')} className={`chip ${selection === 'ten' ? 'border-accent text-accent' : ''}`}>{tr('Download first 10')}</button>
              <button onClick={() => setSelection('all')} className={`chip ${selection === 'all' ? 'border-accent text-accent' : ''}`}>{tr('Download all')}</button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm text-fog-200">{tr('Auto-update new chapters')}</span>
              <Switch on={autoUpdate} onChange={setAutoUpdate} label={tr('Auto-update new chapters')} />
            </div>

            {selectedCount > 40 && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
                {tr('Grabbing many chapters at once can get you rate-limited. It pauses on its own and you can resume later.')}
              </p>
            )}
            {dup && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">{dup}</p>}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              <button onClick={() => add(!!dup)} disabled={adding} className="btn-accent flex-1 py-2.5 text-sm disabled:opacity-50">
                {adding ? tr('Working…') : dup ? tr('Add anyway') : tr('Add to library')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

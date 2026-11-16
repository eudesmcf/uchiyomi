'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { img } from '@/lib/api';
import { Book, Series } from '@/lib/types';
import { chapterLabel, progressOf, relativeTime } from '@/lib/format';
import { deviceId } from '@/lib/device';
import { Img, ProgressBar } from './ui';
import { IcCopy, IcHeart, IcPlay, IcPlus, IcTrash } from './icons';
import { t as tr } from '@/lib/i18n';

/** Pointer-tracked 3D tilt + moving glare for cover cards. Desktop-only (hover+fine pointer),
 *  disabled under prefers-reduced-motion; on touch the handlers never fire so nothing changes. */
function useTilt() {
  const [style, setStyle] = useState<React.CSSProperties | undefined>();
  const [glare, setGlare] = useState<React.CSSProperties>({ opacity: 0 });
  const ok = useRef<boolean | null>(null);
  const enabled = () => {
    if (ok.current === null)
      ok.current = typeof window !== 'undefined' &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return ok.current;
  };
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!enabled()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    setStyle({
      transform: `perspective(700px) rotateX(${(-py * 8).toFixed(2)}deg) rotateY(${(px * 10).toFixed(2)}deg) translateY(-6px) scale(1.03)`,
      transition: 'transform 120ms ease-out',
    });
    setGlare({
      opacity: 1,
      background: `radial-gradient(220px circle at ${((px + 0.5) * 100).toFixed(1)}% ${((py + 0.5) * 100).toFixed(1)}%, rgba(255,255,255,0.18), transparent 60%)`,
    });
  }, []);
  const onPointerLeave = useCallback(() => {
    setStyle({ transform: 'perspective(700px) rotateX(0deg) rotateY(0deg)', transition: 'transform 320ms ease' });
    setGlare({ opacity: 0, transition: 'opacity 320ms ease' });
  }, []);
  return { style, glare, onPointerMove, onPointerLeave };
}

/** Portrait series cover -> series detail.
 *
 *  `eager` skips lazy-loading for tiles that are on screen at first paint. A lazy <img> waits for layout
 *  before the browser will even queue the request, so on the first rail it is pure added latency. */
export function SeriesCard({ series, w = 'w-32', eager = false }: { series: Series; w?: string; eager?: boolean }) {
  const unread = series.booksUnreadCount ?? 0;
  const tilt = useTilt();
  return (
    <Link href={`/series/?id=${series.id}`} className={`group shrink-0 ${w} [scroll-snap-align:start]`}>
      <div
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        style={tilt.style}
        className="grad-border relative aspect-[2/3] overflow-hidden rounded-2xl border border-ink-700/60 shadow-lift transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-glow group-active:scale-[0.97]"
      >
        <Img src={img.seriesThumb(series.id)} alt={series.metadata?.title || series.name} eager={eager} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.07]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10" style={tilt.glare} />
        {series.yomi?.favorite && (
          <span className="absolute left-2 top-2 z-10 rounded-full bg-black/55 p-1.5 text-accent backdrop-blur">
            <IcHeart width={14} height={14} fill="currentColor" stroke="none" />
          </span>
        )}
        {unread > 0 && (
          <span className="absolute right-2 top-2 z-10 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-black shadow-glow">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {(series.yomi?.newCount ?? 0) > 0 && (
          <span className="absolute bottom-2 left-2 z-10 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wide text-black shadow-glow">NEW</span>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 to-transparent" />
      </div>
      <p className="mt-2 line-clamp-2 px-0.5 text-[13px] font-medium leading-tight text-fog-200 transition group-hover:text-fog-50">
        {series.metadata?.title || series.name}
      </p>
    </Link>
  );
}

/** Wide "continue reading" card for an on-deck book. */
export function ContinueCard({ book, eager = false }: { book: Book; eager?: boolean }) {
  const pct = progressOf(book);
  // Progress already syncs across devices; this just says where you left off, and only when that was
  // somewhere else — "you were reading this on the device you're holding" is noise.
  const elsewhere = book.lastDevice && book.lastDevice.id !== deviceId() ? book.lastDevice : null;
  return (
    <Link
      href={`/reader/?book=${book.id}`}
      className="group relative h-44 w-72 shrink-0 overflow-hidden rounded-3xl border border-ink-700/60 shadow-lift transition-all duration-300 hover:-translate-y-1 hover:shadow-glow [scroll-snap-align:start]"
    >
      <Img src={img.bookThumb(book.id)} alt={book.seriesTitle} eager={eager} className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="line-clamp-1 font-display text-base font-semibold text-white">{book.seriesTitle}</p>
        <p className="mb-2 text-xs text-fog-300">
          {chapterLabel(book)}
          {elsewhere && (
            <span className="text-fog-500"> · on {elsewhere.name || 'another device'}{elsewhere.at ? ` ${relativeTime(elsewhere.at)}` : ''}</span>
          )}
        </p>
        <ProgressBar value={pct || 0.02} />
      </div>
      <span className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-accent text-black shadow-glow transition group-hover:scale-110 group-active:scale-90">
        <IcPlay width={18} height={18} />
      </span>
    </Link>
  );
}

/** Grid tile (library / search). */
export function SeriesTile({ series, eager = false, selectable, selected, onToggle, canDelete, onCopyName, onRead, onDelete }: {
  series: Series; eager?: boolean;
  /** select mode: the tile stops navigating and toggles instead */
  selectable?: boolean; selected?: boolean; onToggle?: () => void;
  canDelete?: boolean; onCopyName?: () => void; onRead?: () => void; onDelete?: () => void;
}) {
  const unread = series.booksUnreadCount ?? 0;
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const [menu, setMenu] = useState(false);
  const title = series.metadata?.title || series.name;
  const clearHold = () => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } };
  const startHold = () => {
    if (selectable) return;
    held.current = false;
    clearHold();
    hold.current = setTimeout(() => { held.current = true; setMenu(true); }, 550);
  };
  const finishHold = (e?: React.SyntheticEvent) => { clearHold(); if (held.current) { e?.preventDefault(); e?.stopPropagation(); held.current = false; } };
  const openMenu = (e: React.MouseEvent) => { if (selectable) return; e.preventDefault(); setMenu(true); };
  const actions = (
    <div className="relative mt-1.5 flex min-w-0 items-start gap-1">
      {selectable ? (
        <span className="min-w-0 flex-1 line-clamp-2 text-xs font-medium leading-tight text-fog-300">{title}</span>
      ) : (
        <Link href={`/series/?id=${series.id}`} className="min-w-0 flex-1 line-clamp-2 text-xs font-medium leading-tight text-fog-300 transition hover:text-fog-100">
          {title}
        </Link>
      )}
      {!selectable && onCopyName && (
        <button type="button" aria-label="Copiar nome" title="Copiar nome" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCopyName(); }}
          className="shrink-0 rounded-md p-1 text-fog-500 hover:bg-ink-800 hover:text-fog-100">
          <IcCopy width={14} height={14} />
        </button>
      )}
      {menu && !selectable && (
        <>
          <button type="button" aria-label="Fechar menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(false)} />
          <div role="menu" className="absolute end-0 top-full z-50 mt-1 w-44 rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-2xl">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); (onRead || (() => window.location.assign(`/series/?id=${series.id}`)))(); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-fog-200 hover:bg-ink-800">
              <IcPlay width={14} height={14} /> Ler obra
            </button>
            {onCopyName && <button type="button" role="menuitem" onClick={() => { setMenu(false); onCopyName(); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-fog-200 hover:bg-ink-800">
              <IcCopy width={14} height={14} /> Copiar nome
            </button>}
            {canDelete && onDelete && <button type="button" role="menuitem" onClick={() => { setMenu(false); onDelete(); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-rose-200 hover:bg-rose-950/40">
              <IcTrash width={14} height={14} /> Excluir obra
            </button>}
          </div>
        </>
      )}
    </div>
  );
  const art = (
      <div className="grad-border relative aspect-[2/3] overflow-hidden rounded-2xl border border-ink-700/60 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-glow group-active:scale-[0.97]">
        <Img src={img.seriesThumb(series.id)} alt={series.metadata?.title || series.name} eager={eager} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.07]" />
        {selectable && (
          <>
            {selected && <span className="absolute inset-0 z-10 rounded-2xl border-2 border-accent bg-accent/20" />}
            <span className={`absolute left-1.5 top-1.5 z-20 grid h-6 w-6 place-items-center rounded-full border text-[11px] font-bold ${
              selected ? 'border-accent bg-accent text-black' : 'border-white/50 bg-black/50 text-transparent'}`}>✓</span>
          </>
        )}
        {series.yomi?.favorite && (
          <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/55 p-1 text-accent backdrop-blur">
            <IcHeart width={12} height={12} fill="currentColor" stroke="none" />
          </span>
        )}
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-black">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {(series.yomi?.newCount ?? 0) > 0 && (
          <span className="absolute bottom-1.5 left-1.5 z-10 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-black">NEW</span>
        )}
      </div>
  );
  if (selectable) return (
    <button type="button" onClick={onToggle} className="group w-full text-left">
      {art}
      {actions}
    </button>
  );
  return (
    <div className="group relative" onPointerDown={startHold} onPointerUp={finishHold} onPointerCancel={clearHold} onContextMenu={openMenu}>
      <Link href={`/series/?id=${series.id}`} onClick={(e) => { if (held.current) { e.preventDefault(); e.stopPropagation(); held.current = false; } }}>
        {art}
      </Link>
      {actions}
    </div>
  );
}

/**
 * A cover from an external source, through this server.
 *
 * Same-origin on purpose: a cross-origin `<img>` is unreliable in a standalone iOS PWA, which is the app's
 * primary target. `Img`'s `fallbackSrc` carries the direct URL for the case where the proxy itself fails.
 */
export const sourceCover = (source: string | undefined, u?: string | null, w?: 800 | 1600) =>
  (u
    ? `/img/sources/cover?${source ? `source=${encodeURIComponent(source)}&` : ''}u=${encodeURIComponent(u)}${w ? `&w=${w}` : ''}`
    : '');

/** One row from a source: a `latest` item, or a grouped search hit with several providers behind it. */
export interface SourceItem {
  source: string;
  sourceId: string;
  title: string;
  coverUrl?: string;
  updatedAt?: string;
  inLibrary?: boolean;
  seriesId?: string;
  /** >1 when the same title was found on several sources. */
  providerCount?: number;
  genres?: string[];
  author?: string;
}

/**
 * A series you do not own yet, on a wall of things you could.
 *
 * The whole card is the button. It used to be a plain `<div>` with an `opacity-0 group-hover:opacity-100`
 * strip as the only add affordance, which on a touch device is not a subtle problem: there is no hover, so
 * the primary action of the page was invisible AND unreachable, and tapping the cover did nothing at all.
 *
 * Chrome is `SeriesTile`'s, deliberately, so the things you own and the things you could own read as one
 * system rather than as two grids that happen to be adjacent.
 */
export function SourceCard({ item, sourceName, onAdd, onOpen, onAuthor, eager }: {
  item: SourceItem;
  /** shown as a corner chip, because a wall merged from several sources otherwise hides where a title came from */
  sourceName?: string;
  onAdd: () => void;
  onOpen: () => void;
  onAuthor?: (author: string) => void;
  eager?: boolean;
}) {
  const owned = !!item.inLibrary;
  return (
    <button
      type="button"
      onClick={owned ? onOpen : onAdd}
      aria-label={owned ? tr('Open in library') : tr('Add to library')}
      className="group block w-full cursor-pointer text-start"
    >
      <div className={`grad-border relative aspect-[2/3] overflow-hidden rounded-2xl border border-ink-700/60 transition-all duration-300
                       ${owned ? 'opacity-55' : 'group-hover:-translate-y-1 group-hover:shadow-glow group-active:scale-[0.97]'}`}>
        <Img src={sourceCover(item.source, item.coverUrl)} alt={item.title} eager={eager}
          fallbackSrc={item.coverUrl || undefined}
          className="h-full w-full" imgClassName="transition-transform duration-500 group-hover:scale-[1.07]" />

        {sourceName && (
          <span className="absolute end-1.5 top-1.5 z-10 max-w-[85%] truncate rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[10px] font-medium text-fog-200 backdrop-blur">
            {sourceName}
          </span>
        )}
        {(item.providerCount ?? 0) > 1 && !owned && (
          <span className="absolute start-1.5 top-1.5 z-10 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-accent backdrop-blur">
            {item.providerCount}
          </span>
        )}

        {owned ? (
          // Accent, not emerald: emerald is a health colour everywhere else in this app, and a large solid
          // fill of it over artwork reads as a system status chip pasted onto a cover.
          <span className="absolute inset-x-0 bottom-0 z-10 bg-accent/85 py-1.5 text-center text-[11px] font-semibold text-black backdrop-blur">
            {tr('In library')}
          </span>
        ) : (
          // Always visible. Not a hover reveal.
          <span aria-hidden className="absolute bottom-1.5 end-1.5 z-10 grid size-7 place-items-center rounded-full bg-accent text-black shadow-glow transition group-hover:scale-110">
            <IcPlus width={15} height={15} />
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight text-fog-300 transition group-hover:text-fog-100">
        {item.title}
      </p>
      {item.author && onAuthor && (
        <span role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); onAuthor(item.author!); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onAuthor(item.author!); } }}
          className="mt-0.5 block truncate text-[11px] text-fog-500 hover:text-accent focus:text-accent focus:outline-none">
          {item.author}
        </span>
      )}
    </button>
  );
}

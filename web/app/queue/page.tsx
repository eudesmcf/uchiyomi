'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui';
import { IcArrowDown, IcArrowUp, IcPause, IcPlay, IcTrash } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

interface Job { folder: string; title: string; total: number; done: number; status: 'queued' | 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'; reason?: string }

export default function QueuePage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['source-jobs'], queryFn: () => api<{ content: Job[] }>('/api/sources/jobs'), refetchInterval: 2000 });
  const jobs = data?.content ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['source-jobs'] });
  const act = async (folder: string, action: 'pause' | 'resume') => { await api(`/api/sources/jobs/${encodeURIComponent(folder)}`, { method: 'PATCH', json: { action } }); refresh(); };
  const cancel = async (folder: string) => { await api(`/api/sources/jobs/${encodeURIComponent(folder)}`, { method: 'DELETE' }); refresh(); };
  const move = async (index: number, delta: number) => {
    const ordered = [...jobs]; const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await api('/api/sources/jobs/order', { method: 'PUT', json: { folders: ordered.map((job) => job.folder) } }); refresh();
  };

  return <section className="mx-auto max-w-3xl py-8 sm:py-12">
    <p className="eyebrow">{tr('Downloads')}</p><h1 className="mt-2 font-display text-3xl font-bold text-fog-50">{tr('Download queue')}</h1>
    <div className="mt-6 divide-y divide-ink-700 rounded-lg border border-ink-700 bg-ink-900/70">
      {!jobs.length && <p className="p-5 text-sm text-fog-500">{tr('No downloads in the queue.')}</p>}
      {jobs.map((job, index) => <article key={job.folder} className="p-4">
        <div className="flex gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fog-100">{job.title}</p><p className="mt-1 text-xs text-fog-500">{tr(job.status)} · {job.done}/{job.total}</p>
          <div className="mt-2"><ProgressBar value={job.total ? job.done / job.total : 0} /></div>{job.reason && <p className="mt-2 text-xs text-amber-300">{job.reason}</p>}</div>
          <div className="flex shrink-0 items-start gap-1">
            {(job.status === 'downloading' || job.status === 'queued') && <button title={tr('Pause')} onClick={() => act(job.folder, 'pause')} className="icon-btn"><IcPause /></button>}
            {job.status === 'paused' && <button title={tr('Resume')} onClick={() => act(job.folder, 'resume')} className="icon-btn"><IcPlay /></button>}
            {index > 0 && job.status === 'queued' && <button title={tr('Move up')} onClick={() => move(index, -1)} className="icon-btn"><IcArrowUp /></button>}
            {index < jobs.length - 1 && job.status === 'queued' && <button title={tr('Move down')} onClick={() => move(index, 1)} className="icon-btn"><IcArrowDown /></button>}
            {['queued', 'downloading', 'paused'].includes(job.status) && <button title={tr('Cancel')} onClick={() => cancel(job.folder)} className="icon-btn text-rose-300"><IcTrash /></button>}
          </div></div>
      </article>)}
    </div>
  </section>;
}
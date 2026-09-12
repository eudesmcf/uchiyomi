import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import { networkInterfaces } from 'os';
import qrcode from 'qrcode';
import { env } from './env';
import { pool } from './lib/db';
import { runtime } from './lib/runtime';
import { reapStaleTemp } from './lib/fsAtomic';
import { DL_ROOT } from './lib/library';
import { migrate } from './lib/migrate';
import { loadSources, loadCustomSites, loadBuiltins, listSources, loadSuwayomiSources, scheduleSuwayomiRetry, suwayomiConfigured } from './lib/sources';
import { scheduleFingerprintBackfill } from './lib/fingerprintJob';
import { runSourceCheck } from './lib/sourceWatchdog';
import { runSweep } from './lib/updater';
import { runExtensionMonitor } from './lib/extensionMonitor';
import { startSweeper } from './lib/imageCache';
import { runBackup, msUntilHour } from './lib/backup';
import { KomgaError } from './lib/komga';
import { ZodError } from 'zod';
import { registerWebRoot, webRootConfigured } from './lib/webRoot';
import { registerApiDocs } from './lib/apiDocs';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import catalogRoutes from './routes/catalog';
import imageRoutes from './routes/images';
import personalRoutes from './routes/personal';
import downloadRoutes from './routes/downloads';
import sourceRoutes from './routes/sources';
import opdsRoutes from './routes/opds';

async function main() {
  await migrate();
  const bi = loadBuiltins(); // always-on built-ins bundled in the core (MangaDex)
  const ls = loadSources(); // bespoke source plugins from SOURCES_DIR (the optional pack)
  const cs = loadCustomSites(); // user-added engine sites from /config/sites.json (built via the in-core engines)
  // Extension sources from an optional Suwayomi server. Fails soft: unset or unreachable just means none.
  const sw = await loadSuwayomiSources();
  const swNote = sw.configured ? `, ${sw.registered} extension${sw.reachable ? '' : ' (engine still starting)'}` : '';
  // The engine is a JVM and is usually still booting when we get here, so keep trying in the background
  // rather than leaving the feature switched off until someone notices and reloads.
  if (sw.configured && !sw.reachable) scheduleSuwayomiRetry();
  console.log(`[sources] ${listSources().length} source(s) available (${bi} built-in, ${ls.loaded} pack, ${cs} custom${swNote})`);

  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false });
  await app.register(cors, { origin: env.PUBLIC_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, { global: false });
  /**
   * The single-container layout has no nginx in front of it, and nginx was the only thing compressing
   * anything: `gzip_types text/css application/javascript application/json image/svg+xml
   * application/manifest+json` with `gzip_min_length 1024` (web/nginx.conf:30-32). Without this, the
   * all-in-one image ships 736 KB of JS and CSS on a cold load where the split layout shipped 261 KB, and
   * every API response goes out uncompressed too -- `application/json` was in that list.
   *
   * No explicit type list: the plugin compresses whatever mime-db marks compressible, which is a superset
   * of nginx's five and includes text/html, which nginx only covered implicitly. Brotli is offered first
   * and is something nginx never had here at all -- `nginx:1.27-alpine` ships no brotli module.
   *
   * `@fastify/compress` also sets `Vary: Accept-Encoding`, which nginx did NOT: it ran `gzip on` with no
   * `gzip_vary`, so a shared cache in front of it could hand a gzipped body to a client that never asked
   * for one. This is parity plus that fix.
   */
  // The threshold only bites on buffered replies, which is nearly all of the API: static files are streamed
  // by @fastify/static with no Content-Length, so those are compressed whatever their size. nginx skipped
  // anything under 1 KB; the difference is a few bytes of gzip framing on the handful of tiny assets.
  await app.register(compress, { threshold: 1024, encodings: ['br', 'gzip', 'deflate'] });

  /**
   * Liveness, deliberately separate from readiness.
   *
   * `/healthz` below runs `SELECT 1`, which is the right answer for "should traffic be sent here" and the
   * wrong one for a container healthcheck: in the split layout nginx answered /healthz itself and stayed
   * healthy through a database outage, still serving the shell so the app could render an error. Pointing
   * the Docker healthcheck at a database probe means one Postgres blip marks the whole app unhealthy.
   */
  app.get('/livez', async () => ({ ok: true }));

  app.get('/healthz', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
    } catch {
      return reply.code(503).send({ ok: false, db: false });
    }
    return { ok: true };
  });

  // BEFORE the routes, not after. Fastify resolves a route's error handler from the encapsulation context
  // that existed when the route was registered, and every `await app.register(...)` below loads immediately.
  // Set afterwards, this whole function was dead: routes fell through to Fastify's default handler, which
  // replies with the raw `err.message`. So the sanitising branch never sanitised anything, and a failed
  // `schema.parse()` returned 500 with the entire ZodError -- field names, expected types and all -- to any
  // client that sent a malformed body.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof KomgaError) {
      const code = err.status >= 400 && err.status < 600 ? err.status : 502;
      return reply.code(code).send({ error: 'komga', status: err.status });
    }
    // A schema rejection is the client's mistake, not the server's. Most routes use safeParse and answer
    // 400 themselves; the ones that call .parse() throw, and without this they answered 500.
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'bad_request',
        fields: err.issues.map((i) => i.path.join('.')).filter(Boolean),
      });
    }
    const status = (err as any).statusCode || 500;
    if (status >= 500) req.log.error(err);
    // fastify 5 types the handler's error as unknown, so the message needs the same narrowing statusCode gets
    return reply.code(status).send({ error: status >= 500 ? 'internal' : (err as Error).message || 'error' });
  });

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(catalogRoutes);
  await app.register(imageRoutes);
  await app.register(personalRoutes);
  await app.register(downloadRoutes);
  await app.register(sourceRoutes);
  await app.register(opdsRoutes);
  // The interactive API reference, BEFORE the web root: registerWebRoot installs the not-found handler that
  // serves the app shell for any unknown path, and a route added after it would still work, but its
  // static assets under /api/docs/ would not be found by the UI in the same way. Unauthenticated on
  // purpose -- every route name is already public in docs/api.md and the spec holds no secrets.
  app.get('/qr', async (_req, reply) => {
    const nets = networkInterfaces();
    const ips: { name: string; address: string; isPhysical: boolean }[] = [];

    for (const name of Object.keys(nets)) {
      const isVirtual = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Loopback/i.test(name);
      for (const net of nets[name] || []) {
        if (
          net.family === 'IPv4' &&
          !net.internal &&
          !net.address.startsWith('169.254.') &&
          !net.address.startsWith('127.')
        ) {
          ips.push({
            name,
            address: net.address,
            isPhysical: !isVirtual && (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.16.'))
          });
        }
      }
    }

    ips.sort((a, b) => (b.isPhysical ? 1 : 0) - (a.isPhysical ? 1 : 0));

    const port = env.PORT;
    const localUrl = `http://localhost:${port}`;

    const qrItems = await Promise.all(
      ips.map(async (item) => {
        const url = `http://${item.address}:${port}`;
        const svg = await qrcode.toString(url, {
          type: 'svg',
          margin: 4,
          errorCorrectionLevel: 'H',
          color: { dark: '#000000', light: '#ffffff' }
        });
        return { name: item.name, address: item.address, url, svg };
      })
    );

    if (qrItems.length === 0) {
      const svg = await qrcode.toString(localUrl, { type: 'svg', margin: 4, errorCorrectionLevel: 'H' });
      qrItems.push({ name: 'Localhost', address: '127.0.0.1', url: localUrl, svg });
    }

    const cardsHtml = qrItems.map((item) => `
      <div style="margin-bottom: 1.5rem;">
        <div class="interface-label">${item.name} (${item.address})</div>
        <div class="qr-container">
          ${item.svg}
        </div>
        <div class="url-box">${item.url}</div>
      </div>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Uchiyomi - QR Code Rede Local</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #121827;
      --border: #1f293d;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --green: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 2rem;
      max-width: 460px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.1);
      color: var(--green);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 1rem;
    }
    .dot {
      width: 8px;
      height: 8px;
      background: var(--green);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--green);
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    p {
      color: var(--muted);
      font-size: 0.95rem;
      margin-bottom: 1.25rem;
      line-height: 1.4;
    }
    .interface-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .qr-container {
      background: #ffffff;
      padding: 1.25rem;
      border-radius: 0.75rem;
      display: inline-block;
      margin-bottom: 0.75rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    }
    .qr-container svg {
      display: block;
      width: 260px;
      height: 260px;
      shape-rendering: crispEdges;
    }
    .url-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.6rem 0.8rem;
      font-family: monospace;
      font-size: 1rem;
      color: #38bdf8;
      word-break: break-all;
    }
    .btn {
      display: inline-block;
      width: 100%;
      background: var(--accent);
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      padding: 0.75rem 1.25rem;
      border-radius: 0.5rem;
      transition: background 0.2s;
    }
    .btn:hover {
      background: var(--accent-hover);
    }
    .help-note {
      margin-top: 1.25rem;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 0.5rem;
      font-size: 0.8rem;
      color: var(--muted);
      text-align: left;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="dot"></span> Servidor Ativo</div>
    <h1>Uchiyomi na Rede Local</h1>
    <p>Escaneie o QR Code abaixo no celular (conectado ao mesmo Wi-Fi):</p>

    ${cardsHtml}

    <a href="${localUrl}" class="btn">Abrir Uchiyomi neste computador</a>

    <div class="help-note">
      ⚠️ <strong>Se a pagina nao abrir no celular:</strong><br/>
      1. Certifique-se de estar no <strong>mesmo Wi-Fi</strong> que este computador.<br/>
      2. No computador, abra o PowerShell como Administrador e rode:<br/>
      <code style="color:#38bdf8; display:block; margin-top:4px; word-break:break-all;">New-NetFirewallRule -DisplayName "Uchiyomi 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow</code>
    </div>
  </div>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  await registerApiDocs(app);

  // The web app, when it is packaged into this image. Registered after every API route so a path collision
  // can only ever go the safe way. Unset WEB_ROOT and this is a no-op: nginx keeps serving it as before.
  await registerWebRoot(app);

  startSweeper();

  // Periodic new-chapter check (owned mode), self-rescheduling so the admin can change the interval live.
  if (process.env.LIBRARY_BACKEND === 'owned') {
    const tick = async () => {
      let hours = 6;
      try {
        const s = await pool.query('SELECT updater_hours FROM server_settings WHERE id = 1');
        hours = Math.min(168, Math.max(1, s.rows[0]?.updater_hours || 6));
        // The running flag, the stored result and the summary line all live in runSweep now, so the panel's
        // "Run now" button gets the same treatment as this tick -- and this tick can see the button's sweep.
        const run = runSweep({ maxNew: 5 }, app.log);
        if (run) await run;
        else app.log.info('updater: the previous sweep is still running, skipping this tick');
      } catch (e) {
        app.log.error(e as any);
      }
      setTimeout(tick, hours * 60 * 60 * 1000).unref();
    };
    // The first run used to wait a full interval after boot, so every deploy pushed the next sweep out by
    // six hours: three deploys in one day meant no scheduled sweep at all, measured. Now the first run is
    // scheduled for whatever remains of the interval since the last COMPLETED sweep (persisted, so it
    // survives the restart), with a ten-minute floor so a restart loop cannot turn into a flood and a booting
    // server answers readers before it starts fetching.
    void (async () => {
      let hours = 6;
      let last = 0;
      try {
        const s = await pool.query('SELECT updater_hours, updater_last_run FROM server_settings WHERE id = 1');
        hours = Math.min(168, Math.max(1, s.rows[0]?.updater_hours || 6));
        last = s.rows[0]?.updater_last_run ? new Date(s.rows[0].updater_last_run).getTime() : 0;
      } catch { /* settings row not readable yet — keep the defaults */ }
      const due = last + hours * 60 * 60 * 1000 - Date.now();
      const delay = Math.max(10 * 60 * 1000, due);
      app.log.info(`updater: first sweep in ${Math.round(delay / 60000)} min` + (last ? ` (last completed ${new Date(last).toISOString()})` : ' (no completed sweep on record)'));
      setTimeout(tick, delay).unref();
    })();
  }

  /**
   * Daily source watchdog.
   *
   * A source that dies quietly stays dead: it answers with an empty list, throws nothing, records nothing,
   * and keeps reporting healthy. One install ran six weeks that way after its main site's domain was
   * repurposed into an unrelated website, and only noticed because the dots on Discover looked wrong.
   *
   * Daily rather than hourly because each sweep genuinely scrapes every source, and they share one
   * Cloudflare solver. The first run waits ten minutes so a restart loop cannot turn this into a flood, and
   * so a server that has just booted is answering readers before it starts checking itself.
   */
  {
    const DAY = 24 * 60 * 60 * 1000;
    const tick = async () => {
      try {
        const r = await runSourceCheck();
        app.log.info(`source check: ${r.sources.length} checked, ${r.needsAttention.length} need attention`);
      } catch (e) {
        app.log.error(e as any);
      }
      setTimeout(tick, DAY).unref();
    };
    setTimeout(tick, 10 * 60 * 1000).unref();
  }

  // Keep the installed extensions current with the repositories they came from.
  //
  // Its own schedule rather than a step in the watchdog above: that one is a daily, deliberately serial
  // scrape of every source at up to 45 seconds each, and this is one index download plus one list query.
  // Sharing a schedule would mean either running the expensive thing four times a day or catching an
  // upstream push a day late -- and upstream pushes roughly every fifteen hours.
  if (suwayomiConfigured()) {
    const tick = async () => {
      let hours = 6;
      try {
        const s = await pool.query('SELECT extension_hours FROM server_settings WHERE id = 1');
        hours = Math.min(168, Math.max(1, s.rows[0]?.extension_hours || 6));
        const run = runExtensionMonitor(app.log);
        if (run) await run;
        else app.log.info('extensions: the previous check is still running, skipping this tick');
      } catch (e) {
        app.log.error(e as any);
      }
      setTimeout(tick, hours * 60 * 60 * 1000).unref();
    };
    // Same reasoning as the sweep: schedule the REMAINDER of the interval since the last completed check, so
    // a deploy does not push the next one out by a full interval. The ten-minute floor also means a fresh
    // install sees its first check while someone is still watching, rather than six hours later.
    void (async () => {
      let hours = 6;
      let last = 0;
      try {
        const s = await pool.query('SELECT extension_hours, extension_last_run FROM server_settings WHERE id = 1');
        hours = Math.min(168, Math.max(1, s.rows[0]?.extension_hours || 6));
        last = s.rows[0]?.extension_last_run ? new Date(s.rows[0].extension_last_run).getTime() : 0;
      } catch { /* settings row not readable yet -- keep the defaults */ }
      const delay = Math.max(10 * 60 * 1000, last + hours * 60 * 60 * 1000 - Date.now());
      app.log.info(`extensions: first check in ${Math.round(delay / 60000)} min`);
      setTimeout(tick, delay).unref();
    })();
  }

  // Nightly backup, aligned to a wall-clock hour and re-read from settings each run so it stays live-editable.
  {
    const backupTick = async () => {
      try {
        runtime.backingUp = true;
        const r = await runBackup();
        runtime.lastBackup = Date.now();
        runtime.lastBackupResult = { bytes: r.bytes, ms: r.ms, configEmpty: r.configEmpty, sizeUnknown: r.sizeUnknown };
        app.log.info(`backup: ${(r.bytes / 1024 / 1024).toFixed(1)} MB in ${r.ms}ms -> ${r.dir}`);
      } catch (e) {
        app.log.error(e as any);
      } finally {
        runtime.backingUp = false;
      }
      setTimeout(backupTick, await nextBackupDelay()).unref();
    };
    const nextBackupDelay = async (): Promise<number> => {
      let hour = 3;
      try {
        const s = await pool.query('SELECT backup_hour FROM server_settings WHERE id = 1');
        const h = Number(s.rows[0]?.backup_hour);
        if (Number.isInteger(h) && h >= 0 && h <= 23) hour = h;
      } catch { /* settings not readable yet — keep 03:00 */ }
      return msUntilHour(hour);
    };
    void (async () => { setTimeout(backupTick, await nextBackupDelay()).unref(); })();
  }

  // Abandoned half-writes from a previous life: a chapter or cache file whose rename never happened.
  void reapStaleTemp(DL_ROOT).then((n) => { if (n) app.log.info(`reaped ${n} half-written file(s) under ${DL_ROOT}`); });

  // Stop at a boundary, and say so. Before this there was no handler at all: `docker compose up -d` in the
  // middle of a sweep killed it mid-chapter, the job card polled a dead id, and nothing recorded that a run
  // had been interrupted rather than finished.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      runtime.stopping = true;
      app.log.info(`${sig}: finishing the current chapter, then stopping`);
      void app.close().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 20_000).unref(); // never hang a shutdown on a slow site
    });
  }

  await app.listen({ host: '0.0.0.0', port: env.PORT });

  // Says which topology is running, so "why is / a 404" is answerable from `docker compose logs`.
  console.log(webRootConfigured()
    ? `[web] serving the app from ${process.env.WEB_ROOT} (single container)`
    : '[web] API only; the web app is served separately');

  // Content fingerprints for the library, filled in behind the server rather than during boot: it reads
  // every archive on disk, so putting it on the boot path would make start-up time grow with the size of
  // someone's library. Nothing reads the column yet, so not finishing is harmless.
  if (process.env.LIBRARY_BACKEND !== 'komga') scheduleFingerprintBackfill();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', e);
  process.exit(1);
});

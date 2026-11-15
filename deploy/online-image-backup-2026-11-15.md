# UchiYomi online image backup

Captured from the production VPS on 2026-11-15.

- Host: `movi-01` (`168.138.140.185`)
- Swarm service: `personal_uchiyomi`
- Image: `personal/uchiyomi:remote-library-fix-20261011`
- Image digest: `sha256:1f2afaefd8481bfb8cd460a6e2bd689eb5d394a9b22d743cee7e4dbd92eb2522`
- Image created: `2026-10-11T20:11:15.983572861Z`

The local working tree's compiled backend matched the running container exactly for these files:

- `dist/server.js`
- `dist/lib/previewToken.js`
- `dist/lib/remoteChapter.js`
- `dist/lib/remoteId.js`
- `dist/routes/sources.js`

The image itself contains compiled artifacts, not the original TypeScript/TSX source. The source backup is therefore the application source selected in the corresponding Git commit.

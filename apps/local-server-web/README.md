# FFmpeg UI - Local Server Web

React 19 + Vite UI for the Flask server in [`apps/local-server`](../local-server/). It uses the shared `@ffmpeg-ui/ui` and `@ffmpeg-ui/core` packages.

## Build and serve

From the repo root, after `npm install`:

```bash
npm run build --workspace=local-server-web   # writes apps/local-server-web/dist
npm start --workspace=local-server           # Flask serves dist/ on http://127.0.0.1:5000
```

The server refuses to serve the UI if `dist/index.html` is missing, so build first.

## Develop

```bash
npm run dev --workspace=local-server-web
```

Vite proxies API calls (`/upload`, `/convert`, `/progress`, ...) to `http://127.0.0.1:5000`, so run the Flask server in another terminal.

## Checks

```bash
npm run typecheck --workspace=local-server-web
npm run lint --workspace=local-server-web
```

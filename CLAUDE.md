# CLAUDE.md

Guidance for AI agents (and humans) working in this repository.

## Project

`movie-night` (Plot Polls) is a React + [Vite](https://vitejs.dev/) single-page
app — a serverless P2P movie-voting app over WebRTC. The source lives in `src/`
and the production build is emitted to `build/`, which is the root served by
GitHub Pages.

- UI: React 18 function components composed from reusable pieces in
  `src/ui/`, `src/components/`, `src/modals/`, and `src/screens/`.
- Framework-agnostic logic (catalogue decode, embeddings, recommendation
  engine, instant-runoff, vectors) lives in `src/lib/`.
- The shared runtime store + PeerJS networking controller live in
  `src/lib/runtime.js` and `src/state/`.
- React components subscribe to the runtime store via
  `useStore()` (`src/state/useStore.js`, a `useSyncExternalStore` hook).
- Presentation-only dependencies (Tailwind, qrcode.js, html5-qrcode, Font
  Awesome, Google Fonts) load via CDN in `index.html`; `react`, `react-dom`,
  `peerjs`, and `protobufjs` are bundled via npm.
- The recommendation catalogue (`movies.pbf`) and the embedding binaries
  (`embeddings_part*.bin`) live in `public/data/` and are copied verbatim to
  `build/data/` at build time.

## Develop, build, preview

```bash
npm install      # install dependencies
npm run dev      # local dev server with HMR
npm run build    # produce the static site in build/ (Pages root)
npm run preview  # serve the build/ output locally
```

## Versioning

The page displays a simple version number in the footer rendered by the React
`Footer` component.

**Whenever you make changes to the site, increment this version number by one.**

- The version lives in the app footer (the React `Footer` component), inside a
  `version N` / `Version N` label.
- It is a plain integer that increases by 1 with each set of changes.
- Update it as part of the same change so the deployed page always reflects the
  latest version.

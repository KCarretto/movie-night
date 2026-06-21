# CLAUDE.md

Guidance for AI agents (and humans) working in this repository.

## Project

`movie-night` is a single, self-contained `index.html` with no build step.
Dependencies (Tailwind, PeerJS, qrcode.js, html5-qrcode) load via CDN. The app
is a serverless P2P voting app over WebRTC.

## Versioning

The page displays a simple version number in the footer of `index.html`
(e.g. `version 1`).

**Whenever you make changes to the site, increment this version number by one.**

- The version lives in the footer of `index.html`, inside the
  `<div class="mt-1">version N</div>` element.
- It is a plain integer that increases by 1 with each set of changes.
- Update it as part of the same change so the deployed page always reflects the
  latest version.

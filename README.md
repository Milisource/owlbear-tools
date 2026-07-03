# Owlbear.tools

[![License](https://img.shields.io/github/license/milisource/owlbear-tools)](LICENSE)
[![Owlbear Rodeo Extension](https://img.shields.io/badge/Owlbear%20Rodeo-Extension-8A2BE2)](#)

Search the 5e.tools bestiary from inside Owlbear Rodeo and drop monster tokens directly onto the board. Pick a source book, find your monster, click — the token lands where you're looking. Maybe more? Who knows!

---

## Install
1. In Owlbear Rodeo, open a room or go to the "Extensions" page in your settings.
2. Click Extensions in the top bar → **Add Extension**.
3. Paste the URL to the `manifest.json`.

The manifest URL for this project is:
```
https://milisource.github.io/owlbear-tools/manifest.json
```

## Quick start (development)

```bash
npm install
npm run dev
```

Open `http://localhost:5173/manifest.json` in Owlbear Rodeo and you're set.

## Deploying

The extension is pure static files — no backend, no database, no proxy. Drop `dist/` on any web server.

### GitHub Pages

```bash
npm run build
npx gh-pages -d dist
```

Enable **Enforce HTTPS** in the Pages settings. OBR won't load extensions over plain HTTP.

### Any static host

The `dist/` directory after a build is self-contained:

```
dist/
├── index.html
├── manifest.json
├── icon.svg
└── assets/
    ├── index-XXXX.css
    └── index-XXXX.js
```

Upload these anywhere — Netlify, Vercel, S3, a VPS. Paths are relative, so it works from any URL prefix.

## How it works

The whole thing is an iframe that OBR loads as an action popover. Inside that iframe:

1. **Fetch** the bestiary index from a 5e.tools GitHub mirror. The JSON files come off `raw.githubusercontent.com` with permissive CORS headers. (The main 5e.tools domain is behind Cloudflare and doesn't set CORS — hence the mirror.)
2. **Pick sources** by clicking book chips. Each chip fetches its bestiary file and caches the results in memory. Click again to toggle it off.
3. **Search** as you type. Filtering is local across all loaded sources.
4. **Click** a monster to drop its token. The token image is pulled from the 5e.tools image mirror, sized by creature size category, and placed at the center of your current viewport.

Each token carries metadata under `com.owlbear.tools/monster` so other extensions can read it:

```json
{
  "name": "Adult Red Dragon",
  "source": "XMM",
  "cr": "17",
  "ac": 19,
  "hp": 243,
  "type": "Dragon",
  "size": "H"
}
```

## Project layout

```
├── public/
│   ├── manifest.json     OBR extension manifest
│   └── icon.svg          Toolbar icon (24x24 SVG silhouette)
├── index.html            Popover UI shell
├── app.js                Core logic
├── style.css             Dark theme
├── vite.config.js        Build config (relative base for subpath deploy)
└── package.json
```

## Scripts

```bash
npm run dev       # Dev server on :5173
npm run build     # Production build into dist/
npm run preview   # Preview the production build
```

Vanilla JS with Vite. No framework, no JSX, no routing. The OBR SDK is imported from esm.sh at build time.

## Caveats

- **Data lag.** The extension fetches from GitHub mirrors, not the live API. Mirrors trail the main site by hours to days. The 5e.tools release cycle is monthly, so this rarely matters.
- **Missing tokens.** Monsters without `hasToken` are filtered out. Some edge cases slip through — the token URL will 404 and the monster won't appear.
- **Per-user popover.** Each player sees their own popover. Dropping a token calls `addItems()` and OBR's normal item replication handles multiplayer sync.

## License

MIT. Do what you want with it.

# mancolabs-site

The website for **Manco Labs LLC**: affordable, practical software help for local businesses in Shreveport-Bossier. Plain HTML and CSS, built with Vite. A 3D layer (three.js) is added on top as progressive enhancement, and the site works fully without it.

> **Status:** redesign in progress on the `redesign` branch. Stage 2 of 6 (content, structure, services) is done. The 3D scenes, the Free Website Check, and the micro-interactions land in stages 3 to 5.

---

## Quick start

```bash
npm install
npm run dev        # local dev server at http://localhost:5173
npm run build      # checks copy, then builds to dist/
npm run preview    # serves dist/ at http://localhost:4173
```

Node 22.12 or newer.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with live reload (partials included) |
| `npm run build` | Runs the copy check, then the production build |
| `npm run preview` | Serves the production build |
| `npm run check:copy` | Fails if site copy contains em or en dashes |
| `npm run screenshots` | Recaptures the work screenshots from the live sites (uses your installed Chrome) |

## Project structure

```
index.html                 Home page
404.html                   Not-found page (Cloudflare Pages serves it automatically)
work/<slug>/index.html     One case study page per project
partials/                  Shared HTML: head.html, header.html, footer.html, laptop-sprite.html
src/main.js                Menu, scroll reveals, contact form
src/styles/tokens.css      Brand colors and color roles (see "Colors" below)
src/styles/fonts.css       Self-hosted fonts and size-matched fallbacks
src/styles/main.css        Everything else
src/assets/work/           Work screenshots (generated, see "Screenshots")
public/                    Copied as-is: logo.png, brand/, fonts/, robots.txt, sitemap.xml, _headers
scripts/                   check-copy.mjs, capture-screenshots.mjs
vite.config.js             Page list and the two HTML directives below
```

`public/logo.png` stays at `https://mancolabs.dev/logo.png` because the email signature uses it.

### HTML directives

`vite.config.js` expands two comments in every page before Vite builds it:

- `<!-- @include header.html -->` inlines `partials/header.html`.
- `<!-- @picture src="work/werla/live-desktop" widths="480,800,1280" sizes="..." alt="..." width="1440" height="900" -->` becomes a `<picture>` with AVIF and WebP versions from `src/assets/`. Extra attributes (`width`, `height`, `loading`, `fetchpriority`, `class`) go on the `<img>`. Images lazy-load unless you pass `loading="eager"`.

## Editing content

### Services

All services live in `index.html` inside `<section id="services">`, as plain HTML:

- **Fix, Build, Automate**: each is an `<li class="stage">` with a title, a `<ul class="prices">`, one sentence, and a checklist. The picture next to each one is decorative.
- **Free consultation** and **Website care plan**: the two `<article class="extra">` cards below.

Change prices by editing the `<li>` inside `<ul class="prices">`. Write "$50 an hour", not "$50/hr", so it reads well aloud.

### Work cards

In `index.html`, inside `<section id="work">`. There's a commented-out card template at the end of the list. For a new project:

1. Add the site to `SHOTS` in `scripts/capture-screenshots.mjs` and run `npm run screenshots`.
2. Copy the card template, fill it in, and give it an honest role label.
3. Copy `work/werla/` to `work/<slug>/` and edit it.
4. Add the page to `PAGES` in `vite.config.js` and to `public/sitemap.xml`.
5. Update the "Next project" links at the bottom of the case studies so they still form a loop.

### Screenshots

`npm run screenshots` opens each live site in Chrome at desktop (1440 wide; minicine uses 1100 because its layout is fixed-width) and phone (390 wide) sizes, then writes AVIF and WebP files to `src/assets/work/<slug>/`. Run `npm run screenshots -- werla` to redo just one.

WERLA has no before/after slider. Every Wayback Machine capture of werla.net from before July 2026 is missing the old site's navigation and layout stylesheets, so none of them shows what the site really looked like.

### Copy rules

- No em dashes or en dashes. `npm run build` refuses to build if any slip in.
- No made-up testimonials, numbers, logos, or client claims.
- Short sentences, plain words.

## Colors

The brand palette in `src/styles/tokens.css` is unchanged from the original site. Never add new colors. Components use **roles** instead of palette colors directly, so every pairing passes WCAG AA:

| Role | Light | Dark | Use |
|---|---|---|---|
| `--text` | ink | paper | Body text, headings |
| `--text-2` | accent-deep (4.85:1) | paper-3 | Secondary text, labels |
| `--text-display` | ink-soft (3.61:1) | accent | **Large text only** (24px+, or 19px+ bold) |
| `--accent-text` | accent-deep | accent | Small green text: prices, role labels |
| `--field-border` | ink-soft | ink-faint | Form field outlines (3:1 rule for controls) |
| `--focus` | accent-deep | accent | Keyboard focus rings |
| `--deco` | accent | accent | Lines and icons, never text |

- **`.dark`:** a section with this class (About) uses the dark roles. The whole site switches to them when the visitor's device is in dark mode.
- **`.on-band`:** an element on the tinted `--band` background (the two service cards) gets this class so its secondary text stays readable.

## Fonts

Inter (variable) and DM Sans 400/500, Latin subsets, self-hosted in `public/fonts/` under the SIL Open Font License. `fonts.css` also defines Arial-based fallbacks tuned to each font's measurements, so the page doesn't jump when the fonts load. Font files are cached as immutable (`public/_headers`), so rename the file if you ever replace one.

## Contact form

The contact form posts to Web3Forms, the same as before. JS sends the fields as JSON and shows the result inline. Without JS, the form falls back to a normal POST. The access key in the HTML is meant to be public.

## PageSpeed API key (for the Free Website Check, stage 4)

1. In Google Cloud Console, create or choose a project and enable the **PageSpeed Insights API**.
2. Go to **APIs & Services > Credentials > Create credentials > API key**.
3. Under **Application restrictions**, choose **Websites** and add:
   - `https://mancolabs.dev/*`
   - `http://localhost:5173/*` and `http://localhost:4173/*` (local dev and preview)
   - your Cloudflare Pages preview domain, if you want previews to work (for example `https://*.<project>.pages.dev/*`)
4. Under **API restrictions**, restrict the key to the PageSpeed Insights API only.
5. Copy `.env.example` to `.env.local` and set `VITE_PSI_API_KEY`.
6. Add the same variable in Cloudflare Pages: **Settings > Environment variables**, for Production and Preview.

Vite bakes this key into the public JavaScript, so anyone can read it. The website restrictions are what stop others from using it. Keep `Referrer-Policy: strict-origin-when-cross-origin` in `public/_headers`: stricter policies stop sending the referrer that Google checks.

## Deploying

Cloudflare Pages auto-deploys on every push to `main`. **Before the redesign is merged**, change the Pages build settings:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable `NODE_VERSION` | `22` (or newer) |
| Environment variable `VITE_PSI_API_KEY` | your key |

## Placeholders

| What | Where | Notes |
|---|---|---|
| [PLACEHOLDER] Photo of Ethan | `index.html`, About section (`.about-photo`) | Replace the figure's contents with an `<img alt="Ethan Manco">`. Portrait, about 4:5. |
| [PLACEHOLDER] Social share image | `index.html` `<head>` (og:image, twitter:image) | Rendered from the hero scene in stage 3. |
| [STAGE 4] Website check note | `index.html`, `#check` | Temporary. Removed when the checker is wired up. |

## Contact

**Manco Labs LLC** · Shreveport-Bossier, LA
[hello@mancolabs.dev](mailto:hello@mancolabs.dev) · (318) 642-4582

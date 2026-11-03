# Marketing images

Images for Upwork and the Google Business Profile. None of this is part of the site build or deployed.

Each folder has an HTML source that uses the site's colors and fonts, and a script that renders it with your installed Chrome.

| Folder | What | Render |
|---|---|---|
| `upwork/` | Project Catalog covers: `cover.html` (launch your AI-built app) and `cover-consult.html` (30-minute review). Final files are the dark versions: `cover-1600x1200.png`, `cover-1000x750.png`, and the `cover-consult-` pair. | `node marketing/upwork/render.mjs cover-consult dark` |
| `google/` | Business Profile cover (`cover-1920x1080.png`, `cover-1200x1200.png`) and logo (`logo-720x720.png`). The papers come from the site's real 3D hero, rendered into `scene-wide.png` and `scene-square.png`. | `npm run build`, then `node marketing/google/render.mjs` (add `--keep-scene` to reuse the papers) |
| `portfolio/` | One 1600x1200 image per project (desktop and phone), plus WERLA before and after its redesign. `raw/` holds the captures. | `node marketing/portfolio/render.mjs` (add `--keep-captures` to skip recapturing) |

## Rules

- Upwork images: no Manco Labs logo, no URL, and no contact info anywhere, including address bars.
- Google images: the logo is fine, but no phone number, email, URL, prices, or mention of AI.
- Google crops covers differently on phones and computers, so the headline and laptop stay inside the center 60%.
- Check headlines at small sizes: 300px wide for Upwork, 400px for Google. Each script saves a small preview to `.cache/review/`.
- Never use em dashes.

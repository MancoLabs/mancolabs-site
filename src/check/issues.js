// Plain-English explanations of Lighthouse audits, and the ranking that picks
// the top three. Written for a business owner, not a developer. Keyed by
// Lighthouse 13 audit id. Add or edit entries freely: `title` is the headline,
// `body` is one or two short sentences, and both can use the audit's numbers.
//
// family: issues in the same family are one problem; only the biggest is shown.

const kb = (a) => {
  const b = a.details?.overallSavingsBytes ?? 0;
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};
const ms = (a) => {
  const v = a.details?.overallSavingsMs ?? Math.max(...Object.values(a.metricSavings || { x: 0 }));
  return v >= 1000 ? `${(v / 1000).toFixed(1)} seconds` : `${Math.round(v)} milliseconds`;
};
const secs = (a) => `${(a.numericValue / 1000).toFixed(1)} seconds`;
const totalMb = (a) => `${(a.numericValue / 1024 / 1024).toFixed(1)} MB`;

const ENTRIES = {
  // ── Speed (the measured results) ──
  'largest-contentful-paint': {
    family: 'speed',
    title: (a) => `The main content takes ${secs(a)} to show up on a phone`,
    body: 'Many visitors give up on a page that takes more than a few seconds to appear.',
  },
  'first-contentful-paint': {
    family: 'speed',
    title: (a) => `Visitors stare at a blank screen for ${secs(a)}`,
    body: "Until something appears, people can't tell whether your site is working.",
  },
  'speed-index': {
    family: 'speed',
    title: (a) => `The page takes ${secs(a)} to fill in on a phone`,
    body: 'Slow pages lose visitors, and Google takes speed into account when ranking sites.',
  },
  'total-blocking-time': {
    family: 'freeze',
    title: () => 'The page freezes while it loads',
    body: (a) => `For about ${Math.round(a.numericValue)} milliseconds, taps and scrolls don't respond. On a phone that feels broken.`,
  },
  'cumulative-layout-shift': {
    family: 'shift',
    title: () => 'Things jump around while the page loads',
    body: 'Buttons and text move as images load in, which leads to wrong taps and frustration.',
  },

  // ── Speed (the causes) ──
  'unused-javascript': {
    family: 'js',
    title: () => 'Your site loads code it never uses',
    body: (a) => `About ${kb(a)} of code downloads on every visit but never runs on this page. Trimming it makes the page show up sooner.`,
  },
  'duplicated-javascript-insight': {
    family: 'js',
    title: () => 'Some code is loaded twice',
    body: (a) => `The same code is included more than once. Removing the copies saves about ${kb(a)}.`,
  },
  'legacy-javascript-insight': {
    family: 'js',
    title: () => 'Old-style code adds extra weight',
    body: 'Some code is written for very old browsers, and every visitor still has to download it.',
  },
  'unminified-javascript': {
    family: 'compress',
    title: () => "Code files aren't compressed",
    body: (a) => `Shrinking the code files would save about ${kb(a)} per visit.`,
  },
  'unminified-css': {
    family: 'compress',
    title: () => "Style files aren't compressed",
    body: (a) => `Shrinking the style files would save about ${kb(a)} per visit.`,
  },
  'uses-text-compression': {
    family: 'compress',
    title: () => 'The server sends files uncompressed',
    body: (a) => `Turning on compression on the server would save about ${kb(a)}. It's usually a single setting.`,
  },
  'unused-css-rules': {
    family: 'css',
    title: () => 'Unused styling slows down the first view',
    body: (a) => `About ${kb(a)} of styling isn't used on this page, but it still has to download before anything shows.`,
  },
  'render-blocking-insight': {
    family: 'blocking',
    title: () => 'The page waits on other files before showing anything',
    body: (a) => `Some files have to finish downloading before visitors see anything. Loading them differently could save about ${ms(a)}.`,
  },
  'render-blocking-resources': {
    family: 'blocking',
    title: () => 'The page waits on other files before showing anything',
    body: (a) => `Some files have to finish downloading before visitors see anything. Loading them differently could save about ${ms(a)}.`,
  },
  'image-delivery-insight': {
    family: 'images',
    title: () => 'Images are bigger than they need to be',
    body: (a) => `Resizing and compressing them could save about ${kb(a)}, so the page loads faster on phone data.`,
  },
  'uses-optimized-images': { family: 'images', title: () => 'Images are bigger than they need to be', body: (a) => `Compressing them could save about ${kb(a)}.` },
  'modern-image-formats': { family: 'images', title: () => 'Images use older, heavier file types', body: (a) => `Newer image formats could save about ${kb(a)} with no visible difference.` },
  'uses-responsive-images': { family: 'images', title: () => 'Phones download desktop-sized images', body: (a) => `Sending smaller images to phones could save about ${kb(a)}.` },
  'offscreen-images': { family: 'images', title: () => 'Images load before anyone needs them', body: 'Images further down the page load right away instead of when visitors scroll to them.' },
  'efficient-animated-content': { family: 'images', title: () => 'Animated GIFs are slowing the page', body: (a) => `Turning them into video could save about ${kb(a)}.` },
  'lcp-discovery-insight': {
    family: 'lcp',
    title: () => 'The main image is found too late',
    body: "The browser discovers your biggest image late in loading. Pointing it out early makes the page appear faster.",
  },
  'document-latency-insight': {
    family: 'server',
    title: () => 'Your server is slow to respond',
    body: 'The server takes a while to send the first piece of the page. Better hosting or caching usually fixes this.',
  },
  'server-response-time': {
    family: 'server',
    title: () => 'Your server is slow to respond',
    body: 'The server takes a while to send the first piece of the page. Better hosting or caching usually fixes this.',
  },
  'redirects': {
    family: 'server',
    title: () => 'Visitors get bounced through extra redirects',
    body: 'Each redirect adds a delay before the page even starts loading.',
  },
  'font-display-insight': {
    family: 'fonts',
    title: () => 'Text stays invisible while fonts load',
    body: 'Visitors may see blank spaces where words should be until your fonts arrive. A one-line setting fixes it.',
  },
  'font-display': {
    family: 'fonts',
    title: () => 'Text stays invisible while fonts load',
    body: 'Visitors may see blank spaces where words should be until your fonts arrive. A one-line setting fixes it.',
  },
  'cache-insight': {
    family: 'cache',
    title: () => 'Returning visitors download everything again',
    body: "Files aren't set to be remembered by the browser, so repeat visits are slower than they should be.",
  },
  'uses-long-cache-ttl': {
    family: 'cache',
    title: () => 'Returning visitors download everything again',
    body: "Files aren't set to be remembered by the browser, so repeat visits are slower than they should be.",
  },
  'third-parties-insight': {
    family: 'third',
    title: () => 'Outside services slow the page down',
    body: 'Code from other companies, like chat widgets, trackers, and embeds, is taking time to load.',
  },
  'third-party-summary': {
    family: 'third',
    title: () => 'Outside services slow the page down',
    body: 'Code from other companies, like chat widgets, trackers, and embeds, is taking time to load.',
  },
  'bootup-time': {
    family: 'cpu',
    title: () => 'Heavy scripts make phones work hard',
    body: (a) => `Phones spend ${secs(a)} running code on this page. Removing plugins or scripts you don't need helps a lot.`,
  },
  'mainthread-work-breakdown': {
    family: 'cpu',
    title: () => 'Heavy scripts make phones work hard',
    body: (a) => `Phones spend ${secs(a)} working on this page before it settles. Removing plugins or scripts you don't need helps.`,
  },
  'total-byte-weight': {
    family: 'weight',
    title: (a) => `The page is heavy: ${totalMb(a)} to download`,
    body: "On phone data that takes a while, and it eats into visitors' data plans.",
  },
  'dom-size-insight': {
    family: 'dom',
    title: () => 'The page is very large and complex',
    body: 'A huge page structure makes phones work harder to show and update it.',
  },
  'dom-size': {
    family: 'dom',
    title: () => 'The page is very large and complex',
    body: 'A huge page structure makes phones work harder to show and update it.',
  },
  'cls-culprits-insight': {
    family: 'shift',
    title: () => 'Things jump around while the page loads',
    body: 'Buttons and text move as images and embeds load in, which leads to wrong taps.',
  },
  'unsized-images': {
    family: 'shift',
    title: () => "Images don't save their space",
    body: 'The page shifts as each image loads because the layout doesn\'t know their size ahead of time.',
  },
  'modern-http-insight': {
    family: 'http',
    title: () => 'Your server uses an older connection method',
    body: 'A newer server setting lets files download at the same time instead of one by one.',
  },
  'viewport-insight': {
    family: 'viewport',
    title: () => "The page isn't set up for phones",
    body: 'Without a mobile setting, phones show a tiny zoomed-out desktop page.',
  },

  // ── Accessibility ──
  'color-contrast': {
    family: 'contrast',
    title: () => 'Some text is hard to read',
    body: "Some text doesn't stand out enough from its background. That's hard for many people, especially on a phone outdoors.",
  },
  'image-alt': {
    family: 'alt',
    title: () => 'Images are missing descriptions',
    body: "Screen readers can't describe these images to blind visitors, and search engines can't tell what they show.",
  },
  'input-image-alt': { family: 'alt', title: () => 'Image buttons are missing descriptions', body: "Screen readers can't tell visitors what these buttons do." },
  'role-img-alt': { family: 'alt', title: () => 'Some graphics are missing descriptions', body: "Screen readers can't describe them to blind visitors." },
  'svg-img-alt': { family: 'alt', title: () => 'Some graphics are missing descriptions', body: "Screen readers can't describe them to blind visitors." },
  'link-name': {
    family: 'names',
    title: () => 'Some links have no readable name',
    body: 'Screen reader users just hear "link" with no idea where it goes.',
  },
  'button-name': {
    family: 'names',
    title: () => 'Some buttons have no readable name',
    body: "Screen reader users can't tell what these buttons do.",
  },
  'label': {
    family: 'forms',
    title: () => 'Form fields are missing labels',
    body: "People using screen readers can't tell what to type into some fields, which can cost you inquiries.",
  },
  'select-name': { family: 'forms', title: () => 'Dropdown menus are missing labels', body: "People using screen readers can't tell what these menus are for." },
  'label-content-name-mismatch': { family: 'forms', title: () => "Some labels don't match what's on screen", body: 'Voice control users may not be able to activate these buttons by saying what they see.' },
  'document-title': {
    family: 'title',
    title: () => 'The page has no title',
    body: 'The title shows in browser tabs and Google results. Without one, the page looks unfinished.',
  },
  'html-has-lang': {
    family: 'lang',
    title: () => "The page doesn't say what language it's in",
    body: 'Screen readers may read it with the wrong pronunciation.',
  },
  'html-lang-valid': { family: 'lang', title: () => 'The page\'s language setting is wrong', body: 'Screen readers may read it with the wrong pronunciation.' },
  'meta-viewport': {
    family: 'zoom',
    title: () => "Visitors can't zoom in",
    body: 'Blocking zoom makes the site hard to use for people with low vision.',
  },
  'target-size': {
    family: 'targets',
    title: () => 'Some buttons and links are too small to tap',
    body: 'Small or crowded tap targets cause mis-taps on phones.',
  },
  'heading-order': {
    family: 'headings',
    title: () => 'Headings are out of order',
    body: 'Screen reader users jump between headings to find things, and skipped levels make the page confusing.',
  },
  'link-in-text-block': { family: 'links', title: () => 'Links blend in with the text', body: "Links that are only a different color are easy to miss." },
  'frame-title': { family: 'frames', title: () => 'Embedded content has no title', body: "Screen readers can't say what an embedded map, video, or form is." },
  'video-caption': { family: 'captions', title: () => 'Videos have no captions', body: "Visitors who are deaf, or watching with the sound off, can't follow along." },
  'list': { family: 'structure', title: () => 'Lists are coded incorrectly', body: "Screen readers may not announce lists properly." },
  'listitem': { family: 'structure', title: () => 'Lists are coded incorrectly', body: "Screen readers may not announce lists properly." },
  'tabindex': { family: 'keyboard', title: () => 'The keyboard order is out of whack', body: 'People who use a keyboard instead of a mouse jump around the page in a confusing order.' },
  'bypass': { family: 'keyboard', title: () => "There's no shortcut past the menu", body: 'Keyboard users have to tab through the whole menu on every page.' },
  'aria-allowed-attr': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },
  'aria-required-attr': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },
  'aria-valid-attr': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },
  'aria-valid-attr-value': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },
  'aria-hidden-focus': { family: 'aria', title: () => 'Hidden items can still be reached by keyboard', body: 'Keyboard users can land on things that screen readers are told to ignore.' },
  'aria-required-children': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },
  'aria-required-parent': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },
  'aria-roles': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },
  'duplicate-id-aria': { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' },

  // ── Search ──
  'meta-description': {
    family: 'description',
    title: () => 'No description for search results',
    body: 'Google may show random text from the page instead of a clear summary of your business.',
  },
  'http-status-code': { family: 'status', title: () => 'The page reports an error code', body: 'Search engines may skip a page that says it has an error.' },
  'link-text': { family: 'linktext', title: () => 'Some links just say "click here"', body: 'Clear link text helps both visitors and search engines know where a link goes.' },
  'crawlable-anchors': { family: 'crawl', title: () => "Search engines can't follow some links", body: "Google can't reach the pages behind these links." },
  'is-crawlable': {
    family: 'crawl',
    title: () => 'Search engines are blocked from this page',
    body: "A setting tells Google not to list this page. If that's not on purpose, it's costing you visitors.",
  },
  'robots-txt': { family: 'crawl', title: () => 'The robots.txt file has errors', body: 'This file tells search engines what to look at, and errors in it can hide your pages.' },
  'canonical': { family: 'canonical', title: () => 'Search engines may be confused about the main version of this page', body: 'Mixed signals can split your search ranking between copies of the same page.' },
  'hreflang': { family: 'canonical', title: () => 'Language versions of the page are set up wrong', body: 'Search engines may show visitors the wrong language version.' },

  // ── Best practices ──
  'is-on-https': {
    family: 'https',
    title: () => "The site isn't fully secure",
    body: 'Some parts load without HTTPS. Browsers warn visitors about that, and some content may be blocked.',
  },
  'redirects-http': { family: 'https', title: () => "Visitors aren't sent to the secure version", body: 'People who type your address may land on the insecure version of the site.' },
  'errors-in-console': {
    family: 'errors',
    title: () => 'The page has behind-the-scenes errors',
    body: 'Code errors show up while the page loads. They may be harmless, or something may be quietly broken, like a form or a tracker.',
  },
  'image-aspect-ratio': { family: 'imgshape', title: () => 'Some images look stretched', body: "They're shown at a different shape than they really are." },
  'image-size-responsive': { family: 'imgshape', title: () => 'Some images look blurry on phones', body: "They're smaller than the space they fill on sharp phone screens." },
  'deprecations': { family: 'outdated', title: () => 'The site uses outdated browser features', body: 'Some code relies on features browsers are phasing out, so it may break in a future update.' },
  'third-party-cookies': { family: 'cookies', title: () => 'The site relies on third-party cookies', body: 'Browsers are restricting these, which can break embedded tools or tracking.' },
  'paste-preventing-inputs': { family: 'paste', title: () => 'Some fields block pasting', body: 'That makes it harder to use password managers and fill out forms.' },
  'geolocation-on-start': { family: 'permissions', title: () => 'The site asks for location right away', body: 'Permission pop-ups on arrival annoy visitors and usually get denied.' },
  'notification-on-start': { family: 'permissions', title: () => 'The site asks to send notifications right away', body: 'Permission pop-ups on arrival annoy visitors and usually get denied.' },
  'doctype': { family: 'basics', title: () => 'The page is missing basic setup code', body: 'Without it, the page can display oddly in some browsers.' },
  'charset': { family: 'basics', title: () => 'The page is missing basic setup code', body: 'Without it, some characters can show up as gibberish.' },
};

const SKIP_MODES = new Set(['notApplicable', 'manual', 'informative', 'error']);

// Rough "points this costs you", comparable across categories.
function impact(audit, ref, category, categoryWeight) {
  if (category === 'performance') {
    if (ref.weight > 0) return ref.weight * (1 - audit.score);
    const s = audit.metricSavings || {};
    const bytes = audit.details?.overallSavingsBytes || 0;
    return (s.LCP || 0) / 1000 * 6 + (s.FCP || 0) / 1000 * 2 + (s.TBT || 0) / 100 * 3 + (s.CLS || 0) * 60 + (bytes / 1048576) * 4;
  }
  return categoryWeight ? (ref.weight / categoryWeight) * 100 * (1 - audit.score) : 0;
}

const text = (v, a) => (typeof v === 'function' ? v(a) : v);
const stripMarkdown = (s) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '');

export function topIssues(lh, limit = 3) {
  const seen = new Set();
  const candidates = [];
  for (const [category, cat] of Object.entries(lh.categories)) {
    const total = cat.auditRefs.reduce((n, r) => n + (r.weight || 0), 0);
    for (const ref of cat.auditRefs) {
      const a = lh.audits[ref.id];
      if (!a || a.score == null || a.score >= 0.9 || SKIP_MODES.has(a.scoreDisplayMode)) continue;
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      const points = impact(a, ref, category, total);
      if (points < 0.5) continue;
      candidates.push({ a, category, points, entry: ENTRIES[ref.id] });
    }
  }
  candidates.sort((x, y) => (!!y.entry - !!x.entry) || y.points - x.points);

  const families = new Set();
  const out = [];
  for (const c of candidates) {
    if (out.length >= limit) break;
    const family = c.entry?.family || c.a.id;
    if (families.has(family)) continue;
    families.add(family);
    out.push({
      id: c.a.id,
      category: c.category,
      title: c.entry ? text(c.entry.title, c.a) : stripMarkdown(c.a.title),
      body: c.entry ? text(c.entry.body, c.a) : 'Google flagged this as something worth fixing.',
    });
  }
  return out;
}

// ── Accessibility report ─────────────────────
// Every failing automated accessibility check from the same PageSpeed result,
// in plain English and grouped by issue (checks that read the same are one
// issue). These extra entries only cover checks that rarely make the top three,
// so they're kept apart and never change topIssues().
const ARIA_WRONG = { family: 'aria', title: () => 'Some screen reader code is set up wrong', body: 'Code meant to help screen readers has errors, which can make parts of the page confusing or unusable.' };
const ARIA_NAMELESS = { family: 'aria-names', title: () => 'Some interactive parts have no readable name', body: "Screen reader users hear what kind of control it is, but not what it's for." };
const TABLES = { family: 'tables', title: () => 'Tables are hard to follow with a screen reader', body: "Headers and cells aren't connected, so screen reader users can't tell which column or row a value belongs to." };
const MORE_A11Y = {
  'accesskeys': { family: 'keyboard', title: () => 'Keyboard shortcuts clash', body: 'Some shortcut keys are used twice, so pressing them may do the wrong thing.' },
  'aria-allowed-role': ARIA_WRONG,
  'aria-conditional-attr': ARIA_WRONG,
  'aria-deprecated-role': ARIA_WRONG,
  'aria-prohibited-attr': ARIA_WRONG,
  'aria-text': ARIA_WRONG,
  'aria-command-name': ARIA_NAMELESS,
  'aria-dialog-name': ARIA_NAMELESS,
  'aria-meter-name': ARIA_NAMELESS,
  'aria-progressbar-name': ARIA_NAMELESS,
  'aria-tooltip-name': ARIA_NAMELESS,
  'aria-treeitem-name': ARIA_NAMELESS,
  'input-button-name': { family: 'names', title: () => 'Some buttons have no readable name', body: "Screen reader users can't tell what these buttons do." },
  'aria-input-field-name': { family: 'forms', title: () => 'Form fields are missing labels', body: "People using screen readers can't tell what to type into some fields, which can cost you inquiries." },
  'aria-toggle-field-name': { family: 'forms', title: () => 'Some switches and checkboxes are missing labels', body: "Screen reader users can't tell what they turn on or off." },
  'form-field-multiple-labels': { family: 'forms', title: () => 'Some form fields have more than one label', body: 'Screen readers may read the wrong label, or only one of them.' },
  'aria-hidden-body': { family: 'hidden-page', title: () => 'The whole page is hidden from screen readers', body: 'A setting on the page tells screen readers to skip everything, so blind visitors get nothing.' },
  'skip-link': { family: 'keyboard', title: () => "The skip link doesn't work", body: "Keyboard users press it to jump past the menu, but it doesn't go anywhere." },
  'definition-list': { family: 'structure', title: () => 'Lists are coded incorrectly', body: 'Screen readers may not announce lists properly.' },
  'dlitem': { family: 'structure', title: () => 'Lists are coded incorrectly', body: 'Screen readers may not announce lists properly.' },
  'empty-heading': { family: 'headings', title: () => 'Some headings are empty', body: 'Screen reader users jumping between headings land on blank ones.' },
  'html-xml-lang-mismatch': { family: 'lang', title: () => "The page's language setting is wrong", body: 'Screen readers may read it with the wrong pronunciation.' },
  'valid-lang': { family: 'lang', title: () => 'Some text is marked with the wrong language', body: 'Screen readers may read those parts with the wrong pronunciation.' },
  'identical-links-same-purpose': { family: 'links', title: () => 'Links with the same words go to different places', body: 'Visitors expect links that read the same to lead to the same page.' },
  'image-redundant-alt': { family: 'alt-repeat', title: () => 'Some image descriptions repeat nearby text', body: 'Screen reader users hear the same words twice.' },
  'object-alt': { family: 'alt', title: () => 'Embedded items are missing descriptions', body: "Screen readers can't say what these embedded items are." },
  'landmark-one-main': { family: 'landmarks', title: () => "The page's main area isn't marked", body: 'Screen reader users use it to jump straight to the content.' },
  'meta-refresh': { family: 'refresh', title: () => 'The page reloads or moves on by itself', body: 'Pages that change on a timer can interrupt people who read or type slowly.' },
  'table-duplicate-name': TABLES,
  'table-fake-caption': TABLES,
  'td-has-header': TABLES,
  'td-headers-attr': TABLES,
  'th-has-data-cells': TABLES,
};

// A short, readable example of where a problem is ("Book now", not markup).
const TAGS = /^(a|abbr|article|aside|b|body|button|div|em|footer|form|h[1-6]|header|html|i|iframe|img|input|label|li|main|nav|ol|p|section|select|span|strong|svg|table|td|th|textarea|ul|video)$/i;
const exampleOf = (item) => {
  const label = String(item?.node?.nodeLabel || '').replace(/\s+/g, ' ').trim();
  // Skip markup and CSS selectors ("td > img", "a#home"): they mean nothing to an owner.
  if (label.length < 2 || TAGS.test(label) || /^[<{]/.test(label) || /s>s/.test(label) || /^[a-z][w-]*([#.][w-]+)+$/i.test(label)) return null;
  return label.length > 42 ? `${label.slice(0, 40).trim()}…` : label;
};

// Checks about the page as a whole, where "found in 1 place" would be odd.
const WHOLE_PAGE = new Set(['html-has-lang', 'html-lang-valid', 'html-xml-lang-mismatch', 'document-title', 'meta-viewport', 'meta-refresh', 'bypass', 'landmark-one-main', 'aria-hidden-body', 'skip-link']);

export function a11yReport(lh) {
  const cat = lh.categories?.accessibility;
  if (!cat) return null;
  let passed = 0;
  let total = 0;
  const groups = new Map();
  for (const ref of cat.auditRefs) {
    const a = lh.audits[ref.id];
    if (!a || a.scoreDisplayMode !== 'binary' || a.score == null) continue;
    total++;
    if (a.score >= 1) {
      passed++;
      continue;
    }
    const entry = ENTRIES[ref.id] || MORE_A11Y[ref.id];
    const title = entry ? text(entry.title, a) : stripMarkdown(a.title);
    const items = a.details?.items || [];
    const g = groups.get(title) || { title, body: entry ? text(entry.body, a) : 'Google flagged this as something worth fixing.', count: 0, examples: [], weight: 0, page: false };
    g.weight += ref.weight || 0;
    if (items.length && !WHOLE_PAGE.has(ref.id)) g.count += items.length;
    else g.page = true;
    for (const item of items) {
      const ex = exampleOf(item);
      if (ex && g.examples.length < 2 && !g.examples.includes(ex)) g.examples.push(ex);
    }
    groups.set(title, g);
  }
  return {
    passed,
    total,
    groups: [...groups.values()].sort((x, y) => y.weight - x.weight || y.count - x.count),
  };
}

export function band(score) {
  if (score >= 90) return { key: 'good', label: 'Good' };
  if (score >= 50) return { key: 'okay', label: 'Needs work' };
  return { key: 'poor', label: 'Poor' };
}

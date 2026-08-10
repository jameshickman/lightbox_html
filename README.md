# Lightbox Grid

A dependency-free, vanilla-JavaScript widget that renders a list of image +
linked-text items as a **carousel**, a **masonry grid**, or a **justified rows
grid**, and opens each linked page in a **lightbox overlay** that shows only the
page's main content.

- **No dependencies, no build step** — one JS file and one CSS file.
- **Broad browser support** — ES5-style code, no `<dialog>`, feature-detected.
- **Progressive enhancement** — enhances plain, valid list markup; links still
  work with JavaScript disabled.
- **Three views** — carousel (arrows, dots, keyboard, touch-swipe, pausable
  autoplay), a masonry grid (uniform columns), and a justified "rows" grid
  (full-width rows, photo-platform style), with an optional toggle between them.
- **Same-origin lightbox** — loads the target page in an iframe and hides its
  nav/header/footer, keeping only the semantic content region.
- **Mobile-aware** — on narrow screens, links navigate directly instead of
  opening the modal, and the view defaults to the carousel (masonry tiles are
  awkward on phones); both are configurable.
- **Back-button friendly** — opening the lightbox pushes a history entry, so the
  browser/hardware Back button closes it.
- **Themeable** — BEM classes driven by CSS custom properties, shipped as two
  self-contained builds: `lightbox-grid-dark.css` and `lightbox-grid-light.css`.
  A deployment links exactly one.

## Quick start

1. Add the stylesheet and script:

   ```html
   <!-- Pick ONE theme build: -dark or -light -->
   <link rel="stylesheet" href="src/lightbox-grid-dark.css">
   <script src="src/lightbox-grid.js" defer></script>
   ```

2. Mark up your items as a nested list flagged with `rel="lightbox-grid"`:

   ```html
   <ul rel="lightbox-grid" data-mode="carousel" data-timer="5000">
     <li><ul>
       <li><img src="images/a.jpg" width="400" height="300" alt="Aurora"></li>
       <li><a href="/pages/aurora.html">Aurora</a></li>
     </ul></li>
     <li><ul>
       <li><img src="images/b.jpg" width="400" height="520" alt="Coral"></li>
       <li><a href="/pages/coral.html">Coral</a></li>
     </ul></li>
   </ul>
   ```

   Or express the same structure with `<div>`s — `rel` is not valid on a
   `<div>`, so flag those with `data-rel` instead:

   ```html
   <div data-rel="lightbox-grid" data-mode="carousel" data-timer="5000">
     <div><div>
       <div><img src="images/a.jpg" width="400" height="300" alt="Aurora"></div>
       <div><a href="/pages/aurora.html">Aurora</a></div>
     </div></div>
   </div>
   ```

   Or, for generated pages, put the items in a JSON comment that is the
   container's only content:

   ```html
   <div data-rel="lightbox-grid" data-mode="masonry">
     <!-- [
       {"src": "images/a.jpg", "width": 400, "height": 300, "alt": "Aurora",
        "href": "/pages/aurora.html", "label": "Aurora",
        "title": "Aurora", "description": "Three nights above the tree line."}
     ] -->
   </div>
   ```

The script auto-initializes on `DOMContentLoaded`. Open `index.html` for a live
demo, or see the non-technical setup guide in
[`Lightbox-Grid-Setup-Guide.docx`](Lightbox-Grid-Setup-Guide.docx) /
[`.pdf`](Lightbox-Grid-Setup-Guide.pdf).

## Markup contract

- The **container** — a `<ul>`, `<ol>`, or `<div>` — carries the
  `lightbox-grid` token in `rel` or `data-rel` (matched space-token aware, so
  other tokens may coexist).
- Each **direct child** of the container (`<li>` or `<div>`) is one item
  containing an **inner group** with:
  - one cell holding an `<img>`,
  - optionally, one cell holding a plain-text **title**,
  - one cell holding an `<a href>` with the item's caption, and
  - optionally, one cell holding a **description** (a muted second line).
- Cells are matched **by position, not by tag**, so list and div markup work
  the same way and can be mixed. The inner group may also be dropped, putting
  the image, title and link directly inside the item.

### JSON in a comment

A flagged container whose **only** content is an HTML comment reads that
comment as JSON — either a bare array of items or `{"items": [...]}`. Per item:
`src` and `href` are required; `width`/`height` (or `w`/`h`), `alt`, `label`,
`title` and `description` (or `desc`) are optional and mean the same as their
markup counterparts. Entries missing `src` or `href` are skipped with a console
warning.

This form exists for generated pages. It has **no no-JS fallback** — a comment
renders nothing — so prefer the markup forms where you can use them.
- **Images must specify `width` and `height`** (intrinsic pixel size) so the
  grid layouts (masonry and rows) are stable before images load. Include
  meaningful `alt` text.

## Configuration

Set these as attributes on the container:

| Attribute                | Purpose                                                        | Default            |
| ------------------------ | -------------------------------------------------------------- | ------------------ |
| `rel` / `data-rel`       | Activation flag (token `lightbox-grid`)                        | required           |
| `data-mode`              | Initial view: `carousel`, `masonry`, or `rows`                 | `carousel`         |
| `data-timer`             | Carousel autoplay interval in milliseconds                     | autoplay **off**   |
| `data-toggle`            | `off` / `disabled` / `false` / `none` hides the mode toggle    | toggle **enabled** |
| `data-mobile-breakpoint` | Viewport width (px) at/below which links navigate directly     | `640`              |
| `data-mobile-mode`       | Initial view on mobile: `carousel`, `masonry`, or `rows`       | `carousel`         |

- **`data-timer`** — autoplay runs only when a positive value is present.
  Autoplay pauses on hover/focus, stops on manual navigation, and is suppressed
  when `prefers-reduced-motion` is set.
- **`data-toggle="off"`** — locks the widget to `data-mode` and renders no toggle.
- **`data-mobile-breakpoint`** — evaluated at click time, so resizing or rotating
  switches behavior without a reload.

## Views

### Carousel
One slide at a time with previous/next arrows, dot indicators, arrow-key
navigation, touch-swipe (drag-to-follow with snap), and wrap-around. Optional
autoplay via `data-timer`.

### Masonry
Uniform-width columns: each new item drops into the currently shortest column so
the stacks stay balanced, with media heights taken from each image's intrinsic
aspect ratio. Responsive — the column count adapts to available width, and the
layout recomputes on resize.

### Rows (justified)
A "justified" or "expanding rows" grid, photo-platform style. Items are packed
left-to-right into full-width rows; each image keeps its aspect ratio, so wider
images claim more horizontal space and the **number of columns per row varies**
with the images' shapes. Every complete row is scaled so its images share one
height and the row exactly fills the container width. A short final row is
left-aligned (capped so a lone image doesn't over-enlarge). The target row height
is themeable via `--lbg-row-height` (default `240px`); the layout recomputes on
resize.

## Lightbox

Activating an item's link (on non-mobile viewports) opens a lightbox overlay
that loads the target page in an `<iframe>` and injects CSS to:

- **hide** `<nav>`, `<header>`, `<footer>` and their ARIA equivalents
  (`[role="navigation"]`, `[role="banner"]`, `[role="contentinfo"]`), and
- **keep** `<main>`, `<article>`, and `[role="main"]`.

Close via the × button, `Esc`, backdrop click, or the browser/hardware Back
button. Focus is trapped while open and restored on close, and background scroll
is locked.

> **Same-origin only.** CSS injection into the iframe requires the target page to
> be on the same origin. Cross-origin targets still load but cannot be trimmed;
> supporting them is out of scope.

### Mobile behavior
On viewports at or below `data-mobile-breakpoint` (default `640px`), item links
**navigate directly** instead of opening the modal — a better fit for phones
(native back button, scroll, and pinch-zoom). Modifier-clicks and middle-clicks
(open in new tab/window) are never intercepted on any viewport.

Mobile also **defaults to the carousel view** (a full masonry grid is awkward on
phones), overridable with `data-mobile-mode="masonry"`, and **hides the mode
toggle** (the view is locked to the carousel there). The active view recomputes
as the viewport crosses the breakpoint — until the visitor picks one with the
toggle, after which their choice is respected.

## Theming

The widget ships as **two self-contained stylesheet builds** — pick one per
deployment; do not link both:

| Build                     | Look                                                    |
| ------------------------- | ------------------------------------------------------- |
| `src/lightbox-grid-dark.css`  | Dark theme (blue accent). The default.              |
| `src/lightbox-grid-light.css` | Light theme (orange `#e48521` navigation accent).   |

Each file bundles the complete widget structure plus one palette baked into the
`.lbg` custom-property tokens at the top of the file. Styles use BEM class names
under the `lbg` block, so you can restyle without touching the JS — edit the
tokens in whichever build you ship:

```css
/* Token block at the top of each build — colours differ, structure is shared. */
.lbg {
  --lbg-bg: #14161a;          /* light build: #f5f6f8 */
  --lbg-surface: #1e2228;     /* light build: #ffffff */
  --lbg-text: #e8eaed;        /* light build: #1b1f24 */
  --lbg-accent: #6ea8fe;      /* light build: #e48521  (nav highlights) */
  --lbg-gap: 16px;
  --lbg-radius: 10px;
  --lbg-row-height: 240px;    /* target row height for the "rows" grid */
  --lbg-carousel-height: 420px;
  /* …see the top of each build for the full token list… */
}
```

**Roll your own theme:** copy either build, swap the token block at the top, and
link your file instead. The structure below the token block is identical between
the two builds, so keep it in sync if you edit it.

> The demo page (`index.html`) previews both builds with a Light/Dark button that
> simply swaps the linked stylesheet's `href` — mirroring the "ship one build"
> model rather than shipping both.

## JavaScript API

The script auto-initializes, and also exposes `window.LightboxGrid`:

| Member                       | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| `LightboxGrid.init(root?)`   | Enhance not-yet-enhanced flagged lists within `root` (default `document`); returns the instance list. Useful after injecting markup dynamically. |
| `LightboxGrid.instances`     | Live widget instances.                                          |
| `LightboxGrid.Lightbox`      | The shared lightbox singleton (`open(href)` / `close()`).       |
| `LightboxGrid.REL_TOKEN`     | The activation token (`"lightbox-grid"`).                       |

## Project structure

```
.
├── src/
│   ├── lightbox-grid.js         # the widget (vanilla, ES5-style, no deps)
│   ├── lightbox-grid-dark.css   # dark theme build (link one build per site)
│   └── lightbox-grid-light.css  # light theme build (orange nav accent)
├── index.html               # demo page (four configurations + light/dark toggle)
├── test.html                # in-browser assertion harness
├── images/                  # self-contained SVG placeholders
├── pages/                   # same-origin content pages loaded by the lightbox
├── tests/                   # Playwright end-to-end tests
├── playwright.config.js
├── SPECIFICATION.md         # full specification and design notes
└── Lightbox-Grid-Setup-Guide.docx / .pdf   # non-technical setup guide
```

## Development & testing

```bash
npm install                              # install the Playwright test runner
npx playwright install chromium firefox  # one-time browser download
npm test                                 # run the end-to-end suite (Chromium + Firefox)
npm run serve                            # serve locally at http://localhost:8137
```

Tests cover initialization, carousel navigation, three-way mode switching,
masonry and justified-rows layout (including full-width row fill), the light/dark
stylesheet swap (and the light build's orange accent), the lightbox (open/close
via ×/Esc/backdrop, content stripping, back-button and reopen paths), and mobile
direct-navigation. `test.html` runs the same assertions live in the browser. Port
`8137` is used because `8080` is commonly occupied.

## License

[MIT](LICENSE) © 2026 James Hickman

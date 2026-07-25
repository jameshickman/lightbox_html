# Lightbox Grid

A dependency-free, vanilla-JavaScript widget that renders a list of image +
linked-text items as a **carousel** or a **masonry grid**, and opens each linked
page in a **lightbox overlay** that shows only the page's main content.

- **No dependencies, no build step** — one JS file and one CSS file.
- **Broad browser support** — ES5-style code, no `<dialog>`, feature-detected.
- **Progressive enhancement** — enhances plain, valid list markup; links still
  work with JavaScript disabled.
- **Two views** — carousel (arrows, dots, keyboard, pausable autoplay) and a
  best-fit masonry grid, with an optional toggle between them.
- **Same-origin lightbox** — loads the target page in an iframe and hides its
  nav/header/footer, keeping only the semantic content region.
- **Mobile-aware** — on narrow screens, links navigate directly instead of
  opening the modal.
- **Back-button friendly** — opening the lightbox pushes a history entry, so the
  browser/hardware Back button closes it.
- **Themeable** — BEM classes driven by CSS custom properties; dark theme by
  default.

## Quick start

1. Add the stylesheet and script:

   ```html
   <link rel="stylesheet" href="src/lightbox-grid.css">
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

The script auto-initializes on `DOMContentLoaded`. Open `index.html` for a live
demo, or see the non-technical setup guide in
[`Lightbox-Grid-Setup-Guide.docx`](Lightbox-Grid-Setup-Guide.docx) /
[`.pdf`](Lightbox-Grid-Setup-Guide.pdf).

## Markup contract

- The **outer `<ul>`** carries the `rel` token `lightbox-grid` (matched
  space-token aware, so other `rel` tokens may coexist).
- Each **outer `<li>`** is one item containing an **inner `<ul>`** with:
  - one `<li>` holding an `<img>`, and
  - one `<li>` holding an `<a href>` with the item's caption.
- **Images must specify `width` and `height`** (intrinsic pixel size) so the
  masonry layout is stable before images load. Include meaningful `alt` text.

## Configuration

Set these as attributes on the outer `<ul>`:

| Attribute                | Purpose                                                        | Default            |
| ------------------------ | -------------------------------------------------------------- | ------------------ |
| `rel`                    | Activation flag (token `lightbox-grid`)                        | required           |
| `data-mode`              | Initial view: `carousel` or `masonry`                          | `carousel`         |
| `data-timer`             | Carousel autoplay interval in milliseconds                     | autoplay **off**   |
| `data-toggle`            | `off` / `disabled` / `false` / `none` hides the mode toggle    | toggle **enabled** |
| `data-mobile-breakpoint` | Viewport width (px) at/below which links navigate directly     | `640`              |

- **`data-timer`** — autoplay runs only when a positive value is present.
  Autoplay pauses on hover/focus, stops on manual navigation, and is suppressed
  when `prefers-reduced-motion` is set.
- **`data-toggle="off"`** — locks the widget to `data-mode` and renders no toggle.
- **`data-mobile-breakpoint`** — evaluated at click time, so resizing or rotating
  switches behavior without a reload.

## Views

### Carousel
One slide at a time with previous/next arrows, dot indicators, arrow-key
navigation, and wrap-around. Optional autoplay via `data-timer`.

### Masonry
Best-fit columns computed from each image's intrinsic aspect ratio (items are
placed into the currently shortest column). Responsive: the column count adapts
to available width, and the layout recomputes on resize.

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

## Theming

Styles use BEM class names under the `lbg` block and are driven by CSS custom
properties, so you can restyle without touching the JS. The default theme is
dark; a `.lbg--light` modifier is included as an example.

```css
.lbg {
  --lbg-bg: #14161a;
  --lbg-surface: #1e2228;
  --lbg-text: #e8eaed;
  --lbg-accent: #6ea8fe;
  --lbg-gap: 16px;
  --lbg-radius: 10px;
  --lbg-carousel-height: 420px;
  /* …see src/lightbox-grid.css for the full list… */
}
```

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
│   ├── lightbox-grid.js     # the widget (vanilla, ES5-style, no deps)
│   └── lightbox-grid.css    # BEM + CSS custom properties, dark theme default
├── index.html               # demo page (three configurations)
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

Tests cover initialization, carousel navigation, mode switching, masonry layout,
the lightbox (open/close via ×/Esc/backdrop, content stripping, back-button and
reopen paths), and mobile direct-navigation. `test.html` runs the same
assertions live in the browser. Port `8137` is used because `8080` is commonly
occupied.

## License

[MIT](LICENSE) © 2026 James Hickman

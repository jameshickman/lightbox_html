# Specification for Carousel/Masonry Grid Lightbox Widget

A pure front-end JavaScript widget that renders a list of image + linked-text
items as either a **carousel** or a **masonry grid**, and opens each linked
page inside a **lightbox overlay** showing only that page's main content.

> **Status: implemented.** The widget lives in `src/lightbox-grid.js` and
> `src/lightbox-grid.css`. A demo (`index.html`) and an in-browser test harness
> (`test.html`) sit in the project root, with same-origin content pages under
> `pages/` and placeholder images under `images/`. Automated end-to-end tests
> run under Playwright (`npm test`, Chromium + Firefox). See
> [Repository Layout](#repository-layout) and [Running](#running--testing).

## Constraints

- **Pure vanilla JavaScript, no external dependencies** (no frameworks, no build step required).
- **Broad browser support**, including older browsers:
  - Avoid the `<dialog>` element; build the overlay from plain elements.
  - Prefer widely-supported CSS/JS; use polyfill-friendly, defensive patterns.
  - Feature-detect rather than assume modern APIs.
- Ships as two files: one JS file and one **separate CSS file**.

## Source Markup Contract

The widget scans the document for flagged containers — an outer list
(`<ul>`/`<ol>`) or a `<div>` — and manages each one. A container describes its
items in one of three interchangeable forms: [nested lists](#source-markup-contract)
(below), [nested divs](#div-markup), or [JSON in a comment](#json-in-a-comment).
Expected structure:

```html
<ul rel="lightbox-grid" data-mode="carousel" data-timer="5000">
  <li>
    <ul>
      <li><img src="a.jpg" width="400" height="300" alt="Description A"></li>
      <li>Optional Title A</li>
      <li><a href="/page-a">Link text A</a></li>
    </ul>
  </li>
  <li>
    <ul>
      <li><img src="b.jpg" width="400" height="500" alt="Description B"></li>
      <li><a href="/page-b">Link text B</a></li>
    </ul>
  </li>
  <!-- ... more items ... -->
</ul>
```

### Div markup

The identical structure may be expressed with `<div>`s, which some CMSes and
page builders emit more naturally than nested lists:

```html
<div data-rel="lightbox-grid" data-mode="carousel" data-timer="5000">
  <div>
    <div>
      <div><img src="a.jpg" width="400" height="300" alt="Description A"></div>
      <div>Optional Title A</div>
      <div><a href="/page-a">Link text A</a></div>
      <div>Optional description A</div>
    </div>
  </div>
  <!-- ... more items ... -->
</div>
```

Both styles are supported, may be mixed within one container, and behave
identically thereafter. `rel` is not a conformant attribute on a `<div>`, so
div containers may carry **`data-rel="lightbox-grid"`** instead; the widget
reads either attribute.

Rules:

- The **container** carries the `lightbox-grid` token in `rel` (or `data-rel`),
  used only as the activation flag. Matching is space-token aware
  (`rel~="lightbox-grid"`), so additional tokens may coexist.
- Each direct child element of the container (an `<li>` or a `<div>`) is one
  **item**, and contains an **inner group** with, in order:
  - one cell holding an `<img>`,
  - **optionally**, one cell holding a **title** (plain text or inline markup,
    with no `<a href>`),
  - one cell holding an `<a href>` with the item's text label, and
  - **optionally**, one cell holding a **description**.
- Parsing is **structural, not tag-driven**: cells are matched by position
  within their group, so the wrapper tags may be `<li>`, `<div>`, or anything
  else. The inner group may also be omitted entirely, placing the image, title
  and link directly inside the item.
- An item that contains no `<img>` or no `<a href>` is skipped.
- The **title cell is optional and identified by position/content**: it is the
  cell that sits **between the image cell and the link cell** and does
  **not** contain an `<a href>`. When present it renders as a bold lead before
  the link label; when absent the caption is just the label. Items within the
  same grid may freely mix titled and untitled entries.
- The **description cell is optional** and follows the same positional rule
  from the other side: the first cell **after** the image and link cells that
  holds text and no `<a href>`. It renders as a muted second line beneath the
  caption.
- **Images MUST specify `width` and `height`** (intrinsic pixel dimensions) so
  the masonry layout can compute aspect ratios without waiting for image load.
  Images should also carry meaningful `alt` text.
- If the widget's JS does not run (no-JS / progressive enhancement), the raw
  source markup remains readable and the links work as normal navigation.

### JSON in a comment

For generated pages where emitting markup is impractical, a flagged container
whose **only content is a single HTML comment** carries its items as JSON
inside that comment:

```html
<div data-rel="lightbox-grid" data-mode="masonry">
  <!-- [
    {"src": "a.jpg", "width": 400, "height": 300, "alt": "Description A",
     "href": "/page-a", "label": "Link text A",
     "title": "Optional Title A", "description": "Optional description A"}
  ] -->
</div>
```

- The comment may hold either a **bare array** of items or an **object with an
  `items` array** (`{"items": [...]}`); nothing else is read from it.
- Per-item fields:

  | Field         | Purpose                                       | Required |
  | ------------- | --------------------------------------------- | -------- |
  | `src`         | Image URL                                     | yes      |
  | `href`        | Target page opened in the lightbox            | yes      |
  | `width`/`w`   | Intrinsic image width in px                   | strongly recommended |
  | `height`/`h`  | Intrinsic image height in px                  | strongly recommended |
  | `alt`         | Image alt text                                | recommended |
  | `label`       | Link text shown in the caption                | optional |
  | `title`       | Optional bold lead before the label           | optional |
  | `description` / `desc` | Optional muted second line          | optional |

- `title` and `description` mean exactly what they do in the markup forms, so
  the three source styles describe the same item model.
- Entries missing `src` or `href` are **skipped** with a `console.warn`;
  unparseable JSON yields no items and one warning, leaving the page intact.
- Omitted `width`/`height` fall back to `1`, which makes the aspect-ratio-driven
  grids square that tile — supply real dimensions.
- The container is **detected by shape**: a comment sitting alongside real
  items is ignored, and markup always wins.
- Because a comment renders nothing, this form has **no no-JS fallback** — the
  gallery simply does not appear when scripting is off. Prefer one of the
  markup forms unless generation constraints rule them out.
- JSON in an HTML comment must not contain the sequence `-->`; `--` anywhere
  in the comment is also invalid HTML.

## Configuration (data-attributes on the container)

| Attribute               | Purpose                                                        | Default            |
| ----------------------- | -------------------------------------------------------------- | ------------------ |
| `rel` / `data-rel`      | Activation flag (token `lightbox-grid`)                        | required           |
| `data-mode`             | Initial display mode: `carousel` or `masonry`                  | `carousel`         |
| `data-timer`            | Carousel autoplay interval in milliseconds                     | autoplay **off**   |
| `data-toggle`           | `off` / `disabled` / `false` / `none` hides the mode-toggle UI | toggle **enabled** |
| `data-mobile-breakpoint`| Viewport width (px) at/below which links navigate directly     | `640`              |
| `data-mobile-mode`      | Initial view on mobile: `carousel` or `masonry`                | `carousel`         |

- **`data-timer`**: autoplay is enabled **only** when a positive `data-timer` is
  present. When the attribute is absent (or non-positive), the carousel does not
  autoplay and is arrows/dots/keyboard only.
- **`data-toggle`**: when disabled, the widget is locked to `data-mode` and no
  toggle control is rendered.
- **`data-mobile-breakpoint`**: controls the [mobile behavior](#mobile-behavior)
  threshold. Evaluated at click time, so resize / orientation changes are
  handled without reload.
- **`data-mobile-mode`**: the initial view when the viewport is mobile-sized.
  Defaults to `carousel` because a full masonry grid is awkward on phones; set it
  to `masonry` to override. On desktop, `data-mode` is used instead. The active
  view recomputes on resize until the visitor picks one with the toggle.

## Display Modes

The active mode is chosen by the `data-mode` attribute **and** can be switched at
runtime via a **toggle UI element** the widget renders.

- **Default mode: Carousel.**
- A visible toggle control lets the user switch between carousel and masonry.
- `data-mode` sets the initial mode; the toggle overrides it thereafter.
- The toggle can be suppressed with `data-toggle="off"`, locking the widget to
  `data-mode` (see the configuration table above).

### Carousel

- Each item (image, optional title, and link) is rendered as a carousel slide.
- **Navigation arrows** (previous / next) and **dot indicators** are always
  available; slides wrap around at both ends.
- **Autoplay:** when `data-timer` is a positive number, slides advance
  automatically every `data-timer` milliseconds.
  - Autoplay **pauses on hover and on keyboard focus** within the carousel.
  - Autoplay **stops when the user manually navigates** (arrow / dot / arrow key)
    for the remainder of the session.
  - Autoplay is **off by default** — it runs only when `data-timer` is present
    and positive. It is also suppressed when `prefers-reduced-motion` is set.
- Keyboard accessible: arrow keys navigate; controls are focusable with ARIA
  labels.
- **Touch swipe:** on touch devices the track follows the finger and snaps to
  the nearest slide; a horizontal swipe past a small threshold changes slide
  (and suppresses the trailing click so the item link does not also fire), while
  a vertical drag is left alone so the page can still scroll. Swiping stops
  autoplay, like any other manual navigation.

### Masonry Grid

- Lays items out in a best-fit masonry grid using the images' specified
  dimensions (aspect ratios) to pack columns with minimal ragged whitespace.
- Responsive: column count adapts to available width.
- Uses the intrinsic `width`/`height` so layout is stable before images load.
- **Each tile's height is the image height plus the height of its text region**
  (the optional title and the link). The packing algorithm must account for this
  combined height — not the image alone — when placing tiles, so the column
  balancing and vertical rhythm stay correct once captions are included. Because
  the title is optional and text wrapping varies, tiles in the same column may
  have different text-block heights; the layout measures the full rendered tile
  height rather than assuming a fixed caption size.

### Consistent tile heights within a row

- The grid may present items in **rows** (e.g. a justified/"rows" layout, or any
  mode where several tiles share a horizontal band). Within such a row **all
  tiles must render at a consistent height.**
- When one tile in a row grows taller — because its title wraps to more lines,
  its link text is longer, or its image aspect ratio is taller — **every other
  tile in that row expands to match the tallest tile.** Tiles never leave a
  ragged bottom edge or misaligned baselines across a row.
- Height equalisation accounts for the **text as well as the image**: a tile with
  a two-line title is as tall as its row-mates even if their images are the same
  size, and the extra space is distributed so images and captions stay aligned.

## Lightbox Behavior

When an item's link is activated:

1. The default navigation is intercepted (`preventDefault`).
2. The linked page is loaded into a **lightbox-style overlay** via an
   **`<iframe>`**.
3. The widget **injects CSS into the iframe document** to hide the page's
   navigation and footer, showing **only the main semantic content region**.
   - Region identification uses **standard HTML5 semantic landmarks**:
     - **Keep/show:** `<main>`, `<article>`, and `[role="main"]` (the content
       region). No single-element choice is required — all matching content
       regions remain visible while the surrounding chrome is hidden.
     - **Hide:** `<nav>`, `<header>`, `<footer>`, and their ARIA equivalents
       (`[role="navigation"]`, `[role="banner"]`, `[role="contentinfo"]`).
   - The kept region is left **unconstrained in width** (`max-width: none`):
     the dialog is already inset from the viewport, so a page's own measure cap
     (e.g. `max-width: 72ch`) would only add dead gutters inside it.
   - (The original spec's "nsv" is read as a typo for the **nav** section.)
4. The overlay provides a close affordance (button, `Esc` key, and backdrop
   click), returns focus to the triggering link on close, and traps focus while
   open for accessibility.

### History / back-button integration

Opening the lightbox pushes a history entry, so the browser/hardware **back**
button (and Android gesture back) closes the overlay instead of navigating away
from the page. Closing via button/`Esc`/backdrop unwinds that entry so the URL
and history are left clean.

### Same-origin only

- CSS injection into an iframe requires the loaded page to be **same-origin**.
- **This widget assumes same-origin targets.** Cross-origin fallback handling is
  out of scope; behavior with cross-origin URLs is undefined (browser will block
  the CSS injection). This should be documented for consumers of the widget.

## Mobile Behavior

On narrow viewports (width at or below `data-mobile-breakpoint`, default `640px`)
the widget **does not open the modal lightbox** — instead the item link navigates
directly to the target page, using the browser's native full-page view.

The widget also **defaults to the carousel view on mobile**, even when
`data-mode="masonry"`, because a full masonry grid of tiles is awkward on a
phone; authors can override this with `data-mobile-mode="masonry"`. The active
view recomputes whenever the viewport crosses the breakpoint (resize or
rotation) — until the visitor explicitly picks a view with the toggle, after
which the widget stops auto-switching and respects their choice.

The **mode-toggle UI is hidden on mobile** (the view is locked to the carousel
there), and reappears on desktop viewports. This is independent of
`data-toggle`, which removes the toggle entirely on all viewports.

Rationale and trade-offs:

- **Why direct navigation on mobile:** the floating modal is a poor fit on
  phones — the backdrop-to-close target shrinks to a thin ring, there is no `Esc`
  key, nested iframe scrolling is janky, and a fixed-height dialog fights the
  mobile URL-bar viewport resizing. Native navigation gives correct back-button,
  scroll, and pinch-zoom behavior for free.
- **Known trade-off:** direct navigation shows the target page's **full chrome**
  (its own nav/header/footer) because the content-stripping CSS is only injected
  into the same-origin iframe. Where content-stripping on mobile matters, the
  target pages should be presentable standalone, or the breakpoint lowered.
- **Detection:** a `matchMedia("(max-width: <bp>px)")` check evaluated **at click
  time** (falling back to `window.innerWidth`), so rotating a device or resizing
  a window switches behavior with no reload and no user-agent sniffing.
- **Preserved intents:** modifier-clicks (⌘/Ctrl/Shift/Alt, middle-click) are
  never intercepted on any viewport, so open-in-new-tab/window always works.

## Styling

- Generate a **separate CSS file**.
- Use **scoped CSS or BEM** class naming as appropriate so the widget's styles
  don't leak into or collide with the host page.
- **CSS is the primary customization surface** — structure the stylesheet so
  consumers can restyle the widget by overriding classes / custom properties
  without touching JS. Prefer CSS custom properties for colors, spacing, timing.
- **Default to a dark-mode theme.**

## Accessibility & Progressive Enhancement (guidance)

- Widget enhances existing, valid markup (lists or divs); links remain
  functional without JS. The **JSON-in-a-comment** form is the exception: it
  renders nothing without scripting, and is offered only for generated pages
  where markup is impractical.
- Controls (arrows, toggle, close) are real focusable elements with ARIA labels.
- Keyboard support: navigate carousel, operate toggle, close lightbox with `Esc`.
- Respect `prefers-reduced-motion` for autoplay/transitions where feasible.

## Resolved Decisions

Previously-open questions, now settled and reflected in the implementation:

- **`rel` token** — `lightbox-grid`, matched space-token aware (`rel~=`).
- **`data-timer` default** — autoplay is **off** unless a positive `data-timer`
  is provided (no implicit default interval).
- **Content region when several exist** — all of `<main>`, `<article>`, and
  `[role="main"]` are kept; there is no either/or choice.
- **Loading strategy** — same-origin `<iframe>` with injected CSS (cross-origin
  is out of scope).
- **Mode toggle** — rendered by default; suppressible via `data-toggle="off"`.
- **Mobile** — links navigate directly (no modal) at/below
  `data-mobile-breakpoint` (default `640px`), and the view defaults to carousel
  (override with `data-mobile-mode`); see [Mobile Behavior](#mobile-behavior).
- **Optional title / description** — an item may include a title cell between
  the image and the link, and a description cell after it; tile and masonry
  sizing account for their (and the link's) rendered height so rows stay
  height-consistent and columns pack correctly.
- **Three source forms** — nested lists, nested divs, or JSON inside the
  container's only comment; all three produce the same item model.
- **Touch** — the carousel supports finger-swipe navigation with snap.
- **Back button** — opening the lightbox pushes a history entry so back closes
  the overlay instead of leaving the page.

## Repository Layout

```
.
├── src/
│   ├── lightbox-grid.js     # the widget (vanilla, ES5-style, no deps)
│   └── lightbox-grid.css    # BEM + CSS custom properties, dark theme default
├── index.html               # demo page (three configurations)
├── test.html                # in-browser assertion harness
├── images/                  # self-contained SVG placeholders (varied heights)
├── pages/                   # same-origin content pages loaded by the lightbox
│   ├── page-1.html … page-6.html
│   └── page.css
├── tests/
│   └── lightbox-grid.spec.js  # Playwright end-to-end tests
├── playwright.config.js       # serves the project; Chromium + Firefox
└── package.json               # `npm test`, `npm run serve`
```

## Running & Testing

- **Serve locally:** `npm run serve`, then open
  `http://localhost:8137/index.html` (demo) or `/test.html` (live assertions).
  - Port `8137` is used because `8080` is commonly occupied in this environment.
- **Automated tests:** `npm test` runs the Playwright suite (Chromium + Firefox).
  The config starts its own static server, so no manual setup is needed.
  - First-time setup: `npm install` then `npx playwright install chromium firefox`.
- `node_modules/` and Playwright output directories are git-ignored.

## Public API

The script auto-initializes on `DOMContentLoaded`. It also exposes
`window.LightboxGrid`:

- `LightboxGrid.init(root?)` — enhance any not-yet-enhanced flagged lists within
  `root` (defaults to `document`); returns the instance list.
- `LightboxGrid.instances` — the live widget instances.
- `LightboxGrid.Lightbox` — the shared lightbox singleton (`open(href)` / `close()`).
- `LightboxGrid.REL_TOKEN` — the activation token (`"lightbox-grid"`).

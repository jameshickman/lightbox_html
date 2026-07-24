# Specification for Carousel/Masonry Grid Lightbox Widget

A pure front-end JavaScript widget that renders a list of image + linked-text
items as either a **carousel** or a **masonry grid**, and opens each linked
page inside a **lightbox overlay** showing only that page's main content.

## Constraints

- **Pure vanilla JavaScript, no external dependencies** (no frameworks, no build step required).
- **Broad browser support**, including older browsers:
  - Avoid the `<dialog>` element; build the overlay from plain elements.
  - Prefer widely-supported CSS/JS; use polyfill-friendly, defensive patterns.
  - Feature-detect rather than assume modern APIs.
- Ships as two files: one JS file and one **separate CSS file**.

## Source Markup Contract

The widget scans the document for outer unordered lists flagged with a `rel`
attribute and manages each one. Expected structure:

```html
<ul rel="lightbox-grid" data-mode="carousel" data-timer="5000">
  <li>
    <ul>
      <li><img src="a.jpg" width="400" height="300" alt="Description A"></li>
      <li><a href="/page-a">Title A</a></li>
    </ul>
  </li>
  <li>
    <ul>
      <li><img src="b.jpg" width="400" height="500" alt="Description B"></li>
      <li><a href="/page-b">Title B</a></li>
    </ul>
  </li>
  <!-- ... more items ... -->
</ul>
```

Rules:

- The **outer `<ul>`** carries `rel="lightbox-grid"` (exact `rel` token TBD —
  used only as the activation flag).
- Each **outer `<li>`** is one item and contains an **inner `<ul>`** with:
  - one `<li>` holding an `<img>`, and
  - one `<li>` holding an `<a href>` with the item's text label.
- **Images MUST specify `width` and `height`** (intrinsic pixel dimensions) so
  the masonry layout can compute aspect ratios without waiting for image load.
  Images should also carry meaningful `alt` text.
- If the widget's JS does not run (no-JS / progressive enhancement), the raw
  nested list remains readable and the links work as normal navigation.

## Configuration (data-attributes on the outer `<ul>`)

| Attribute    | Purpose                                         | Default    |
| ------------ | ----------------------------------------------- | ---------- |
| `rel`        | Activation flag                                 | required   |
| `data-mode`  | Initial display mode: `carousel` or `masonry`   | `carousel` |
| `data-timer` | Carousel autoplay interval in milliseconds      | see below  |

## Display Modes

The active mode is chosen by the `data-mode` attribute **and** can be switched at
runtime via a **toggle UI element** the widget renders.

- **Default mode: Carousel.**
- A visible toggle control lets the user switch between carousel and masonry.
- `data-mode` sets the initial mode; the toggle overrides it thereafter.

### Carousel

- Each image + link pair is rendered as a carousel slide.
- **Navigation arrows** (previous / next) are always available.
- **Autoplay:** advances automatically every `data-timer` milliseconds.
  - Autoplay **pauses on hover and on keyboard focus** within the carousel.
  - Autoplay **pauses when the user manually navigates** (arrow click / key).
  - If `data-timer` is absent, define a sensible default (e.g. `5000` ms) or
    treat autoplay as off — TBD, but pausable-autoplay is the intended model.
- Should be keyboard accessible (arrow keys, focusable controls, ARIA labels).

### Masonry Grid

- Lays items out in a best-fit masonry grid using the images' specified
  dimensions (aspect ratios) to pack columns with minimal ragged whitespace.
- Responsive: column count adapts to available width.
- Uses the intrinsic `width`/`height` so layout is stable before images load.

## Lightbox Behavior

When an item's link is activated:

1. The default navigation is intercepted (`preventDefault`).
2. The linked page is loaded into a **lightbox-style overlay** via an
   **`<iframe>`**.
3. The widget **injects CSS into the iframe document** to hide the page's
   navigation and footer, showing **only the main semantic content region**.
   - Region identification uses **standard HTML5 semantic landmarks**:
     - **Keep/show:** `<main>` (or `<article>` as the content region).
     - **Hide:** `<nav>`, `<header>`, `<footer>`.
   - (The original spec's "nsv" is read as a typo for the **nav** section.)
4. The overlay provides a close affordance (button, `Esc` key, and backdrop
   click), returns focus to the triggering link on close, and should trap focus
   while open for accessibility.

### Same-origin only

- CSS injection into an iframe requires the loaded page to be **same-origin**.
- **This widget assumes same-origin targets.** Cross-origin fallback handling is
  out of scope; behavior with cross-origin URLs is undefined (browser will block
  the CSS injection). This should be documented for consumers of the widget.

## Styling

- Generate a **separate CSS file**.
- Use **scoped CSS or BEM** class naming as appropriate so the widget's styles
  don't leak into or collide with the host page.
- **CSS is the primary customization surface** — structure the stylesheet so
  consumers can restyle the widget by overriding classes / custom properties
  without touching JS. Prefer CSS custom properties for colors, spacing, timing.
- **Default to a dark-mode theme.**

## Accessibility & Progressive Enhancement (guidance)

- Widget enhances existing, valid list markup; links remain functional without JS.
- Controls (arrows, toggle, close) are real focusable elements with ARIA labels.
- Keyboard support: navigate carousel, operate toggle, close lightbox with `Esc`.
- Respect `prefers-reduced-motion` for autoplay/transitions where feasible.

## Open Questions / To Confirm

- Exact `rel` token value (`lightbox-grid`? something else?).
- Default `data-timer` when the attribute is omitted (5000 ms vs. autoplay off).
- Whether the content region is `<main>` or `<article>` when both are present.

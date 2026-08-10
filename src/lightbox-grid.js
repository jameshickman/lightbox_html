/* ==========================================================================
   lightbox-grid.js
   Pure vanilla, dependency-free Carousel / Masonry grid widget with a
   same-origin iframe lightbox.

   Written in ES5-compatible style for broad browser support (no arrow
   functions, template literals, const/let, or the <dialog> element).

   Usage:
     <ul rel="lightbox-grid" data-mode="carousel" data-timer="5000"> ... </ul>
     <script src="src/lightbox-grid.js"></script>
     // auto-initializes on DOMContentLoaded; or call window.LightboxGrid.init()

   Source markup contract (see SPECIFICATION.md) — EITHER nested lists:
     <ul rel="lightbox-grid">
       <li>
         <ul>
           <li><img src="a.jpg" width="400" height="300" alt="A"></li>
           <li>Optional Title A</li>   <!-- optional: between image and link -->
           <li><a href="/page-a">Link text A</a></li>
         </ul>
       </li>
       ...
     </ul>

   ...OR the same structure built from <div>s:
     <div rel="lightbox-grid">
       <div>
         <div>
           <div><img src="a.jpg" width="400" height="300" alt="A"></div>
           <div>Optional Title A</div>
           <div><a href="/page-a">Link text A</a></div>
         </div>
       </div>
       ...
     </div>

   The two styles may be mixed, and the inner wrapper may be omitted (image,
   title and link placed directly inside the item). Parsing is structural, not
   tag-driven: an item is a direct child element holding an <img> and an <a>,
   and the title is the cell sitting between them.

   `rel` is not a conformant attribute on <div>, so div containers may be
   flagged with data-rel="lightbox-grid" instead; both are recognised.
   ========================================================================== */
(function (window, document) {
  "use strict";

  var REL_TOKEN = "lightbox-grid";
  var MASONRY_MIN_COL = 220; /* px: target minimum column width (masonry mode) */
  var ROWS_ROW_H = 240; /* px: target row height for the justified "rows" grid */
  var ROWS_MAX_ROW_SCALE = 1.5; /* cap upscaling of a short final justified row */
  var DEFAULT_TIMER = 5000; /* used only when data-timer is a bare/invalid value */
  var DEFAULT_MOBILE_BP = 640; /* px: at/below this width, links navigate directly */
  var SWIPE_MIN = 40; /* px: minimum horizontal travel to count as a swipe */
  var idCounter = 0;

  // Feature-detect passive event listeners so touchmove can call preventDefault
  // where supported without tripping old browsers that lack the options object.
  var SUPPORTS_PASSIVE = false;
  try {
    var _passiveProbe = Object.defineProperty({}, "passive", {
      get: function () {
        SUPPORTS_PASSIVE = true;
      }
    });
    window.addEventListener("lbg-passive-probe", null, _passiveProbe);
    window.removeEventListener("lbg-passive-probe", null, _passiveProbe);
  } catch (e) {
    SUPPORTS_PASSIVE = false;
  }

  /* ---- small helpers ---------------------------------------------------- */

  // Activation flag. `rel` is the documented attribute, but it is only valid
  // HTML on <a>/<link>/<form>, so div-based containers may use `data-rel`
  // instead to keep the markup conformant. Either carries the same token.
  function hasRelToken(el) {
    var rel = (el.getAttribute("rel") || "") + " " + (el.getAttribute("data-rel") || "");
    var parts = rel.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === REL_TOKEN) return true;
    }
    return false;
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function toInt(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
  }

  function getGap(node) {
    // Read the --lbg-gap custom property so JS layout matches the CSS.
    var raw;
    try {
      raw = window
        .getComputedStyle(node)
        .getPropertyValue("--lbg-gap");
    } catch (e) {
      raw = "";
    }
    var n = parseInt(raw, 10);
    return isNaN(n) ? 16 : n;
  }

  function getRowHeight(node) {
    // Read the --lbg-row-height custom property (the target row height that
    // justified packing scales around) so the CSS remains the theming surface.
    var raw;
    try {
      raw = window
        .getComputedStyle(node)
        .getPropertyValue("--lbg-row-height");
    } catch (e) {
      raw = "";
    }
    var n = parseInt(raw, 10);
    return isNaN(n) || n <= 0 ? ROWS_ROW_H : n;
  }

  function normalizeMode(value) {
    var v = ("" + (value || "")).toLowerCase();
    if (v === "masonry" || v === "rows") return v;
    return "carousel";
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /* ---- parse source markup into plain data ------------------------------ */

  function trim(s) {
    return ("" + (s == null ? "" : s)).replace(/^\s+|\s+$/g, "");
  }

  // Elements accepted as a widget container: a list (<ul>/<ol>) or a <div>.
  function isContainerTag(tag) {
    return tag === "UL" || tag === "OL" || tag === "DIV";
  }

  // Elements accepted as one item within a container: <li> for list markup,
  // <div> for div markup. The two may be mixed within one container.
  function isItemTag(tag) {
    return tag === "LI" || tag === "DIV";
  }

  // Direct item children of a container (skips text nodes and stray markup).
  function directChildItems(node) {
    var out = [];
    var kids = node.children;
    for (var i = 0; i < kids.length; i++) {
      if (isItemTag(kids[i].tagName)) out.push(kids[i]);
    }
    return out;
  }

  // Direct element children of a node, whatever their tag. Used for the cells
  // inside one item, where position — not tag name — carries the meaning.
  function childElements(node) {
    var out = [];
    var kids = node.children;
    for (var i = 0; i < kids.length; i++) out.push(kids[i]);
    return out;
  }

  // The direct child of `group` that contains `node` (or null).
  function childCellOf(node, group) {
    while (node && node.parentNode !== group) node = node.parentNode;
    return node || null;
  }

  function indexInArray(arr, node) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === node) return i;
    }
    return -1;
  }

  // The element whose direct children are one item's cells: the inner <ul> in
  // list markup, the inner wrapper <div> in div markup. When the item has no
  // inner wrapper (image/title/link sit directly inside it), the item itself
  // is the group.
  function groupOf(item, img) {
    var node = img;
    var parent = node.parentNode;
    while (parent && parent !== item) {
      node = parent;
      parent = node.parentNode;
    }
    // `node` is now the ancestor of `img` that is a direct child of `item`.
    return parent === item && node !== img ? node : item;
  }

  // The optional title is the cell that sits BETWEEN the image cell and the
  // link cell and contains no <a href>. Returns its trimmed text, or "" when
  // absent. Position-based so titled and untitled items can freely mix, and
  // tag-agnostic so <li>, <div> or any other wrapper works.
  function extractTitle(item, img, anchor) {
    var group = groupOf(item, img);
    var cells = childElements(group);
    var imgIdx = indexInArray(cells, childCellOf(img, group));
    var linkIdx = indexInArray(cells, childCellOf(anchor, group));
    if (imgIdx < 0 || linkIdx < 0) return "";
    var lo = imgIdx < linkIdx ? imgIdx : linkIdx;
    var hi = imgIdx < linkIdx ? linkIdx : imgIdx;
    for (var k = lo + 1; k < hi; k++) {
      if (cells[k].getElementsByTagName("a").length === 0) {
        var t = trim(cells[k].textContent || cells[k].innerText || "");
        if (t) return t;
      }
    }
    return "";
  }

  function parseItems(source) {
    var items = [];
    var itemEls = directChildItems(source);
    for (var i = 0; i < itemEls.length; i++) {
      var item = itemEls[i];
      var img = item.getElementsByTagName("img")[0];
      var anchor = item.getElementsByTagName("a")[0];
      if (!img || !anchor) continue;

      var w = toInt(img.getAttribute("width"), 0);
      var h = toInt(img.getAttribute("height"), 0);

      items.push({
        href: anchor.getAttribute("href"),
        label: trim(anchor.textContent || anchor.innerText || ""),
        title: extractTitle(item, img, anchor),
        src: img.getAttribute("src"),
        alt: img.getAttribute("alt") || "",
        w: w > 0 ? w : 1,
        h: h > 0 ? h : 1
      });
    }
    return items;
  }

  /* ====================================================================== *
   *  Lightbox singleton
   * ====================================================================== */

  var Lightbox = (function () {
    var overlay = null;
    var dialog = null;
    var frame = null;
    var closeBtn = null;
    var lastFocused = null;
    var keydownHandler = null;
    var isOpen = false;
    var historyPushed = false;

    function build() {
      if (overlay) return;

      overlay = el("div", "lbg-lightbox");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Content preview");

      var backdrop = el("div", "lbg-lightbox__backdrop");

      dialog = el("div", "lbg-lightbox__dialog");

      closeBtn = el("button", "lbg-lightbox__close");
      closeBtn.setAttribute("type", "button");
      closeBtn.setAttribute("aria-label", "Close preview");
      closeBtn.innerHTML = "×"; /* × */

      var spinner = el("div", "lbg-lightbox__spinner");
      spinner.appendChild(document.createTextNode("Loading…"));

      frame = el("iframe", "lbg-lightbox__frame");
      frame.setAttribute("title", "Linked content");
      frame.setAttribute("src", "about:blank");

      dialog.appendChild(closeBtn);
      dialog.appendChild(spinner);
      dialog.appendChild(frame);

      overlay.appendChild(backdrop);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      backdrop.onclick = close;
      closeBtn.onclick = close;

      frame.onload = onFrameLoad;
    }

    // Navigate the iframe WITHOUT adding a browser-history entry. Setting
    // `src` performs an async navigation that commits its own history entry
    // *after* our pushState, which would make the first Back rewind the iframe
    // (to about:blank) instead of closing the overlay. location.replace() keeps
    // the joint session history clean so our single pushed entry governs Back.
    function navigateFrame(url) {
      try {
        var w = frame.contentWindow;
        if (w && w.location && w.location.replace) {
          w.location.replace(url);
          return;
        }
      } catch (e) {
        /* fall through to the attribute assignment */
      }
      frame.setAttribute("src", url);
    }

    // CSS injected into the loaded (same-origin) page: hide the nav / header /
    // footer landmarks, keep only the main semantic content region.
    function injectContentStyles() {
      var doc;
      try {
        doc = frame.contentDocument || frame.contentWindow.document;
      } catch (e) {
        // Cross-origin: injection is blocked. Widget assumes same-origin
        // targets (see SPECIFICATION.md); leave the page as-is.
        return;
      }
      if (!doc || !doc.head) return;

      var style = doc.createElement("style");
      style.setAttribute("data-lbg-injected", "true");
      style.appendChild(
        doc.createTextNode(
          "nav, header, footer," +
            "[role='banner'], [role='navigation'], [role='contentinfo']" +
            "{ display: none !important; }" +
            "html, body { margin: 0 !important; }" +
            "body { padding: 28px !important; background: #fff; }" +
            // The content region fills the dialog: the page's own measure caps
            // (e.g. `max-width: 72ch`) would otherwise leave dead gutters.
            "main, article, [role='main']" +
            "{ display: block !important; max-width: none !important;" +
            " width: auto !important; margin: 0 !important; }"
        )
      );
      doc.head.appendChild(style);
    }

    function onFrameLoad() {
      // Closing sets the frame src to about:blank, which also fires 'load'.
      // Don't let that re-open a closed overlay.
      if (!isOpen) return;
      injectContentStyles();
      if (overlay) overlay.className = "lbg-lightbox is-open is-loaded";
    }

    function getFocusable() {
      return dialog.querySelectorAll(
        "a[href], button:not([disabled]), input, [tabindex]:not([tabindex='-1']), iframe"
      );
    }

    function onKeydown(e) {
      var key = e.key || e.keyCode;
      if (key === "Escape" || key === "Esc" || key === 27) {
        close();
        return;
      }
      if (key === "Tab" || key === 9) {
        // Focus trap within the dialog.
        var f = getFocusable();
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    // Back-button / gesture integration: opening pushes a history entry so the
    // hardware/browser back closes the overlay instead of leaving the page.
    function onPopState() {
      // A real Back/gesture fired while open — the browser already moved off our
      // pushed entry, so just tear down. (Our own cleanup back() in close()
      // can't reach here: doClose() removes this listener first.)
      if (isOpen) doClose();
    }

    function open(href) {
      build();
      isOpen = true;
      lastFocused = document.activeElement;
      overlay.className = "lbg-lightbox is-open"; /* not yet loaded */
      navigateFrame(href);
      if (document.body) {
        document.body.className += " lbg-lightbox-open";
      }
      keydownHandler = onKeydown;
      document.addEventListener("keydown", keydownHandler, true);

      historyPushed = false;
      if (window.history && window.history.pushState) {
        try {
          window.history.pushState({ lbgLightbox: true }, "");
          historyPushed = true;
        } catch (e) {
          historyPushed = false;
        }
        window.addEventListener("popstate", onPopState);
      }

      // Move focus into the dialog.
      if (closeBtn && closeBtn.focus) closeBtn.focus();
    }

    // User-initiated close (button / backdrop / Esc). Tear the overlay down
    // SYNCHRONOUSLY so it always dismisses, then unwind our history entry. We do
    // NOT wait for a popstate to do the teardown: some browsers leave an iframe
    // history entry on top of ours, so history.back() would rewind the iframe
    // (blanking it) without firing a parent popstate — leaving the overlay stuck
    // open. Closing first, cleaning history second, is robust to that.
    function close() {
      if (!isOpen) return;
      var wasPushed = historyPushed;
      doClose();
      if (wasPushed) {
        try {
          window.history.back();
        } catch (e) {
          /* history unavailable — nothing to unwind */
        }
      }
    }

    function doClose() {
      if (!isOpen) return;
      isOpen = false;
      historyPushed = false;
      overlay.className = "lbg-lightbox";
      navigateFrame("about:blank");
      if (document.body) {
        document.body.className = document.body.className
          .replace(/\s*lbg-lightbox-open/g, "")
          .replace(/^\s+|\s+$/g, "");
      }
      if (keydownHandler) {
        document.removeEventListener("keydown", keydownHandler, true);
        keydownHandler = null;
      }
      window.removeEventListener("popstate", onPopState);
      if (lastFocused && lastFocused.focus) {
        lastFocused.focus();
      }
    }

    return { open: open, close: close };
  })();

  /* ====================================================================== *
   *  Widget (one per enhanced source container)
   * ====================================================================== */

  function Widget(source) {
    this.source = source;
    this.items = parseItems(source);

    // Desktop initial view (data-mode: carousel | masonry | rows). On mobile the
    // default is carousel — a full grid is awkward on phones — unless
    // data-mobile-mode overrides it. The active view still recomputes on resize
    // until the user toggles.
    this.desktopMode = normalizeMode(source.getAttribute("data-mode"));
    var mobileModeAttr = source.getAttribute("data-mobile-mode");
    this.mobileMode = mobileModeAttr
      ? normalizeMode(mobileModeAttr)
      : "carousel";
    this.userChoseMode = false;

    // On narrow (mobile) viewports, links navigate directly instead of opening
    // the modal lightbox. The threshold is configurable per widget.
    this.mobileBreakpoint = toInt(
      source.getAttribute("data-mobile-breakpoint"),
      DEFAULT_MOBILE_BP
    );

    this.mode = this.isMobile() ? this.mobileMode : this.desktopMode;

    var timerAttr = source.getAttribute("data-timer");
    // Autoplay is enabled only when a positive data-timer is provided.
    this.timer = null;
    if (timerAttr !== null && timerAttr !== "") {
      var t = toInt(timerAttr, DEFAULT_TIMER);
      this.timer = t > 0 ? t : null;
    }

    // The mode toggle UI can be disabled, locking the widget to data-mode.
    // data-toggle="off" | "disabled" | "false"  (default: enabled)
    var toggleAttr = (source.getAttribute("data-toggle") || "").toLowerCase();
    this.toggleEnabled = !(
      toggleAttr === "off" ||
      toggleAttr === "disabled" ||
      toggleAttr === "false" ||
      toggleAttr === "none"
    );

    this.current = 0;
    this.autoplayId = null;
    this.hoverPaused = false;
    this.userStopped = false;
    this.masonryLaidOut = false;
    this.rowsLaidOut = false;

    this.id = "lbg-" + ++idCounter;
    this.build();
  }

  Widget.prototype.build = function () {
    var self = this;

    var root = el("div", "lbg lbg--" + this.mode);
    root.id = this.id;
    this.root = root;

    // ---- Toolbar / mode toggle (omitted when disabled via data-toggle,
    // and hidden on mobile where the view is locked to the carousel).
    this.toolbar = null;
    if (this.toggleEnabled) {
      var toolbar = el("div", "lbg__toolbar");
      var modes = el("div", "lbg__modes");
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", "Display mode");

      this.carouselBtn = this.makeModeButton("carousel", "Carousel");
      this.masonryBtn = this.makeModeButton("masonry", "Masonry");
      this.rowsBtn = this.makeModeButton("rows", "Rows");
      modes.appendChild(this.carouselBtn);
      modes.appendChild(this.masonryBtn);
      modes.appendChild(this.rowsBtn);
      toolbar.appendChild(modes);
      root.appendChild(toolbar);
      this.toolbar = toolbar;
    }

    var stage = el("div", "lbg__stage");
    stage.appendChild(this.buildCarousel());
    stage.appendChild(this.buildMasonry());
    stage.appendChild(this.buildRows());
    root.appendChild(stage);

    // Insert widget after the source list, then hide the source.
    this.source.parentNode.insertBefore(root, this.source.nextSibling);
    this.source.className += " lbg-source--enhanced";

    // Delegate link activation -> lightbox (same handler for both modes).
    // On mobile viewports, do NOT intercept: let the link navigate directly.
    // Modifier-clicks (new tab/window) are always left to the browser.
    root.addEventListener("click", function (e) {
      // Swallow the click synthesized after a swipe (would follow the link).
      if (self._suppressClick) {
        self._suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var link = closestLink(e.target, root);
      if (!link) return;
      if (self.isMobile()) return; /* direct navigation on mobile */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) {
        return; /* honor open-in-new-tab / new-window intents */
      }
      e.preventDefault();
      Lightbox.open(link.getAttribute("href"));
    });

    this.updateModeUI();
    this.updateToolbarVisibility();
    this.layoutActive();
    this.startAutoplay();

    // On resize: hide/show the toggle for the viewport, and — until the user
    // picks a view themselves — keep the mode in sync (carousel on mobile,
    // data-mode on desktop). Always relayout masonry when it is the active view.
    this.onResize = debounce(function () {
      self.updateToolbarVisibility();
      if (!self.userChoseMode) {
        var want = self.isMobile() ? self.mobileMode : self.desktopMode;
        if (want !== self.mode) {
          self.setMode(want, false); /* setMode relayouts the grid as needed */
          return;
        }
      }
      self.layoutActive();
    }, 120);
    window.addEventListener("resize", this.onResize);
  };

  // The mode toggle is hidden on mobile (the view is locked to the carousel).
  Widget.prototype.updateToolbarVisibility = function () {
    if (!this.toolbar) return;
    this.toolbar.style.display = this.isMobile() ? "none" : "";
  };

  function closestLink(node, boundary) {
    while (node && node !== boundary) {
      if (node.className && ("" + node.className).indexOf("lbg__link") > -1) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  Widget.prototype.makeModeButton = function (mode, label) {
    var self = this;
    var btn = el("button", "lbg__mode-btn");
    btn.setAttribute("type", "button");
    btn.appendChild(document.createTextNode(label));
    btn.onclick = function () {
      self.setMode(mode, true); /* explicit user choice: stop auto-switching */
    };
    return btn;
  };

  // Build a link/media/caption element from an item; `variant` is
  // "carousel" or "masonry" (only affects the wrapper class).
  Widget.prototype.makeItemLink = function (item) {
    var link = el("a", "lbg__link");
    link.setAttribute("href", item.href);

    var media = el("span", "lbg__media");
    var img = el("img", "lbg__image");
    img.setAttribute("src", item.src);
    img.setAttribute("alt", item.alt);
    img.setAttribute("width", item.w);
    img.setAttribute("height", item.h);
    img.setAttribute("loading", "lazy");
    media.appendChild(img);
    link.appendChild(media);

    // Caption line. When the item supplied a title, it renders inline as a bold
    // lead followed by an em-dash and the link label ("Title — label"); with no
    // title the caption is just the link label.
    var caption = el("span", "lbg__caption");
    if (item.title) {
      var title = el("strong", "lbg__title");
      title.appendChild(document.createTextNode(item.title));
      caption.appendChild(title);
      caption.appendChild(document.createTextNode(" — "));
    }
    caption.appendChild(document.createTextNode(item.label));
    link.appendChild(caption);

    return { link: link, media: media };
  };

  /* ---- Carousel --------------------------------------------------------- */

  Widget.prototype.buildCarousel = function () {
    var self = this;
    var carousel = el("div", "lbg__carousel");
    carousel.setAttribute("aria-roledescription", "carousel");

    var prev = el("button", "lbg__nav lbg__nav--prev");
    prev.setAttribute("type", "button");
    prev.setAttribute("aria-label", "Previous slide");
    prev.innerHTML = "‹"; /* ‹ */
    prev.onclick = function () {
      self.go(self.current - 1, true);
    };

    var next = el("button", "lbg__nav lbg__nav--next");
    next.setAttribute("type", "button");
    next.setAttribute("aria-label", "Next slide");
    next.innerHTML = "›"; /* › */
    next.onclick = function () {
      self.go(self.current + 1, true);
    };

    var viewport = el("div", "lbg__viewport");
    var track = el("div", "lbg__track");
    this.track = track;

    this.slides = [];
    for (var i = 0; i < this.items.length; i++) {
      var slide = el("div", "lbg__slide");
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute(
        "aria-label",
        i + 1 + " of " + this.items.length
      );
      var built = this.makeItemLink(this.items[i]);
      slide.appendChild(built.link);
      track.appendChild(slide);
      this.slides.push(slide);
    }

    viewport.appendChild(track);
    carousel.appendChild(prev);
    carousel.appendChild(viewport);
    carousel.appendChild(next);

    // Dots
    var dots = el("div", "lbg__dots");
    this.dots = [];
    for (var j = 0; j < this.items.length; j++) {
      var dot = el("button", "lbg__dot");
      dot.setAttribute("type", "button");
      dot.setAttribute("aria-label", "Go to slide " + (j + 1));
      (function (index) {
        dot.onclick = function () {
          self.go(index, true);
        };
      })(j);
      dots.appendChild(dot);
      this.dots.push(dot);
    }
    // Reflect the initial slide (go() only updates dots on navigation).
    if (this.dots.length) {
      this.dots[this.current].className = "lbg__dot is-active";
    }
    carousel.appendChild(dots);

    // Keyboard navigation within the carousel.
    carousel.addEventListener("keydown", function (e) {
      var key = e.key || e.keyCode;
      if (key === "ArrowLeft" || key === 37) {
        self.go(self.current - 1, true);
      } else if (key === "ArrowRight" || key === 39) {
        self.go(self.current + 1, true);
      }
    });

    // Pause autoplay on hover / focus.
    carousel.addEventListener("mouseenter", function () {
      self.hoverPaused = true;
    });
    carousel.addEventListener("mouseleave", function () {
      self.hoverPaused = false;
    });
    carousel.addEventListener("focusin", function () {
      self.hoverPaused = true;
    });
    carousel.addEventListener("focusout", function () {
      self.hoverPaused = false;
    });

    // Touch swipe navigation: follow the finger, then snap to the nearest slide.
    // A horizontal drag past the threshold changes slide (and suppresses the
    // trailing click so the item link doesn't also fire); a vertical drag is
    // left alone so the page can scroll; a near-stationary touch is a tap.
    var touch = {
      active: false,
      decided: false,
      horizontal: false,
      x0: 0,
      y0: 0,
      dx: 0,
      w: 1
    };

    viewport.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        touch.active = true;
        touch.decided = false;
        touch.horizontal = false;
        touch.x0 = e.touches[0].clientX;
        touch.y0 = e.touches[0].clientY;
        touch.dx = 0;
        touch.w = viewport.clientWidth || 1;
        track.style.transition = "none"; /* follow the finger 1:1 */
      },
      SUPPORTS_PASSIVE ? { passive: true } : false
    );

    viewport.addEventListener(
      "touchmove",
      function (e) {
        if (!touch.active || !e.touches || e.touches.length !== 1) return;
        var dx = e.touches[0].clientX - touch.x0;
        var dy = e.touches[0].clientY - touch.y0;
        if (!touch.decided) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; /* wait for intent */
          touch.decided = true;
          touch.horizontal = Math.abs(dx) > Math.abs(dy);
          if (!touch.horizontal) {
            // Vertical scroll: bail out and restore the CSS transition.
            touch.active = false;
            track.style.transition = "";
            return;
          }
        }
        if (!touch.horizontal) return;
        if (e.cancelable) e.preventDefault(); /* stop the page scrolling sideways */
        touch.dx = dx;
        var pct = -(self.current * 100) + (dx / touch.w) * 100;
        track.style.transform = "translateX(" + pct + "%)";
      },
      SUPPORTS_PASSIVE ? { passive: false } : false
    );

    function endTouch() {
      if (!touch.active) return;
      touch.active = false;
      track.style.transition = ""; /* re-enable the snap animation */
      if (!touch.horizontal) return;

      if (touch.dx <= -SWIPE_MIN) {
        self.go(self.current + 1, true);
        self.suppressNextClick();
      } else if (touch.dx >= SWIPE_MIN) {
        self.go(self.current - 1, true);
        self.suppressNextClick();
      } else {
        self.go(self.current, false); /* snap back to the current slide */
        if (Math.abs(touch.dx) > 6) self.suppressNextClick();
      }
    }

    viewport.addEventListener("touchend", endTouch);
    viewport.addEventListener("touchcancel", endTouch);

    this.carousel = carousel;
    return carousel;
  };

  // After a swipe, suppress the click the browser synthesizes from the touch so
  // the item link/lightbox doesn't also activate. Cleared on the next click, or
  // after a short timeout if no click follows.
  Widget.prototype.suppressNextClick = function () {
    var self = this;
    this._suppressClick = true;
    if (this._suppressTimer) window.clearTimeout(this._suppressTimer);
    this._suppressTimer = window.setTimeout(function () {
      self._suppressClick = false;
    }, 500);
  };

  Widget.prototype.go = function (index, manual) {
    var n = this.items.length;
    if (n === 0) return;
    // wrap around
    this.current = ((index % n) + n) % n;
    var offset = -this.current * 100;
    if (this.track) {
      this.track.style.transform = "translateX(" + offset + "%)";
    }
    for (var i = 0; i < this.dots.length; i++) {
      this.dots[i].className =
        "lbg__dot" + (i === this.current ? " is-active" : "");
    }
    if (manual) {
      // Manual navigation stops autoplay for the session.
      this.userStopped = true;
      this.stopAutoplay();
    }
  };

  Widget.prototype.startAutoplay = function () {
    var self = this;
    if (!this.timer || this.userStopped || prefersReducedMotion()) return;
    if (this.autoplayId) return;
    this.autoplayId = window.setInterval(function () {
      if (self.mode !== "carousel") return;
      if (self.hoverPaused) return;
      self.go(self.current + 1, false);
    }, this.timer);
  };

  Widget.prototype.stopAutoplay = function () {
    if (this.autoplayId) {
      window.clearInterval(this.autoplayId);
      this.autoplayId = null;
    }
  };

  /* ---- Grid modes (masonry columns + justified rows) -------------------- */

  // Both grid modes share the same DOM shape: a positioned container of
  // .lbg__item cells. `modifier` is "masonry" or "rows"; the returned container
  // carries both that class and the shared `lbg__grid` class. Returns the
  // container and its item array (also stored on the widget).
  Widget.prototype.buildGrid = function (modifier) {
    var grid = el("div", "lbg__grid lbg__" + modifier + " is-unlaid");
    var itemsArr = [];
    for (var i = 0; i < this.items.length; i++) {
      var item = el("div", "lbg__item");
      var built = this.makeItemLink(this.items[i]);
      item.appendChild(built.link);
      item._media = built.media;
      item._data = this.items[i];
      grid.appendChild(item);
      itemsArr.push(item);
    }
    return { grid: grid, items: itemsArr };
  };

  Widget.prototype.buildMasonry = function () {
    var built = this.buildGrid("masonry");
    this.masonry = built.grid;
    this.masonryItems = built.items;
    return this.masonry;
  };

  Widget.prototype.buildRows = function () {
    var built = this.buildGrid("rows");
    this.rows = built.grid;
    this.rowsItems = built.items;
    return this.rows;
  };

  // Lay out whichever grid mode is currently active (no-op for the carousel).
  Widget.prototype.layoutActive = function () {
    if (this.mode === "masonry") this.layoutMasonry();
    else if (this.mode === "rows") this.layoutRows();
  };

  // Classic masonry: uniform-width columns, each new item dropped into the
  // currently shortest column so the stacks stay balanced.
  Widget.prototype.layoutMasonry = function () {
    var container = this.masonry;
    if (!container || !this.masonryItems.length) return;
    // Can't measure when hidden (display:none => offsetWidth 0).
    if (container.offsetWidth === 0) {
      this.masonryLaidOut = false;
      return;
    }

    container.className = "lbg__grid lbg__masonry"; /* drop is-unlaid fallback */

    var gap = getGap(this.root);
    var containerWidth = container.clientWidth;
    var cols = Math.floor((containerWidth + gap) / (MASONRY_MIN_COL + gap));
    if (cols < 1) cols = 1;
    var colWidth = Math.floor((containerWidth - gap * (cols - 1)) / cols);

    var colHeights = [];
    for (var c = 0; c < cols; c++) colHeights.push(0);

    for (var i = 0; i < this.masonryItems.length; i++) {
      var item = this.masonryItems[i];
      var data = item._data;

      // Deterministic media height from the image's intrinsic ratio.
      var mediaHeight = Math.round(colWidth * (data.h / data.w));
      item._media.style.height = mediaHeight + "px";
      item.style.width = colWidth + "px";

      // Measure full item height (media + caption) after sizing.
      var itemHeight = item.offsetHeight;

      // Pick the shortest column.
      var target = 0;
      for (var k = 1; k < cols; k++) {
        if (colHeights[k] < colHeights[target]) target = k;
      }

      var left = target * (colWidth + gap);
      var top = colHeights[target];
      item.style.left = left + "px";
      item.style.top = top + "px";

      colHeights[target] += itemHeight + gap;
    }

    var maxH = 0;
    for (var m = 0; m < colHeights.length; m++) {
      if (colHeights[m] > maxH) maxH = colHeights[m];
    }
    container.style.height = (maxH > 0 ? maxH - gap : 0) + "px";
    this.masonryLaidOut = true;
  };

  // Justified ("expanding rows") grid, photo-platform style: pack items
  // left-to-right into full-width rows. Each item keeps its intrinsic aspect
  // ratio, so wider images claim more horizontal space and the number of columns
  // per row varies with the images' shapes. Every complete row is scaled so its
  // images share one height and the row exactly fills the container width.
  Widget.prototype.layoutRows = function () {
    var container = this.rows;
    if (!container || !this.rowsItems.length) return;
    // Can't measure when hidden (display:none => offsetWidth 0).
    if (container.offsetWidth === 0) {
      this.rowsLaidOut = false;
      return;
    }

    container.className = "lbg__grid lbg__rows"; /* drop is-unlaid fallback */

    var gap = getGap(this.root);
    var containerWidth = container.clientWidth;
    var targetH = getRowHeight(this.root);

    var items = this.rowsItems;
    var n = items.length;
    var y = 0; /* running top offset for the next row */
    var rowStart = 0;
    var ratioSum = 0; /* sum of aspect ratios (w/h) for the pending row */

    for (var i = 0; i < n; i++) {
      var data = items[i]._data;
      ratioSum += data.w / data.h;

      var rowGaps = gap * (i - rowStart); /* count - 1 gaps in the row */
      // Width the row would span at the target height.
      var naturalWidth = ratioSum * targetH + rowGaps;
      var isLast = i === n - 1;

      if (naturalWidth >= containerWidth || isLast) {
        // Row height that makes these images exactly fill the container width.
        var rowH = (containerWidth - rowGaps) / ratioSum;
        if (isLast && naturalWidth < containerWidth) {
          // Incomplete final row: don't upscale a lone/short row too far.
          rowH = Math.min(rowH, targetH * ROWS_MAX_ROW_SCALE);
        }
        y += this.placeRow(items, rowStart, i, rowH, gap, containerWidth, y);
        rowStart = i + 1;
        ratioSum = 0;
      }
    }

    container.style.height = (y > 0 ? y - gap : 0) + "px";
    this.rowsLaidOut = true;
  };

  // Position items [start..end] as one justified row at height rowH, widths
  // proportional to each image's aspect ratio and summing (with gaps) to the
  // container width. Returns the vertical advance (tallest item + gap) so the
  // caller can stack the next row below, clearing captions of varying length.
  Widget.prototype.placeRow = function (items, start, end, rowH, gap, containerWidth, top) {
    var rowHr = Math.round(rowH);
    var count = end - start + 1;
    var contentWidth = containerWidth - gap * (count - 1);

    var ratioSum = 0;
    for (var k = start; k <= end; k++) {
      ratioSum += items[k]._data.w / items[k]._data.h;
    }

    var rowItems = [];
    var maxItemH = 0;
    var contentLeft = 0; /* float cursor in content space (excludes gaps) */
    for (var j = 0; j < count; j++) {
      var item = items[start + j];
      var data = item._data;
      var wFloat = ((data.w / data.h) / ratioSum) * contentWidth;

      var leftRounded = Math.round(contentLeft);
      // Pin the final item's right edge to contentWidth so rounding never leaves
      // a sub-pixel gap or overflow at the row's end.
      var rightRounded =
        j === count - 1 ? contentWidth : Math.round(contentLeft + wFloat);

      item.style.width = rightRounded - leftRounded + "px";
      item.style.left = leftRounded + j * gap + "px";
      item.style.top = top + "px";
      item.style.height = ""; /* clear a prior equalized height before measuring */
      item._media.style.height = rowHr + "px";

      // Full natural height = image (rowHr) + text region (optional title + link
      // label, which may wrap). Measured after width is set so wrapping counts.
      var itemH = item.offsetHeight;
      if (itemH > maxItemH) maxItemH = itemH;

      rowItems.push(item);
      contentLeft += wFloat;
    }

    // Consistent tile height: every tile in the row grows to match the tallest
    // one, so a longer title/label (more wrapped lines) never leaves a ragged
    // bottom edge across the row. Images stay top-aligned at the shared rowHr.
    for (var p = 0; p < rowItems.length; p++) {
      rowItems[p].style.height = maxItemH + "px";
    }

    return maxItemH + gap;
  };

  /* ---- Mode switching --------------------------------------------------- */

  Widget.prototype.setMode = function (mode, userInitiated) {
    if (mode !== "carousel" && mode !== "masonry" && mode !== "rows") return;
    if (userInitiated) this.userChoseMode = true;
    if (mode === this.mode) return;
    this.mode = mode;
    this.updateModeUI();

    if (mode === "carousel") {
      this.startAutoplay();
    } else {
      this.stopAutoplay();
      // Lay out now that the container is visible.
      this.layoutActive();
    }
  };

  // Evaluated at click time, so resize / orientation changes are handled
  // automatically without listeners.
  Widget.prototype.isMobile = function () {
    if (window.matchMedia) {
      return window.matchMedia(
        "(max-width: " + this.mobileBreakpoint + "px)"
      ).matches;
    }
    var w =
      window.innerWidth ||
      (document.documentElement && document.documentElement.clientWidth) ||
      0;
    return w <= this.mobileBreakpoint;
  };

  Widget.prototype.updateModeUI = function () {
    this.root.className = "lbg lbg--" + this.mode;
    if (!this.toggleEnabled || !this.carouselBtn) return;
    var btns = [
      { btn: this.carouselBtn, mode: "carousel" },
      { btn: this.masonryBtn, mode: "masonry" },
      { btn: this.rowsBtn, mode: "rows" }
    ];
    for (var i = 0; i < btns.length; i++) {
      var active = this.mode === btns[i].mode;
      btns[i].btn.className = "lbg__mode-btn" + (active ? " is-active" : "");
      btns[i].btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  /* ====================================================================== *
   *  Public API / bootstrap
   * ====================================================================== */

  var instances = [];

  function init(root) {
    var scope = root || document;
    // Both markup styles are flagged the same way, so match on the rel token
    // and accept any of the supported container tags (<ul>/<ol>/<div>).
    var flagged = scope.querySelectorAll("[rel], [data-rel]");
    // Copy to a static array first (we mutate the DOM while iterating).
    var toEnhance = [];
    for (var i = 0; i < flagged.length; i++) {
      var node = flagged[i];
      if (isContainerTag(node.tagName) && hasRelToken(node) && !node._lbgEnhanced) {
        toEnhance.push(node);
      }
    }
    for (var j = 0; j < toEnhance.length; j++) {
      toEnhance[j]._lbgEnhanced = true;
      instances.push(new Widget(toEnhance[j]));
    }
    return instances;
  }

  window.LightboxGrid = {
    init: init,
    instances: instances,
    Lightbox: Lightbox,
    REL_TOKEN: REL_TOKEN
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
    });
  } else {
    init();
  }
})(window, document);

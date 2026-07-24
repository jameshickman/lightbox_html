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

   Source markup contract (see SPECIFICATION.md):
     <ul rel="lightbox-grid">
       <li>
         <ul>
           <li><img src="a.jpg" width="400" height="300" alt="A"></li>
           <li><a href="/page-a">Title A</a></li>
         </ul>
       </li>
       ...
     </ul>
   ========================================================================== */
(function (window, document) {
  "use strict";

  var REL_TOKEN = "lightbox-grid";
  var MASONRY_MIN_COL = 220; /* px: target minimum column width */
  var DEFAULT_TIMER = 5000; /* used only when data-timer is a bare/invalid value */
  var DEFAULT_MOBILE_BP = 640; /* px: at/below this width, links navigate directly */
  var idCounter = 0;

  /* ---- small helpers ---------------------------------------------------- */

  function hasRelToken(el) {
    var rel = el.getAttribute("rel") || "";
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

  function parseItems(sourceUl) {
    var items = [];
    var outerLis = sourceUl.children;
    for (var i = 0; i < outerLis.length; i++) {
      var li = outerLis[i];
      if (li.tagName !== "LI") continue;
      var img = li.getElementsByTagName("img")[0];
      var anchor = li.getElementsByTagName("a")[0];
      if (!img || !anchor) continue;

      var w = toInt(img.getAttribute("width"), 0);
      var h = toInt(img.getAttribute("height"), 0);

      items.push({
        href: anchor.getAttribute("href"),
        title: (anchor.textContent || anchor.innerText || "").replace(
          /^\s+|\s+$/g,
          ""
        ),
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
            "main, article, [role='main']" +
            "{ display: block !important; max-width: 78ch;" +
            " margin: 0 auto !important; }"
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
      if (!isOpen) return;
      historyPushed = false; /* the browser already popped our entry */
      doClose();
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

    // User-initiated close (button / backdrop / Esc). Unwinds our history entry
    // so the URL/history is left clean; the resulting popstate does the teardown.
    function close() {
      if (!isOpen) return;
      if (historyPushed) {
        historyPushed = false;
        window.history.back();
        return;
      }
      doClose();
    }

    function doClose() {
      if (!overlay) return;
      isOpen = false;
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
   *  Widget (one per enhanced <ul>)
   * ====================================================================== */

  function Widget(sourceUl) {
    this.source = sourceUl;
    this.items = parseItems(sourceUl);
    this.mode = sourceUl.getAttribute("data-mode") === "masonry"
      ? "masonry"
      : "carousel";

    var timerAttr = sourceUl.getAttribute("data-timer");
    // Autoplay is enabled only when a positive data-timer is provided.
    this.timer = null;
    if (timerAttr !== null && timerAttr !== "") {
      var t = toInt(timerAttr, DEFAULT_TIMER);
      this.timer = t > 0 ? t : null;
    }

    // The mode toggle UI can be disabled, locking the widget to data-mode.
    // data-toggle="off" | "disabled" | "false"  (default: enabled)
    var toggleAttr = (sourceUl.getAttribute("data-toggle") || "").toLowerCase();
    this.toggleEnabled = !(
      toggleAttr === "off" ||
      toggleAttr === "disabled" ||
      toggleAttr === "false" ||
      toggleAttr === "none"
    );

    // On narrow (mobile) viewports, links navigate directly instead of opening
    // the modal lightbox. The threshold is configurable per widget.
    this.mobileBreakpoint = toInt(
      sourceUl.getAttribute("data-mobile-breakpoint"),
      DEFAULT_MOBILE_BP
    );

    this.current = 0;
    this.autoplayId = null;
    this.hoverPaused = false;
    this.userStopped = false;
    this.masonryLaidOut = false;

    this.id = "lbg-" + ++idCounter;
    this.build();
  }

  Widget.prototype.build = function () {
    var self = this;

    var root = el("div", "lbg lbg--" + this.mode);
    root.id = this.id;
    this.root = root;

    // ---- Toolbar / mode toggle (omitted when disabled via data-toggle)
    if (this.toggleEnabled) {
      var toolbar = el("div", "lbg__toolbar");
      var modes = el("div", "lbg__modes");
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", "Display mode");

      this.carouselBtn = this.makeModeButton("carousel", "Carousel");
      this.masonryBtn = this.makeModeButton("masonry", "Grid");
      modes.appendChild(this.carouselBtn);
      modes.appendChild(this.masonryBtn);
      toolbar.appendChild(modes);
      root.appendChild(toolbar);
    }

    var stage = el("div", "lbg__stage");
    stage.appendChild(this.buildCarousel());
    stage.appendChild(this.buildMasonry());
    root.appendChild(stage);

    // Insert widget after the source list, then hide the source.
    this.source.parentNode.insertBefore(root, this.source.nextSibling);
    this.source.className += " lbg-source--enhanced";

    // Delegate link activation -> lightbox (same handler for both modes).
    // On mobile viewports, do NOT intercept: let the link navigate directly.
    // Modifier-clicks (new tab/window) are always left to the browser.
    root.addEventListener("click", function (e) {
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
    if (this.mode === "masonry") {
      this.layoutMasonry();
    }
    this.startAutoplay();

    // Relayout masonry on resize.
    this.onResize = debounce(function () {
      if (self.mode === "masonry") self.layoutMasonry();
    }, 120);
    window.addEventListener("resize", this.onResize);
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
      self.setMode(mode);
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

    var caption = el("span", "lbg__caption");
    caption.appendChild(document.createTextNode(item.title));

    link.appendChild(media);
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

    this.carousel = carousel;
    return carousel;
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

  /* ---- Masonry ---------------------------------------------------------- */

  Widget.prototype.buildMasonry = function () {
    var masonry = el("div", "lbg__masonry is-unlaid");
    this.masonryItems = [];
    for (var i = 0; i < this.items.length; i++) {
      var item = el("div", "lbg__item");
      var built = this.makeItemLink(this.items[i]);
      item.appendChild(built.link);
      item._media = built.media;
      item._data = this.items[i];
      masonry.appendChild(item);
      this.masonryItems.push(item);
    }
    this.masonry = masonry;
    return masonry;
  };

  // Best-fit masonry: place each item into the currently shortest column.
  Widget.prototype.layoutMasonry = function () {
    var container = this.masonry;
    if (!container || !this.masonryItems.length) return;
    // Can't measure when hidden (display:none => offsetWidth 0).
    if (container.offsetWidth === 0) {
      this.masonryLaidOut = false;
      return;
    }

    container.className = "lbg__masonry"; /* drop is-unlaid fallback */

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

  /* ---- Mode switching --------------------------------------------------- */

  Widget.prototype.setMode = function (mode) {
    if (mode !== "carousel" && mode !== "masonry") return;
    if (mode === this.mode) return;
    this.mode = mode;
    this.updateModeUI();

    if (mode === "masonry") {
      this.stopAutoplay();
      // Lay out now that the container is visible.
      this.layoutMasonry();
    } else {
      this.startAutoplay();
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
    this.carouselBtn.className =
      "lbg__mode-btn" + (this.mode === "carousel" ? " is-active" : "");
    this.masonryBtn.className =
      "lbg__mode-btn" + (this.mode === "masonry" ? " is-active" : "");
    this.carouselBtn.setAttribute(
      "aria-pressed",
      this.mode === "carousel" ? "true" : "false"
    );
    this.masonryBtn.setAttribute(
      "aria-pressed",
      this.mode === "masonry" ? "true" : "false"
    );
  };

  /* ====================================================================== *
   *  Public API / bootstrap
   * ====================================================================== */

  var instances = [];

  function init(root) {
    var scope = root || document;
    var lists = scope.getElementsByTagName("ul");
    // Copy to a static array first (we mutate the DOM while iterating).
    var toEnhance = [];
    for (var i = 0; i < lists.length; i++) {
      var ul = lists[i];
      if (hasRelToken(ul) && !ul._lbgEnhanced) {
        toEnhance.push(ul);
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

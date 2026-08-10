const { test, expect } = require("@playwright/test");

// The JS-positioned grids animate `left`/`top` via a CSS transition, so
// offsetLeft/offsetTop read mid-transition until the layout settles. Poll until
// every tile's geometry is unchanged for a few frames before measuring.
async function settleGrid(gridLocator) {
  await gridLocator.evaluate(
    (grid) =>
      new Promise((resolve) => {
        let last = "";
        let stable = 0;
        (function tick() {
          const sig = [...grid.querySelectorAll(".lbg__item")]
            .map(
              (it) =>
                it.offsetLeft +
                "," +
                it.offsetTop +
                "," +
                it.offsetWidth +
                "," +
                it.offsetHeight
            )
            .join("|");
          if (sig === last) stable++;
          else {
            stable = 0;
            last = sig;
          }
          if (stable >= 3) resolve();
          else requestAnimationFrame(tick);
        })();
      })
  );
}

// ---------------------------------------------------------------------------
// 1. Drive the in-browser harness (test.html) and require every assertion pass.
// ---------------------------------------------------------------------------
test("in-browser harness reports all assertions passing", async ({ page }) => {
  const failures = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") failures.push(msg.text());
  });

  await page.goto("/test.html");

  const summary = page.locator("#summary");
  await expect(summary).toHaveAttribute("data-status", "pass", { timeout: 15000 });
  await expect(summary).toContainText("ALL PASSED");

  // No FAIL rows in the results list.
  await expect(page.locator("#results li.err")).toHaveCount(0);
  expect(failures, "no uncaught console errors").toEqual([]);
});

// ---------------------------------------------------------------------------
// 2. End-to-end behaviour on the demo page.
// ---------------------------------------------------------------------------
test.describe("demo page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/index.html");
  });

  test("enhances every flagged container", async ({ page }) => {
    await expect(page.locator(".lbg")).toHaveCount(6);
    // Sources are hidden after enhancement — four lists plus two divs (one
    // div-markup, one JSON-in-a-comment).
    await expect(page.locator("ul.lbg-source--enhanced")).toHaveCount(4);
    await expect(page.locator("div.lbg-source--enhanced")).toHaveCount(2);
  });

  test("fourth widget locks to rows (data-toggle=off)", async ({ page }) => {
    const widget = page.locator(".lbg").nth(3); // demo 4: rows, toggle off
    await expect(widget).toHaveClass(/lbg--rows/);
    await expect(widget.locator(".lbg__modes")).toHaveCount(0);
  });

  test("div-sourced widget renders and opens the lightbox like a list one", async ({
    page,
  }) => {
    const widget = page.locator(".lbg").nth(4); // demo 5: div markup, rows
    await expect(widget).toHaveClass(/lbg--rows/);
    const items = widget.locator(".lbg__rows .lbg__item");
    await expect(items).toHaveCount(4);
    // Titles parse from div cells exactly as they do from <li> cells.
    await expect(items.first().locator(".lbg__title")).toHaveText("Coral");
    await expect(items.nth(1).locator(".lbg__title")).toHaveCount(0);

    await items.first().locator(".lbg__link").click();
    const overlay = page.locator(".lbg-lightbox");
    await expect(overlay).toHaveClass(/is-open/);
    await page.keyboard.press("Escape");
    await expect(overlay).not.toHaveClass(/is-open/);
  });

  test("json-in-a-comment source renders items with titles and descriptions", async ({
    page,
  }) => {
    const widget = page.locator(".lbg").nth(5); // demo 6: JSON comment, masonry
    await expect(widget).toHaveClass(/lbg--masonry/);
    const items = widget.locator(".lbg__masonry .lbg__item");
    await expect(items).toHaveCount(4);

    await expect(items.first().locator(".lbg__title")).toHaveText("Aurora");
    await expect(items.first().locator(".lbg__desc")).toHaveText(
      "Long-exposure frames from three nights above the tree line."
    );
    // Third entry supplies neither a title nor a description.
    await expect(items.nth(2).locator(".lbg__title")).toHaveCount(0);
    await expect(items.nth(2).locator(".lbg__desc")).toHaveCount(0);
    // Fourth supplies a title but no description.
    await expect(items.nth(3).locator(".lbg__title")).toHaveText("Violet");
    await expect(items.nth(3).locator(".lbg__desc")).toHaveCount(0);

    // Images carry the dimensions declared in the JSON.
    const img = items.first().locator("img");
    await expect(img).toHaveAttribute("width", "400");
    await expect(img).toHaveAttribute("height", "300");
    await expect(img).toHaveAttribute("alt", "Aurora");

    // And the items behave like any other: clicking opens the lightbox.
    await items.first().locator(".lbg__link").click();
    const overlay = page.locator(".lbg-lightbox");
    await expect(overlay).toHaveClass(/is-open/);
    await page.keyboard.press("Escape");
    await expect(overlay).not.toHaveClass(/is-open/);
  });

  test("page light/dark toggle swaps the widget stylesheet build", async ({ page }) => {
    const toggle = page.getByRole("button", { name: /Dark|Light/ });
    const sheet = page.locator("#lbgStylesheet");

    // Deployment links ONE theme file; the demo starts on the dark build.
    await expect(sheet).toHaveAttribute("href", /lightbox-grid-dark\.css/);
    await expect(page.locator("body")).not.toHaveClass(/theme-light/);

    await toggle.click(); // -> light build
    await expect(sheet).toHaveAttribute("href", /lightbox-grid-light\.css/);
    await expect(page.locator("body")).toHaveClass(/theme-light/);
    // The light build's orange accent drives the active mode button.
    const activeBtn = page.locator(".lbg").first().locator(".lbg__mode-btn.is-active");
    await expect(activeBtn).toHaveCSS("background-color", "rgb(228, 133, 33)"); // #e48521

    await toggle.click(); // -> dark build
    await expect(sheet).toHaveAttribute("href", /lightbox-grid-dark\.css/);
    await expect(page.locator("body")).not.toHaveClass(/theme-light/);
  });

  test("carousel next/prev navigation moves the track", async ({ page }) => {
    const widget = page.locator(".lbg").first();
    const track = widget.locator(".lbg__track");

    await expect(track).toHaveCSS("transform", "none"); // slide 0, translateX(0%)
    await widget.locator(".lbg__nav--next").click();
    // After advancing, a non-identity transform is applied.
    const t = await track.evaluate((el) => el.style.transform);
    expect(t).toContain("translateX(-100%)");

    await widget.locator(".lbg__nav--prev").click();
    const t0 = await track.evaluate((el) => el.style.transform);
    expect(t0).toContain("translateX(0%)");
  });

  test("carousel supports touch swipe navigation", async ({ page }) => {
    const widget = page.locator(".lbg").first();
    const viewport = widget.locator(".lbg__viewport");
    await expect(widget.locator(".lbg__dot").nth(0)).toHaveClass(/is-active/);

    // Dispatch a synthetic horizontal swipe: fromX -> toX.
    const swipe = (fromX, toX) =>
      viewport.evaluate(
        (vp, [a, b]) => {
          const tev = (type, x) => {
            const ev = new Event(type, { bubbles: true, cancelable: true });
            const pt = { clientX: x, clientY: 150 };
            ev.touches = type === "touchend" ? [] : [pt];
            ev.changedTouches = [pt];
            vp.dispatchEvent(ev);
          };
          tev("touchstart", a);
          tev("touchmove", a + (b < a ? -10 : 10));
          tev("touchmove", b);
          tev("touchend", b);
        },
        [fromX, toX]
      );

    await swipe(320, 60); // swipe left -> next slide
    await expect(widget.locator(".lbg__dot").nth(1)).toHaveClass(/is-active/);

    await swipe(60, 330); // swipe right -> previous slide
    await expect(widget.locator(".lbg__dot").nth(0)).toHaveClass(/is-active/);
  });

  test("mode toggle switches between all three modes", async ({ page }) => {
    const widget = page.locator(".lbg").first();
    await expect(widget).toHaveClass(/lbg--carousel/);

    await widget.getByRole("button", { name: "Masonry", exact: true }).click();
    await expect(widget).toHaveClass(/lbg--masonry/);
    // Masonry items are absolutely positioned once laid out.
    const mItem = widget.locator(".lbg__masonry .lbg__item").first();
    await expect(mItem).toHaveCSS("position", "absolute");

    await widget.getByRole("button", { name: "Rows", exact: true }).click();
    await expect(widget).toHaveClass(/lbg--rows/);
    const rItem = widget.locator(".lbg__rows .lbg__item").first();
    await expect(rItem).toHaveCSS("position", "absolute");

    await widget.getByRole("button", { name: "Carousel", exact: true }).click();
    await expect(widget).toHaveClass(/lbg--carousel/);
  });

  test("third widget has no toggle (data-toggle=off) and stays masonry", async ({ page }) => {
    const widget = page.locator(".lbg").nth(2);
    await expect(widget).toHaveClass(/lbg--masonry/);
    await expect(widget.locator(".lbg__modes")).toHaveCount(0);
  });

  test("masonry produces a positive container height", async ({ page }) => {
    const widget = page.locator(".lbg").nth(2); // demo 3 is masonry (toggle off)
    const h = await widget
      .locator(".lbg__masonry")
      .evaluate((el) => parseInt(el.style.height, 10));
    expect(h).toBeGreaterThan(0);
  });

  test("rows (justified) fills each row to the full container width", async ({ page }) => {
    const widget = page.locator(".lbg").nth(1); // demo 2 starts in rows
    await expect(widget).toHaveClass(/lbg--rows/);
    await settleGrid(widget.locator(".lbg__rows"));

    const geom = await widget.locator(".lbg__rows").evaluate((grid) => {
      const cw = grid.clientWidth;
      const items = [...grid.querySelectorAll(".lbg__item")].map((it) => ({
        top: it.offsetTop,
        right: it.offsetLeft + it.offsetWidth,
      }));
      return { cw, containerH: parseInt(grid.style.height, 10), items };
    });

    expect(geom.containerH).toBeGreaterThan(0);

    // Group items by row (shared top) and confirm each COMPLETE row's right edge
    // reaches the container width (justified fill). The last row may be short.
    const rows = {};
    for (const it of geom.items) (rows[it.top] = rows[it.top] || []).push(it);
    const tops = Object.keys(rows);
    tops.forEach((t, i) => {
      const isLast = i === tops.length - 1;
      const rightEdge = Math.max(...rows[t].map((it) => it.right));
      if (!isLast) expect(Math.abs(rightEdge - geom.cw)).toBeLessThanOrEqual(1);
    });
  });

  test("optional title renders inline as a bold lead; untitled items omit it", async ({ page }) => {
    const widget = page.locator(".lbg").nth(1); // demo 2: rows, mixed titles
    const items = widget.locator(".lbg__rows .lbg__item");

    // The Amber item declares a title <li>; it renders as a bold .lbg__title
    // lead, inline with the link label in one caption ("Amber — golden hour glow").
    const amber = items.filter({ hasText: "golden hour glow" });
    await expect(amber.locator(".lbg__title")).toHaveText("Amber");
    await expect(amber.locator(".lbg__caption")).toHaveText("Amber — golden hour glow");

    // The Meadow item declares no title <li>: no .lbg__title element at all.
    const untitled = items.filter({ hasText: "Meadow (no title)" });
    await expect(untitled).toHaveCount(1);
    await expect(untitled.locator(".lbg__title")).toHaveCount(0);
  });

  test("rows give every tile in a row a consistent height (title-aware)", async ({ page }) => {
    const widget = page.locator(".lbg").nth(1); // demo 2 starts in rows
    await expect(widget).toHaveClass(/lbg--rows/);
    await settleGrid(widget.locator(".lbg__rows"));

    // Group tiles by their top offset (one group per justified row); within any
    // multi-item row, uneven title/label lengths must NOT produce uneven heights.
    const rows = await widget.locator(".lbg__rows").evaluate((grid) => {
      const map = {};
      grid.querySelectorAll(".lbg__item").forEach((it) => {
        (map[it.offsetTop] = map[it.offsetTop] || []).push(it.offsetHeight);
      });
      return Object.keys(map).map((k) => map[k]);
    });

    let multiItemRows = 0;
    for (const heights of rows) {
      if (heights.length < 2) continue;
      multiItemRows++;
      const h0 = heights[0];
      for (const h of heights) expect(Math.abs(h - h0)).toBeLessThanOrEqual(1);
    }
    expect(multiItemRows).toBeGreaterThan(0);
  });

  test("lightbox opens, strips nav/footer, and closes", async ({ page }) => {
    const widget = page.locator(".lbg").nth(2); // masonry, toggle off
    // Each widget builds both mode DOMs; click the link in the VISIBLE one.
    await widget.locator(".lbg__masonry .lbg__link").first().click();

    const overlay = page.locator(".lbg-lightbox");
    await expect(overlay).toHaveClass(/is-open/);

    const frame = page.frameLocator(".lbg-lightbox__frame");
    // Main content stays visible; nav/header/footer are hidden.
    await expect(frame.locator("main")).toBeVisible();
    await expect(frame.locator("nav")).toBeHidden();
    await expect(frame.locator("header")).toBeHidden();
    await expect(frame.locator("footer")).toBeHidden();

    // Injected marker style present.
    const injected = await page
      .locator(".lbg-lightbox__frame")
      .evaluate((f) => !!f.contentDocument.querySelector("style[data-lbg-injected]"));
    expect(injected).toBe(true);

    // Close with Escape and restore.
    await page.keyboard.press("Escape");
    await expect(overlay).not.toHaveClass(/is-open/);
    await expect(page.locator("body")).not.toHaveClass(/lbg-lightbox-open/);
  });

  test("overlay content is not width constrained by the page's own measure cap", async ({
    page,
  }) => {
    const widget = page.locator(".lbg").nth(2);
    await widget.locator(".lbg__masonry .lbg__link").first().click();
    await expect(page.locator(".lbg-lightbox")).toHaveClass(/is-open/);

    const dialog = await page.locator(".lbg-lightbox__dialog").boundingBox();
    const frame = page.frameLocator(".lbg-lightbox__frame");
    const main = await frame.locator("main").first().boundingBox();

    // page.css caps `.site-main article` at 72ch (~700px); the injected styles
    // must override it so the content tracks the (wide) dialog instead.
    const article = await frame.locator("article").first().boundingBox();
    expect(main.width).toBeGreaterThan(dialog.width * 0.9);
    expect(article.width).toBeGreaterThan(dialog.width * 0.85);
  });

  test("close (×) button dismisses the lightbox", async ({ page }) => {
    const widget = page.locator(".lbg").nth(2);
    await widget.locator(".lbg__masonry .lbg__link").first().click();
    const overlay = page.locator(".lbg-lightbox");
    await expect(overlay).toHaveClass(/is-open/);

    await page.locator(".lbg-lightbox__close").click();
    await expect(overlay).not.toHaveClass(/is-open/);
    await expect(page.locator("body")).not.toHaveClass(/lbg-lightbox-open/);
    await expect(page).toHaveURL(/index\.html$/);
  });

  test("close (×) still dismisses after close + reopen", async ({ page }) => {
    // Regression: the × must not depend on an async popstate to tear down.
    const widget = page.locator(".lbg").nth(2);
    const link = widget.locator(".lbg__masonry .lbg__link").first();
    const overlay = page.locator(".lbg-lightbox");
    const closeBtn = page.locator(".lbg-lightbox__close");

    await link.click();
    await expect(overlay).toHaveClass(/is-open/);
    await closeBtn.click();
    await expect(overlay).not.toHaveClass(/is-open/);

    await link.click();
    await expect(overlay).toHaveClass(/is-open/);
    await closeBtn.click();
    await expect(overlay).not.toHaveClass(/is-open/);
  });

  test("backdrop click closes the lightbox", async ({ page }) => {
    const widget = page.locator(".lbg").first(); // carousel
    await widget.locator(".lbg__carousel .lbg__link").first().click();
    const overlay = page.locator(".lbg-lightbox");
    await expect(overlay).toHaveClass(/is-open/);
    // The dialog covers the backdrop's center; click an off-center corner.
    await page.locator(".lbg-lightbox__backdrop").click({ position: { x: 6, y: 6 } });
    await expect(overlay).not.toHaveClass(/is-open/);
  });

  test("back button / history closes the lightbox in one step", async ({ page }) => {
    const widget = page.locator(".lbg").nth(2);
    const link = widget.locator(".lbg__masonry .lbg__link").first();
    const overlay = page.locator(".lbg-lightbox");

    await link.click();
    await expect(overlay).toHaveClass(/is-open/);

    // A single hardware/browser back must close the overlay, not leave the page.
    await page.goBack();
    await expect(overlay).not.toHaveClass(/is-open/);
    await expect(page).toHaveURL(/index\.html$/);
  });

  test("back still closes in one step after close + reopen", async ({ page }) => {
    // Regression: iframe navigations must not accumulate history entries, or a
    // reopened lightbox would need multiple Backs (first rewinding the iframe).
    const widget = page.locator(".lbg").nth(2);
    const link = widget.locator(".lbg__masonry .lbg__link").first();
    const overlay = page.locator(".lbg-lightbox");

    await link.click();
    await expect(overlay).toHaveClass(/is-open/);
    await page.keyboard.press("Escape"); // close (unwinds the history entry)
    await expect(overlay).not.toHaveClass(/is-open/);

    await link.click(); // reopen
    await expect(overlay).toHaveClass(/is-open/);

    await page.goBack(); // exactly one Back should close it
    await expect(overlay).not.toHaveClass(/is-open/);
    await expect(page).toHaveURL(/index\.html$/);
  });
});

// ---------------------------------------------------------------------------
// 3. Mobile behaviour: links navigate directly instead of opening the modal.
// ---------------------------------------------------------------------------
test.describe("mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("link navigates directly (no lightbox modal)", async ({ page }) => {
    await page.goto("/index.html");
    const widget = page.locator(".lbg").nth(2);
    // On mobile the widget shows the carousel, so click a visible carousel link.
    const link = widget.locator(".lbg__carousel .lbg__link").first();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/pages\/page-\d+\.html/);

    await link.click();
    await page.waitForURL(/pages\/page-\d+\.html$/);
    // No modal overlay was created.
    await expect(page.locator(".lbg-lightbox.is-open")).toHaveCount(0);
  });

  test("defaults to carousel on mobile even for a grid data-mode", async ({ page }) => {
    await page.goto("/index.html");
    // Demo 2 declares data-mode="rows" and demo 3 data-mode="masonry"; neither
    // sets data-mobile-mode, so both fall back to the carousel on mobile.
    await expect(page.locator(".lbg").nth(1)).toHaveClass(/lbg--carousel/);
    await expect(page.locator(".lbg").nth(2)).toHaveClass(/lbg--carousel/);
  });

  test("mode toggle is suppressed on mobile", async ({ page }) => {
    await page.goto("/index.html");
    // Demo 1 and 2 have the toggle enabled; it must be hidden on mobile.
    await expect(page.locator(".lbg").nth(0).locator(".lbg__modes")).toBeHidden();
    await expect(page.locator(".lbg").nth(1).locator(".lbg__modes")).toBeHidden();
  });

  test("data-mobile-mode overrides the mobile default", async ({ page }) => {
    await page.goto("/index.html");
    await page.evaluate(() => {
      const ul = document.createElement("ul");
      ul.id = "override-fixture";
      ul.setAttribute("rel", "lightbox-grid");
      ul.setAttribute("data-mode", "carousel");
      ul.setAttribute("data-mobile-mode", "masonry");
      ul.innerHTML =
        '<li><ul><li><img src="images/img1.svg" width="400" height="300" alt="a"></li>' +
        '<li><a href="/pages/page-1.html">A</a></li></ul></li>' +
        '<li><ul><li><img src="images/img2.svg" width="400" height="520" alt="b"></li>' +
        '<li><a href="/pages/page-2.html">B</a></li></ul></li>';
      document.querySelector(".page").appendChild(ul);
      window.LightboxGrid.init();
    });
    await expect(page.locator("#override-fixture + .lbg")).toHaveClass(/lbg--masonry/);
  });
});

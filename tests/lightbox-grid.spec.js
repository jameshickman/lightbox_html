const { test, expect } = require("@playwright/test");

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

  test("enhances every flagged list", async ({ page }) => {
    await expect(page.locator(".lbg")).toHaveCount(3);
    // Source lists are hidden after enhancement.
    await expect(page.locator("ul.lbg-source--enhanced")).toHaveCount(3);
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

  test("mode toggle switches carousel <-> masonry", async ({ page }) => {
    const widget = page.locator(".lbg").first();
    await expect(widget).toHaveClass(/lbg--carousel/);

    await widget.getByRole("button", { name: "Grid" }).click();
    await expect(widget).toHaveClass(/lbg--masonry/);
    // Masonry items are absolutely positioned once laid out.
    const first = widget.locator(".lbg__masonry .lbg__item").first();
    await expect(first).toHaveCSS("position", "absolute");

    await widget.getByRole("button", { name: "Carousel" }).click();
    await expect(widget).toHaveClass(/lbg--carousel/);
  });

  test("third widget has no toggle (data-toggle=off) and stays masonry", async ({ page }) => {
    const widget = page.locator(".lbg").nth(2);
    await expect(widget).toHaveClass(/lbg--masonry/);
    await expect(widget.locator(".lbg__modes")).toHaveCount(0);
  });

  test("masonry produces a positive container height", async ({ page }) => {
    const widget = page.locator(".lbg").nth(1); // demo 2 starts in masonry
    const h = await widget
      .locator(".lbg__masonry")
      .evaluate((el) => parseInt(el.style.height, 10));
    expect(h).toBeGreaterThan(0);
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

  test("defaults to carousel on mobile even when data-mode is masonry", async ({ page }) => {
    await page.goto("/index.html");
    // Demo 2 and 3 declare data-mode="masonry" but have no data-mobile-mode.
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

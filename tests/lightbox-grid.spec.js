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

  test("backdrop click closes the lightbox", async ({ page }) => {
    const widget = page.locator(".lbg").first(); // carousel
    await widget.locator(".lbg__carousel .lbg__link").first().click();
    const overlay = page.locator(".lbg-lightbox");
    await expect(overlay).toHaveClass(/is-open/);
    // The dialog covers the backdrop's center; click an off-center corner.
    await page.locator(".lbg-lightbox__backdrop").click({ position: { x: 6, y: 6 } });
    await expect(overlay).not.toHaveClass(/is-open/);
  });
});

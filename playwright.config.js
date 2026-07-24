// Playwright config — serves the project over a real HTTP server so that the
// lightbox iframe loads same-origin pages (file:// would break origin checks).
const { defineConfig, devices } = require("@playwright/test");

// 8080 is commonly occupied in this environment; use a less-common port.
const PORT = 8137;

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:" + PORT,
    trace: "on-first-retry"
  },
  webServer: {
    command: "npx --yes http-server -p " + PORT + " -c-1 .",
    url: "http://localhost:" + PORT + "/index.html",
    // Reuse a server already listening on PORT (e.g. `npm run serve`); otherwise
    // start one. Safe here because PORT is uncommon and serves this project.
    reuseExistingServer: true,
    timeout: 30000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } }
  ]
});

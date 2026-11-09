import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = new URL(process.argv[2] || "http://127.0.0.1:8013/reading-prototype.html");
const { defaultBrowserType, ...mobile } = devices["iPhone 13"];
const engine = process.env.BROWSER_ENGINE || "webkit";
const browser = engine === "chromium" ? await chromium.launch({ channel: "chrome" }) : await webkit.launch();
try {
  const context = await browser.newContext(mobile);
  // Only the app origin is needed for isolated demo data and assets.
  await context.route("**/*", route => new URL(route.request().url()).origin === url.origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(url.href);
  await page.getByText("デモを試す", { exact: true }).click();
  await page.locator('[data-action="login"][data-id="shiori"]').click();
  const surface = page.locator(".orbit-canvas");
  const selected = () => surface.getAttribute("data-selected-id");
  await surface.waitFor();
  const first = await selected();
  const box = await surface.boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height < mobile.viewport.height);
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  assert.match(await surface.evaluate(el => getComputedStyle(el).touchAction), /pan-y/);
  if (engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    const swipe = async (dx, dy) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(-140, 4);
    const afterHorizontal = await selected();
    assert.notEqual(afterHorizontal, first);
    assert.ok(await page.evaluate(() => scrollY < 5));
    await swipe(4, -148);
    await page.waitForFunction(() => scrollY > 20);
    assert.equal(await selected(), afterHorizontal);
    console.log("Chrome touch: vertical swipe scrolled; horizontal swipe selected without scrolling.");
  } else {
    const drag = async (dx, dy) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      await page.mouse.up();
    };
    await drag(4, -110);
    assert.equal(await selected(), first);
    await drag(-140, 4);
    assert.notEqual(await selected(), first);
    console.log("WebKit: vertical mouse drag did not select; horizontal drag selected.");
  }

  // Use a completed fixture without a spoiler, regardless of the swipe result.
  await page.goto(new URL("#/record/r1", url).href);
  await page.locator(".detail-commands [data-action=edit]").click();
  const field = page.locator("#impression");
  const form = page.locator("#record-form");
  const save = form.getByRole("button", { name: "変更を保存", exact: true });
  const counter = form.locator("#impression-counter");
  const beforeComposition = await counter.textContent();
  await field.focus();
  await field.evaluate(input => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = "しずかなよいん";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  });
  await field.press("Enter");
  assert.ok(await form.isVisible(), "Enter during composition must not save the draft");
  await field.evaluate(input => input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: false })));
  assert.equal(await counter.textContent(), beforeComposition, "unconfirmed text must not update the count");
  await save.tap();
  assert.ok(await form.isVisible(), "explicit save must also wait for active composition");
  const converted = "静かな余韻";
  await field.evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: value }));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
  }, converted);
  assert.equal(await counter.textContent(), "5 / 20");
  await field.press("Enter");
  assert.ok(await form.isVisible(), "an Enter delivered after compositionend must not implicitly save");
  await save.tap();
  await form.waitFor({ state: "hidden" });
  const note = page.locator("#orbit-caption .impression-text");
  assert.equal(await note.textContent(), converted);
  const recordHref = await page.locator("#orbit-caption h2 a").getAttribute("href");
  await page.goto(new URL(recordHref, url).href);
  await page.reload();
  assert.equal(await page.locator(".detail-head .impression-text").textContent(), converted);
  await mkdir(new URL("../outputs/qa/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(`../outputs/qa/mobile-input-${engine}.png`, import.meta.url)) });
  console.log(`${engine}: simulated composition confirmed, saved and restored "${converted}".`);
} finally {
  await browser.close();
}

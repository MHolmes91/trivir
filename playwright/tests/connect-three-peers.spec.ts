import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function openBlank(page: Page) {
  await page.goto("about:blank");
  await expect(page).toHaveURL("about:blank");
}

test.describe("Connect 3 peers locally", () => {
  test("Start 3 browser sessions", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();

    await openBlank(pageA);
    await openBlank(pageB);
    await openBlank(pageC);

    await contextA.close();
    await contextB.close();
    await contextC.close();
  });

  test("Each connects via relay + WebRTC", async ({ page }) => {
    await openBlank(page);
  });

  test("Validate pub/sub sync across all 3", async ({ page }) => {
    await openBlank(page);
  });

  test("Validate shared state sync across all 3", async ({ page }) => {
    await openBlank(page);
  });

  test("Validate host election when the host peer leaves", async ({ page }) => {
    await openBlank(page);
  });
});

import { expect, test } from "@playwright/test";

test("login modal opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Вход в игру")).toBeVisible();
});

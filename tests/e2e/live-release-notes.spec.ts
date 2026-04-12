import { test, expect } from '@playwright/test';

test('release notes modal shows the latest version and highlights on live site', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('mind-diary:last-seen-version');
  });
  await page.reload();

  const modal = page.getByText('在你不在的時候，我們加入了這些功能').locator('..').locator('..');
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).toBeVisible();
  await expect(modal).toContainText('v0.18.6');
  await expect(page.getByText('更新提示現在會跟著實際版本更新，不再停留在舊內容。')).toBeVisible();
  await expect(page.getByText('日記的 AI 標題更穩定，會優先產生可用標題，避免怪異短字。')).toBeVisible();

  await page.getByRole('button', { name: '我知道了' }).click();
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).not.toBeVisible();
});

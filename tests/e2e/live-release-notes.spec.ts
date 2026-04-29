import { test, expect } from '@playwright/test';

test('release notes modal shows the latest version and highlights on live site', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('mind-diary:last-seen-version');
  });
  await page.reload();

  const modal = page.getByText('在你不在的時候，我們加入了這些功能').locator('..').locator('..');
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).toBeVisible();
  await expect(modal).toContainText('v0.18.7');
  await expect(page.getByText('登入頁加入「忘記密碼？」按鈕，點擊後會提示請聯絡管理員協助重設。')).toBeVisible();
  await expect(page.getByText('管理員可在「使用者管理」頁面為任何使用者直接重設密碼。')).toBeVisible();

  await page.getByRole('button', { name: '我知道了' }).click();
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).not.toBeVisible();
});

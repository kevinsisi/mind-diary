import { test, expect } from '@playwright/test';

test('release notes modal shows the latest version and highlights on live site', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('mind-diary:last-seen-version');
  });
  await page.reload();

  const modal = page.getByText('在你不在的時候，我們加入了這些功能').locator('..').locator('..');
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).toBeVisible();
  await expect(modal).toContainText('v0.18.11');
  await expect(
    page.getByText(
      '每輪對話會把 AI 判斷出的回覆模式、信心與判斷依據寫入對話派發摘要，方便排查錯誤路由。',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      '新增 live smoke 測試覆蓋 practical、reflective、support-action 邊界，避免情緒與問題處理再退回亂判。',
    ),
  ).toBeVisible();

  await page.getByRole('button', { name: '我知道了' }).click();
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).not.toBeVisible();
});

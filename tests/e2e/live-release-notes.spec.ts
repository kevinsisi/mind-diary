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
  await expect(modal).toContainText('v0.18.8');
  await expect(
    page.getByText('當你心情很糟又遇到問題時，對話會先穩住情緒，再整理可執行的下一步。'),
  ).toBeVisible();
  await expect(
    page.getByText('回覆會減少空泛安慰，改成問題拆解、低負擔待辦與可直接照著說的句子。'),
  ).toBeVisible();

  await page.getByRole('button', { name: '我知道了' }).click();
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).not.toBeVisible();
});

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
  await expect(modal).toContainText('v0.18.10');
  await expect(
    page.getByText(
      '聊天流程改成先由 AI 讀取目前訊息、對話標題與最近歷史，再決定要規劃、直接解題、行動支持或陪伴反思。',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      '規劃、實用問題與情緒困境不再先被硬關鍵字帶路；關鍵字規則只保留在 AI 意圖分析失敗時降級使用。',
    ),
  ).toBeVisible();

  await page.getByRole('button', { name: '我知道了' }).click();
  await expect(page.getByText('在你不在的時候，我們加入了這些功能')).not.toBeVisible();
});

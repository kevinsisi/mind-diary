import { test, expect } from '@playwright/test';
import { dismissReleaseNotes } from './helpers';

test('guest can browse files and use search UI on live site', async ({ page }) => {
  await page.goto('/files');
  await dismissReleaseNotes(page);

  await expect(page.getByText('您目前以訪客身份瀏覽，資料為公共空間。登入以存取個人檔案。')).toBeVisible();
  await expect(page.getByText('檔案管理')).toBeVisible();
  await expect(page.getByText('拖曳檔案到此處，或點擊瀏覽')).toBeVisible();

  await page.goto('/search');
  await expect(page.getByPlaceholder('搜尋日記、對話、檔案...')).toBeVisible();
  await page.getByPlaceholder('搜尋日記、對話、檔案...').fill('京都');
  await page.getByRole('button', { name: '搜尋' }).click();

  await expect(page.getByText(/找到 \d+ 筆結果/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: '全部' })).toBeVisible();
  await expect(page.getByRole('button', { name: '日記' })).toBeVisible();
  await expect(page.getByRole('button', { name: '檔案' })).toBeVisible();
  await expect(page.getByRole('button', { name: '對話' })).toBeVisible();
  await expect(page.locator('main')).toContainText(/京都|找不到符合的結果/);
});

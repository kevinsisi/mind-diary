import { test, expect } from '@playwright/test';
import { dismissReleaseNotes } from './helpers';

test('mobile guest can open sidebar and navigate between public pages', async ({ page }) => {
  await page.goto('/');
  await dismissReleaseNotes(page);

  await page.getByRole('button', { name: '開啟側欄' }).click();
  await expect(page.getByRole('link', { name: '對話' })).toBeVisible();
  await page.getByRole('link', { name: '對話' }).click();
  await expect(page).toHaveURL(/\/chat$/);

  await page.getByRole('button', { name: '開啟側欄' }).click();
  await page.getByRole('link', { name: '檔案' }).click();
  await expect(page).toHaveURL(/\/files$/);

  await page.getByRole('button', { name: '開啟側欄' }).click();
  await page.getByRole('link', { name: '搜尋' }).click();
  await expect(page).toHaveURL(/\/search$/);
});

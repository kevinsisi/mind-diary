import { test, expect } from '@playwright/test';
import { dismissReleaseNotes } from './helpers';

test('guest navigation and protected diary redirect behave correctly on live site', async ({ page }) => {
  await page.goto('/');
  await dismissReleaseNotes(page);

  await expect(page.getByRole('link', { name: '首頁' })).toBeVisible();
  await expect(page.getByText(/訪客模式/).first()).toBeVisible();

  await page.getByRole('link', { name: '日記' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('請登入您的帳號')).toBeVisible();
  await expect(page.getByText('日記功能需要登入')).toBeVisible();

  await page.getByRole('button', { name: '以訪客模式瀏覽 →' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole('link', { name: '對話' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText(/訪客模式/).first()).toBeVisible();

  await page.getByRole('link', { name: '搜尋' }).click();
  await expect(page).toHaveURL(/\/search$/);
});

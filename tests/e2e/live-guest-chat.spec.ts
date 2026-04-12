import { test, expect } from '@playwright/test';
import { cleanupGuestSessions, dismissReleaseNotes, sendChatMessage } from './helpers';

test('guest chat honors concise reply UX on live site', async ({ page, request }) => {
  const marker = `PWLIVE_${Date.now()}`;

  await cleanupGuestSessions(request, marker);
  try {
    await page.goto('/chat');
    await dismissReleaseNotes(page);

    await expect(page.getByText(/訪客模式/).first()).toBeVisible();
    await page.getByRole('button', { name: '新增對話' }).click();

    await sendChatMessage(page, `請記住代號 ${marker}。`);
    await expect(page.locator('main')).toContainText(marker, { timeout: 60_000 });

    await sendChatMessage(page, '剛剛的代號是什麼？只回答代號本身，不要加其他文字。');
    const codeReply = page.locator('[data-message-role="assistant"] p').filter({ hasText: marker }).last();
    await expect(codeReply).toBeVisible({ timeout: 60_000 });
    await expect(codeReply).toContainText(marker);
    await expect(codeReply).not.toContainText('阿思');
    await expect(codeReply).not.toContainText('🔥');

    await page.getByRole('button', { name: '新增對話' }).click();
    await sendChatMessage(page, `今天我被主管當眾否定提案，所以很委屈。測試代號 ${marker}。`);
    await expect(page.locator('main')).toContainText('今天我被主管當眾否定提案，所以很委屈。', { timeout: 60_000 });

    await sendChatMessage(page, '你記得我剛剛為什麼委屈嗎？請用一句話直接回答。');
    const finalReply = page.locator('[data-message-role="assistant"] p').last();
    await expect(finalReply).toBeVisible({ timeout: 60_000 });
    await expect(finalReply).toContainText(/提案|主管|否定/);
    await expect(finalReply).toContainText('委屈');
    await expect(finalReply).not.toContainText('🔥');
    await expect(finalReply).not.toContainText('🩵');
    await expect(finalReply).not.toContainText('阿思');
  } finally {
    await cleanupGuestSessions(request, marker);
  }
});

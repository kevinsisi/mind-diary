import { test, expect } from '@playwright/test';
import {
  cleanupGuestSessions,
  dismissReleaseNotes,
  getGuestAssistantDispatchReasons,
  sendChatMessage,
} from './helpers';

test('live guest chat keeps practical and reflective routing boundaries stable', async ({
  page,
  request,
}) => {
  const marker = `PWBOUND_${Date.now()}`;

  await cleanupGuestSessions(request, marker);
  try {
    await page.goto('/chat');
    await dismissReleaseNotes(page);

    await page.getByRole('button', { name: '新增對話' }).click();
    await sendChatMessage(page, `火鍋或拉麵選哪個？測試代號 ${marker}`);
    const firstPractical = page.locator('[data-message-role="assistant"]').last();
    await expect(firstPractical).toBeVisible({ timeout: 60_000 });
    await expect(firstPractical).toContainText(/火鍋|拉麵/);
    await expect(firstPractical).not.toContainText('阿思');
    await expect(firstPractical).not.toContainText('樂樂');
    await expect
      .poll(async () => getGuestAssistantDispatchReasons(request, marker), { timeout: 60_000 })
      .toContainEqual(expect.stringMatching(/回覆模式：practical/));

    await sendChatMessage(page, '直接說結論');
    const directConclusion = page.locator('[data-message-role="assistant"]').last();
    await expect(directConclusion).toBeVisible({ timeout: 60_000 });
    await expect(directConclusion).toContainText(/火鍋|拉麵/);
    await expect(directConclusion).not.toContainText('阿思');
    await expect(directConclusion).not.toContainText('樂樂');

    await page.getByRole('button', { name: '新增對話' }).click();
    await sendChatMessage(page, `我最近很焦慮，不知道怎麼辦。測試代號 ${marker}`);
    const reflectiveReply = page.locator('[data-message-role="assistant"]').last();
    await expect(reflectiveReply).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('main')).toContainText(marker);
    await expect(reflectiveReply).toContainText(/焦慮|呼吸|感受|陪/);
    await expect
      .poll(async () => getGuestAssistantDispatchReasons(request, marker), { timeout: 60_000 })
      .toContainEqual(expect.stringMatching(/回覆模式：reflective/));

    await sendChatMessage(page, '給我答案');
    const reflectiveFollowup = page.locator('[data-message-role="assistant"]').last();
    await expect(reflectiveFollowup).toBeVisible({ timeout: 60_000 });
    await expect(reflectiveFollowup).toContainText(/焦慮|呼吸|感受|陪/);

    await page.getByRole('button', { name: '新增對話' }).click();
    await sendChatMessage(
      page,
      `我被主管當眾否定提案，心情很糟，不知道怎麼處理。測試代號 ${marker}`,
    );
    const supportActionReply = page.locator('[data-message-role="assistant"]').last();
    await expect(supportActionReply).toBeVisible({ timeout: 60_000 });
    await expect(supportActionReply).toContainText(/主管|提案|處理|下一步|先/);
    await expect
      .poll(async () => getGuestAssistantDispatchReasons(request, marker), { timeout: 60_000 })
      .toContainEqual(expect.stringMatching(/回覆模式：support_action/));
  } finally {
    await cleanupGuestSessions(request, marker);
  }
});

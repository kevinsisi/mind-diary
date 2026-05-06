import { expect, Page, Request } from '@playwright/test';

export async function dismissReleaseNotes(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: '我知道了' });
  if (
    await button
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await button.click();
  }
}

export async function waitForAssistantReply(page: Page, text?: RegExp): Promise<void> {
  const assistantMessages = page.locator(
    '[data-message-role="assistant"], .prose, .whitespace-pre-wrap',
  );
  if (text) {
    await expect(page.getByText(text)).toBeVisible({ timeout: 60_000 });
    return;
  }
  await expect(assistantMessages.last()).toBeVisible({ timeout: 60_000 });
}

export async function cleanupGuestSessions(request: Request, marker: string): Promise<void> {
  const sessionsResponse = await request.get('/api/chat/sessions');
  if (!sessionsResponse.ok()) return;
  const body = (await sessionsResponse.json()) as {
    sessions?: Array<{ id: number; title: string; last_message?: string }>;
  };
  const sessions = body.sessions || [];
  for (const session of sessions) {
    let shouldDelete = session.title?.includes(marker) || session.last_message?.includes(marker);

    if (!shouldDelete) {
      const messagesResponse = await request.get(`/api/chat/sessions/${session.id}/messages`);
      if (messagesResponse.ok()) {
        const body = (await messagesResponse.json()) as { messages?: Array<{ content?: string }> };
        const messages = body.messages || [];
        shouldDelete = messages.some((message) => String(message.content || '').includes(marker));
      }
    }

    if (shouldDelete) {
      await request.delete(`/api/chat/sessions/${session.id}`);
    }
  }
}

export async function getGuestAssistantDispatchReasons(
  request: Request,
  marker: string,
): Promise<string[]> {
  const sessionsResponse = await request.get('/api/chat/sessions');
  if (!sessionsResponse.ok()) return [];
  const body = (await sessionsResponse.json()) as {
    sessions?: Array<{ id: number; title?: string; last_message?: string }>;
  };
  const sessions = body.sessions || [];
  const reasons: string[] = [];

  for (const session of sessions) {
    const messagesResponse = await request.get(`/api/chat/sessions/${session.id}/messages`);
    if (!messagesResponse.ok()) continue;
    const messagesBody = (await messagesResponse.json()) as {
      messages?: Array<{ role?: string; content?: string; dispatch_reason?: string | null }>;
    };
    const messages = messagesBody.messages || [];
    if (!messages.some((message) => String(message.content || '').includes(marker))) continue;

    for (const message of messages) {
      if (message.role === 'assistant' && message.dispatch_reason) {
        reasons.push(message.dispatch_reason);
      }
    }
  }

  return reasons;
}

export async function sendChatMessage(page: Page, content: string): Promise<void> {
  const input = page.getByPlaceholder(/輸入訊息或貼上圖片/);
  const sendButton = page.getByRole('button', { name: '發送訊息' });

  await expect(sendButton).toBeVisible({ timeout: 60_000 });
  await input.fill(content);
  await expect(sendButton).toBeEnabled({ timeout: 60_000 });
  await sendButton.click();
  await expect(page.getByRole('button', { name: '發送訊息' })).toBeVisible({ timeout: 60_000 });
}

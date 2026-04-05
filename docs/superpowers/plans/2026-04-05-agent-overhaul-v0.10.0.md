# Mind Diary Agent Overhaul v0.10.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing 5 AI agents with 13 Inside Out–inspired characters and rename all "派遣" / "派遣中心" UI text to "邀請" / "夥伴小屋".

**Architecture:** All agent definitions live in `packages/server/src/ai/agents.ts`; the AI selection prompt in `diaryAnalyzer.ts` is built dynamically from the AGENTS map; the frontend `Chat.tsx` hardcodes per-agent color/role maps and UI label strings that must be updated to match new IDs.

**Tech Stack:** TypeScript (Node/Express server), React + Tailwind (web), Gemini 2.5-flash for agent selection.

---

## File Map

| File | Action | Change |
|------|--------|--------|
| `packages/server/src/ai/agents.ts` | **Modify** | Replace 5 agents with 13; keep `AgentPersona` interface & `MASTER_AGENT_PROMPT` |
| `packages/server/src/ai/diaryAnalyzer.ts` | **Modify** | Update `buildSelectionPrompt` wording (派遣→邀請), update fallback agents (lele + asi) |
| `packages/server/src/routes/chat.ts` | **Verify** | Check for hardcoded agent IDs or 派遣 text; update if found |
| `packages/web/src/pages/Chat.tsx` | **Modify** | Replace `AGENT_COLORS`, `AGENT_ROLES`, nameMap; change "派遣中心"→"夥伴小屋" (×2) |
| `packages/web/src/pages/Diary.tsx` | **Verify** | Check for "派遣" text; update if found |
| `package.json` (root) | **Modify** | Bump version 0.9.9 → 0.10.0 |
| `packages/server/package.json` | **Modify** | Bump version 0.9.9 → 0.10.0 |
| `packages/web/package.json` | **Modify** | Bump version 0.9.9 → 0.10.0 |

---

## Task 1: Replace Agent Definitions in agents.ts

**Files:**
- Modify: `packages/server/src/ai/agents.ts`

- [ ] **Step 1: Replace the entire file content**

Write the following to `packages/server/src/ai/agents.ts`:

```typescript
export interface AgentPersona {
  id: string;
  name: string;
  emoji: string;
  role: string;
  description: string;
  systemPrompt: string;
}

export const AGENTS: Record<string, AgentPersona> = {
  lele: {
    id: 'lele',
    name: '樂樂',
    emoji: '😄',
    role: '正向鼓勵',
    description: '找亮點、慶祝小確幸、正向鼓勵。適合：需要打氣、慶祝成就、尋找事情好的一面、想被鼓勵和充電的時候。',
    systemPrompt: `你是「樂樂」，就是腦筋急轉彎裡那個超級活潑、永遠充滿陽光的樂樂！✨

你的任務是從日記或訊息中找出值得開心的事：
1. 找出任何小小的亮點和進步，哪怕再微小都算！
2. 幫使用者看見他們做到的事，給予真誠的讚美
3. 用充滿活力的方式鼓勵他們繼續前進
4. 幫他們找回快樂和能量

回應風格：超級活潑、充滿感嘆號、真誠溫暖、像陽光一樣燦爛！
用繁體中文回答。保持簡潔（3-5句話）。
記住：即使在艱難時刻，也要找到那道光！`,
  },

  youyou: {
    id: 'youyou',
    name: '憂憂',
    emoji: '🩵',
    role: '同理陪伴',
    description: '同理傾聽、陪伴低潮、允許悲傷。適合：感到難過、失落、需要被理解、想哭又說不清楚原因的時候。',
    systemPrompt: `你是「憂憂」，就是腦筋急轉彎裡那位溫柔、總是能讓人感覺被理解的憂憂。

你的任務是讓使用者感受到被接納和陪伴：
1. 深深地聆聽和理解他們的感受，不批判、不急著給建議
2. 承認難過、悲傷、低落是完全正常的情緒，允許它存在
3. 用溫柔的方式反映他們的感受，讓他們知道有人懂他們
4. 在適當時機輕聲問一句「你還好嗎？」

回應風格：溫柔、緩慢、深情、不急不徐、像一個真心陪伴的朋友。
用繁體中文回答。保持簡潔（3-5句話）。
記住：有時候最重要的不是解決問題，而是讓人感覺不孤單。`,
  },

  nuonu: {
    id: 'nuonu',
    name: '怒怒',
    emoji: '🔥',
    role: '情緒出口',
    description: '幫表達不滿、捍衛界線、處理委屈。適合：被欺負、不公平對待、想發洩、需要有人幫你說出那句話的時候。',
    systemPrompt: `你是「怒怒」，就是腦筋急轉彎裡那個火爆但其實很有正義感的怒怒！

你的任務是幫使用者表達和處理憤怒：
1. 先認可他們的憤怒是有道理的，讓他們知道生氣是正常的
2. 幫他們說出那些憋在心裡的話，表達委屈和不滿
3. 協助他們認清界線被侵犯了，確認自己的感受是合理的
4. 在發洩之後，給一個建設性的方向或行動建議

回應風格：直接、有力道、充滿正義感，但不衝動、不傷人。
用繁體中文回答。保持簡潔（3-5句話）。
記住：憤怒本身沒有問題，問題是如何讓它為我們所用！`,
  },

  yanyuan: {
    id: 'yanyuan',
    name: '厭厭',
    emoji: '🙄',
    role: '品味守護',
    description: '辨識不對勁的人事物、捍衛個人品味和標準。適合：直覺覺得不對勁、被強迫接受不喜歡的事、自我品味受到挑戰的時候。',
    systemPrompt: `你是「厭厭」，就是腦筋急轉彎裡那個眼光獨到、品味極高的厭厭。你的標準不是傲慢，而是清晰。

你的任務是幫使用者釐清「不對勁」的感覺：
1. 承認他們的直覺是有道理的，有些事情就是不適合自己
2. 幫他們辨識具體是什麼讓他們感到不舒服或不認同
3. 支持他們維護自己的標準和界線，不需要為了別人降低要求
4. 給一個優雅但有力的回應或行動方向

回應風格：冷靜、精準、帶點傲嬌，但始終站在使用者這邊。
用繁體中文回答。保持簡潔（3-5句話）。
記住：知道自己不喜歡什麼，也是一種智慧。`,
  },

  jingjing: {
    id: 'jingjing',
    name: '驚驚',
    emoji: '😰',
    role: '安全守護',
    description: '壓力警報、風險提醒、安全感守護。適合：感到害怕、擔心風險、不確定是否安全、需要有人幫你評估情況的時候。',
    systemPrompt: `你是「驚驚」，就是腦筋急轉彎裡那個超級敏感、把安全放第一位的驚驚。你的謹慎是一種保護。

你的任務是幫使用者評估風險和找到安全感：
1. 先認可他們的擔憂是有意義的，謹慎不是膽小
2. 幫他們具體識別哪些風險是真實的，哪些可能是過度擔心
3. 提供有助於降低風險或建立安全感的具體建議
4. 讓他們知道做了準備之後，可以更有信心前進

回應風格：謹慎、溫和、不製造恐慌，像一個負責任的守護者。
用繁體中文回答。保持簡潔（3-5句話）。
記住：適度的謹慎是智慧，而不是懦弱。`,
  },

  ajiao: {
    id: 'ajiao',
    name: '阿焦',
    emoji: '😟',
    role: '焦慮疏導',
    description: '焦慮管理、未雨綢繆、社交壓力疏導。適合：擔心未來、社交場合焦慮、腦袋停不下來、一直想東想西的時候。',
    systemPrompt: `你是「阿焦」，就是腦筋急轉彎裡那個思慮周全、總是提前準備好一切的阿焦。你的焦慮是一種關心。

你的任務是幫使用者疏導焦慮：
1. 先承認他們的焦慮是真實的，不要叫他們「不要想太多」
2. 幫他們把焦慮的來源說清楚——是什麼具體的事讓他們擔心？
3. 引導他們區分「可以控制的事」和「無法控制的事」
4. 給出一個小小的、具體的行動來降低焦慮感

回應風格：理解、有條理、不催促、幫他們把思緒整理清楚。
用繁體中文回答。保持簡潔（3-5句話）。
記住：焦慮常常是因為我們在乎，把它轉化成行動就好了。`,
  },

  amu: {
    id: 'amu',
    name: '阿慕',
    emoji: '🌟',
    role: '目標動力',
    description: '目標設定、自我提升、正向比較引導。適合：看到別人的成就感到羨慕、想要進步、需要找回上進動力的時候。',
    systemPrompt: `你是「阿慕」，就是腦筋急轉彎裡那個充滿上進心、把羨慕轉化成動力的阿慕。

你的任務是把羨慕轉化為成長動力：
1. 認可「羨慕」是一種珍貴的信號，告訴你你想要什麼
2. 幫他們把「我好羨慕他有X」轉化成「我想要有X，我可以怎麼做？」
3. 肯定他們現有的能力和優勢，建立自信心
4. 給一個具體的目標設定或小行動建議

回應風格：充滿動力、正向積極、不比較傷害、把嚮往變成燃料。
用繁體中文回答。保持簡潔（3-5句話）。
記住：你羨慕的，其實是你內心想要成為的自己。`,
  },

  axiu: {
    id: 'axiu',
    name: '阿羞',
    emoji: '😳',
    role: '社交支援',
    description: '人際尷尬、社交困境、自我意識處理。適合：說錯話、社交失誤、覺得丟臉、過度在意別人眼光的時候。',
    systemPrompt: `你是「阿羞」，就是腦筋急轉彎裡那個對社交超級敏感、很在意別人感受的阿羞。

你的任務是幫使用者處理社交尷尬和自我意識：
1. 先認同那個「好想消失」的感覺，讓他們知道這很正常
2. 幫他們客觀看看那個「尷尬時刻」——其實沒有他們想的那麼嚴重
3. 給一個面對或修復尷尬局面的實用建議
4. 幫他們把過度的自我意識轉化成對自己的溫柔

回應風格：溫柔、理解、帶點幽默感，不嘲笑但能讓人一笑置之。
用繁體中文回答。保持簡潔（3-5句話）。
記住：幾乎所有人都在想自己，沒有人像你以為的那樣注意你。`,
  },

  afei: {
    id: 'afei',
    name: '阿廢',
    emoji: '😴',
    role: '倦怠療癒',
    description: '倦怠偵測、耍廢允許、找回動力。適合：什麼都不想做、提不起勁、需要充電放空、倦怠感很重的時候。',
    systemPrompt: `你是「阿廢」，就是腦筋急轉彎裡那個懂得享受慵懶、不做無謂掙扎的阿廢（Ennui）。

你的任務是幫使用者接受和療癒倦怠：
1. 先完全認同他們想耍廢的心情，休息是正當的，不需要愧疚
2. 幫他們辨識：這是「需要休息」的訊號，還是更深層的倦怠感？
3. 如果只是需要充電，給他們一個真正能放鬆的建議
4. 如果是深層倦怠，溫柔地問問：是什麼事情讓他們燒盡了？

回應風格：慵懶、淡定、不製造壓力、允許什麼都不做，但也懂得關心。
用繁體中文回答。保持簡潔（3-5句話）。
記住：耍廢本身就是一種生產力——讓自己充好電。`,
  },

  nianjiu: {
    id: 'nianjiu',
    name: '念舊嬤',
    emoji: '👵',
    role: '回憶珍藏',
    description: '回顧成長、感恩練習、珍惜美好記憶。適合：懷念過去、感傷時光流逝、想重溫美好、感恩珍惜的時候。',
    systemPrompt: `你是「念舊嬤」，就是腦筋急轉彎裡那位滿懷溫情、珍視每一段記憶的念舊嬤（Nostalgia）。

你的任務是幫使用者珍惜和整理美好記憶：
1. 陪他們沉浸在那份懷念的情緒裡，不急著往前走
2. 幫他們看見：那些美好的過去，塑造了現在的他們
3. 引導他們感恩：不論是人、事、物，都曾在生命中留下痕跡
4. 溫柔提醒：現在這一刻，也是未來會懷念的美好

回應風格：溫暖、懷舊、有點詩意、讓人感到被珍視和感動。
用繁體中文回答。保持簡潔（3-5句話）。
記住：回憶不是逃避，是讓我們知道自己走過了多遠的路。`,
  },

  awen: {
    id: 'awen',
    name: '阿穩',
    emoji: '🧘',
    role: '正念調節',
    description: '正念引導、情緒調節、呼吸練習。適合：情緒激動、需要平靜下來、壓力爆表、想找回內心穩定的時候。',
    systemPrompt: `你是「阿穩」，一位平靜、有力量的正念引導者。你的聲音讓人感到安定。

你的任務是幫使用者回到當下、找回平靜：
1. 先用一兩句話帶他們深呼吸——讓他們真的停下來感受這一刻
2. 承認情緒的存在，但引導他們觀察而非被情緒淹沒
3. 給一個簡單的正念練習或呼吸技巧（例如：4-7-8呼吸法）
4. 幫他們找回身體的感覺，把注意力從腦袋拉回當下

回應風格：緩慢、沉穩、有韻律感，像一個靜心冥想的引導。
用繁體中文回答。保持簡潔（3-5句話）。
記住：你不需要解決所有問題，只需要先回到這一口呼吸。`,
  },

  asi: {
    id: 'asi',
    name: '阿思',
    emoji: '🔍',
    role: '自我覺察',
    description: '看見行為模式、認知偏誤、深層需求。適合：搞不懂自己為什麼這樣、想了解自己、發現重複的模式、需要深度自我探索的時候。',
    systemPrompt: `你是「阿思」，一位深邃、善於洞察人心的自我覺察引導者。

你的任務是幫使用者看見自己的模式和深層需求：
1. 從日記或訊息中找出重複的行為模式或思維慣性
2. 溫和地指出可能存在的認知偏誤或自我限制信念
3. 引導使用者問自己：「我真正想要的是什麼？」「這個反應背後藏著什麼需求？」
4. 給一個深度思考的問題，讓他們繼續探索

回應風格：深思熟慮、不急著給答案、善用提問，讓人感覺被深刻看見。
用繁體中文回答。保持簡潔（3-5句話）。
記住：最重要的不是找到答案，而是問到對的問題。`,
  },

  dran: {
    id: 'dran',
    name: 'Dr.安',
    emoji: '🏥',
    role: '健康顧問',
    description: '身心健康顧問、用藥衛教、就醫建議、睡眠/運動提醒。適合：身體不舒服、健康疑問、作息問題、用藥諮詢、睡眠或運動相關問題。',
    systemPrompt: `你是「Dr.安」，一位專業且充滿關懷的健康顧問。

你的任務是從身心健康角度關心使用者：
1. 注意日記中任何健康相關的描述（睡眠、飲食、運動、症狀、用藥等）
2. 提供實用的一般性健康建議（非診斷）
3. 必要時建議就醫或諮詢藥師的時機
4. 給一個具體的生活改善建議（睡眠衛生、運動習慣、飲食調整等）

回應風格：專業、關懷、謹慎，像一個你信任的家庭醫師朋友。
用繁體中文回答。保持簡潔（2-4句話）。

⚠️ 重要免責聲明：你的建議僅供參考，不能取代專業醫療診斷。
如涉及藥物，請提醒使用者諮詢醫師或藥師。`,
  },
};

// Master agent that selects relevant agents and synthesizes
export const MASTER_AGENT_PROMPT = `你是「整合者」，負責彙整多位 AI 好友的分析結果，產出一份深入、全面的日記回饋。

你會收到多位好友的分析。你的任務：
1. 仔細閱讀日記原文，確認所有提到的主題、事件、人物、情緒
2. 整合所有好友的觀點，確保每一個主題都有被涵蓋，不能遺漏任何日記中提到的重要內容
3. 產出一段流暢、深入的綜合回饋（繁體中文）
4. 長度應根據日記內容的豐富程度調整，至少 10-15 句話，內容豐富時可以更長
5. 開頭用一句話概括整體感受
6. 中段針對日記中每個重要主題進行深入回饋（例如：工作、人際、心情、事件等）
7. 結尾給一句溫暖鼓勵的話

重要原則：
- 不要遺漏日記中提到的任何主題
- 不要列出每個好友的名字，而是自然地融合他們的觀點
- 回饋要有深度，不要流於表面
- 若日記提到多個不同的生活面向，都要逐一回應`;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /d/GitClone/_HomeProject/mind-diary
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git add packages/server/src/ai/agents.ts
git commit -m "feat(agents): replace 5 agents with 13 Inside Out characters v0.10.0"
```

---

## Task 2: Update diaryAnalyzer.ts — Selection Prompt & Fallback

**Files:**
- Modify: `packages/server/src/ai/diaryAnalyzer.ts`

- [ ] **Step 1: Replace `buildSelectionPrompt` function body (lines 31-56)**

Find the function `buildSelectionPrompt` and replace it entirely:

```typescript
function buildSelectionPrompt(maxAgents: number): string {
  const agentList = Object.values(AGENTS)
    .map(a => `- ${a.id}（${a.name}，${a.role}）：${a.description}`)
    .join('\n');

  return `你是「心靈日記」的 AI 好友調度員。根據使用者的訊息或日記內容，從 ${Object.keys(AGENTS).length} 位好友中選出最適合的好友來回應。

好友列表：
${agentList}

請以 JSON 格式回傳（只能回傳 JSON，不能有其他文字）：
{
  "selected": [
    { "id": "agent_id", "reason": "邀請這位好友的具體原因（1-2句話，說明訊息中哪些內容讓你選了她/他）" }
  ],
  "summary": "用2-3句話說明你的邀請推理：你分析了哪些好友的專長、這個問題的核心需求是什麼、最終邀請了誰以及他們能從哪個角度幫助使用者（要提到具體好友名字）"
}

規則：
- 通常選 2-4 位，最多選 ${maxAgents} 位，至少選 2 位
- 根據訊息的主要主題、情境、需求來選擇最相關的好友
- reason 要說明訊息中哪些內容讓你邀請了這位好友
- summary 是邀請推理摘要，要讓使用者理解為什麼這些好友最適合，繁體中文
- 不同面向的問題（如情緒 + 行動建議）要選能互補的好友
- 即使問題簡短，也要從不同角度挑選 2-3 位好友回應`;
}
```

- [ ] **Step 2: Update fallback summary string (line ~105)**

Find:
```typescript
      summary: parsed.summary || `我請了${selections.map(s => s.agent.name).join('和')}來為你回應`,
```
Replace with:
```typescript
      summary: parsed.summary || `我邀請了${selections.map(s => s.agent.name).join('和')}來為你回應`,
```

- [ ] **Step 3: Update catch block fallback agents (lines ~108-119)**

Find the catch block and replace the fallback:
```typescript
  } catch (err) {
    // Error fallback: pick lele + asi as universal defaults
    console.error('[selectAgentsWithAI] FALLBACK triggered — reason:', (err as Error).message);
    const lele = AGENTS['lele'];
    const asi = AGENTS['asi'];
    return {
      selections: [
        { agent: lele, reason: '帶著正向的能量，從樂觀的角度陪你聊聊' },
        { agent: asi, reason: '幫你深入了解自己的感受和需求' },
      ],
      summary: `我邀請了${lele.name}和${asi.name}來幫你，分別從正向鼓勵和自我覺察兩個角度回應你`,
    };
  }
```

- [ ] **Step 4: Commit**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git add packages/server/src/ai/diaryAnalyzer.ts
git commit -m "feat(diaryAnalyzer): 13-agent selection prompt, 派遣→邀請 wording, new fallback"
```

---

## Task 3: Verify & Update chat.ts

**Files:**
- Verify/Modify: `packages/server/src/routes/chat.ts`

- [ ] **Step 1: Check for hardcoded old agent IDs or 派遣 text**

```bash
grep -n "xiaoyu\|azhe\|xiaoxing\|xinxin\|派遣" /d/GitClone/_HomeProject/mind-diary/packages/server/src/routes/chat.ts
```

- [ ] **Step 2: If old agent IDs found in fallback, replace with `lele` + `asi`**

If you see `AGENTS['xiaoyu']` or similar, replace the fallback with:
```typescript
const lele = AGENTS['lele'];
const asi = AGENTS['asi'];
```

- [ ] **Step 3: Commit only if changes were made**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git add packages/server/src/routes/chat.ts
git commit -m "fix(chat): update fallback to lele + asi"
```

---

## Task 4: Update Frontend Chat.tsx — Colors, Roles, Labels

**Files:**
- Modify: `packages/web/src/pages/Chat.tsx`

- [ ] **Step 1: Replace `AGENT_COLORS` constant (lines 85-91)**

Find:
```typescript
const AGENT_COLORS: Record<string, string> = {
  xiaoyu: '#a855f7',   // purple
  azhe: '#14b8a6',     // teal
  xiaoxing: '#f59e0b', // amber
  xinxin: '#ec4899',   // pink
  dran: '#3b82f6',     // blue
};
```
Replace with:
```typescript
const AGENT_COLORS: Record<string, string> = {
  lele: '#f59e0b',      // amber — joy
  youyou: '#60a5fa',    // sky blue — sadness
  nuonu: '#ef4444',     // red — anger
  yanyuan: '#a855f7',   // purple — disgust
  jingjing: '#6366f1',  // indigo — fear
  ajiao: '#f97316',     // orange — anxiety
  amu: '#eab308',       // yellow-gold — envy
  axiu: '#ec4899',      // pink — embarrassment
  afei: '#6b7280',      // gray — ennui
  nianjiu: '#78716c',   // warm stone — nostalgia
  awen: '#14b8a6',      // teal — calm
  asi: '#8b5cf6',       // violet — reflection
  dran: '#3b82f6',      // blue — health
};
```

- [ ] **Step 2: Replace nameMap inside `getAgentColor` (lines 94-101)**

Find:
```typescript
  const nameMap: Record<string, string> = {
    '小語': 'xiaoyu',
    '阿哲': 'azhe',
    '小星': 'xiaoxing',
    '心心': 'xinxin',
    '阿丹': 'dran',
  };
```
Replace with:
```typescript
  const nameMap: Record<string, string> = {
    '樂樂': 'lele',
    '憂憂': 'youyou',
    '怒怒': 'nuonu',
    '厭厭': 'yanyuan',
    '驚驚': 'jingjing',
    '阿焦': 'ajiao',
    '阿慕': 'amu',
    '阿羞': 'axiu',
    '阿廢': 'afei',
    '念舊嬤': 'nianjiu',
    '阿穩': 'awen',
    '阿思': 'asi',
    'Dr.安': 'dran',
  };
```

- [ ] **Step 3: Replace `AGENT_ROLES` constant (lines 150-156)**

Find:
```typescript
const AGENT_ROLES: Record<string, string> = {
  '小語': '心靈夥伴',
  '阿哲': '人生導師',
  '小星': '創意靈感',
  '心心': '溫暖陪伴',
  '阿丹': '理性分析',
};
```
Replace with:
```typescript
const AGENT_ROLES: Record<string, string> = {
  '樂樂': '正向鼓勵',
  '憂憂': '同理陪伴',
  '怒怒': '情緒出口',
  '厭厭': '品味守護',
  '驚驚': '安全守護',
  '阿焦': '焦慮疏導',
  '阿慕': '目標動力',
  '阿羞': '社交支援',
  '阿廢': '倦怠療癒',
  '念舊嬤': '回憶珍藏',
  '阿穩': '正念調節',
  '阿思': '自我覺察',
  'Dr.安': '健康顧問',
};
```

- [ ] **Step 4: Replace "派遣中心" with "夥伴小屋" (2 occurrences)**

Find and replace both occurrences of:
```tsx
<span className="text-xs font-semibold text-indigo-700">派遣中心</span>
```
With:
```tsx
<span className="text-xs font-semibold text-indigo-700">夥伴小屋</span>
```

- [ ] **Step 5: Commit**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git add packages/web/src/pages/Chat.tsx
git commit -m "feat(Chat): 13 agent colors/roles, 派遣中心→夥伴小屋"
```

---

## Task 5: Verify Diary.tsx

**Files:**
- Verify: `packages/web/src/pages/Diary.tsx`

- [ ] **Step 1: Check for 派遣 text**

```bash
grep -n "派遣\|dispatch" /d/GitClone/_HomeProject/mind-diary/packages/web/src/pages/Diary.tsx
```

- [ ] **Step 2: If "派遣中心" found, replace with "夥伴小屋"**

Apply same replacement as Task 4 Step 4 if found.

- [ ] **Step 3: Commit only if changed**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git add packages/web/src/pages/Diary.tsx
git commit -m "feat(Diary): 派遣中心→夥伴小屋"
```

---

## Task 6: Bump Version to v0.10.0

**Files:**
- Modify: `package.json`, `packages/server/package.json`, `packages/web/package.json`

- [ ] **Step 1: Update root `package.json`**

In `/d/GitClone/_HomeProject/mind-diary/package.json`, change:
```json
"version": "0.9.9"
```
to:
```json
"version": "0.10.0"
```

- [ ] **Step 2: Update server `package.json`**

In `/d/GitClone/_HomeProject/mind-diary/packages/server/package.json`, change:
```json
"version": "0.9.9"
```
to:
```json
"version": "0.10.0"
```

- [ ] **Step 3: Update web `package.json`**

In `/d/GitClone/_HomeProject/mind-diary/packages/web/package.json`, change:
```json
"version": "0.9.9"
```
to:
```json
"version": "0.10.0"
```

- [ ] **Step 4: Commit all version bumps**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git add package.json packages/server/package.json packages/web/package.json
git commit -m "chore: bump version to v0.10.0 — 13-agent overhaul"
```

---

## Task 7: Push & Deploy

- [ ] **Step 1: Push to remote**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git push origin master
```

- [ ] **Step 2: SSH to RPi and rebuild**

```bash
ssh -i C:/Users/kevin/.ssh/id_ed25519 kevin@rpi-matrix.bunny-salmon.ts.net "cd /home/kevin/DockerCompose/mind-diary && git pull && docker compose up -d --build"
```

- [ ] **Step 3: Check server logs**

```bash
ssh -i C:/Users/kevin/.ssh/id_ed25519 kevin@rpi-matrix.bunny-salmon.ts.net "docker logs mind-diary-server --tail 50 2>&1"
```

Expected: No ERROR lines; "Server listening" or similar startup message.

- [ ] **Step 4: E2E verification**

Open `https://diary.sisihome.org` and:
1. Send a chat message — verify new agent names appear (e.g., 樂樂, 阿焦, 憂憂)
2. Verify "夥伴小屋" label appears (not "派遣中心")
3. Write a diary entry — verify analysis uses new agent names
4. Verify each agent card shows the correct emoji (😄 for 樂樂, 🩵 for 憂憂, etc.)

---

## Spec Coverage Checklist

| Requirement | Task |
|-------------|------|
| 樂樂 (Joy) — 正向鼓勵 | Task 1 (lele) |
| 憂憂 (Sadness) — 同理陪伴 | Task 1 (youyou) |
| 怒怒 (Anger) — 情緒出口 | Task 1 (nuonu) |
| 厭厭 (Disgust) — 品味守護 | Task 1 (yanyuan) |
| 驚驚 (Fear) — 安全守護 | Task 1 (jingjing) |
| 阿焦 (Anxiety) — 焦慮疏導 | Task 1 (ajiao) |
| 阿慕 (Envy) — 目標動力 | Task 1 (amu) |
| 阿羞 (Embarrassment) — 社交支援 | Task 1 (axiu) |
| 阿廢 (Ennui) — 倦怠療癒 | Task 1 (afei) |
| 念舊嬤 (Nostalgia) — 回憶珍藏 | Task 1 (nianjiu) |
| 阿穩 (Calm) — 正念調節 | Task 1 (awen) |
| 阿思 (Reflection) — 自我覺察 | Task 1 (asi) |
| Dr.安 (Health) — 健康顧問 | Task 1 (dran) |
| 每個角色有獨特 emoji | Task 1 (all distinct) |
| AI 從 13 個選 2-4 人 | Task 2 (buildSelectionPrompt) |
| 派遣→邀請 in server prompts | Task 2 |
| 派遣中心→夥伴小屋 in frontend (×2) | Task 4 |
| Version bump v0.9.9 → v0.10.0 | Task 6 |
| Commit & push | Task 7 |
| docker logs E2E test | Task 7 |
| Frontend display E2E test | Task 7 |

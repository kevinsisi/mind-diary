export const APP_VERSION = '0.18.11';

export interface ReleaseNote {
  version: string;
  title: string;
  highlights: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.18.11',
    title: '更容易追蹤 AI 為什麼這樣回',
    highlights: [
      '每輪對話會把 AI 判斷出的回覆模式、信心與判斷依據寫入對話派發摘要，方便排查錯誤路由。',
      '新增 live smoke 測試覆蓋 practical、reflective、support-action 邊界，避免情緒與問題處理再退回亂判。',
    ],
  },
  {
    version: '0.18.10',
    title: '對話會先用 AI 判斷你真正需要什麼',
    highlights: [
      '聊天流程改成先由 AI 讀取目前訊息、對話標題與最近歷史，再決定要規劃、直接解題、行動支持或陪伴反思。',
      '規劃、實用問題與情緒困境不再先被硬關鍵字帶路；關鍵字規則只保留在 AI 意圖分析失敗時降級使用。',
    ],
  },
  {
    version: '0.18.9',
    title: '情緒低潮時更會幫你處理問題',
    highlights: [
      '當你心情很糟又遇到問題時，對話會先穩住情緒，再整理可執行的下一步。',
      '回覆會減少空泛安慰，改成問題拆解、低負擔待辦與可直接照著說的句子。',
    ],
  },
  {
    version: '0.18.7',
    title: '加入忘記密碼流程',
    highlights: [
      '登入頁加入「忘記密碼？」按鈕，點擊後會提示請聯絡管理員協助重設。',
      '管理員可在「使用者管理」頁面為任何使用者直接重設密碼。',
    ],
  },
  {
    version: '0.18.6',
    title: '更新日誌與體驗修正已同步',
    highlights: [
      '更新提示現在會跟著實際版本更新，不再停留在舊內容。',
      '日記的 AI 標題更穩定，會優先產生可用標題，避免怪異短字。',
      '對話在「只回答一句話／只回答代號」這類明確要求下，會更準確地收斂成短答。',
      '訪客模式的導覽、搜尋、檔案頁與手機側欄流程已補上 live UI smoke 測試。',
    ],
  },
  {
    version: '0.18.0',
    title: '加入版本更新提示',
    highlights: ['升級後第一次開啟，會看到「在你不在的時候，我們加入了這些功能」更新摘要。'],
  },
  {
    version: '0.17.1',
    title: '送出中的對話現在可以取消',
    highlights: ['送出中的對話可直接取消，圖片分析與後續流程會停止並清理半途資料。'],
  },
  {
    version: '0.17.0',
    title: '搜尋變得更完整',
    highlights: ['搜尋現在可找到對話內容、檔案內容，以及日記照片的 AI 描述。'],
  },
  {
    version: '0.16.0',
    title: '加入資料隔離修復工具',
    highlights: ['管理員可在設定頁掃描並安全修復 legacy folder ownership 問題。'],
  },
  {
    version: '0.15.2',
    title: '記憶更新與對話品質提升',
    highlights: [
      '若這輪對話更新了跨對話記憶，回覆尾端會淡淡提示「記憶已更新」。',
      '修正同一角色偶爾被重複派出的問題。',
    ],
  },
  {
    version: '0.15.0',
    title: '跨對話記憶現在可管理',
    highlights: ['每位使用者都有跨對話記憶，並可在設定頁查看與刪除。'],
  },
];

export const LAST_SEEN_VERSION_KEY = 'mind-diary:last-seen-version';

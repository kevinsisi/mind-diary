import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import {
  Upload,
  FileText,
  Image,
  Trash2,
  RefreshCw,
  Loader2,
  File,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────

interface FileItem {
  id: number;
  filename: string;
  mimetype: string;
  size: number;
  content_text: string | null;
  ai_summary: string | null;
  created_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mimeIcon(mimetype: string) {
  if (mimetype.startsWith('image/')) return Image;
  if (
    mimetype === 'application/pdf' ||
    mimetype.startsWith('text/') ||
    mimetype === 'application/json'
  )
    return FileText;
  return File;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ACCEPT =
  'application/pdf,image/*,text/*,text/markdown,text/plain,application/json';

// ── Component ─────────────────────────────────────────────────────

export default function Files() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [resummarizing, setResummarizing] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Fetch files ───────────────────────────────────────────────

  const fetchFiles = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<
        { files: FileItem[]; pagination: Pagination } | FileItem[]
      >(`/api/files?page=${page}&limit=20`);

      if (Array.isArray(data)) {
        setFiles(data);
        setPagination({ page: 1, limit: 20, total: data.length, totalPages: 1 });
      } else {
        setFiles(data.files ?? []);
        setPagination(data.pagination ?? { page, limit: 20, total: 0, totalPages: 1 });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '載入檔案失敗';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // ── Upload ────────────────────────────────────────────────────

  const uploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    for (const f of arr) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`「${f.name}」超過 50 MB 上限`);
        return;
      }
    }

    setUploading(true);
    setError(null);
    try {
      for (const f of arr) {
        const form = new FormData();
        form.append('file', f);
        const resp = await fetch('/api/files', { method: 'POST', body: form });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '上傳失敗');
          throw new Error(text);
        }
      }
      await fetchFiles(pagination.page);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上傳失敗';
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  // ── Drag & Drop ───────────────────────────────────────────────

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  // ── Delete ────────────────────────────────────────────────────

  const deleteFile = async (id: number) => {
    if (!confirm('確定要刪除此檔案嗎？')) return;
    setDeleting((s) => new Set(s).add(id));
    try {
      await apiClient.delete(`/api/files/${id}`);
      await fetchFiles(pagination.page);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '刪除失敗';
      setError(msg);
    } finally {
      setDeleting((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  // ── Re-summarize ──────────────────────────────────────────────

  const resummarize = async (id: number) => {
    setResummarizing((s) => new Set(s).add(id));
    try {
      const result = await apiClient.post<{ ai_summary: string }>(
        `/api/files/${id}/resummarize`,
      );
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, ai_summary: result.ai_summary } : f,
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '重新摘要失敗';
      setError(msg);
    } finally {
      setResummarizing((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">檔案管理</h2>
        <p className="mt-1 text-gray-600">
          上傳與管理你的個人檔案，支援文件、圖片等多種格式。
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors ${
          dragOver
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
        }`}
      >
        {uploading ? (
          <Loader2 size={36} className="animate-spin text-indigo-500" />
        ) : (
          <Upload size={36} className="text-gray-400" />
        )}
        <p className="text-sm text-gray-600">
          {uploading ? '上傳中…' : '拖曳檔案到此處，或點擊瀏覽'}
        </p>
        <p className="text-xs text-gray-400">PDF、圖片、文字檔、Markdown，最大 50 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-indigo-500" />
          <span className="ml-3 text-gray-500">載入中…</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && files.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Upload size={48} className="mb-4" />
          <p className="text-lg font-medium">上傳你的第一個檔案</p>
        </div>
      )}

      {/* File list */}
      {!loading && files.length > 0 && (
        <div className="space-y-3">
          {files.map((file) => {
            const Icon = mimeIcon(file.mimetype);
            const expanded = expandedId === file.id;
            const isSummarizing = resummarizing.has(file.id);
            const isDeleting = deleting.has(file.id);

            return (
              <div
                key={file.id}
                className="rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Card header */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : file.id)}
                >
                  <div className="flex-shrink-0 rounded-lg bg-indigo-50 p-2.5 text-indigo-500">
                    <Icon size={22} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">
                      {file.filename}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatSize(file.size)} · {formatDate(file.created_at)}
                    </p>
                    {file.ai_summary && !expanded && (
                      <p className="mt-1 truncate text-sm text-gray-500">
                        {file.ai_summary}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <button
                      title="重新摘要"
                      disabled={isSummarizing}
                      onClick={(e) => {
                        e.stopPropagation();
                        resummarize(file.id);
                      }}
                      className="rounded-lg p-2 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 transition-colors"
                    >
                      {isSummarizing ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                    </button>
                    <button
                      title="刪除"
                      disabled={isDeleting}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFile(file.id);
                      }}
                      className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                    >
                      {isDeleting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded summary */}
                {expanded && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    {file.ai_summary ? (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                        {file.ai_summary}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic">
                        尚無 AI 摘要，點擊重新摘要按鈕產生。
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <button
            disabled={pagination.page <= 1}
            onClick={() => fetchFiles(pagination.page - 1)}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
            上一頁
          </button>
          <span className="text-sm text-gray-500">
            第 {pagination.page} / {pagination.totalPages} 頁
          </span>
          <button
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => fetchFiles(pagination.page + 1)}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            下一頁
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

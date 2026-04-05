# Multi-Agent Chat System & v0.9 Features

## Summary

Retroactive documentation for all features shipped in v0.6.0 through v0.9.7.

## Changes

- **Multi-agent chat system**: 5 persona agents (小魚, 阿哲, 小敏, 大熊, 小藍) + master synthesizer, replacing single-model response
- **AI-based agent selection**: `selectAgentsWithAI` uses Gemini with `thinkingBudget:0` + JSON response mode to pick 2–4 agents per message
- **SSE event pipeline**: structured events (`phase`, `intent`, `agent-start`, `agent-thinking`, `agent-done`, `synthesizing`, `tags`, `done`, `complete`, `title-updated`) for real-time streaming UI
- **Chat title auto-generation**: generated after first message using Gemini with `thinkingBudget:0` and large `maxOutputTokens` to avoid truncation
- **Diary category/folder selection**: chat sessions and diary entries can be assigned to folders; folder CRUD API
- **Image upload and display**: users can attach images to chat messages; stored to disk, analyzed by Gemini vision, displayed in chat UI with `react-markdown` rendering
- **Shared retry utility**: `callGeminiText()` in `geminiRetry.ts` — single non-streaming call wrapper with 15s timeout, thinking control, and usage tracking; used by both chat and diary modules
- **Key pool**: Fisher-Yates shuffle batch allocation, 50 valid keys target, error-graded cooldowns (429 → 2 min, 401/403 → 30 min, 5xx → 30 s)
- **JWT httpOnly cookie auth**: `bcryptjs` password hashing, 7-day TTL, `requireAuth` / `optionalAuth` middleware
- **Docker Hub + GitHub Actions CI/CD**: push to `main` builds and pushes `chuangkevin/mind-diary:latest` to Docker Hub; CD workflow SSHes into RPi via Tailscale and pulls + restarts container
- **visibilitychange reconnect**: frontend reconnects SSE on `visibilitychange` (page re-focus) to recover from mobile connection drops
- **react-markdown rendering**: all AI responses rendered with `react-markdown` for proper formatting

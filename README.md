# 简单网页 AI 助手（智谱 AI）

一个最小可运行的网页聊天助手：
- 前端只负责聊天 UI
- 后端代理调用智谱 AI API，避免在浏览器暴露 API Key
- 支持多轮会话（`sessionId`）、新对话重置、流式输出

## 1. 配置 API Key

启动时读取顺序：
1. 系统环境变量
2. `.env`
3. `.env.example`

建议把真实密钥放在 `.env`。

```env
ZHIPU_API_KEY=你的智谱APIKey
ZHIPU_MODEL=glm-4-flash
ZHIPU_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
PORT=3000
MAX_CONTEXT_MESSAGES=20
SESSION_TTL_MS=7200000
```

参数说明：
- `MAX_CONTEXT_MESSAGES`：每个会话保留的上下文消息数量（user/assistant/system）
- `SESSION_TTL_MS`：会话在服务端内存中的过期时间（毫秒）

## 2. 启动

```powershell
npm start
```

浏览器打开 `http://127.0.0.1:3000`。

## 3. 会话机制

- 前端会将 `sessionId` 与最近消息缓存在 `localStorage`
- 同一浏览器刷新后，会继续同一会话，支持多轮追问
- 点击“新对话”会：
  - 本地清空会话历史
  - 调用 `/api/chat/reset` 清理服务端会话

## 4. 接口

### `POST /api/chat`
请求体：
```json
{
  "message": "你好",
  "sessionId": "可选，建议传",
  "history": [
    { "role": "user", "content": "上一轮" },
    { "role": "assistant", "content": "上一轮回复" }
  ]
}
```

返回：
```json
{
  "reply": "模型回复",
  "sessionId": "服务端确认后的会话ID"
}
```

### `POST /api/chat/stream`（推荐）
请求体与 `/api/chat` 相同，响应为 `text/event-stream`，事件数据格式：
```json
{ "type": "session", "sessionId": "会话ID" }
{ "type": "delta", "delta": "增量文本" }
{ "type": "done", "reply": "完整回复", "sessionId": "会话ID" }
{ "type": "error", "error": "错误信息" }
```

### `POST /api/chat/reset`
请求体：
```json
{
  "sessionId": "要清理的会话ID"
}
```

返回：
```json
{
  "ok": true
}
```

## 5. 文件说明

- `server.js`：Node 后端、会话缓存、普通/流式智谱 API 转发
- `public/index.html`：聊天页面、会话持久化、流式渲染逻辑

# 多模型网页 AI 助手（支持国内 API + 思考模式）

一个最小可运行的网页聊天助手：
- 前端负责聊天 UI、提供商切换、模型切换、思考模式开关
- 后端代理调用国内 OpenAI 兼容 API，避免在浏览器暴露 API Key
- 支持多轮会话（`sessionId`）、新对话重置、流式输出
- 支持思考过程流（`reasoning` 事件，视上游模型是否返回）

## 1. 配置 API Key

启动时读取顺序：
1. 系统环境变量
2. `.env`
3. `.env.example`

建议把真实密钥放在 `.env`。

```env
DEFAULT_PROVIDER=zhipu
DEFAULT_TEMPERATURE=0.7

ZHIPU_API_KEY=your_zhipu_api_key
ZHIPU_MODEL=glm-4-flash
ZHIPU_THINKING_MODEL=glm-z1-flash
ZHIPU_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions

DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_THINKING_MODEL=deepseek-reasoner
DEEPSEEK_URL=https://api.deepseek.com/chat/completions

QWEN_API_KEY=your_qwen_api_key
QWEN_MODEL=qwen-plus
QWEN_THINKING_MODEL=qwen-plus
QWEN_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions

MOONSHOT_API_KEY=your_moonshot_api_key
MOONSHOT_MODEL=moonshot-v1-8k
MOONSHOT_THINKING_MODEL=moonshot-v1-8k
MOONSHOT_URL=https://api.moonshot.cn/v1/chat/completions

PORT=3000
MAX_CONTEXT_MESSAGES=20
SESSION_TTL_MS=7200000
```

参数说明：
- `DEFAULT_PROVIDER`：默认提供商（`zhipu` / `deepseek` / `qwen` / `moonshot`）
- `*_MODEL`：普通模式默认模型
- `*_THINKING_MODEL`：思考模式默认模型
- `DEFAULT_TEMPERATURE`：默认温度参数
- `MAX_CONTEXT_MESSAGES`：每个会话保留的上下文消息数量（user/assistant/system）
- `SESSION_TTL_MS`：会话在服务端内存中的过期时间（毫秒）

## 2. 启动

```powershell
npm start
```

浏览器打开 `http://127.0.0.1:3000`。

## 3. 前端能力

页面支持：
- 选择 API 提供商
- 手动填写模型
- 开关“思考模式”
- 输入区“预览”按钮（发送前预览消息内容）
- 工具栏“复制对话 / 分享对话”（分享不支持时自动降级为复制）
- 流式显示回答和思考过程（若上游返回）
- 流式渲染按帧刷新，减少逐 token 卡顿感

状态会保存在 `localStorage`（会话、历史、模型设置）。

## 4. 会话机制

- 前端会将 `sessionId` 与最近消息缓存在 `localStorage`
- 同一浏览器刷新后，会继续同一会话，支持多轮追问
- 点击“新对话”会：
  - 本地清空会话历史
  - 调用 `/api/chat/reset` 清理服务端会话

## 5. 接口

### `GET /api/providers`
返回可用提供商及默认模型配置：

```json
{
  "defaultProvider": "zhipu",
  "providers": [
    {
      "id": "zhipu",
      "name": "Zhipu AI",
      "configured": true,
      "defaultModel": "glm-4-flash",
      "thinkingModel": "glm-z1-flash"
    }
  ]
}
```

### `POST /api/chat`
请求体：
```json
{
  "message": "你好",
  "sessionId": "可选，建议传",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "enableThinking": true,
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
  "reasoning": "可选，思考内容",
  "sessionId": "服务端确认后的会话ID",
  "provider": "deepseek",
  "model": "deepseek-chat"
}
```

### `POST /api/chat/stream`（推荐）
请求体与 `/api/chat` 相同，响应为 `text/event-stream`，事件数据格式：

```json
{ "type": "session", "sessionId": "会话ID", "provider": "qwen", "model": "qwen-plus" }
{ "type": "reasoning", "delta": "思考增量" }
{ "type": "delta", "delta": "回答增量" }
{ "type": "done", "reply": "完整回复", "reasoning": "可选", "sessionId": "会话ID" }
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

## 6. 文件说明

- `server.js`：Node 后端、会话缓存、多提供商转发、普通/流式聊天
- `public/index.html`：聊天页面、会话持久化、提供商/模型/思考模式设置、流式渲染

## 7. 变更记录（每次修改必填）

后续每次代码改动，必须在本节追加一条记录，并包含两部分：
- `如何添加`：改了哪些文件、增加了哪些关键逻辑/按钮/接口
- `如何完成`：如何验证改动有效（最少写明语法检查、关键交互验证）

### 2026-04-01：新增“复制对话 / 分享对话”

- 如何添加：
  - 在 `public/index.html` 工具栏新增 `复制对话`、`分享对话` 两个按钮。
  - 新增 `buildConversationExportText()`，把会话信息和 `history` 导出为可读文本。
  - 新增 `copyConversation()` 与 `shareConversation()`：
    - 复制优先使用 `navigator.clipboard.writeText`，失败时使用 `document.execCommand("copy")` 兜底。
    - 分享优先使用 `navigator.share`，不支持时自动降级为复制。
  - 发送消息期间禁用复制/分享按钮，流式请求完成后恢复按钮状态。
  - 在底部 `tip` 增加短时状态提示（复制成功/失败、分享回退等）。

- 如何完成：
  - 使用 `node -e` 提取并编译 `public/index.html` 内联脚本，确认语法通过（`script syntax ok`）。
  - 通过代码走查确认按钮事件已绑定、导出文本包含会话元信息、分享降级逻辑已接入。

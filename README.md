# ArcWiki

一个以 Arc 的侧边栏和 Spaces 交互为灵感的轻量桌面知识工作区。第一版专注于 **Markdown 阅读**和 **Agent Thread 对话**；它不是浏览器，也暂时没有自动整理 Wiki、网页标签页或云同步。

## 开发运行

需要 Bun 1.4+、Rust/Cargo、Tauri 2 的[系统依赖](https://v2.tauri.app/start/prerequisites/)；当前桌面开发环境是 macOS，项目也配置了 Windows/Linux 桌面构建。

```sh
bun install
# 在同一终端自行设置 OPENROUTER_API_KEY（不要将真实密钥写入仓库）
bun run dev
```

`bun run dev` 会先把 TypeScript sidecar 编译成当前机器的独立 Bun 可执行文件，再启动 Tauri 与 Vite。若只想查看界面，运行 `bun run dev:web`，在 `http://localhost:1420` 打开；独立浏览器预览不会连接桌面 Agent。

```sh
bun run test
bun run build           # 检查类型并构建前端
bun run desktop:build   # 打包当前平台的桌面应用
```

桌面应用从启动进程的 `OPENROUTER_API_KEY` 环境变量读取密钥。双击安装包不会继承开发终端的环境变量；第一版请从已设置环境变量的终端启动桌面应用进行 Agent 测试。默认 API 地址是 `https://openrouter.ai/api/v1`，模型是 `stealth/space-bunny-alpha`；分别可用 `OPENROUTER_BASE_URL` 和 `OPENROUTER_MODEL` 覆盖，空白值按默认值处理。Bun 会自动加载仓库根目录的 `.env.local`，因此本地测试凭据可以只放在该文件（已被 `.gitignore` 排除）而无需写入终端环境。不要使用 `VITE_` 环境变量传递密钥，否则 Vite 会将它嵌入前端资源。

## 使用方式

- 在侧边栏底部点击彩色圆点选择 Space，侧边栏中选择 Tab；仅在**左侧侧边栏**用触控板横向双指滑动切换 Space，右侧内容区域的横向滑动不会切换，纵向滚动仍用于阅读文档。
- Markdown 标签页可阅读内置示例，或从本机导入 `.md` 文件；文件内容只进入应用本地状态，不会发给 Agent，除非用户主动复制并发送。
- Agent Thread 中的消息会在同一标签页内延续对话。Space、Tab 和对话在本机 WebView 的 localStorage 中保留；清理站点数据会清空它们。
- 没有设置密钥时仍能浏览文档，Agent 会显示配置提示。

## 结构与安全边界

- `src/`：React 界面、Space/Tab 状态、Markdown 与 Thread。
- `src-tauri/`：桌面窗口和 sidecar 生命周期；Tauri 在启动时生成随机会话令牌，并把本机端口与令牌通过限定的 IPC 命令交给窗口。
- `sidecar/`：Bun HTTP 服务，使用 OpenAI Agents SDK 通过 OpenRouter 的 Chat Completions 接口回应 Thread。服务只绑定 `127.0.0.1`，校验会话令牌及 WebView Origin；API Key 不进入浏览器或 Git 仓库。

Agent 对话会发送到所配置的模型提供方；请不要在 Thread 中输入不希望发送的数据。本地保存的对话尚未加密，第一版也没有多 Agent 编排、流式 token 输出或跨设备同步。

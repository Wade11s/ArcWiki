# ArcWiki

一个以 Arc 的侧边栏和 Spaces 交互为灵感的轻量桌面知识工作区。第一版专注于 **Markdown 阅读**和 **Agent Thread 对话**；它不是浏览器，也暂时没有自动整理 Wiki、网页标签页或云同步。

## 开发运行

需要 Bun 1.4+、Rust/Cargo、Tauri 2 的[系统依赖](https://v2.tauri.app/start/prerequisites/)；当前桌面开发环境是 macOS，项目也配置了 Windows/Linux 桌面构建。

```sh
bun install
# 在同一终端自行设置 OPENROUTER_API_KEY（不要将真实密钥写入仓库）
bun run dev
# 或将密钥保存在本机、被 Git 忽略的 .env.local，并显式加载：
bun --env-file=.env.local run dev
```

`bun run dev` 会先把 TypeScript sidecar 编译成当前机器的独立 Bun 可执行文件，再启动 Tauri 与 Vite。若只想查看界面，运行 `bun run dev:web`，在 `http://localhost:1420` 打开；独立浏览器预览不会连接桌面 Agent。

```sh
bun run test
bun run build           # 检查类型并构建前端
bun run desktop:build   # 打包当前平台的桌面应用
bun run test:e2e        # 构建隔离的测试版 Tauri 应用，运行桌面 E2E
bun --env-file=.env.local run test:e2e:live  # 显式调用真实 OpenRouter 模型
```

显示名、头像、Agent 的 API 密钥、模型与 API 地址在独立的 **Settings** 窗口中配置（菜单 ArcWiki → Settings，或 `⌘ ,` / `Ctrl+,`）。头像会重编码为本机 PNG，只用于界面；密钥保存在本机应用配置目录，由 Tauri 写入 sidecar 进程的 `OPENROUTER_API_KEY`；前端不会读回已保存的密钥。若 Settings 里还没有密钥，启动环境中的 `OPENROUTER_API_KEY`、`OPENROUTER_BASE_URL` 和 `OPENROUTER_MODEL` 仍可作为开发回退（空白值按默认处理）。默认 API 地址是 `https://openrouter.ai/api/v1`，模型是 `stealth/space-bunny-alpha`。Bun 会自动加载仓库根目录的 `.env.local`，因此本地测试凭据可以只放在该文件（已被 `.gitignore` 排除）。不要使用 `VITE_` 环境变量传递密钥，否则 Vite 会将它嵌入前端资源。双击安装包不会继承开发终端的环境变量，请在 Settings 中保存密钥。

`test:e2e` 需要 Node.js 18.20+、Bun 和 Tauri 构建依赖。它使用 WebdriverIO + Tauri Service 的嵌入式 WebDriver 驱动真实桌面窗口；脚本启动仅监听 `127.0.0.1` 的模拟 OpenRouter 接口，并覆盖运行环境中的 API Key 为测试假值，不调用真实模型。测试版通过独立的 `com.wade11s.arcwiki.e2e` 标识隔离本地数据（macOS 会生成独立的 `ArcWiki E2E.app`；Linux/Windows 会将 sidecar 放在未打包的测试可执行文件旁）；测试结束会停止模拟服务。正常 `desktop:build` 不包含 WebDriver 插件。Linux 无桌面会话时可用 `xvfb-run bun run test:e2e`。目前已在 macOS 实机验证，Linux/Windows 尚未实机运行。

`test:e2e:live` 需要真实的 `OPENROUTER_API_KEY`，只在显式运行时调用 OpenRouter；它在隔离的测试版桌面窗口里发送两轮非私人测试消息并验证历史持久化，不会重置正常 ArcWiki 的数据。若密钥在另一个本机目录，请将 `--env-file` 改为该文件的绝对路径。测试用的 `.env.local` 不会自动随 Delta Thread 或 Git remote 同步。

## 使用方式

- 在侧边栏底部点击彩色圆点选择 Space，侧边栏中选择 Tab；仅在**左侧侧边栏**用触控板横向双指滑动切换 Space，右侧内容区域的横向滑动不会切换，纵向滚动仍用于阅读文档。
- Markdown 标签页可阅读内置示例，或从本机导入 `.md` 文件；文件内容只进入应用本地状态，不会发给 Agent，除非用户主动复制并发送。
- Agent Thread 的输入框是对话末尾的用户气泡；Enter 换行，macOS 用 Command+Enter 发送，Windows/Linux 用 Control+Enter 发送。用户消息与 Agent 消息共用左侧头像列：没有自定义照片时显示占位图标。每个 Thread 的未发送草稿独立保留，回复失败或中断后可以重试该条消息，不会重复插入用户消息。Space、Tab、草稿和对话在本机 WebView 的 localStorage 中保留；清理站点数据会清空它们。Profile 显示名和头像保存在 Settings 里，桌面应用写入本机配置目录。
- 历史记录完整保留在本机，向模型发送时只选取符合 sidecar 条数与请求大小限制的最近上下文；超过长度限制的单条输入无法发送。
- 没有设置密钥时仍能浏览文档；Agent Thread 会提示打开 Settings。阅读宽度可在主窗口切换，也会写入 Settings。

## 结构与安全边界

- `src/`：React 界面、Space/Tab 状态、Markdown、Thread 与 Settings 窗口。
- `src-tauri/`：主窗口、Settings 窗口和 sidecar 生命周期；Tauri 在启动时生成随机会话令牌，并把本机端口与令牌通过限定的 IPC 命令交给窗口。Settings 可通过 IPC 提交新密钥，但不会把已保存的密钥返回给前端。
- `sidecar/`：Bun HTTP 服务，使用 OpenAI Agents SDK 通过 OpenRouter 的 Chat Completions 接口回应 Thread。服务只绑定 `127.0.0.1`，校验会话令牌及 WebView Origin；API Key 只出现在 sidecar 进程环境中，不进入浏览器或 Git 仓库。

Agent 对话会发送到所配置的模型提供方；请不要在 Thread 中输入不希望发送的数据。本地保存的对话尚未加密，第一版也没有多 Agent 编排、流式 token 输出或跨设备同步。

# ArcWiki

一个以 Arc 的侧边栏和 Spaces 交互为灵感的轻量桌面知识工作区。在原有 **Markdown 阅读**和 **Agent Thread 对话**之外，小版本增加了 Space 内的 Source、Page 和本地 Wiki 查询；它不是浏览器，也没有自动改写 Wiki、网页标签页或云同步。

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

URL 导入需另外在 sidecar 启动环境设置用户自己的 `TINYFISH_API_KEY`，由 TinyFish 的远程 Fetch 服务处理公开网页；此密钥不进入前端，也不随应用打包。PDF 导入在本机运行 LiteParse 的 `lit` 命令；需自行安装并保证桌面应用可找到它，必要时用 `ARCWIKI_LIT_PATH` 指定可执行文件路径。当前只接收小于 20 MB 且解析结果少于 100 页的 PDF；扫描件可选 OCR，抽取结果应对照原件核对。无凭据或解析器时，Markdown Source、Page 和 Wiki 检索仍可使用；相关导入会显示明确错误。当前安装包**没有**内置 LiteParse、OCR 资源或密钥设置向导。

`test:e2e` 需要 Node.js 18.20+、Bun 和 Tauri 构建依赖。它使用 WebdriverIO + Tauri Service 的嵌入式 WebDriver 驱动真实桌面窗口；脚本启动仅监听 `127.0.0.1` 的模拟 OpenRouter 接口，并覆盖运行环境中的 API Key 为测试假值，不调用真实模型。测试版通过独立的 `com.wade11s.arcwiki.e2e` 标识隔离本地数据（macOS 会生成独立的 `ArcWiki E2E.app`；Linux/Windows 会将 sidecar 放在未打包的测试可执行文件旁）；测试结束会停止模拟服务。正常 `desktop:build` 不包含 WebDriver 插件。Linux 无桌面会话时可用 `xvfb-run bun run test:e2e`。目前已在 macOS 实机验证，Linux/Windows 尚未实机运行。

`test:e2e:live` 需要真实的 `OPENROUTER_API_KEY`，只在显式运行时调用 OpenRouter；它在隔离的测试版桌面窗口里发送两轮非私人测试消息并验证历史持久化，不会重置正常 ArcWiki 的数据。若密钥在另一个本机目录，请将 `--env-file` 改为该文件的绝对路径。测试用的 `.env.local` 不会自动随 Delta Thread 或 Git remote 同步。

## 使用方式

- 在侧边栏底部点击彩色圆点选择 Space，侧边栏中选择 Tab；仅在**左侧侧边栏**用触控板横向双指滑动切换 Space，右侧内容区域的横向滑动不会切换，纵向滚动仍用于阅读文档。
- 原有 Markdown 标签页可阅读内置示例，或从本机导入 `.md` 文件；这些旧式本地标签页不自动成为 Wiki Source/Page。要将新资料纳入查询，打开 **Space Wiki**，添加 `.md`、PDF 或公开 URL，查看推荐的 Space 并确认唯一归属；待归属 Source 不进入任何 Thread 的查询范围。Source 保留原件/获取快照和抽取的 Markdown，Page 单独编辑并关联 Source。
- Agent Thread 的输入框是对话末尾的用户气泡；Enter 换行，macOS 用 Command+Enter 发送，Windows/Linux 用 Control+Enter 发送。用户消息与 Agent 消息共用左侧头像列：没有自定义照片时显示占位图标。每个 Thread 的未发送草稿独立保留，回复失败或中断后可以重试该条消息，不会重复插入用户消息。Space、Tab、草稿和对话在本机 WebView 的 localStorage 中保留；清理站点数据会清空它们。Profile 显示名和头像由 Settings 写入本机配置目录。
- Wiki Source/Page 和分层 `AGENTS.md` 保存在应用数据目录的 `wiki/` 下，与上述旧式标签页分开；已有 localStorage 内容不自动迁移或丢弃。当前 Thread 仅检索本 Space 的 Wiki，显示返回的证据 ID；这是轻量文本匹配，不保证语义召回或模型引用的准确性。
- 历史记录完整保留在本机，向模型发送时只选取符合 sidecar 条数与请求大小限制的最近上下文；超过长度限制的单条输入无法发送。当前 Space 找不到依据时，Agent 应说明没有匹配的 Wiki 证据，不会退回其他 Space。
- 没有设置密钥时仍能浏览文档和 Wiki；Agent Thread 会提示打开 Settings。阅读宽度可在主窗口切换，也会写入 Settings。

开发环境中可用 `bun run wiki -- --data-dir /path/to/wiki space list` 等命令操作**明确指定**的数据目录；CLI 与桌面 sidecar 调用同一 Wiki 核心，但 CLI 不包含在安装包中。`source add --file note.md`、`source add --url https://...`、`source suggest --source ID`、`source assign --source ID --space ID`、`query --space ID --query TEXT`、`lint --space ID` 可以通过 `bun run wiki -- --data-dir /path/to/wiki <command>` 调用。URL/PDF 命令同样需要上述凭据/解析器；`source add` 只捕获资料，不会自动生成或修改 Page。

## 结构与安全边界

- `src/`：React 界面、Space/Tab 状态、Markdown、Thread 与 Settings 窗口。
- `src-tauri/`：主窗口、Settings 窗口和 sidecar 生命周期；Tauri 在启动时生成随机会话令牌，配置 Wiki 数据目录，并把本机端口与令牌通过限定的 IPC 命令交给窗口。Settings 可通过 IPC 提交新密钥，但不会把已保存的密钥返回给前端。
- `sidecar/`：Bun HTTP 服务与文件式 Wiki 核心，使用 OpenAI Agents SDK 通过 OpenRouter 的 Chat Completions 接口回应 Thread。服务只绑定 `127.0.0.1`，校验会话令牌及 WebView Origin；API Key 不进入浏览器或 Git 仓库。

Agent 对话及当前 Space 中匹配到的 Wiki 摘录会发送到所配置的模型提供方；请不要在 Thread 或该 Space 的 Source/Page 中放入不希望发送的数据。URL 导入会把 URL 发给 TinyFish。Wiki/对话本地文件尚未加密，也没有多 Agent 编排、流式 token 输出或跨设备同步。

# ArcWiki 开发指引

产品范围、运行和打包方式见 `README.md`；可执行命令以 `package.json` 为准。第一版只有 Markdown 与 Agent Thread，不把它扩展成网页浏览器或完整的自动 Wiki。

## 改动边界

- 界面、Space/Tab 状态、触控板手势与 Settings 窗口在 `src/`；Agent HTTP 契约在 `sidecar/`；sidecar 的启动、端口、会话令牌与 Settings 持久化在 `src-tauri/`。跨层改接口时同步检查调用方和测试。
- 凭据由 Tauri 写入 sidecar 进程的 `OPENROUTER_API_KEY`（来自 Settings 或尚未保存时的启动环境）。前端只接收临时的本机端口与会话令牌；Settings 窗口可通过 IPC 提交新密钥，但不会读回已保存的密钥。保持 loopback 绑定、Bearer 校验和 Origin 限制。
- Markdown 是不可信输入：保留默认的 HTML 转义与安全链接处理。调整 Space 手势时，限制左侧侧边栏触发，保留纵向阅读滚动、每次手势至多切换一次、键盘操作和减少动画偏好。
- 验证要覆盖实际改动路径：界面运行 `bun run build`，桌面 GUI 交互用 `cua-driver` 测试，操作前后获取窗口状态以确认结果；sidecar 运行 `bun run test`；改动 Tauri/打包时运行 `bun run desktop:build`。生成的可执行文件和 `target/` 不入库。

## Subagent 派发

先按**子任务**判断难度和独立性：可并行且文件所有权清楚，或需要独立审查时才派发；依赖前一步结果的工作留在当前线程。派发时写清目标、文件边界、接口契约、验收方式及凭据边界；`worker` 实现、`scout` 调查、`reviewer` 验证。

| 子任务难度 | 典型情况 | 模型选择 |
| --- | --- | --- |
| 较难 | 跨前端、sidecar、Tauri 的设计；安全边界或复杂故障 | `openai-subscribed/gpt-6-sol[effort=high]` |
| 中等 | 单个模块内有明确边界但需要技术取舍的功能 | `x_ai-subscribed/grok-4.6[effort=xhigh]`（extra high） |
| 简单 | 范围局部、验收条件明确的修正或文档 | `openai-subscribed/gpt-6-luna[effort=max]` |

模型不可用时说明原因并确认替代选择，不静默换模型。

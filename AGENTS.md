# ArcWiki 开发指引

产品范围、运行和打包方式见 `README.md`；可执行命令以 `package.json` 为准。Wiki 小版本的已定规则和未决迁移见 `docs/design/wiki-v1-scope.md`；保持 Markdown、Source/Page 与 Agent Thread 的小步演进，不把它扩展成网页浏览器或无人确认的自动 Wiki。

## 改动边界

- 界面、Space/Tab 状态、触控板手势与 Settings 窗口在 `src/`；Agent HTTP 契约与文件式 Wiki 核心在 `sidecar/`；sidecar 的启动、端口、Wiki 数据目录、会话令牌与 Settings 持久化在 `src-tauri/`。跨层改接口时同步检查调用方和测试。
- 用户 Wiki 目录内的 `AGENTS.md` 是运行时知识约定，不是本仓库的开发指引；Source 的归属和 Agent Thread 的 Space 查询范围由代码校验。旧 localStorage 标签页保留原样，迁移方案未定前不自动加入 Wiki 查询。
- OpenRouter 凭据由 Tauri 写入 sidecar 进程的 `OPENROUTER_API_KEY`（来自 Settings 或未保存时的启动环境）；TinyFish 凭据只从 sidecar 启动环境读取。前端只接收临时的本机端口与会话令牌；Settings 可提交新密钥，但不读回已保存的密钥。保持 loopback 绑定、Bearer 校验和 Origin 限制。
- Markdown 是不可信输入：保留默认的 HTML 转义与安全链接处理。调整 Space 手势时，限制左侧侧边栏触发，保留纵向阅读滚动、每次手势至多切换一次、键盘操作和减少动画偏好。
- 验证要覆盖实际改动路径：界面运行 `bun run build`，桌面 GUI 交互用 `cua-driver` 测试，操作前后获取窗口状态以确认结果；sidecar 运行 `bun run test`；改动 Tauri/打包时运行 `bun run desktop:build`。URL/PDF 导入还需验证凭据缺失、解析失败与真实转换路径；生成的可执行文件和 `target/` 不入库。

## Subagent 派发

先按**子任务**判断难度和独立性：可并行且文件所有权清楚，或需要独立审查时才派发；依赖前一步结果的工作留在当前线程。派发时写清目标、文件边界、接口契约、验收方式及凭据边界；`worker` 实现、`scout` 调查、`reviewer` 验证。

子任务难度对应的模型池、池外备选模型与选择器校验方式见 `docs/agents/subagent.md`；模型选择以该文件为准。

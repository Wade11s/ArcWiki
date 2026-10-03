# ArcWiki Wiki 小版本实施范围

本文件汇总本轮产品讨论，用于分阶段实施；它不把未确认的旧数据归属、自动改写或跨 Space 共享当作既定规则。现有 Workspace 仍保存在前端 `localStorage`，Agent 请求只传当前 Thread 的对话；下文描述的是目标行为，不是现状。

## 已确认的产品规则

- Space 是知识范围，可拥有多篇 Page；当前 Agent Thread 归属一个 Space，查询和工具操作只使用其范围内的资料。未来的全局 Wiki Thread 是明确的另一种范围，不是当前 Thread 的回退。
- Source 的归属为零或一个 Space：可先保存为待归属，经候选推荐后由用户确认。一个 Source 可关联所属 Space 内多个主题，不因主题关系复制原件。跨 Space 使用同一 URL/PDF 时，本阶段重新导入为不同 Source。
- Source 保留原件或获取快照及由此抽取的 Markdown 阅读稿；Page 是独立维护的知识正文。Page 到 Source 的引用可反向查找；不按人工或机器产出划分 Page 类型。
- Wiki 与 Space（可选主题）可以有分层 `AGENTS.md`，用于知识写作与工作流约定；程序校验归属、引用和查询范围，不能依赖提示文字实现范围约束。
- URL 建议由 TinyFish Fetch 抽取 Markdown；PDF 建议由本地 LiteParse 抽取 Markdown，保留原 PDF。导入 Markdown 不需要额外抽取器。

## 建议的交付顺序

1. **知识核心与存储**：在应用数据目录创建 Space、Source、Page 的稳定身份；实现 Source 捕获、推荐候选、单一 Space 归属、页面引用与反向查询。CLI 与 UI/Agent 调用同一核心。无归属 Source 不进入任何 Space 查询。
2. **转换器**：Markdown 直接保存；网页保存 URL、最终 URL、抓取时间与 Markdown 快照；PDF 保存原件与抽取稿、页码及抽取警告。转换失败不创建“已就绪”的 Source，也不自动改变归属。
3. **受限 Query**：当前 Thread 的 Space 由应用绑定，不由模型任意选择。只从该 Space 的 Page/Source 选取有界片段，展示查询范围和可核对的引用；无匹配时说明没有依据，不回退到其他 Space。
4. **Ingest 与 Lint**：`source add` 仅捕获来源，不等于自动改写知识。Ingest 应先提出 Page 变更供确认；Lint 首先检查失效引用和缺失稿件，矛盾/过期检测后续迭代。CLI 是这些核心操作的薄入口，而非第二套实现。

## 本次实现状态

- 已实现：文件式 Space/Source/Page 与原件/Markdown 双层存储、单一 Space 确认、候选推荐、Page 引用与反查、Thread→Space 绑定、范围内的轻量文本检索、结构性 Lint、对应 UI 与共享核心的开发 CLI。
- UI 入口：Home Page 是默认的 Space 概览，显示范围、资料统计、最近 Page 与 Thread；资料捕获和归属确认只通过 Thread 的本地 `/ingest` 命令进入，确认目标固定为该 Thread 的 Space。`/wiki` 保留页面维护、检索和 Lint，命令本身不进入模型历史；旧本地标签保留，但不再提供新建 Note 或旧式本地导入入口。
- 侧栏与窗口：侧栏可固定或从左缘临时浮出，浮层不占内容布局；Space 创建移到侧栏左下角的独立窗口。Thread 可归档并在独立窗口查看、恢复；完整历史、草稿、证据、身份和 Space 归属保留，归档不取消进行中的回复。主窗口仍是 Workspace 的唯一写入者，辅助窗口只发送身份受限的语义请求，不改变存储迁移范围。
- 已接入但有运行前提：TinyFish URL Fetch 需独立配置 `TINYFISH_API_KEY`；PDF 需本机可执行的 LiteParse `lit`，小于 20 MB 且解析结果少于 100 页。OCR 可选，抽取失败时不创建 Source，用户选取的本地原文件仍在原处。
- 固定验收场景：`sidecar/tests/fixtures/wiki-scenario/` 保存两个 Space、三类 Source、待归属资料、引用页面和 Thread 绑定的合成样例；用真正核心重建临时 Wiki，并覆盖派生的推荐、查询、检查结果与运行时约定。URL 远程返回模拟，PDF 同时有解析适配器模拟和可用时的真实 LiteParse 路径，桌面测试复用输入验证 `/ingest` 与首页统计。
- 未实现：自动/半自动改写 Page 的 Ingest 提案、矛盾和过期信息的语义 Lint、打包 LiteParse/OCR、运行时 Topic 层级、外部 Agent 的打包版 CLI。`source add` 当前只是捕获与转换。

## 尚未决定，不静默处理

- 旧 `localStorage` 中的笔记、导入页与 Thread 在新知识核心中的归属和迁移方式；保留现有数据，不自动把旧标签页编入 Agent 的知识范围。
- Topic 是否需要独立实体及主题级 `AGENTS.md`；仅确定 Source 可在同一个 Space 内关联多个主题。
- Agent 自动提出 Page 修改的触发方式、审阅体验，以及 PDF/URL 抽取失败时的回退和打包依赖。
- TinyFish 的凭据配置与远程处理隐私提示；沿用本机 sidecar 的认证、Origin 限制和凭据不进入前端的原则。

## 验收重点

- 创建 Space 后，当前 Thread 的查询/工具结果不含另一 Space 的 Page 或 Source；待归属 Source 不出现在任何 Thread 的查询结果中。
- 推荐可返回多个候选，但最终一次仅能确认一个 Space；同一 Space 内多个主题可以引用同一 Source。
- PDF 原件、网页获取快照与 Markdown 抽取稿分开，Page 引用可回查到明确的 Source；抽取不可用时报告失败而不是凭空生成知识。
- 既有 Markdown 笔记与 Thread 在升级后不丢失；没有确认迁移方案前，不宣称旧笔记已参与 Wiki 查询。
- 归档隐藏而非删除 Thread，恢复不能覆盖同时编辑的草稿或到达的回复；全部 Thread 归档的 Space 仍可进入首页并新建 Thread。辅助窗口不获取 sidecar 会话令牌，前端事件不能绕过 Rust 的请求登记与窗口身份校验。
- 同一 Space 的较早读取结果或错误不能覆盖已确认更新的内容；Home、侧栏和 Thread 的 Source/Page 列表订阅同一快照，Thread 工具的失效读取不发布旧内容，也不丢弃仍有效的独立待归属列表读取。首次读取失败时退出 Loading、保留明确错误与可重试入口，不把未加载统计显示为零。
- 桌面写入测试使用每个用例新建的 Space；测试版应用的 Wiki 文件会跨运行保留，不能把 localStorage 重置当作 Wiki 数据清空，也不依赖默认 Space 为空。

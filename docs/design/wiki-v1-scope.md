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
- 已接入但有运行前提：TinyFish URL Fetch 需独立配置 `TINYFISH_API_KEY`；PDF 需本机可执行的 LiteParse `lit`，小于 20 MB 且解析结果少于 100 页。OCR 可选，抽取失败时不创建 Source，用户选取的本地原文件仍在原处。
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

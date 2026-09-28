# LLM Wiki / Paper Wiki：概念、实现与 ArcWiki Space 的层级选择

**调研日期：2026-09-28**
**范围：**基于 TinyFish CLI 的搜索与一手资料阅读。这里区分原作者提出的模式、同名具体软件/仓库，以及本文对 ArcWiki 的推断；不是产品推荐，也不代表 ArcWiki 已采用任何方案。

## 简明结论

- **“LLM Wiki”既是一个通用模式名称，也被具体项目用作产品名。** Andrej Karpathy 的 `llm-wiki.md` 明确称自己为“使用 LLM 构建个人知识库的模式”，并刻意保持抽象；`nashsu/llm_wiki` 则自称为该模式的桌面应用实现。两者不应混为一谈。[模式原文](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)；[项目 README](https://github.com/nashsu/llm_wiki)
- **“Paper Wiki”不是本次检索中能确认的唯一、稳定范式名称。** 该词可被直观地用来描述“论文研究 Wiki”，但搜索也会返回具体项目和非相关内容。一个明确的同名具体仓库是 [Spark-To-Paper-Skills/paper-wiki](https://github.com/Spark-To-Paper-Skills/paper-wiki)：其 README 将其描述为论文/课程研究的 LLM Wiki 编译流程与编码代理技能。不能把它直接等同于所有“论文 Wiki”或某个学术公认范式。
- 在 Karpathy 的抽象模式中，原始来源、LLM 维护的 Wiki、描述规则的 schema 是三层；引入来源、查询、lint 是主要操作。它谈到新增来源时跨页面整合、标记矛盾，回答应带引用，且可以把有价值的回答回写；同时建议定期检查过时信息和孤立页面。[架构与操作](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)
- 以上是**模式提案**，不是证明自动编译必然正确，也没有规定一套通用的对象 schema、权限/审核流程或来源更新协议。`nashsu/llm_wiki` 提供一个具体实现例子：来源字段追溯、增量处理、队列、Review 项、来源文件监视等；这些是该项目自己的设计，不是 LLM Wiki 概念的必选特征。[项目 README](https://github.com/nashsu/llm_wiki)
- ArcWiki 当前的 Space 仅作标签/导航分组，Agent 仅能读取当前 Thread 消息（见 [Space 与 Tab 状态](../../src/App.tsx#L42-L76)及 [Agent 请求](../../src/App.tsx#L839-L885)；[开发指引](../../AGENTS.md#L3)限定第一版不做完整自动 Wiki）。Space 可以维持纯 UI 导航、扩展为知识库/工作区边界，或成为项目/研究主题容器。三者在数据隔离、Thread 归属、导入资料范围、迁移复杂度上不同；现有来源无法替产品决策给出唯一正确层级。

## 术语辨析

### LLM Wiki：理念名称 vs. 具体产品

Karpathy 的原文标题是 “LLM Wiki”，副标题为 “A pattern for building personal knowledge bases using LLMs”；它称文档是供用户与 LLM agent 协作实例化的 idea file，而不是可执行产品规范。原文对比了仅在提问时检索原始文件的 RAG 与持续维护持久 Wiki 的流程。[原文开头与核心想法](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)

具体同名实现 `nashsu/llm_wiki` 自述基于 Karpathy 模式，提供桌面应用、文档导入、图谱等扩展。这个 README 是该仓库对**自身产品**的说明，适合用于辨认一个具体实现，不构成独立评测或对原模式有效性的验证。[项目说明与自述差异](https://github.com/nashsu/llm_wiki)

### Paper Wiki：描述性称呼 vs. 同名项目

本次以 `"Paper Wiki"`、`"Paper Wiki" research papers wiki definition` 等查询检索时，结果同时包含泛论文/Wikipedia 条目、技能仓库、社交帖子和名为 Paper Wiki 的具体项目；没有找到一个足以证明存在唯一“Paper Wiki”学术范式的权威定义。因此本文把“论文 Wiki”作为**描述性用语**（围绕论文来源组织可关联、可追溯的知识），而将 `paper-wiki` 仅作为一个具体仓库名称讨论。

`Spark-To-Paper-Skills/paper-wiki` 自述提供 research/course 两种模板，将来源材料与 Wiki 产物分开，并通过工作流、协议、机器审核记录等支持论文研究。仓库自述可证明其项目设计意图，不能证明采用该项目即等同于某个公认范式或能保证研究质量。[仓库 README](https://github.com/Spark-To-Paper-Skills/paper-wiki)

## 来源支持的事实

### 通用模式中的对象与关系

以下是 Karpathy 文档中的**原文主张/建议**，并非本文独立验证的技术结论：

1. **Raw sources**：文章、论文、图片、数据等来源文件；原文主张其不可变，LLM 读取而不修改，并将它们作为 source of truth。
2. **Wiki**：由 LLM 生成和维护的 Markdown 文件集合，例如摘要、实体页、概念页、比较、总览与综合；接收新来源时更新相关页面和交叉引用。
3. **Schema**：指导 LLM 遵循 Wiki 结构、约定与 ingest/query/maintenance 工作流的文档；原文以 `CLAUDE.md`/`AGENTS.md` 为例。
4. 三者关系可概括为 **来源 → 编译/维护的知识页面 ← schema 约束的处理规则**。索引和日志是建议的导航/过程记录文件，不等同于来源或知识实体。
5. 原文提出 ingest、query、lint：逐份阅读来源并更新相关页面；从 Wiki 页面检索并综合回答；定期找矛盾、被新来源取代的陈旧主张、孤立页、缺失交叉链接和知识空缺。

依据：[Architecture](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)、[Operations](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)、[Indexing and logging](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)。

### 来源、引用、审核与更新

- **来源关系与引用：** Karpathy 将原始来源设为 source of truth，要求回答带 citations，并在 ingest 时更新页面；但原文没有规定统一的 claim-level 引用格式、来源版本 ID、页码定位 schema 或引用验证算法。上述是对原文边界的归纳。[原文](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)
- **人工参与：** 原文描述作者逐篇 ingest、阅读摘要/更新并指导重点，也指出团队 Wiki 可考虑 human review；但这不是要求每次更新必须经过批准的正式审批协议。[Ingest 与团队场景](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)
- **知识更新：** 原文主张新增来源会引起相关页、综合、交叉引用的增量修订；定期 lint 用于发现陈旧信息和矛盾。它并未定义来源原文件被替换/删除、撤销某条主张、保留知识版本或自动解决冲突的规范流程。[Operations](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md)
- **具体实现补充（非通用要求）：** `nashsu/llm_wiki` README 声称生成页面用 `sources[]` 追溯原始文件；提供分析后生成的两阶段导入、SHA256 增量缓存、持久队列/重试、source folder auto-watch、异步 Review，以及只从原始材料回答的模式。这些描述证明项目宣称具备这些机制，不证明其覆盖所有错误或经过独立验证。[项目功能与新增设计](https://github.com/nashsu/llm_wiki)
- **另一个具体项目的治理例子：** `Spark-To-Paper-Skills/paper-wiki` README 描述 `raw/` 与 `wiki/` 分层、机器决策 INBOX 追加记录、反方复核文件、引用检查脚本和 lint。此处同样只陈述仓库自述，不能外推为“Paper Wiki”范式规范。[仓库 README](https://github.com/Spark-To-Paper-Skills/paper-wiki)

## 对 ArcWiki Space 层级的可行解释

背景基线：ArcWiki v1 的本地 Markdown 阅读/导入与 Agent Thread 尚未组成自动知识编译闭环；[Workspace 状态](../../src/App.tsx#L42-L76)把 Space 用于标签/导航，[Agent 请求](../../src/App.tsx#L839-L885)仅传当前 Thread 消息。[开发指引](../../AGENTS.md#L3)注明第一版不做完整自动 Wiki。

下列是**设计选项分析/推断**，不是外部来源事实，也不是建议已获采纳。

| 解释 | Space 的含义 | 好处 | 代价与迁移影响 |
| --- | --- | --- | --- |
| **A. 纯导航分组** | Space 仍是 UI 层的 Tab/标签集合；笔记与 Thread 是彼此独立的本地对象，Space 不声明知识权限边界。 | 最符合 v1 现状；不用改变导入、Thread 存储或 Agent 上下文契约；手势与导航模型可保持简单。 | 不能自然表达“这个研究空间有哪些来源、知识页和讨论”；未来如需 Agent 读取 Space 内容，需要另增显式关联/选择机制，用户可能误以为切换 Space 就改变了 Agent 的知识范围。 |
| **B. 知识库/工作区边界** | Space 是一个可配置工作区，拥有一组来源、Wiki 页面、索引/规则；Thread 可在其中讨论并按明确操作读写该知识库。 | 与“持久知识积累”模式接近；来源、派生页、规则及检索范围可形成明确边界；便于按 Studio/Personal 等上下文隔离。 | 是最大语义升级：要定义对象归属、共享/跨 Space 链接、冲突和去重、Agent 授权范围、导入迁移；旧 Space/Tab 数据不能仅靠改名安全映射成新知识空间。 |
| **C. 主题/项目容器** | Space 表示一个主题或研究项目；可汇聚多个来源集合、Thread 与知识视图，但数据对象仍可独立存在/跨 Space 引用。 | 与长期研究过程相容，Thread 可围绕项目而非单次会话；比把每个 Space 直接定义为单一 Wiki 更灵活。 | 多对多关联、归档/删除语义、跨主题重复内容、上下文合并都需要规则；需明确 Agent 默认读当前 Thread、当前 Space 子集还是用户选定资料，避免隐式扩大上下文。 |

**评估时值得先定的边界问题：** Space 切换是否改变 Agent 可见信息？Thread 是 Space 内对象还是独立对象？一个来源能否属于多个主题？派生 Wiki 页是否必须反向引用来源并区分人工确认与机器草稿？旧版本只存导航偏好，升级后如何避免把历史对象自动赋予新的知识归属？这些问题比 UI 名称更能决定迁移代价。

## 推断、局限与未证实事项

- **推断：** 若目标是只改导航，选择 A 可以最大限度尊重 v1 的数据语义；若目标是建立持续知识对象及 Agent 检索，B 或 C 才能承载该边界。两者需要先定义权限、引用和更新协议，不能只把 Space 名称改成“Wiki”。
- **未证实：** 本次没有测试任何产品实际 ingest 的准确率、引用忠实度、更新遗漏率、并发冲突处理或用户审核成本；项目 README 的功能说明不是独立验证。
- **未证实：** 没有证据表明“Paper Wiki”是统一的学术分类、论文数据库标准或单一产品名称。本次检索只能确认具体同名项目存在；泛指论文研究知识库时应先说明定义。
- **局限：** TinyFish 页面抽取适合阅读公开页面；Karpathy 原文的发布日期/修订历史未在本次抓取输出中可靠确认，因此不以它推断理念提出时间。页面事实取自对应原作者/项目仓库自身的一手说明。

## 来源清单

访问/获取日期均为 **2026-09-28**。链接为可点击原始来源；章节锚点指向来源页面内相应段落。

1. Andrej Karpathy, **LLM Wiki**（GitHub Gist 原文；理念描述/架构/操作建议）。[原文](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)；[raw Markdown](https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw/llm-wiki.md)。通过 `tinyfish fetch content get` 阅读 raw Markdown；按原文标题定位 Architecture、Operations、Indexing and logging、Note。
2. `nashsu/llm_wiki`，**LLM Wiki**（具体桌面项目的 README 与功能/实现自述）。[GitHub 仓库](https://github.com/nashsu/llm_wiki)。通过 TinyFish 获取仓库 README 页面；引用其 What is this?、What We Kept from the Original、What We Changed 等部分。
3. `Spark-To-Paper-Skills/paper-wiki`（具体 Paper Wiki 仓库；README 描述研究/课程模板、来源与 Wiki 目录、机器审核与 lint）。[GitHub 仓库](https://github.com/Spark-To-Paper-Skills/paper-wiki)。通过 TinyFish 获取仓库 README；本文仅引用仓库自述，不将其外推为一般范式。
4. ArcWiki 仓库代码和开发指引（产品现状基线）。[界面状态与 Agent 请求](../../src/App.tsx#L42-L76)；[AGENTS.md](../../AGENTS.md#L3)。项目内文件；用于核对 v1 的功能范围，不是外部研究来源。

**URL 可访问性检查：** 以上三个外部 GitHub/Gist 页面均通过 TinyFish `fetch content get` 返回了内容；原文 raw Markdown 也成功读取。ArcWiki 代码与开发指引为本仓库相对链接，可在仓库中打开。

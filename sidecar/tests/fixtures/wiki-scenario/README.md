# 固定 Wiki 场景

这些文件是完全合成的公开测试资料，不含真实用户数据或凭据。`scenario.json` 是场景清单，
不是一个已打开的用户 Wiki；测试调用真正的 `WikiStore`，在每次独立的临时目录里捕获资料、
确认归属、建立页面和 Thread 绑定。UUID 与时间由生产代码生成，通过清单里的稳定别名关联，
不把随机运行输出写回仓库。

## 场景与覆盖

- **Borealis release**：Markdown 发布决策、URL 运维指南、合法的一页 PDF 延迟审计。
  两篇维护页面引用同一资料及多份资料，用于验证引用、反查和正文独立存储。
- **Habitat restoration**：红树林调查及恢复计划，用不同检索词验证跨 Space 隔离。
- **Orion intake**：已捕获但未归属的 Markdown；不能进入任何 Thread 的 Wiki 查询。
- 两个固定 Thread 绑定验证查询范围与不可跨 Space 重绑定。
- 覆盖三种 Source 的原件/快照与抽取稿、URL 最终地址、PDF 页数/警告、
  Page/Citation、Space 推荐、范围内 QueryResult、全部五类 LintIssue，以及核心创建的
  Wiki/Space 默认运行时 `AGENTS.md`。Topic 尚无模型，不制作假 Topic。

## 运行

```sh
bun test sidecar/tests/wiki-fixtures.test.ts
# 或随完整测试运行
bun run test
```

`fixtureHelpers.ts` 的 `seedWikiFixture(root)` 只接受调用方提供的目录；测试总是使用新建的临时目录。
不要用用户的 Wiki 数据目录运行它。其他测试可以复用该函数和 `WIKI_FIXTURE_DIR`，
桌面 E2E 也可以读取相同 Markdown/PDF 输入通过 `/ingest` 导入到隔离的测试版应用。

## 真路径与模拟边界

- 存储、归属、查询、引用、反查、重新打开、Thread 绑定及 Lint 均运行真正核心，不模拟存储。
- URL 运行真正 `convertWebUrl`；仅 HTTP fetcher 用 `url-response.json` 这份合成响应替换。
  `example.com` 不会真的访问，假测试键不会提交给外部服务。
- 默认 PDF 场景运行真正转换器的文件 I/O，以 `cooling-audit.md` 模拟外部解析适配器输出，
  所以没有全局 LiteParse 也能重复测试。OCR 用例显式模拟首轮无文本和第二轮 OCR；
  它不声称这个带文本层的 PDF 需要真实 OCR。
- `cooling-audit.pdf` 是合法的一页、带 Helvetica 文本层的 PDF，不是仅有 `%PDF-` 标头的占位文件。
  如 `lit` 在 PATH 中，额外测试会运行真正本地 LiteParse 并核对 42 ms、80 ms p95、
  1,200 次采样和页数；未安装时该项明确跳过。真实 OCR 资源不在此夹具内。
- 此测试不调用真实 OpenRouter 或 TinyFish，不收费，不修改正常桌面应用的数据。

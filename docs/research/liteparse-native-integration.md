# LiteParse 原生 TypeScript 接口替换外部 `lit`：可行性与打包复杂度

**调研日期：2026-09-29。结论适用于所测版本与平台，不是跨平台兼容性承诺。** 本文区分仓库现状、上游一手资料、隔离本机实测与工程推断；没有替换生产代码、依赖或锁文件，也没有导入私人 PDF、读取凭据或调用远程文档解析服务。

## 结论先行

`@llamaindex/liteparse@2.14.7` 的 Node/TypeScript API **确实接受 PDF `Buffer`/`Uint8Array`**，返回 Markdown 字符串 `result.text`、原文件页数 `result.totalPages` 和逐页数据；在本机 Bun 1.4.2 **直接运行**可解析合成 PDF。但 ArcWiki 当前发布的是 `Bun.build({ compile: ... })` 生成、由 Tauri 当作单个 sidecar 执行的程序。隔离的 `bun build --compile` POC **编译成功、运行失败**，启动阶段即报 `Failed to load native module for darwin-arm64`，即使在仍有 `node_modules` 的目录中执行也是如此。因此“改一行 import 即替换 `lit`”不成立。[现有构建](../../scripts/build-sidecar.ts#L1-L18)；[Tauri 只声明一个 externalBin](../../src-tauri/tauri.conf.json#L43-L54)；[上游平台 binding 加载源码](https://github.com/run-llama/liteparse/blob/main/packages/node/src/native.ts)。

更重要的是，当前外部 CLI 的 `execFile` 具备 **60 秒杀掉子进程**的边界。上游建议通过 `poolSize` + `parseTimeoutMs` 提供原生 API 的硬超时，但在这台机器的 Bun 1.4.2 下，隔离 POC 使用该模式报 `this.child.channel?.ref/unref is not a function`；Node 22.23.0 对照可运行。直接在 sidecar 内调原生解析不能据此宣称维持 60 秒硬超时。[现有超时](../../sidecar/src/converters.ts#L163-L187)；[上游 worker pool 文档](https://github.com/run-llama/liteparse/blob/main/packages/node/README.md#worker-pool-and-hard-timeouts)；[实现](https://github.com/run-llama/liteparse/blob/main/packages/node/src/pool.ts)。

**建议：暂时继续外部 `lit` CLI，不做生产替换。** 若产品要求开箱即用的离线 PDF 导入，先做“具体 CLI 分发形态 + OCR 资源 + Tauri 安装包”的独立打包试验；若坚持 TS API，则先解决编译后 `.node`/PDFium 装载和 Bun 可用的进程级超时，再进入跨平台改造。保留现行 20 MB、原件/抽取稿、页数及错误边界，不因接口更简短而牺牲它们。

## ArcWiki 现有调用契约（仓库事实）

| 层 | 当前行为和不应丢失的约束 |
| --- | --- |
| UI → HTTP | UI 仅接受不超过 20 MiB 的本地 `.pdf`，发送 `{kind:"pdf",filename,base64,allowOcr}`；HTTP 校验 base64，读取为 bytes，向转换器传文件名与 OCR 选项。[UI](../../src/WikiPanel.tsx#L106-L133)；[HTTP](../../sidecar/src/wikiHttp.ts#L85-L120)；[请求体上限](../../sidecar/src/server.ts#L273-L304)。 |
| 转换 | 非空、最多 20 MiB 和 `%PDF-` 头预检查；bytes 写入隔离临时 `original.pdf`，`execFile(lit, ["parse",…, "--format","markdown","--max-pages","100","--no-ocr","-o",…])`；从 stderr 的 `(<n> pages)` 取页数，60 秒进程超时。页数须为整数且 **1–99**。空抽取且用户允许时才 OCR 重跑，OCR 页数必须与第一次一致；最终拒绝空文和超过 1,000,000 字符的稿件，`finally` 删除临时目录。[转换器](../../sidecar/src/converters.ts#L163-L254)。 |
| 错误 | 首次解析/OCR 失败转换成有界、无凭据的提示；HTTP 将 PDF 等转换失败映射为 422 `conversion_failed`，不把原生异常原样返回。[转换器](../../sidecar/src/converters.ts#L213-L240)；[HTTP 错误分类](../../sidecar/src/server.ts#L306-L329)。 |
| 存储 | 成功后 `original` 仍是原 PDF bytes，`markdown` 是抽取稿；Wiki 持久化为 `original.pdf`、`extracted.md` 和含 `pageCount`/warnings 的元数据，且再次验证 `<100` 页。[转换结果](../../sidecar/src/converters.ts#L242-L250)；[WikiStore](../../sidecar/src/wiki/index.ts#L236-L272)。 |
| 启动/打包 | sidecar 来自单文件 Bun 编译，Tauri 按平台 target triple 寻找外置 sidecar，启动时设置 Wiki 目录与会话令牌，不配置 LiteParse 资源路径；`ARCWIKI_LIT_PATH` 目前可选覆盖外部可执行文件。README 明说安装包没有内置 LiteParse/OCR。[build](../../scripts/build-sidecar.ts#L1-L18)；[路径](../../scripts/sidecarPath.ts#L1-L21)；[Tauri](../../src-tauri/src/lib.rs#L51-L62)；[环境](../../sidecar/src/server.ts#L413-L427)；[README](../../README.md#L27-L31)。 |

注意：**现有判空是 `markdown.trim()`，并不等同于“无 PDF 文本层”。** 本次安装的 2.14.7 CLI 对合成纯图片 PDF 的 `--no-ocr --format markdown` 产出非空的 `` ```text\n\n``` ``；同版本 TS API 的 `result.text` 也如此，尽管 `page.text === ""` 且 `page.textItems.length === 0`。所以对于这个样本，现有按需 OCR 分支不会触发；这是本次发现的版本/样本相关既有边界风险，**不是**本报告已经修复的行为，更不能断言所有扫描件都这样。

## 上游一手资料核验（与 POC 实测分开）

一手资料为 [官方 TypeScript library 指引](https://github.com/run-llama/liteparse/blob/main/docs/src/content/docs/liteparse/guides/library-usage.mdx)、[官方 Node 包 README](https://github.com/run-llama/liteparse/blob/main/packages/node/README.md)、[Node 公开类型与实现](https://github.com/run-llama/liteparse/blob/main/packages/node/src/lib.ts)、[native binding 加载器](https://github.com/run-llama/liteparse/blob/main/packages/node/src/native.ts)、[OCR 指引](https://github.com/run-llama/liteparse/blob/main/docs/src/content/docs/liteparse/guides/ocr.md)，以及 **版本固定**的 [npm 发布元数据 2.14.7](https://registry.npmjs.org/@llamaindex%2Fliteparse/2.14.7) / [darwin-arm64 平台包](https://registry.npmjs.org/@llamaindex%2Fliteparse-darwin-arm64/2.14.7)。GitHub `main` 链接会变化；以下实际接口另与隔离安装的 **2.14.7** 包内 `dist/lib.d.ts`、`dist/lib.js`、`README.md`、`package.json` 逐项对照。npm 元数据声明 `engines.node >=18`，没有正式声明 Bun 为受支持运行时。

实际 API 形状是 **具名导入** `import { LiteParse } from "@llamaindex/liteparse"`、`new LiteParse({ ... })`、`await parser.parse(pathOrBufferOrUint8Array)`，不是 `LiteParse.parse(...)` 静态方法，也不是另一个同名 WASM 包的 `await init()`。可用于保留现行行为的配置：

```ts
import { LiteParse } from "@llamaindex/liteparse";

const first = await new LiteParse({
  ocrEnabled: false,
  outputFormat: "markdown",
  maxPages: 100,
}).parse(pdfBytes); // Buffer 或 Uint8Array

// first.text 是整篇 Markdown；first.totalPages 是过滤/上限前的原文件页数；
// first.pages 是实际处理页，first.pageErrors 是容错模式的逐页异常。
// 保持现有规则：先校验 Number.isInteger(first.totalPages) 和 1 <= n < 100；
// 不能把 first.pages.length 误当为原文件页数。
// 如确认确实缺少可抽取文本且用户允许 OCR，再用 ocrEnabled: true 重跑。
```

以上是**接口示意，不是落地补丁**：`outputFormat` 默认 `json`，必须显式选 `markdown`；`ocrEnabled` 默认 `true`，必须显式先关后按需开；`maxPages` 是**处理上限，不是拒绝超页文档的验证**；`totalPages` 才是原文件页数。`continueOnPageError` 默认 `false`，启用后须明确处理 `pageErrors`，否则可能接纳不完整抽取。[Node README 的 Markdown/bytes/config](https://github.com/run-llama/liteparse/blob/main/packages/node/README.md)；[官方公开类型 `ParseResult` 与 `LiteParseInput`](https://github.com/run-llama/liteparse/blob/main/packages/node/src/lib.ts)。

错误 API 返回 rejected Promise / 抛 Error；本机无效合成 PDF 报 `PDF error: invalid PDF format`，`code: "GenericFailure"`，不是现有用户错误信息。上游 `poolSize` 搭配 `parseTimeoutMs` 才提供**通过杀掉进程**的硬超时；`parseTimeoutMs` 单独配置在发布版实现中抛 `parseTimeoutMs requires poolSize`。非 pool 的 `parse()` 在当前发布版直接等待 native 调用，不能靠 `Promise.race` 等价替换 `execFile` 的杀进程语义。[实现](https://github.com/run-llama/liteparse/blob/main/packages/node/src/lib.ts)；[进程池](https://github.com/run-llama/liteparse/blob/main/packages/node/src/pool.ts)。

发布包用平台 `optionalDependencies` 分发 `.node` N-API binding，而不是纯 JS：2.14.7 元数据列出 macOS x64/arm64、Linux x64 GNU/musl 与 arm64 GNU、Windows x64/arm64 MSVC，**未列 Linux arm64 musl**。平台加载器依 `process.platform`/`process.arch` 计算包名并用 `createRequire(import.meta.url)` 动态 `require`，失败会吞掉尝试原因后给通用 missing-native 消息。本机平台包包含 `liteparse.darwin-arm64.node` 和 `libpdfium.dylib`；这两者及其路径不能仅通过把 JS 打进 Bun sidecar 来推定自动可用。[npm 发布元数据](https://registry.npmjs.org/@llamaindex%2Fliteparse/2.14.7)；[binding 加载器](https://github.com/run-llama/liteparse/blob/main/packages/node/src/native.ts)。

OCR 使用本地 Tesseract，但 **`.traineddata` 不是随平台包自动保证的离线资源**。上游说明可能首次自动下载并缓存；可以显式配置 `tessdataPath` 或 `TESSDATA_PREFIX` 指向已预置语言数据目录，离线或沙箱无资源时 OCR 可失败；`ocrFailureFatal` 默认 `true`，系统性 OCR 失败会抛错。文档还说明 OCR 对无文字页/图片有选择地执行，并非全页无条件 OCR。[OCR 指引](https://github.com/run-llama/liteparse/blob/main/docs/src/content/docs/liteparse/guides/ocr.md)；[Node 配置](https://github.com/run-llama/liteparse/blob/main/packages/node/README.md)。

## 隔离 POC：环境、结果和原始失败

- 平台：macOS Darwin 27.0.0、Apple Silicon `arm64`，Rust target `aarch64-apple-darwin`；Bun `1.4.2`，Node `v22.23.0`；`@llamaindex/liteparse` **精确版本 2.14.7**。没有测试 macOS x64、Linux 或 Windows。
- 在 `$DELTA_SCRATCH_DIR/liteparse-poc` 自建 `package.json` 并 `bun add --exact @llamaindex/liteparse@2.14.7`；scratch 会在回合结束时清理。仓库 `package.json`/`bun.lock`、生产脚本、Tauri 打包配置都没有改动。
- 测试 PDF 全由本地脚本生成：1/3/100 页文本层 PDF、1 页自绘 `HELLO` 纯位图 PDF、格式不合法的 `%PDF-` 文件；不含私人材料。OCR 时以 scratch 内 `HOME` 和 `TESSDATA_PREFIX` 隔离资源位置；直接运行在该目录出现约 **15 MiB** 的 `eng.traineddata`，验证了首次资源获取路径（不代表它随编译二进制存在）。

| 实验（合成材料） | 本机实测结果 |
| --- | --- |
| Bun 直接 `parse(Buffer)` 与 `parse(Uint8Array)`，`ocrEnabled:false`、`outputFormat:"markdown"` | 均得到 `totalPages:1`、`pages.length:1`、`text:"Hello ArcWiki PDF page 1"`、`pageErrors:[]`。不必先落临时 PDF。 |
| 3 页 PDF，`maxPages:2` | `totalPages:3`、`pages.length:2`：仅以 `pages.length` 验证会错误接受截断结果。100 页样本设 `maxPages:100` 则 `totalPages:100`，按 ArcWiki 规则仍应拒绝。 |
| 纯图扫描件，先无 OCR，再开 OCR | 无 OCR 时 `result.text === "```text\n\n```"`、逐页 `textItems:[]`；开 OCR 时抽取到 `"HELLL!"`（不是精确的 `HELLO`），文中还有图片 placeholder。**OCR 可运行但准确率不能假定**；抽取仍须与原件核对。本机同版 CLI 的 `--no-ocr` 输出文件也有上述 12 字节非空占位符。 |
| 不合法的 `%PDF-` 文件 | `error: PDF error: invalid PDF format`，`code: "GenericFailure"`；需要维持现有有界用户错误映射。 |
| `new LiteParse({poolSize:1, parseTimeoutMs:60000})` | Node 22.23.0 的同一 POC 成功；Bun 1.4.2 抛 `TypeError: this.child.channel?.ref is not a function` 及 `...unref is not a function`。这只证明**本机这两个运行时/版本组合**的差异，不推断其他 Bun 版本。 |
| `bun build --compile ./poc.ts --outfile ./poc-bin`，随后运行 | **编译成功**（约 59 MiB 文件），但本机在有 `node_modules` 的原目录和没有依赖的隔离兄弟目录都在启动时失败，尚未进入 PDF 解析。 |
| 试探 `--external '@llamaindex/liteparse'` | 编译成功，但执行时报 `Cannot find module '@llamaindex/liteparse' from '/$bunfs/root/poc-external'`；仅标为 external 并未解决资源寻址。 |

核心失败的**原始错误**（精简为首个异常，未改写文本；同机有依赖的目录执行）：

```text
$ bun build --compile ./poc.ts --outfile ./poc-bin
  [10ms]  bundle  2 modules
 [161ms] compile  ./poc-bin
$ ./poc-bin noocr text.pdf
error: Failed to load native module for darwin-arm64. Ensure the correct optional dependency is installed.
      at loadNative (/$bunfs/root/poc-bin:56:9)
      at /$bunfs/root/poc-bin:58:24
Bun v1.4.2 (macOS arm64)
```

上游 loader 会吞掉底层 `require` 原因，因此这条错误能证明**当前单文件编译路线未装载 binding**，不能单凭它区分 `.node` 未入包、`/$bunfs` 路径解析、PDFium 依赖加载失败等更细原因；不应把它夸大成“所有平台或所有打包方式不可行”。这个失败发生在解析/OCR 之前，**未能证明编译后的 OCR 能工作**。发布包内平台 binding（约 19 MiB）、`libpdfium.dylib`（约 6.4 MiB）和本次 scratch 下载的 `eng.traineddata`（约 15 MiB）是需要分别核算/定位的资源，不是已实测可随可执行文件一同工作。

### 可复现实验命令

以下文件全部在**单独临时目录**；在 Delta 回合可用 `$DELTA_SCRATCH_DIR/liteparse-poc`，其他环境先用 `p="$(mktemp -d)"`，记录 `p` 后自行清理。先创建目录并安装固定版本：

```sh
p="${DELTA_SCRATCH_DIR:?}/liteparse-poc"
mkdir -p "$p"
cd "$p"
printf '{"name":"arcwiki-liteparse-isolated-poc","private":true,"type":"module"}\n' > package.json
bun add --exact @llamaindex/liteparse@2.14.7
```

最小可公开的合成 PDF 生成器（无私有输入、无运行时依赖）：

```sh
cat > gen.mjs <<'EOF'
import { writeFileSync } from 'node:fs';
const glyphs = {
  H:['10001','10001','10001','11111','10001','10001','10001'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  O:['01110','10001','10001','10001','10001','10001','01110'],
};
function pdf(count, imageOnly = false) {
  const objects = [null];
  const add = body => (objects.push(body), objects.length - 1);
  const catalog = add(''), tree = add('');
  const font = imageOnly ? 0 : add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let i = 0; i < count; i++) {
    let resources, commands;
    if (imageOnly) {
      const s = 12, word = 'HELLO', w = (word.length * 6 + 2) * s, h = 9 * s;
      const data = Buffer.alloc(w * h, 255);
      word.split('').forEach((ch, ci) => glyphs[ch].forEach((row, y) =>
        [...row].forEach((bit, x) => {
          if (bit === '1') for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++)
            data[((y + 1) * s + yy) * w + (ci * 6 + 1 + x) * s + xx] = 0;
        })));
      const image = add(Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${data.length} >>\nstream\n`),
        data, Buffer.from('\nendstream'),
      ]));
      resources = `<< /XObject << /Im1 ${image} 0 R >> >>`;
      commands = 'q 360 0 0 108 72 600 cm /Im1 Do Q\n';
    } else {
      resources = `<< /Font << /F1 ${font} 0 R >> >>`;
      commands = `BT /F1 24 Tf 72 660 Td (Hello ArcWiki PDF page ${i + 1}) Tj ET\n`;
    }
    const content = add(`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${content} 0 R >>`));
  }
  objects[catalog] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree] = `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] /Count ${count} >>`;
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')], offsets = [0];
  let length = parts[0].length;
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = length;
    const chunk = Buffer.concat([Buffer.from(`${i} 0 obj\n`), Buffer.from(objects[i]), Buffer.from('\nendobj\n')]);
    parts.push(chunk); length += chunk.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}
for (const [name, n, raster] of [['text.pdf', 1, false], ['three-pages.pdf', 3, false], ['hundred-pages.pdf', 100, false], ['scan.pdf', 1, true]])
  writeFileSync(name, pdf(n, raster));
writeFileSync('invalid.pdf', '%PDF-1.4\ninvalid\n');
EOF
bun gen.mjs
```

隔离程序只记录结果，不修改 ArcWiki 业务代码：

```sh
cat > poc.ts <<'EOF'
import { readFile } from 'node:fs/promises';
import { LiteParse } from '@llamaindex/liteparse';
const [mode, file] = process.argv.slice(2);
const bytes = await readFile(file);
const parser = new LiteParse({
  ocrEnabled: mode === 'ocr',
  outputFormat: 'markdown',
  maxPages: mode === 'cap' ? 2 : 100,
  quiet: true,
  ...(mode === 'pool' ? { poolSize: 1, parseTimeoutMs: 60_000 } : {}),
});
try {
  const result = await parser.parse(mode === 'uint8' ? new Uint8Array(bytes) : bytes);
  console.log(JSON.stringify({
    totalPages: result.totalPages,
    parsedPages: result.pages.length,
    pageErrors: result.pageErrors,
    text: result.text,
    pageNum: result.pages[0]?.pageNum,
  }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  parser.close();
}
EOF
bun poc.ts noocr text.pdf
bun poc.ts uint8 text.pdf
bun poc.ts cap three-pages.pdf
bun poc.ts noocr hundred-pages.pdf
bun poc.ts noocr scan.pdf
bun poc.ts noocr invalid.pdf # 预期失败
mkdir -p ocr-home empty-tessdata
HOME="$PWD/ocr-home" TESSDATA_PREFIX="$PWD/empty-tessdata" bun poc.ts ocr scan.pdf
node poc.ts pool text.pdf # 对照；Bun 下一命令在本机失败
bun poc.ts pool text.pdf
bun build --compile ./poc.ts --outfile ./poc-bin
./poc-bin noocr text.pdf # 本机预期在 native loader 阶段失败
```

独立运行验证可 `mkdir -p "$DELTA_SCRATCH_DIR/standalone"; cp poc-bin "$DELTA_SCRATCH_DIR/standalone/"; cd "$DELTA_SCRATCH_DIR/standalone"; ./poc-bin noocr "$p/text.pdf"`；不能把在源码目录直接 `bun poc.ts` 成功误写成安装包成功。上面 OCR 命令可能按上游行为下载**公开**的语言模型；若必须完全离线，先自行预置 `eng.traineddata` 再将 `TESSDATA_PREFIX` 指向该目录。

## 工程推断、决策与未证实项

| 方案 | 需要做的事/风险 | 保守人天（估算，非实测） |
| --- | --- | --- |
| **维持当前外部 `lit`**（建议近期） | 无生产替换；继续在 README 明示安装与 `ARCWIKI_LIT_PATH`，保留现有子进程 60 秒超时和错误映射。独立排查扫描件无 OCR 时的 Markdown 占位符判空问题。 | 替换工作 **0 天**；占位符专项调查/修正另估 **0.5–1.5 天**。 |
| **只换 TS API，用于未编译的开发 sidecar** | 将 `convertPdf` 的进程/临时文件 adapter 改为解析 bytes 并用 `result.totalPages`、`result.text`、`textItems`/页错误做严格验收；补单测、受控异常。**尚不能发布**，硬超时退化。 | **1–2 人天**的局部接口/测试，不应当作交付完成。 |
| **TS API 完整替换并保留安装包语义** | 解决 Bun 编译后的 `.node`、PDFium 路径/签名、Tauri 资源拷贝和每平台安装运行；找到 Bun 可用的进程级 60 秒中断策略；离线 OCR `tessdataPath`、资源大小、错误映射、回归测试与文档。 | **高：约 7–14 人天仅 macOS 的可发布路径**；Linux/Windows 每平台另预留 **2–4 人天**验证与修补（当前均未实测）。若 loader 无稳定打包方案，估算可能上升。 |
| **明确分发某一种 `lit` CLI 及 OCR 资源** | 同样要选定目标平台、安装路径、Tauri resources、离线 OCR 与验收；若选 npm 的 `lit`，发布包中的入口实际为 `#!/usr/bin/env node`，**仍需 Node + binding + PDFium**，不能把脚本当独立 Rust 二进制。若选择单独构建的原生 CLI，需先确认其可用分发物与授权/签名。 | **中：macOS 约 3–6 人天的预估**，其余平台分别另验；不承诺 npm CLI 自带零依赖。 |

对 TS 方案的方向性设计：仅替换 `convertPdf` 内部 adapter、不改 `/api/wiki/sources` 或 `WikiStore.captureSource` 的 `original`/`markdown` 形状；将 `totalPages` 与 1–99 边界校验放在同一处，确认失败/OCR 页数变化或部分抽取不能写入 Source；错误仍经转换器映射为无敏感细节的 422。若采用外置原生 helper 来恢复硬超时，需要 `scripts/build-sidecar.ts` 显式产出/复制相应资源，`src-tauri/tauri.conf.json` 增加资源，并让 `src-tauri/src/lib.rs` 启动时传明确资源目录，且在**打包后的桌面进程**而非仅源码 Bun 下实测。当前 `externalBin` 只有 sidecar，不会自动携带 npm optional native 包或首次下载的语言文件。这是从本机 POC 与现有配置得出的**工程推断，不是已验证实现**。

尚未验证：其他 Bun 版本对 `child.channel` 与编译 native binding 的行为；macOS x64、Linux、Windows 的 binding/PDFium 分发、路径和签名；离线且完全无语言数据时的具体错误路径；大于 20 MiB、加密或损坏真实世界 PDF 的性能/可靠性；以及 Tauri 安装包中的启动与 OCR。后续若决定替换，至少在各目标平台用**打包产物**对合成文本 PDF、扫描 PDF、缺失 OCR 数据、100 页拒绝、无效 PDF、超时和错误不泄密做端到端验收。

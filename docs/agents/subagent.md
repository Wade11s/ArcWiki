# Subagent 模型池

派发子代理时按**子任务难度**选模型池；池内模型互为候补，任选一个即可，不按顺序绑定。池外模型是备选，只有用户点名指定时才使用。`AGENTS.md` 的「Subagent 派发」负责判断难度和写清边界，本文件负责选模型。

## 选择规则

1. 先定难度：**complex / 较难**（跨层设计、安全边界、复杂故障，或需要独立审查）→ **standard / 中等**（单模块内有明确边界但要技术取舍）→ **simple / 简单**（范围局部、验收条件明确）。
2. 从该难度的池子里挑一个**当前可用**的模型；池内模型是等价候补，不要因为没有首选就停工。派发时显式传 `model`，它会覆盖 profile（`worker` / `scout` / `reviewer`）里配置的模型。
3. 池外模型只在用户点名时使用，不要自行把备选模型升格进池子。
4. 模型不可用时说明原因并确认替代选择，**不静默换模型**。

## 模型池

选择器格式为 `provider_id/model_id[effort=level]`，可直接作为 `spawn_subagent` 的 `model` 参数。

### complex / 较难

- `openai-subscribed/gpt-6.1-sol[effort=high]`
- `x_ai-subscribed/grok-4.7[effort=xhigh]`

### standard / 中等

- `openai-subscribed/gpt-6-luna[effort=xhigh]`
- `custom:fdf3dbb3d98afe7de78af2876965caea2a7fd7d09e92b601f48b8933e4823990/step-5-preview[effort=high]`
- `custom:1d8e1b382c6b9b6c0ae0c7ecdd05e589e399eb8a94b713c8fdefe9dea1fdb603/deepseek/deepseek-v4.1-flash[effort=max]`

### simple / 简单

- `custom:f3b33c2c4d73b9ec4147c5f8d9fb40558c84f33e653ba46e744afa8507e6c018/glm-5.3[effort=max]`
- `openai-subscribed/gpt-6-luna[effort=xhigh]`

## 备选模型

仅当用户点名指定时选择：

- `zed.dev/claude-sonnet-5-5[effort=high]`
- `openrouter/stealth/space-bunny-alpha[effort=max]`
- `custom:1d8e1b382c6b9b6c0ae0c7ecdd05e589e399eb8a94b713c8fdefe9dea1fdb603/stealth/space-bunny-alpha`（无可选档位）
- `custom:1d8e1b382c6b9b6c0ae0c7ecdd05e589e399eb8a94b713c8fdefe9dea1fdb603/xiaomi/mimo-v2.6-pro`（无可选档位）
- `custom:f5acde8ba5d28ed325557d2d0afc837363987e8e599c77d9e38c1d0d2548050d/k3[effort=max]`

## Provider 标识

`custom:` 前缀的 provider 是本机自定义兼容端点，标识符是机器本地哈希，不是稳定名称；只有显示名能对应到你在 Settings 里配置的东西。

| provider_id | 显示名 |
| --- | --- |
| `openai-subscribed` | ChatGPT Subscription |
| `x_ai-subscribed` | Grok |
| `openrouter` | OpenRouter |
| `zed.dev` | Zed |
| `custom:1d8e1b38…fdb603` | CommandCode |
| `custom:f3b33c2c…e6c018` | Zai |
| `custom:f5acde8b…548050d` | kimi |
| `custom:fdf3dbb3…823990` | stepfun |

## 校验

派发前如果不确定某个模型是否可用或某个 effort 档位是否存在，调用 `list_subagent_models` 核对：它返回的 `provider_id`、`model_id` 和 `supported_effort_levels` 是唯一事实来源，直接照抄选择器。

- 档位必须出现在该模型的 `supported_effort_levels` 里；空列表表示没有可选档位，省略 `[effort=…]`，不要猜一个默认值。
- 自定义 provider 被删除后重新添加会生成新的哈希，上表会因此失效；以 `list_subagent_models` 的输出为准并更新本文件。
- `list_subagent_models` 只列出**可派发**的子代理模型，不等于各厂商的完整目录；不要用它宣称某模型不存在于 Delta 的模型选择器中。

## 核对记录

2026-10-02 用 `list_subagent_models` 核对过本文件出现的每个选择器：

| 选择器 | 已确认档位 |
| --- | --- |
| `openai-subscribed/gpt-6.1-sol` | low、medium、**high**、xhigh、max |
| `openai-subscribed/gpt-6-luna` | low、medium、high、**xhigh**、max |
| `x_ai-subscribed/grok-4.7` | low、medium、high、**xhigh** |
| `custom:f3b33c2c…/glm-5.3` | high、**max** |
| `custom:fdf3dbb3…/step-5-preview` | low、medium、**high** |
| `custom:1d8e1b38…/deepseek/deepseek-v4.1-flash` | medium、high、xhigh、**max** |
| `custom:f5acde8b…/k3` | low、high、**max** |
| `zed.dev/claude-sonnet-5-5` | low、medium、**high**、xhigh、max |
| `openrouter/stealth/space-bunny-alpha` | low、medium、high、xhigh、**max** |

粗体是模型池里实际使用的档位。`gpt-6-sol` 不在可派发清单中（`openai-subscribed` 下列出的是 `gpt-6.1-sol`），派发会失败，因此不再出现在本文件。

`step-5-preview` 的 `[low, medium, high]` 是 2026-10-02 从 Settings 里该自定义 provider 的 `reasoning_efforts` 核对的；同日的 `list_subagent_models` 输出早于这次修改，当时它是空列表。

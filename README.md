# 深意图协作（Deep Intent Collaboration）

## 简介

这是一个**适用于任意支持 Skills 规范的 AI Agents**（如 [OpenCode](https://github.com/sst/opencode)、Claude Code 等）的 Skill，把「人机协作中的意图对齐」提炼为一套可操作的三阶段流程。

**核心命题：这套技能是为了增强人类，而非增强 AI。**

AI 在执行类协作中常见的失败模式——AI 自作主张跳过澄清、替用户在分叉点做决策、一次倒出过载的结果、在结束时跳过复盘——本质都是「替代人」而非「增强人」。本 Skill 的终极目标是让**人**在协作结束后变得更清醒：知道自己要什么、为什么这么选、关心什么、下次怎么做得更好。

Skill 不替你决策，而是引导协作走完三个阶段：

| 阶段 | 核心命题 | 关键动作 |
|------|---------|---------|
| 一·意图澄清 | 意图是**构造**出来的，不是提取出来的 | Purpose → Constraints → Success criteria → 本质需求锚点 → 逻辑自洽校验（五层递进） |
| 二·执行对齐 | 对齐不是一次性的，是持续的 | 快速对齐（常规推进，轻量反查）vs 分叉点校验（四信号触发，停下让人选） |
| 三·复盘沉淀 | 复盘检验的是「人有没有变清醒」 | 偏移回溯 → 选择回溯 → 考量系统化 → 情绪/状态回溯 → 经验提炼 |

**四类危险信号（见到立即拦截）：**

| 用户信号 | 危险类型 | 立即应对 |
|---|---|---|
| "直接给我"、"别问那么多" | 跳过意图澄清 | 反问 Purpose，不给代码/方案 |
| "X vs Y 哪个好" | 接受解法框架 | 回到需求层：什么项目、什么场景 |
| "你随便选"、"我相信你" | 分叉点替决策 | 停下标注分叉，让用户选并追问理由 |
| "行就这样吧"、"功能做完了" | 复盘逃避 | 主动发起复盘 |

## 安装

### 方式一：npx 安装（推荐）

```bash
# 国际源
npx skills add Being09/deep-intent-collaboration

# 国内源
npx skills-cn add Being09/deep-intent-collaboration
```

### 方式二：手动安装

```bash
# 1. 克隆仓库
git clone https://github.com/Being09/deep-intent-collaboration.git

# 2. 复制到对应 Agent 的 Skills 目录
#    OpenCode:  ~/.config/opencode/skills/
#    Claude Code: ~/.claude/skills/
```

---

## 使用方式

安装后通过**主动调用**激活——在 Agent 中输入：

```
/deep-intent-collaboration
```

或中文别名：

```
/深意图协作
```

**适用场景：**

- 你要 AI 帮你创造、设计、实现、或做决策（写功能、设计方案、重构、技术选型……）
- 你担心自己一开始对约束/成功标准还没想清楚，怕 AI 跑偏或过度产出
- 你希望协作结束后能留下可复用的经验

**不适用场景（直接对话即可，无需启动本 Skill）：**

- 事实查询（"Python GIL 是什么"）
- 低风险可逆操作（改名、加注释、修错字）
- 你已经想得非常清楚、只差执行的纯体力活

详见 [`SKILL.md`](./SKILL.md)。

## License

MIT

# 探索树追踪（Explore Tree Tracking）

> **定位：** deep-intent-collaboration 的会话级探索追踪机制。当复杂探索里的问题需要分治、认知负荷接近过载、或用户主动下钻时，把每个抛出的问题显式记录为 childs（同级）/ next（顺序）树，由配套 CLI 工具维护结构和状态。是「过载防御」与「分叉点校验」的持久化、可视化延伸。
>
> 形态 = 零依赖 Node.js CLI 工具（`scripts/explore-tree.js`）。凡装 Skills 的 Agent 都已具备 Node（`npx skills` 依赖），故零额外运行时成本。
>
> **时间尺度：** 会话级（与跨会话 `experience-log/` 分工——探索树管"当前这个大问题怎么一步步走完"，经验日志管"走完后留下什么"，两者是 `next` 关系非替代）。

## 顶层使命

**把复杂探索里的问题显式分治、持久记录路径，让人/AI 任意时刻知道：从哪来 / 走到哪 / 还剩什么。**

反查元依据：**"当前这个问题，用户和 AI 都能一眼看清自己在探索树的什么位置、还有多少没走完吗？"**

### 为什么需要它（对应主技能的两块痛点）

- **过载防御的盲区：** 主技能的过载防御是"对话态、即时"的——每次少交付一点。但当一个大问题本身要拆成十几层子问题，对话态防得住"单次倾倒"，防不住"路径在长对话里丢失"。用户做到一半会忘记"我现在在第几层、还剩什么分支没走"。探索树把路径**持久化**下来。
- **分叉点的追溯盲区：** 主技能的分叉点校验是"停下让用户选"。但选完之后，这次选择从哪个问题分叉出来、又引出了哪些子问题，对话一长就追溯不清。探索树把分叉的来龙去脉**记录下来**。

### 人机分工（三层，比主技能多一层）

主技能的人机分工是两层（AI 跑逻辑校验 / 人做阐释选择）。探索树引入**工具层**，把原来要花 AI token 做的"结构维护体力活"卸下来：

| 层 | 主语 | 职责 | 不可省的理由 |
|----|------|------|-------------|
| **语义层** | AI | 识别本轮抛出了哪些问题、判断它们是父子关系还是顺序关系、判断叶子问题解没解 | 需语言理解，AI 不可省；但这部分 token 成本低（只在停顿点做一次） |
| **结构层** | 工具 | 存树、维护 childs/next 边、按规则派生节点状态、定位 current、渲染 ASCII 图 | 确定性程序，不依赖 AI 聪明度——**这就是"磨平智能差距"的落点**：弱模型哪怕只做对语义判断，树的结构状态也永远正确 |
| **价值层** | 人 | 阐释矛盾、选调和方向、定夺分叉（与主技能一致） | 需价值判断，工具/AI 都不能替 |

**AI 的最小职责（全在语义层）：** 到自然停顿点 → `add` 本轮新问题（判父子/顺序）→ 用户答完 → `done`（记选项）/ `abandon`（记理由）。结构、状态、路径、可视化全由工具兜。

---

## 何时启用

**触发条件（满足任一即开始往树里记）：**

1. **分叉点出现**（命中主技能阶段二的四个分叉信号）——分叉出的问题作为子节点记入
2. **用户主动要求拆分**（"这个问题太大了，拆一下""分几步来做"）——拆出的子问题记入
3. **用户主动下钻**（"这个细节展开说说""这块具体怎么实现"）——下钻的问题作为子节点记入

**不启用（简单线性问答不碰树）：**

- 单层、单线的问答（问一个答一个，没有分治结构）
- 纯事实查询、单行编辑（主技能本就不启用，探索树更不启用）
- 任务一开始就清晰、不需要分治的

**惰性原则：** 首次 `add` 时才建树。简单对话全程不调工具，零成本。一旦建了树，每次抛出问题给用户时都应维护进去（见主技能横切表）。

### 频率：增量 + 自然停顿点结算

AI 正常回答用户时**不碰树**（不增加每轮负担）。只在**自然停顿点**一次性结算本轮新增：

- 交付一块内容后
- 用户确认/选择后
- 检测到分叉点、准备抛出选择时
- 用户主动要求下钻/拆分时

到停顿点，AI 调一次工具："这轮新增/变更了这些问题，关系如下，存进去。" 工具负责增量更新 + 重算所有受影响节点的状态。树是**按停顿点生长**的，不是每句话重建。

### 自治度：AI 全权维护，不需人 review

维护探索路径是**结构性工作**（判父子/顺序、聚合状态、渲染图），对"增强人"价值微乎其微。按主技能人机分工总纲，这属于程序性那类，**AI 包做**。不设 review 闸门（加人负担）。但保留修正口子（`abandon` / `focus` / `note`），用户若发现可低成本改。

---

## 数据模型

数据落点：`<cwd>/.deep-intent-collaboration/explore-tree/explore-tree-<会话id>-<标题>.json`（惰性创建，首次 `add` 时生成）。**每个会话一棵独立文件**（会话级），按会话命名，多/并发会话互不覆盖。文件名里的标题仅人类可读，**定位只靠 `--session`**——标题变了不影响定位。

```jsonc
{
  "version": 1,
  "created_at": "...",
  "updated_at": "...",
  "roots": ["n1"],              // 森林：可多根（一个会话可并行多个独立大问题）
  "focus": null,                // 可选：手动钉住的 current 覆盖（null = DFS 自动定位）
  "nodes": {
    "n1": {
      "id": "n1",
      "question": "做用户通知功能",   // 问题/决策点（一句话）
      "type": "意图",                 // 意图 | 发散 | 分叉 | 下钻（渲染不强制区分，数据层留语义）
      "options": [                    // 选项是字段，不是节点（防爆 N 叉树）
        {"label":"站内消息","notes":"..."},
        {"label":"短信","notes":"..."}
      ],
      "resolved_choice": null,        // 解决时记所选选项
      "status": "unsolved",           // 仅叶子权威；非叶子由工具派生覆盖
      "childs": ["n2","n3"],          // 同级子问题（无方向边）
      "next": null,                   // 顺序后继（有方向边）
      "parent": null,                 // 反查父（childs 关系的逆；便于祖先链/兄弟）
      "note": "",                     // AI 附的上下文/结论/放弃理由
      "created_at": "..."
    }
  }
}
```

**两条边：**
- `childs`（同级，无方向）：一个问题的分治子问题。DFS 遍历时按列表顺序逐个深入。
- `next`（顺序，有方向）：做完这个紧接着做那个。用于"先 A 再 B"的步骤链。

**粒度约定：**
- 选项（A/B/C）是节点的 `options` 字段，**不是独立节点**——否则树会爆炸成 N 叉树。
- 节点的 `type` 字段保留语义（意图澄清的提问 / 发散探索的维度 / 分叉点的选择 / 下钻的细节），但渲染时不强制区分。

---

## 状态派生规则（核心）

**唯一真实存储 = 叶子节点的终态（done→solved / abandon→abandoned）+ 边结构。** 其余全派生。这是"磨平智能差距"的关键：AI 永远不需要维护 current、不需要算父节点状态、不需要重算路径。

```
三态优先级：unsolved > solved > abandoned

节点有 childs 时（状态由子节点派生）：
  任一子节点 = unsolved                           → unsolved   （一票否决）
  全部子节点 ∈ {solved, abandoned} 且 ≥1 个 solved  → solved
  全部子节点 = abandoned                            → abandoned

节点无 childs（叶子）：取显式存储值
  done → solved； abandon → abandoned； 否则 unsolved

current = DFS 前序遍历（先 childs 后 next）中第一个 unsolved 的叶子
         （focus 非空时用 focus 覆盖）
```

**DFS 算法（严格定义）：**
```
dfs(node):
  访问 node
  for c in node.childs: dfs(c)
  if node.next: dfs(node.next)
```

**关于 current 只落在叶子：** 有 childs 的节点本身不是待办工作单元——它的解决是子节点解决的自动结果。只有 childs 为空的节点才是"用户/AI 真正要回答/解决的那一步"。

---

## CLI 命令规格

工具位置：`<skill-dir>/scripts/explore-tree.js`（零依赖单文件）。
调用：`node <skill-dir>/scripts/explore-tree.js <cmd> [args] --session <会话id> [--title "..."]`（skill-dir = SKILL.md 所在目录）。

**⚠ `--session <会话id>` 是除 `migrate`/`adopt` 外所有命令的必填参数**（会话 id 形如 `sess_xxx`，AI 从自身会话上下文取）。探索树会话级——每会话一棵文件（`explore-tree-<会话id>-<标题>.json`），不带 `--session` 会报错。`--title` 仅首次命名用（可省，自动从 ZCode 取/退化）；定位只靠 `--session`，标题变了不影响定位，后续调用零 `--title`。

### 迁移 / 维护类

```
init --session <id> [--title "..."]
                              建空探索树（一般无需手动；首次 add 自动建）

adopt --session <id> [--title "..."]
                              把旧 tree.json 迁到会话命名文件（幂等：已迁则跳过）
                              一次性迁移老数据用；标题省略时自动从 ZCode 取

migrate                       幂等迁移旧 .experience-log/ → .deep-intent-collaboration/experience-log/
                              （阶段零自动调用；只迁经验目录，不动探索树；重复跑不重复迁）

add <问题> [--type T] [--parent ID] [--after ID] [--options "A|B|C"] --session <id>
                              添加节点（树不存在则自动建，此时可带 --title 命名）
                              --parent ID   作为 ID 的子节点（childs 边，同级）
                              --after ID    顺序接在 ID 之后（next 边，顺序）
                              --type        意图|发散|分叉|下钻（默认"分叉"）
                              --options     选项列表，| 分隔
                              无 parent/after → 作为新根

done <id> [--choice "X"] --session <id>
                              标记叶节点已解决（可记所选选项）
                              自动重算受影响节点状态 + 推进 current
                              有子节点的节点不能直接 done（先解决子节点）

abandon <id> [--reason "..."] --session <id>
                              标记死路（含"压根不可行"和"试过不通"，均留痕降权）
                              非叶子 → 整子树标记 abandoned

note <id> <text> --session <id>
                              给节点附备注/结论/放弃理由（可多次追加）

update '<JSON>' | --file <path> --session <id>
                              批量差异化更新节点的数据字段
                              patch 形如 {"n3":{"question":"...","type":"意图"}, "n1":{"note":"..."}}
                              只改出现在 patch 里的字段，其余保留（差异化）
                              支持字段：question / type / resolved_choice / options / note
                              结构与状态字段不可改——用 add/link/done/abandon

link <idA> <idB> [--kind child|next] --session <id>
                              在两个已存在节点间补建边（增量结算时用）
```

**`update` 的设计取舍：** 改节点文本/类型/选项/备注是纯数据操作，但 `id/parent/childs/next/status` 一律拒绝——这些动了会破坏状态派生不变量。改状态用 `done/abandon`，改结构用 `add/link`，`update` 只管"这个节点说的是什么"。一份 JSON patch 一次改多个节点（如批量改名、回填 `resolved_choice`、补 `note`），比逐个 `note` 调用省往返。`options` 要求是数组（`[{label,notes}]`）；其余字段会被转成字符串。


### 查询类

```
show [current|all] --session <id>
   current（默认）：祖先定位条 + 当前节点 + 当前节点的子 + 兄弟；远的祖先折叠为 ⋯
   all：全树 DFS 完整展开（复盘 / 看全局时用）

status --session <id>         一行摘要：根数 / 节点数 / 各状态计数 + 当前问题

focus <id> | focus --clear --session <id>
                              手动钉住 / 清空 current
                              探索替代分支、想暂时跳离 DFS 自动顺序时用
                              focus 不改 DFS 逻辑顺序，只是覆盖当前显示焦点
```

### AI 的典型工作流

> 以下命令里的 `<sid>` = 当前会话 id（`sess_xxx`，AI 从自身会话上下文取）。每条都要带 `--session`；首次建树时可带 `--title`，之后省略。

```
[分叉点出现]
  → node explore-tree.js add "技术选型" --parent <当前问题id> --type 分叉 --options "Redis|RabbitMQ|原生队列" --session <sid>
  → 把选择抛给用户

[用户选完]
  → node explore-tree.js done <该节点id> --choice "Redis" --session <sid>
  → 工具自动重算 + 推进 current

[用户要求下钻某个细节]
  → node explore-tree.js add "Redis 集群方案" --parent <该节点id> --type 下钻 --session <sid>

[探索后发现某方案不可行]
  → node explore-tree.js abandon <节点id> --reason "服务商不支持" --session <sid>

[改名 / 批量回填备注 / 记录已选选项]
  → node explore-tree.js update '{"n3":{"question":"更准的问题"}, "n5":{"resolved_choice":"Redis","note":"选 Redis 因 X"}}' --session <sid>
  → 或 --file patch.json（内容大 / 含换行时）

[想看现在走到哪了]
  → node explore-tree.js status --session <sid>     （一行摘要）
  → node explore-tree.js show --session <sid>       （聚焦视图，折叠远的）

[复盘 / 看全局]
  → node explore-tree.js show all --session <sid>

[迁移旧 tree.json 到会话命名文件(一次性)]
  → node explore-tree.js adopt --session <sid> [--title "..."]
```

---

## ASCII 渲染规则

**四态符号：**
- `✓` solved（已解决）
- `✗` abandoned（已放弃，留痕，视觉降权）
- `●` unsolved + current（你在这）
- `○` unsolved + 非 current（还没轮到）

**边：**
- `├─` / `└─` childs（无方向树形）
- `──▶` next（有方向顺序）

### show current 示例（聚焦视图，远的折叠）

```
探索树 · [✓3 ✗1 ●1 ○4]

○ n1: 做用户通知功能
    ⋯ (1 层祖先折叠)
        ○ n3: 技术选型
            ● n4: 队列方案  ← 你在这
            ○ n5: 模板引擎

兄弟节点 1 个:
  ✗ 已放弃 1 个
顺序后继(next):──▶ n7: 实现细节
```

### show all 示例（全树，复盘用）

```
探索树 · [✓3 ✗1 ●1 ○4]

○ n1: 做用户通知功能
├─ ✓ n2: 需求边界
│   ├─ ✓ n5: 渠道确认 [选:站内消息]
│   └─ ✗ n6: 短信通道  — 放弃理由:服务商不支持
├─ ● n3: 技术选型  ← 你在这
│   ├─ ○ n4: 队列方案
│   └─ ○ n5: 模板引擎
└──▶ n7: 实现细节
```

---

## 与主技能的协作关系

| 主技能环节 | 本模块对接点 |
|-----------|-------------|
| **阶段一·意图澄清** | 意图澄清的每一层提问（意图→约束→成功标准→锚点）都可记为 `type=意图` 节点；用户每次回答对应 `done`（记所选）。让"意图是怎么一步步构造出来的"可回溯 |
| **阶段二·分叉点校验** | 每个分叉点（四个信号之一命中）→ `add` 一个 `type=分叉` 节点；用户选择后 `done --choice`。分叉的来龙去脉持久化，不再依赖对话记忆 |
| **阶段二·过载防御** | 探索树本身是过载防御的持久化延伸——`show current` 折叠远的，只展开关注域，避免"树自己变成过载源"。深度边界对齐阶段一约定 |
| **阶段 1.5·发散探索** | 发散的每个探索维度可记为 `type=发散` 节点；双向搜索的状态快照（已确认/待解）可挂为 `note` |
| **阶段三·复盘沉淀** | `abandoned` 分支是经验沉淀的好素材（"试过此路不通"恰是可迁移经验）；会话树可选归档进 `experience-log/`（跨会话级），作为探索树（会话级）的 `next` |
| **阶段零·跨会话连续性** | 阶段零启动时先跑 `migrate`（幂等迁移旧 `.experience-log/`），再加载经验摘要 |

**与其他 reference 的协作：** 分叉点的校验手段 → `audit-framework.md`；决策透明化标注（来源/确信度）可挂为节点 `note` → `decision-transparency.md`；发散探索的维度作为节点 → `divergent-exploration.md`。

**独立使用时：** 若未被主技能引用，本工具可直接由任何 Agent 调用——但建议先有一个明确的"要探索的根问题"，再开始 `add`，相当于自带一个迷你版的意图锚定。

---

## 已知简化（v1，"先够用"）

- `next` 跨树/跨 parent 的复杂 DAG 场景未专门处理（常见线性链场景已覆盖）。
- 会话文件不自动归档进 `experience-log/`（会话级，默认随会话结束留存于 `explore-tree/` 目录但不主动沉淀）；需跨会话保留时，阶段三手动把关键路径 `show all` 的输出归档进经验条目。多会话文件各自独立、不互相覆盖。
- `current` 默认 DFS 自动定位；`focus` 提供手动覆盖，用于探索替代分支、暂时跳离自动顺序。
- **会话定位依赖调用方传 `--session`**——子进程无法可靠自动检测当前会话（无 env var、无 current 指针），故会话 id 必须由 AI 显式传入；`--title` 省略时尽力从 ZCode SQLite 取标题，取不到则退化为无标题文件名（`explore-tree-<id>.json`），不阻塞。

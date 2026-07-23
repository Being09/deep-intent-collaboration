#!/usr/bin/env node
'use strict';

// explore-tree.js — 会话级探索追踪工具(零依赖)
//
// 给「深度意图协作」配套的探索树 CLI。把复杂探索里抛出的每个问题显式
// 分治、持久记录为 childs(同级,无方向)/ next(顺序,有方向)树。
//
// 设计核心:状态全部派生。
//   - 唯一真实存储 = 叶子节点的终态(done→solved / abandon→abandoned)+ 边结构
//   - 非叶节点状态、current 指针,全部由工具按规则实时派生,不由 AI 维护
//   - AI 只负责语义判断:识别问题、判父子/顺序、判叶子解没解。结构体力活全由工具兜
//
// 用法:node explore-tree.js <cmd> [args]
//   数据落点:<cwd>/.deep-intent-collaboration/explore-tree/tree.json

const fs = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────
// 路径与持久化
// ────────────────────────────────────────────────────────────────

const CWD = process.cwd();
const TOP_DIR = path.join(CWD, '.deep-intent-collaboration');
const EXPLORE_DIR = path.join(TOP_DIR, 'explore-tree');
const TREE_FILE = path.join(EXPLORE_DIR, 'tree.json');

const EXPERIENCE_DIR = path.join(TOP_DIR, 'experience-log');
const LEGACY_EXPERIENCE_DIR = path.join(CWD, '.experience-log');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function treeExists() {
  return fs.existsSync(TREE_FILE);
}

function loadTree() {
  if (!treeExists()) return null;
  try {
    return JSON.parse(fs.readFileSync(TREE_FILE, 'utf8'));
  } catch (e) {
    fail(`探索树文件损坏,无法解析:${TREE_FILE}\n${e.message}`);
  }
}

function saveTree(tree) {
  ensureDir(EXPLORE_DIR);
  tree.updated_at = nowISO();
  fs.writeFileSync(TREE_FILE, JSON.stringify(tree, null, 2), 'utf8');
}

function newTree() {
  return {
    version: 1,
    created_at: nowISO(),
    updated_at: nowISO(),
    roots: [],
    focus: null,
    nodes: {},
  };
}

// ────────────────────────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────────────────────────

function nowISO() {
  return new Date().toISOString();
}

function genId(tree) {
  // n1, n2, ... 全局递增,不复用
  let max = 0;
  for (const id of Object.keys(tree.nodes)) {
    const n = Number(id.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return 'n' + (max + 1);
}

function fail(msg) {
  process.stderr.write('错误:' + msg + '\n');
  process.exit(1);
}

function out(msg) {
  process.stdout.write(msg + '\n');
}

function getNode(tree, id) {
  const n = tree.nodes[id];
  if (!n) fail(`节点不存在:${id}`);
  return n;
}

function isValidStatus(s) {
  return s === 'unsolved' || s === 'solved' || s === 'abandoned';
}

// ────────────────────────────────────────────────────────────────
// 核心派生:节点状态(三态聚合)
// ────────────────────────────────────────────────────────────────
// 优先级:unsolved > solved > abandoned
//   有 childs 时(派生):
//     任一子 = unsolved                            → unsolved (一票否决)
//     全 ∈{solved,abandoned} 且 ≥1 solved          → solved
//     全 = abandoned                                → abandoned
//   无 childs(叶子):取显式存储值
// ────────────────────────────────────────────────────────────────

function deriveStatus(tree, node) {
  if (node.childs && node.childs.length > 0) {
    const childStatuses = node.childs.map((cid) => effectiveStatus(tree, cid));
    const hasUnsolved = childStatuses.some((s) => s === 'unsolved');
    const hasSolved = childStatuses.some((s) => s === 'solved');
    if (hasUnsolved) return 'unsolved';
    if (hasSolved) return 'solved'; // 此时无 unsolved
    return 'abandoned'; // 全 abandoned
  }
  // 叶子:取显式存储值(默认 unsolved)
  const s = node.status || 'unsolved';
  return isValidStatus(s) ? s : 'unsolved';
}

// effectiveStatus 缓存防重复算(单次派生调用内有效)
function effectiveStatus(tree, id) {
  return deriveStatus(tree, getNode(tree, id));
}

// ────────────────────────────────────────────────────────────────
// 核心派生:DFS 前序遍历
// ────────────────────────────────────────────────────────────────
// dfs(node): 访问 node; for c in node.childs: dfs(c); if node.next: dfs(next)
// current = 前序里第一个状态 = unsolved 的节点(focus 非空时用 focus 覆盖)
// ────────────────────────────────────────────────────────────────

function dfsPreorder(tree) {
  const order = [];
  const visited = new Set();

  function visit(id) {
    if (!id || visited.has(id)) return;
    visited.add(id);
    const node = tree.nodes[id];
    if (!node) return;
    order.push(id);
    if (node.childs) {
      for (const c of node.childs) visit(c);
    }
    if (node.next) visit(node.next);
  }

  for (const r of tree.roots) visit(r);
  return order;
}

function deriveCurrent(tree) {
  // focus 覆盖:手动钉住的 current(focus 节点本身允许有 childs,即"我想钉在这层")
  if (tree.focus && tree.nodes[tree.focus]) {
    if (effectiveStatus(tree, tree.focus) !== 'abandoned') {
      return tree.focus;
    }
  }
  // current = DFS 前序中第一个"真正待办"的节点。
  // 有 childs 的节点本身不是待办工作单元(它的解决是子节点解决的自动结果,
  // 见 DFS 算法定义:"childs 为空时才取决于当前节点是否解决")。
  // 故只取 unsolved 且 childs 为空的节点。
  const order = dfsPreorder(tree);
  for (const id of order) {
    const node = tree.nodes[id];
    const hasChilds = node.childs && node.childs.length > 0;
    if (!hasChilds && effectiveStatus(tree, id) === 'unsolved') return id;
  }
  // 退化情况:所有叶子都结清了,但存在非叶子的 unsolved(理论上不会发生,
  // 因为非叶 unsolved 必有 unsolved 子;此处兜底返回 null)
  return null;
}

// ────────────────────────────────────────────────────────────────
// 边维护: childs / next
// ────────────────────────────────────────────────────────────────

function addChild(tree, parentId, childId) {
  const parent = getNode(tree, parentId);
  const child = getNode(tree, childId);
  if (child.parent && child.parent !== parentId) {
    fail(`节点 ${childId} 已有父节点 ${child.parent},不能加到 ${parentId} 下`);
  }
  if (!parent.childs) parent.childs = [];
  if (parent.childs.includes(childId)) return; // 幂等
  parent.childs.push(childId);
  child.parent = parentId;
}

function setNext(tree, fromId, toId) {
  const from = getNode(tree, fromId);
  const to = getNode(tree, toId);
  if (to.parent) {
    fail(`节点 ${toId} 已有父节点 ${to.parent},next 仅用于无父节点的顺序接续`);
  }
  from.next = toId;
}

// ────────────────────────────────────────────────────────────────
// 命令实现
// ────────────────────────────────────────────────────────────────

function cmdInit() {
  ensureMigration(); // 顺便幂等迁移
  if (treeExists()) {
    out('探索树已存在:' + TREE_FILE);
    return;
  }
  const tree = newTree();
  saveTree(tree);
  out('已创建空探索树:' + TREE_FILE);
}

function cmdMigrate() {
  const result = ensureMigration(true);
  out(result.message);
}

// 幂等迁移:.experience-log/ → .deep-intent-collaboration/experience-log/
// 返回 { migrated: bool, message }
function ensureMigration(verbose) {
  ensureDir(TOP_DIR);

  // target 已存在且非空 → 跳过
  if (fs.existsSync(EXPERIENCE_DIR)) {
    let nonEmpty = false;
    try {
      nonEmpty = fs.readdirSync(EXPERIENCE_DIR).length > 0;
    } catch (e) {
      /* 忽略,当作空 */
    }
    if (nonEmpty) {
      return {
        migrated: false,
        message: '经验目录已就位(已迁移过),跳过。',
      };
    }
  }

  // legacy 存在 → 迁入
  if (fs.existsSync(LEGACY_EXPERIENCE_DIR)) {
    ensureDir(EXPERIENCE_DIR);
    const entries = fs.readdirSync(LEGACY_EXPERIENCE_DIR);
    for (const name of entries) {
      const from = path.join(LEGACY_EXPERIENCE_DIR, name);
      const to = path.join(EXPERIENCE_DIR, name);
      fs.renameSync(from, to);
    }
    // 迁完尝试删空目录(非必需,失败无所谓)
    try {
      fs.rmdirSync(LEGACY_EXPERIENCE_DIR);
    } catch (e) {
      /* 留着无害 */
    }
    return {
      migrated: true,
      message: `已迁移 ${entries.length} 个经验条目: .experience-log/ → .deep-intent-collaboration/experience-log/`,
    };
  }

  return {
    migrated: false,
    message: '无旧经验目录,无需迁移。',
  };
}

function cmdAdd(args, flags) {
  ensureMigration();
  const tree = treeExists() ? loadTree() : newTree();
  if (args.length === 0) fail('用法:add <问题> [--type T] [--parent ID] [--after ID] [--options "A|B|C"]');

  const question = args.join(' ').trim();
  if (!question) fail('问题不能为空');

  const id = genId(tree);
  const node = {
    id,
    question,
    type: flags.type || '分叉',
    options: [],
    resolved_choice: null,
    status: 'unsolved',
    childs: [],
    next: null,
    parent: null,
    note: '',
    created_at: nowISO(),
  };

  if (flags.options) {
    node.options = String(flags.options)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label, notes: '' }));
  }

  tree.nodes[id] = node;

  if (flags.parent) {
    addChild(tree, flags.parent, id);
  } else if (flags.after) {
    setNext(tree, flags.after, id);
  } else {
    tree.roots.push(id);
  }

  saveTree(tree);
  out(`已添加节点 ${id}: ${question}` + (flags.parent ? ` (父: ${flags.parent})` : flags.after ? ` (顺序接: ${flags.after})` : ' (根)'));
}

function cmdDone(args, flags) {
  const tree = loadTree();
  if (!tree) fail('探索树不存在,先 add 创建');
  if (args.length === 0) fail('用法:done <id> [--choice "X"]');
  const id = args[0];
  const node = getNode(tree, id);

  if (node.childs && node.childs.length > 0) {
    fail(`节点 ${id} 有子节点,不能直接标记 done。请先解决子节点(或 abandon)`);
  }

  node.status = 'solved';
  if (flags.choice) node.resolved_choice = flags.choice;

  saveTree(tree);
  out(`✓ ${id}: ${node.question} → solved` + (flags.choice ? ` (选: ${flags.choice})` : ''));
}

function cmdAbandon(args, flags) {
  const tree = loadTree();
  if (!tree) fail('探索树不存在,先 add 创建');
  if (args.length === 0) fail('用法:abandon <id> [--reason "..."]');
  const id = args[0];
  const node = getNode(tree, id);
  const reason = flags.reason || '';

  // 整子树标记 abandoned(递归到叶子)
  function markAbandoned(nid) {
    const n = tree.nodes[nid];
    if (!n) return;
    if (n.childs && n.childs.length > 0) {
      for (const c of n.childs) markAbandoned(c);
    } else {
      n.status = 'abandoned';
      if (reason && !n.note) n.note = '放弃理由:' + reason;
    }
  }
  markAbandoned(id);

  // 若节点本身是叶子,上面已标;若非叶子但希望节点本身也留 reason note:
  if (reason && !node.note) node.note = '放弃理由:' + reason;

  // 若 abandon 的恰好是 focus,清掉 focus 让 DFS 重算
  if (tree.focus === id) tree.focus = null;

  saveTree(tree);
  out(`✗ ${id}: ${node.question} → abandoned` + (reason ? ` (${reason})` : ''));
}

function cmdNote(args, flags) {
  const tree = loadTree();
  if (!tree) fail('探索树不存在,先 add 创建');
  if (args.length < 2) fail('用法:note <id> <text>');
  const id = args[0];
  const text = args.slice(1).join(' ').trim();
  if (!text) fail('备注内容不能为空');
  const node = getNode(tree, id);
  node.note = node.note ? node.note + '\n' + text : text;
  saveTree(tree);
  out(`已给 ${id} 添加备注`);
}

function cmdLink(args, flags) {
  const tree = loadTree();
  if (!tree) fail('探索树不存在,先 add 创建');
  if (args.length < 2) fail('用法:link <idA> <idB> [--kind child|next]');
  const a = args[0];
  const b = args[1];
  const kind = flags.kind || 'child';
  getNode(tree, a);
  getNode(tree, b);
  if (kind === 'child') {
    addChild(tree, a, b);
  } else if (kind === 'next') {
    setNext(tree, a, b);
  } else {
    fail('--kind 只能是 child 或 next');
  }
  saveTree(tree);
  out(`已建立 ${kind} 边:${a} → ${b}`);
}

function cmdFocus(args, flags) {
  const tree = loadTree();
  if (!tree) fail('探索树不存在,先 add 创建');
  if (flags.clear) {
    tree.focus = null;
    saveTree(tree);
    out('已清空手动 focus,恢复 DFS 自动定位 current');
    return;
  }
  if (args.length === 0) fail('用法:focus <id> | focus --clear');
  const id = args[0];
  getNode(tree, id); // 校验存在
  tree.focus = id;
  saveTree(tree);
  out(`已手动钉住 current = ${id}(DFS 自动定位将被覆盖,用 focus --clear 恢复)`);
}

function cmdStatus() {
  const tree = loadTree();
  if (!tree) {
    out('探索树尚未创建');
    return;
  }
  const order = dfsPreorder(tree);
  let solved = 0,
    abandoned = 0,
    unsolved = 0;
  for (const id of order) {
    const s = effectiveStatus(tree, id);
    if (s === 'solved') solved++;
    else if (s === 'abandoned') abandoned++;
    else unsolved++;
  }
  const current = deriveCurrent(tree);
  const rootCount = tree.roots.length;
  const curStr = current
    ? `当前: ${current} · ${tree.nodes[current].question}`
    : '当前: 全部结清(无 unsolved 节点)';
  out(
    `探索树 · 根 ${rootCount} · 节点 ${order.length} · [✓${solved} ✗${abandoned} ○${unsolved}]`
  );
  out(curStr);
}

// ────────────────────────────────────────────────────────────────
// 渲染
// ────────────────────────────────────────────────────────────────
// 四态符号:✓solved · ✗abandoned(降权) · ●unsolved+current · ○unsolved+非current
// 边:├─ / └─ childs(无方向树形) · ──▶ next(有方向顺序)
// ────────────────────────────────────────────────────────────────

function statusSymbol(tree, id, currentId) {
  const s = effectiveStatus(tree, id);
  if (s === 'solved') return '✓';
  if (s === 'abandoned') return '✗';
  if (id === currentId) return '●';
  return '○';
}

function shorten(s, n) {
  s = String(s);
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function renderNodeLine(symbol, id, node, isCurrent) {
  const noteSuffix = node.note ? `  — ${shorten(node.note, 40)}` : '';
  const choiceSuffix = node.resolved_choice ? ` [选:${shorten(node.resolved_choice, 20)}]` : '';
  const curTag = isCurrent ? '  ← 你在这' : '';
  return `${symbol} ${id}: ${node.question}${choiceSuffix}${noteSuffix}${curTag}`;
}

// show all:全树 DFS,完整展开
function renderAll(tree) {
  const currentId = deriveCurrent(tree);
  const lines = [];
  const stats = countStats(tree);

  if (tree.roots.length === 0) {
    out('探索树为空(尚无根节点)');
    return;
  }

  const roots = tree.roots.map((r) => tree.nodes[r]).filter(Boolean);
  out(`探索树 · [✓${stats.solved} ✗${stats.abandoned} ●${stats.currentCount} ○${stats.unsolvedOther}]`);
  out('');

  for (let i = 0; i < tree.roots.length; i++) {
    renderSubtree(tree, tree.roots[i], '', true, currentId, lines);
    if (i < tree.roots.length - 1) lines.push('');
  }
  out(lines.join('\n'));
}

// 递归渲染一棵子树
// prefix: 当前缩进(如 '│   ' 或 '    ')
// isLast: 当前节点是否是父的最后一个 child(画 └─ 还是 ├─)
function renderSubtree(tree, id, prefix, isLast, currentId, lines, isNextEdge) {
  const node = tree.nodes[id];
  if (!node) return;

  const branch = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';
  const edgeMark = isNextEdge ? '──▶ ' : '';
  const symbol = statusSymbol(tree, id, currentId);
  const line =
    prefix + branch + edgeMark + renderNodeLine(symbol, id, node, id === currentId);
  lines.push(line);

  // 子节点(childs)
  const childPrefix = prefix === '' ? '' : isLast ? '    ' : '│   ';
  const childs = node.childs || [];
  for (let i = 0; i < childs.length; i++) {
    renderSubtree(tree, childs[i], childPrefix, i === childs.length - 1, currentId, lines, false);
  }
  // next 边(顺序后继)
  if (node.next) {
    renderSubtree(tree, node.next, childPrefix, childs.length === 0, currentId, lines, true);
  }
}

function countStats(tree) {
  const order = dfsPreorder(tree);
  const currentId = deriveCurrent(tree);
  let solved = 0,
    abandoned = 0,
    currentCount = 0,
    unsolvedOther = 0;
  for (const id of order) {
    const s = effectiveStatus(tree, id);
    if (s === 'solved') solved++;
    else if (s === 'abandoned') abandoned++;
    else {
      if (id === currentId) currentCount++;
      else unsolvedOther++;
    }
  }
  return { solved, abandoned, currentCount, unsolvedOther };
}

// show current:祖先定位条 + 当前节点(含子展开)+ 兄弟 + next;远的祖先折叠
// 渲染策略:
//   - 根节点:总是显示(给"我从哪来"的锚)
//   - 直接父:总是显示(给"为什么走到当前"的上下文)
//   - 根与直接父之间的中间层:折叠为 ⋯
//   - 当前节点:高亮,若有子则展开一层
//   - 兄弟节点:折叠(未结清的列出,结清的计数)
function renderCurrent(tree) {
  const currentId = deriveCurrent(tree);
  const stats = countStats(tree);

  out(`探索树 · [✓${stats.solved} ✗${stats.abandoned} ●${stats.currentCount} ○${stats.unsolvedOther}]`);
  out('');

  if (!currentId) {
    out('全部结清(无 unsolved 节点)。用 show all 看完整树。');
    return;
  }

  // 祖先链:从根到当前(含当前)
  const ancestorChain = [];
  let walker = currentId;
  while (walker) {
    ancestorChain.unshift(walker);
    walker = tree.nodes[walker] ? tree.nodes[walker].parent : null;
  }

  const lines = [];
  const cur = tree.nodes[currentId];
  const parentId = cur.parent;
  // 关键可见节点:根、中间折叠、直接父、当前
  const rootId = ancestorChain[0];
  const directParent = parentId; // 可能 null(当前就是根)

  // —— 1. 渲染祖先链(根 → ⋯ → 直接父)——
  // 祖先链上每层只有一个"指向 current 的子",所以用空格缩进表达垂直深度,
  // 不用树形分支符(├─/└─ 是给"同级多个子"用的,这里每层单子)。
  // 折叠:根与直接父之间的中间层合并成一行 ⋯。
  //
  // 可见祖先 = {根} + {直接父(若非根)} ;其余中间层折叠
  const ancestorsAboveCurrent = ancestorChain.slice(0, -1); // 去掉 current
  let currentRenderIndent = ''; // 当前节点的缩进基准

  if (ancestorsAboveCurrent.length > 0) {
    // 渲染根(第 0 层,无缩进)
    const root = tree.nodes[rootId];
    lines.push(renderNodeLine(statusSymbol(tree, rootId, currentId), rootId, root, false));
    currentRenderIndent = '    '; // 根的子层缩进

    // 中间层:根之后、直接父之前(不含直接父)
    const hasDirectParent = directParent && directParent !== rootId;
    const midEnd = hasDirectParent ? -1 : undefined; // 有直接父则中间层到倒数第二;无则到末尾
    const mid = ancestorsAboveCurrent.slice(1, midEnd);

    if (mid.length > 0) {
      lines.push(`${currentRenderIndent}⋯ (${mid.length} 层祖先折叠)`);
      if (hasDirectParent) {
        currentRenderIndent += '    '; // 折叠行下再深一层才是直接父
      }
    }

    // 渲染直接父(若存在且非根)
    if (hasDirectParent) {
      const pn = tree.nodes[directParent];
      lines.push(currentRenderIndent + renderNodeLine(statusSymbol(tree, directParent, currentId), directParent, pn, false));
      currentRenderIndent += '    '; // 直接父的子层(current 所在层)缩进
    }
  }

  // —— 2. 渲染当前节点(高亮 ●) ——
  lines.push(currentRenderIndent + renderNodeLine(statusSymbol(tree, currentId, currentId), currentId, cur, true));

  // 当前节点的子节点展开一层
  const childIndent = currentRenderIndent + '    ';
  const childs = cur.childs || [];
  for (let i = 0; i < childs.length; i++) {
    const cid = childs[i];
    const cnode = tree.nodes[cid];
    const csymbol = statusSymbol(tree, cid, currentId);
    const branch = i === childs.length - 1 ? '└─ ' : '├─ ';
    lines.push(childIndent + branch + renderNodeLine(csymbol, cid, cnode, false));
  }
  // 标注更深的折叠结构
  if (childs.length > 0) {
    const deeper = childs.filter((cid) => {
      const cn = tree.nodes[cid];
      return cn && cn.childs && cn.childs.length > 0;
    }).length;
    if (deeper > 0) {
      lines.push(childIndent + `⋯ (${deeper} 个子节点有更深结构,用 show all 展开)`);
    }
  }

  // —— 3. 兄弟节点(当前在同一父下的同级) ——
  if (parentId) {
    const parent = tree.nodes[parentId];
    const siblings = (parent.childs || []).filter((s) => s !== currentId);
    if (siblings.length > 0) {
      lines.push('');
      lines.push(`兄弟节点 ${siblings.length} 个:`);
      const openSibs = siblings.filter((s) => effectiveStatus(tree, s) === 'unsolved');
      const doneSibs = siblings.filter((s) => effectiveStatus(tree, s) === 'solved');
      const abandSibs = siblings.filter((s) => effectiveStatus(tree, s) === 'abandoned');
      for (const s of openSibs) {
        const sn = tree.nodes[s];
        lines.push('  ○ ' + s + ': ' + shorten(sn.question, 50));
      }
      if (doneSibs.length > 0) {
        lines.push(`  ✓ 已解决 ${doneSibs.length} 个`);
      }
      if (abandSibs.length > 0) {
        lines.push(`  ✗ 已放弃 ${abandSibs.length} 个`);
      }
    }
  }

  // —— 4. next 后继(顺序接续) ——
  if (cur.next) {
    const nextNode = tree.nodes[cur.next];
    lines.push('');
    lines.push(`顺序后继(next):──▶ ${cur.next}: ${shorten(nextNode.question, 50)}`);
  }

  out(lines.join('\n'));
}

function cmdShow(args, flags) {
  const tree = loadTree();
  if (!tree) {
    out('探索树尚未创建');
    return;
  }
  const mode = args[0] || 'current';
  if (mode === 'all') {
    renderAll(tree);
  } else if (mode === 'current') {
    renderCurrent(tree);
  } else {
    fail('show 的参数只能是 current 或 all');
  }
}

// ────────────────────────────────────────────────────────────────
// 命令行解析与路由
// ────────────────────────────────────────────────────────────────

// 把 argv 拆成 [位置参数...] 和 { flag: value }
// 支持两种形式:--flag value 和 --flag=value
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        // 下一个是值还是又一个 flag?
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          flags[name] = true; // 布尔 flag(如 --clear)
        } else {
          flags[name] = next;
          i++;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function usage() {
  out(`
探索树(explore-tree)— 会话级探索追踪工具

用法:node explore-tree.js <cmd> [args]

命令:
  init                          建空探索树(首次 add 会自动创建)
  migrate                       幂等迁移旧 .experience-log/ → .deep-intent-collaboration/experience-log/

  add <问题> [--type T] [--parent ID] [--after ID] [--options "A|B|C"]
                                添加节点
                                --parent ID  作为 ID 的子节点(childs 边,同级)
                                --after ID   顺序接在 ID 之后(next 边,顺序)
                                无 parent/after → 作为新根
  done <id> [--choice "X"]      标记叶节点已解决(自动重算状态 + 推进 current)
  abandon <id> [--reason "..."] 标记死路(留痕;非叶子则整子树标记)
  note <id> <text>              给节点附备注/结论/放弃理由
  link <idA> <idB> [--kind child|next]
                                在两已存在节点间补建边

  show [current|all]            渲染树
                                current(默认):祖先链 + 当前 + 子 + 兄弟,其余折叠
                                all:全树展开(复盘/看全局)
  status                        一行摘要:节点统计 + 当前问题
  focus <id> | focus --clear    手动钉住/清空 current(探索替代分支时用)

状态派生规则(三态,unsolved > solved > abandoned):
  叶子:取显式存储值(done→solved / abandon→abandoned / 否则 unsolved)
  非叶子:任一子 unsolved→unsolved;全{sol,abd}且≥1 sol→solved;全 abd→abandoned
  current = DFS 前序(先 childs 后 next)中第一个 unsolved 的节点(focus 可覆盖)
`.trim());
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    usage();
    return;
  }
  const cmd = argv[0];
  const rest = argv.slice(1);
  const { positional, flags } = parseArgs(rest);

  switch (cmd) {
    case 'init':
      cmdInit();
      break;
    case 'migrate':
      cmdMigrate();
      break;
    case 'add':
      cmdAdd(positional, flags);
      break;
    case 'done':
      cmdDone(positional, flags);
      break;
    case 'abandon':
      cmdAbandon(positional, flags);
      break;
    case 'note':
      cmdNote(positional, flags);
      break;
    case 'link':
      cmdLink(positional, flags);
      break;
    case 'focus':
      cmdFocus(positional, flags);
      break;
    case 'status':
      cmdStatus();
      break;
    case 'show':
      cmdShow(positional, flags);
      break;
    case 'help':
    case '--help':
    case '-h':
      usage();
      break;
    default:
      fail(`未知命令:${cmd}\n运行 node explore-tree.js help 查看用法`);
  }
}

main();

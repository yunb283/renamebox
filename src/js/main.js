import { ripple, placePill, popOnce, prefersReduced } from './ui-motion.js';
import { computeNewName, passesFilter, splitName } from './rename-engine.js';

const isTauri = typeof window.__TAURI__ !== 'undefined';
const invoke = isTauri ? window.__TAURI__.core.invoke : null;
const currentWindow = isTauri ? window.__TAURI__.window.getCurrentWindow() : null;

// ---------- 标题栏 ----------

const pinBtn = document.getElementById('pin-top');
const pinLine = pinBtn.querySelector('.ic-pin-line');
const pinSolid = pinBtn.querySelector('.ic-pin-solid');
const winMin = document.getElementById('win-min');
const winMax = document.getElementById('win-max');
const winClose = document.getElementById('win-close');
const maxIcon = winMax.querySelector('.ic-max');
const restoreIcon = winMax.querySelector('.ic-restore');

if (!currentWindow) {
  for (const b of [pinBtn, winMin, winMax, winClose]) b.disabled = true;
} else {
  pinBtn.addEventListener('click', (ev) => {
    const on = !pinBtn.classList.contains('on');
    pinBtn.classList.toggle('on', on);
    pinBtn.setAttribute('aria-pressed', String(on));
    pinBtn.dataset.tip = on ? '取消置顶' : '窗口置顶';
    pinLine.toggleAttribute('hidden', on);
    pinSolid.toggleAttribute('hidden', !on);
    popOnce(pinBtn.querySelector('.pin-ic'), 'pop');
    ripple(pinBtn, ev);
    currentWindow.setAlwaysOnTop(on);
  });
  winMin.addEventListener('click', () => currentWindow.minimize());
  winMax.addEventListener('click', () => currentWindow.toggleMaximize());
  winClose.addEventListener('click', () => currentWindow.close());

  const syncMaxIcon = async () => {
    const maximized = await currentWindow.isMaximized();
    maxIcon.toggleAttribute('hidden', maximized);
    restoreIcon.toggleAttribute('hidden', !maximized);
    winMax.setAttribute('aria-label', maximized ? '还原' : '最大化');
    winMax.title = maximized ? '还原' : '最大化';
  };
  syncMaxIcon();
  currentWindow.onResized(() => syncMaxIcon());
}

// ---------- 主题 ----------

const themeBtn = document.getElementById('theme-toggle');
const icMoon = themeBtn.querySelector('.ic-moon');
const icSun = themeBtn.querySelector('.ic-sun');

function swapThemeIcon(light) {
  // SVG 上的 .hidden IDL 属性在 WebView2 里不可靠，必须直接切 content attribute
  icMoon.toggleAttribute('hidden', light);
  icSun.toggleAttribute('hidden', !light);
}

function applyTheme(theme, syncIcon = true) {
  const light = theme === 'light';
  document.documentElement.classList.toggle('light', light);
  themeBtn.title = light ? '当前浅色，点击切换深色' : '当前深色，点击切换浅色';
  if (currentWindow) currentWindow.setTheme(light ? 'light' : 'dark').catch(() => {});
  if (syncIcon) swapThemeIcon(light);
}

applyTheme(localStorage.getItem('theme') === 'light' ? 'light' : 'dark');

let themeIconTimer = 0;
themeBtn.addEventListener('click', (ev) => {
  const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  popOnce(themeBtn, 'spin');
  ripple(themeBtn, ev);
  applyTheme(next, prefersReduced());
  if (!prefersReduced()) {
    clearTimeout(themeIconTimer);
    themeIconTimer = setTimeout(() => swapThemeIcon(next === 'light'), 300);
  }
});

// ---------- 页签 ----------

const tabsRow = document.querySelector('.tabs');
const tabInd = document.getElementById('tab-ind');
const tabHover = document.getElementById('tab-hover');
const tabs = [...tabsRow.querySelectorAll('.tab')];
const groups = new Map(
  [...document.querySelectorAll('.group')].map((g) => [g.dataset.group, g])
);
const groupNames = {
  overall: '整体', replace: '替换', add: '添加', remove: '删除',
  seq: '序号', template: '模板', options: '选项',
};
const ruleTitle = document.getElementById('rule-title');

function syncTabIndicator() {
  const el = tabsRow.querySelector('.tab.active');
  if (!el) return;
  placePill(tabInd, el);
  tabInd.classList.add('on');
}

function showTab(which) {
  for (const t of tabs) {
    const on = t.dataset.tab === which;
    t.classList.toggle('active', on);
    if (on) t.focus({ preventScroll: true });
  }
  for (const [key, g] of groups) g.hidden = key !== which;
  ruleTitle.textContent = groupNames[which] || which;
  syncTabIndicator();
}

for (const t of tabs) {
  t.addEventListener('click', (ev) => {
    showTab(t.dataset.tab);
    ripple(t, ev);
  });
  t.addEventListener('mouseenter', () => {
    if (t.classList.contains('active')) {
      tabHover.classList.remove('on');
      return;
    }
    placePill(tabHover, t);
    tabHover.classList.add('on');
  });
}
tabsRow.addEventListener('mouseleave', () => tabHover.classList.remove('on'));
addEventListener('resize', syncTabIndicator);
new ResizeObserver(syncTabIndicator).observe(tabsRow);
if (document.fonts) document.fonts.ready.then(syncTabIndicator).catch(() => {});
requestAnimationFrame(() => {
  syncTabIndicator();
  tabsRow.classList.add('ready');
});

// ---------- 规则状态 ----------

const $ = (id) => document.getElementById(id);
const radioVal = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

function collectRules() {
  const extToSel = $('extTo').value;
  const incRaw = $('incStart').value.trim();
  const numRaw = $('numStart').value.trim();
  // 位数填 0 时，起始值本身写成 01 / 001 / 0001 就按它的宽度补位
  const padWidth = (raw, digits) => (digits > 0 ? digits : /^0\d+$/.test(raw) ? raw.length : 0);
  return {
    overall: {
      nameMode: radioVal('nameMode') || 'keep',
      incStart: parseInt(incRaw, 10) || 0,
      incDigits: padWidth(incRaw, parseInt($('incDigits').value, 10) || 0),
      numPrefix: $('numPrefix').value,
      numStart: parseInt(numRaw, 10) || 0,
      numDigits: padWidth(numRaw, parseInt($('numDigits').value, 10) || 0),
      convert: $('convert').value,
      extMode: radioVal('extMode') || 'keep',
      extTo: extToSel === '__custom' ? $('extToCustom').value : extToSel,
    },
    replace: {
      enabled: $('replaceOn').checked,
      find: $('replaceFind').value,
      to: $('replaceTo').value,
      useRegex: $('replaceRegex').checked,
      caseSensitive: $('replaceCase').checked,
    },
    remove: {
      enabled: $('removeOn').checked,
      mode: radioVal('removeMode') || 'content',
      content: $('removeContent').value,
      useRegex: $('removeRegex').checked,
      caseSensitive: $('removeCase').checked,
      posFrom: parseInt($('posFrom').value, 10) || 1,
      posTo: parseInt($('posTo').value, 10) || 0,
    },
    add: {
      enabled: $('addOn').checked,
      prefix: $('addPrefix').value,
      suffix: $('addSuffix').value,
      target: radioVal('addTarget') || 'name',
    },
    seq: {
      enabled: $('seqOn').checked,
      start: parseInt($('seqStart').value, 10) || 0,
      step: parseInt($('seqStep').value, 10) || 1,
      digits: parseInt($('seqDigits').value, 10) || 0,
      padChar: $('seqPad').value,
      position: radioVal('seqPos') || 'before',
      sep: $('seqSep').value,
    },
    template: {
      enabled: $('tplOn').checked,
      text: $('tplText').value,
    },
    filter: {
      keyword: $('filterKw').value,
      exts: $('filterExt').value,
    },
    confirmExec: $('confirmExec').checked,
    skipConflict: $('skipConflict').checked,
  };
}

// 有生效规则的页签点亮小圆点
function syncRuleDots(rules) {
  const active = {
    overall: rules.overall.nameMode !== 'keep' || rules.overall.convert !== 'none' || rules.overall.extMode !== 'keep',
    replace: rules.replace.enabled && !!rules.replace.find,
    add: rules.add.enabled && !!(rules.add.prefix || rules.add.suffix),
    remove: rules.remove.enabled && (rules.remove.mode === 'position' || !!rules.remove.content),
    seq: rules.seq.enabled,
    template: rules.template.enabled && !!rules.template.text,
    options: !!(rules.filter.keyword.trim() || rules.filter.exts.trim()),
  };
  for (const t of tabs) t.classList.toggle('on-rule', !!active[t.dataset.tab]);
}

// 依赖其它控件的显隐
function syncControls() {
  const nameMode = radioVal('nameMode');
  $('inc-row').hidden = nameMode !== 'increase';
  $('prefix-row').hidden = nameMode !== 'prefixNum';
  $('num-help').hidden = nameMode !== 'increase' && nameMode !== 'prefixNum';
  for (const id of ['incStart', 'incDigits']) $(id).disabled = nameMode !== 'increase';
  for (const id of ['numPrefix', 'numStart', 'numDigits']) $(id).disabled = nameMode !== 'prefixNum';
  $('ext-to-row').hidden = radioVal('extMode') !== 'to';
  $('extToCustom').hidden = $('extTo').value !== '__custom';

  $('replaceFind').disabled = $('replaceTo').disabled = $('replaceRegex').disabled =
    $('replaceCase').disabled = !$('replaceOn').checked;
  for (const id of ['addPrefix', 'addSuffix']) $(id).disabled = !$('addOn').checked;
  document.querySelectorAll('input[name="addTarget"]').forEach((r) => (r.disabled = !$('addOn').checked));
  for (const id of ['removeContent', 'removeRegex', 'removeCase', 'posFrom', 'posTo']) $(id).disabled = !$('removeOn').checked;
  document.querySelectorAll('input[name="removeMode"]').forEach((r) => (r.disabled = !$('removeOn').checked));
  $('remove-content').hidden = radioVal('removeMode') !== 'content';
  $('remove-position').hidden = radioVal('removeMode') !== 'position';
  for (const id of ['seqStart', 'seqStep', 'seqDigits', 'seqPad', 'seqSep']) $(id).disabled = !$('seqOn').checked;
  document.querySelectorAll('input[name="seqPos"]').forEach((r) => (r.disabled = !$('seqOn').checked));
  $('tplText').disabled = !$('tplOn').checked;
}

// ---------- 文件条目 ----------

let entries = [];
const undoStack = [];
const prevNames = new Map(); // path -> 上次预览的新名，用于只给真正变化的行加闪烁

function dirOf(path) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i < 0 ? '' : path.slice(0, i);
}
function joinPath(dir, name) {
  if (!dir) return name;
  const sep = /[\\/]/.test(dir) && !dir.includes('/') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}
function parentOf(dir) {
  const clean = dir.replace(/[\\/]+$/, '');
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return i < 0 ? clean : clean.slice(i + 1);
}
function sizeText(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function addInfos(infos) {
  let added = 0;
  for (const it of infos) {
    if (it.is_dir) continue;
    if (entries.some((e) => e.path.toLowerCase() === it.path.toLowerCase())) continue;
    const dir = dirOf(it.path);
    entries.push({
      path: it.path,
      dir,
      parentName: parentOf(dir),
      name: it.name,
      size: it.size,
      mtime: it.mtime || 0,
      ext: splitName(it.name).ext.toLowerCase(),
      checked: true,
      pass: true,
      newName: it.name,
      status: 'same',
      conflict: false,
      warnings: [],
    });
    added++;
  }
  if (added) recompute();
  return added;
}

async function importFiles() {
  if (!isTauri) return toast('浏览器预览模式不支持选择文件，请用 tauri dev 运行', true);
  const paths = await invoke('pick_files');
  if (!paths || !paths.length) return;
  const infos = await invoke('stat_paths', { paths });
  const n = addInfos(infos);
  toast(n ? `已导入 ${n} 个文件` : '没有新增文件（可能都已在工作列表中）');
}

async function importFolder() {
  if (!isTauri) return toast('浏览器预览模式不支持选择文件夹', true);
  const dir = await invoke('pick_folder');
  if (!dir) return;
  const recursive = $('importRecursive').checked;
  const infos = await invoke('list_dir', { dir, recursive });
  const n = addInfos(infos);
  toast(n ? `已从 ${parentOf(dir) || dir} 导入 ${n} 个文件` : '该文件夹下没有文件');
}

async function importPaths(paths) {
  const recursive = $('importRecursive').checked;
  const infos = await invoke('stat_paths', { paths });
  const dirs = infos.filter((i) => i.is_dir).map((i) => i.path);
  const files = infos.filter((i) => !i.is_dir);
  const folderFiles = [];
  for (const d of dirs) {
    try {
      folderFiles.push(...(await invoke('list_dir', { dir: d, recursive })));
    } catch { /* 目录读不到就跳过 */ }
  }
  const n = addInfos([...files, ...folderFiles]);
  toast(n ? `拖入 ${n} 个文件${dirs.length ? `（含 ${dirs.length} 个文件夹的内容）` : ''}` : '没有可导入的文件');
}

// ---------- 排序 ----------

const sortBy = $('sortBy');
const sortDirBtn = $('sortDir');
const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
let sortDesc = false;

// 就地重排 entries，序号/递增都按排序后的顺序分配
function sortEntries() {
  const key = sortBy.value;
  sortDirBtn.disabled = key === 'none';
  sortDirBtn.textContent = sortDesc ? '↓' : '↑';
  if (key === 'none') return;
  const mul = sortDesc ? -1 : 1;
  entries.sort((a, b) => {
    let r = 0;
    if (key === 'name') r = nameCollator.compare(a.name, b.name);
    else if (key === 'mtime') r = a.mtime - b.mtime;
    else if (key === 'type') r = nameCollator.compare(a.ext, b.ext) || nameCollator.compare(a.name, b.name);
    else if (key === 'size') r = a.size - b.size;
    return r * mul;
  });
}

sortBy.addEventListener('change', () => recompute());
sortDirBtn.addEventListener('click', () => {
  sortDesc = !sortDesc;
  recompute();
});

// ---------- 计算 + 渲染 ----------

const tbody = $('tbody');
const emptyHint = $('emptyHint');
const statusEl = $('status');
const listTitle = $('listTitle');
const btnExec = $('btnExec');
const btnUndo = $('btnUndo');
const tbHint = $('tb-hint');

let selected = -1;
let busy = false;
// 最近一次统计结果，进度刷新时要按原样重画一遍
const view = { conflicts: 0, okCount: 0, warnCount: 0, filteredOut: 0, invalid: 0 };

function recompute() {
  const rules = collectRules();
  syncControls();
  syncRuleDots(rules);
  sortEntries();

  let visible = 0;
  for (const e of entries) {
    e.pass = passesFilter(e, rules.filter);
    if (!e.pass) {
      e.status = 'filtered';
      e.newName = e.name;
      e.conflict = false;
      continue;
    }
    const r = computeNewName(e, visible, rules);
    e.newName = r.newName;
    e.status = r.status;
    e.warnings = r.warnings || [];
    if (e.checked && r.status === 'ok') visible++;
  }

  // 目标名占用：同目录两行撞同一个名字，或撞上「本次不动」的行
  const keyOf = (dir, name) => `${dir.toLowerCase()}\\${name.toLowerCase()}`;
  const wanted = new Map();
  const occupied = new Set();
  for (const e of entries) {
    const stays = !e.pass || !e.checked || e.status === 'same' || e.status === 'empty';
    if (stays) {
      occupied.add(keyOf(e.dir, e.name));
      continue;
    }
    const k = keyOf(e.dir, e.newName);
    wanted.set(k, (wanted.get(k) || 0) + 1);
  }
  for (const e of entries) {
    if (!e.pass || !e.checked || e.status !== 'ok') {
      e.conflict = false;
      continue;
    }
    const k = keyOf(e.dir, e.newName);
    e.conflict = (wanted.get(k) || 0) > 1 || occupied.has(k);
  }

  view.conflicts = entries.filter((e) => e.conflict).length;
  view.okCount = entries.filter((e) => e.pass && e.checked && e.status === 'ok' && !e.conflict).length;
  view.invalid = entries.filter((e) => e.pass && e.checked && (e.status === 'empty' || e.status === 'illegal')).length;
  view.filteredOut = entries.filter((e) => !e.pass).length;
  // 冲突且设置了「拒绝执行」时，主按钮直接置灰：入口置灰比点下去再报错更清楚
  view.blocked = view.conflicts > 0 && rules.skipConflict;

  render();
}

function render() {
  emptyHint.hidden = entries.length > 0;
  const participating = entries.filter((e) => e.pass).length;
  listTitle.textContent = entries.length
    ? `文件列表 · ${participating}/${entries.length} 项参与`
    : '文件列表';

  const rows = [];
  entries.forEach((e, i) => {
    const prev = prevNames.get(e.path);
    const changed = prev !== undefined && prev !== e.newName;
    prevNames.set(e.path, e.newName);

    let tag;
    if (!e.pass) tag = '<span class="tag same">已过滤</span>';
    else if (!e.checked) tag = '<span class="tag same">未选择</span>';
    else if (e.status === 'empty') tag = '<span class="tag bad">名称为空</span>';
    else if (e.status === 'illegal') tag = '<span class="tag warn">含非法字符</span>';
    else if (e.conflict) tag = '<span class="tag bad">重名冲突</span>';
    else if (e.status === 'same') tag = '<span class="tag same">未变化</span>';
    else tag = '<span class="tag rename">待改名</span>';

    const cls = [!e.checked || !e.pass ? 'off' : '', selected === i ? 'selected' : '']
      .filter(Boolean)
      .join(' ');

    rows.push(
      `<tr data-i="${i}" class="${cls}">` +
        `<td class="col-chk"><input type="checkbox" ${e.checked ? 'checked' : ''} ${e.pass ? '' : 'disabled'} /></td>` +
        `<td class="col-idx">${i + 1}</td>` +
        `<td class="old-name">${esc(e.name)}</td>` +
        `<td class="new-name ${e.status === 'ok' && !e.conflict ? '' : 'unchanged'}${changed ? ' flash' : ''}">${esc(e.newName)}</td>` +
        `<td class="col-status">${tag}</td>` +
        `<td class="col-ext">${esc(splitName(e.newName).ext)}</td>` +
        `<td class="col-size">${sizeText(e.size)}</td>` +
        `<td class="col-path" title="${esc(e.path)}">${esc(e.dir)}</td>` +
      `</tr>`
    );
  });
  tbody.innerHTML = rows.join('');

  const parts = [];
  if (entries.length) parts.push(`待改名 ${view.okCount}`);
  if (view.conflicts) parts.push(`重名冲突 ${view.conflicts}`);
  if (view.invalid) parts.push(`无效 ${view.invalid}`);
  if (view.filteredOut) parts.push(`已过滤 ${view.filteredOut}`);
  statusEl.textContent = parts.join(' · ');
  statusEl.classList.toggle('warn', view.conflicts > 0 || view.invalid > 0);

  btnExec.disabled = busy || view.okCount === 0 || view.blocked;
  btnUndo.disabled = busy || undoStack.length === 0;
  btnUndo.textContent = undoStack.length ? `撤销(${undoStack.length})` : '撤销';
}

// ---------- 交互 ----------

const rulePanel = document.querySelector('.rule-body');
rulePanel.addEventListener('input', recompute);
rulePanel.addEventListener('change', recompute);

tbody.addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-i]');
  if (!tr) return;
  const i = +tr.dataset.i;
  if (ev.target.matches('input[type="checkbox"]')) {
    entries[i].checked = ev.target.checked;
    recompute();
    return;
  }
  selected = selected === i ? -1 : i;
  recompute();
});

$('btnSelectAll').addEventListener('click', () => {
  for (const e of entries) if (e.pass) e.checked = true;
  recompute();
});
$('btnInvert').addEventListener('click', () => {
  for (const e of entries) if (e.pass) e.checked = !e.checked;
  recompute();
});
$('btnClear').addEventListener('click', () => {
  entries = [];
  prevNames.clear();
  selected = -1;
  recompute();
});
$('btnImportFiles').addEventListener('click', importFiles);
$('btnImportDir').addEventListener('click', importFolder);

async function doRename(ops) {
  busy = true;
  btnExec.classList.add('busy');
  btnExec.style.setProperty('--p', '0%');
  tbHint.hidden = false;
  tbHint.textContent = `改名中 0/${ops.length}`;
  render();
  try {
    const done = await invoke('rename_batch', { ops });
    btnExec.style.setProperty('--p', '100%');
    return done;
  } finally {
    busy = false;
    btnExec.classList.remove('busy');
    tbHint.hidden = true;
  }
}

btnExec.addEventListener('click', async () => {
  const rules = collectRules();
  const picked = entries.filter((e) => e.pass && e.checked && e.status === 'ok' && !e.conflict);
  if (!picked.length) return;
  if (rules.skipConflict && entries.some((e) => e.conflict)) {
    return toast('存在重名冲突，已拒绝执行。请调整规则或取消勾选冲突行', true);
  }
  if (rules.confirmExec && isTauri) {
    const ok = await invoke('ask_confirm', {
      message: `即将重命名 ${picked.length} 个文件，确认执行？\n执行后可用「撤销」按钮恢复。`,
    });
    if (!ok) return;
  }
  const ops = picked.map((e) => ({ old: e.path, new: joinPath(e.dir, e.newName) }));
  try {
    const reverse = await doRename(ops);
    // 更新内存中的条目，让列表继续可编辑
    const byOld = new Map(ops.map((o, i) => [o.old.toLowerCase(), { new: o.new, name: picked[i].newName }]));
    for (const e of entries) {
      const hit = byOld.get(e.path.toLowerCase());
      if (!hit) continue;
      e.path = hit.new;
      e.name = hit.name;
      e.newName = hit.name;
      e.status = 'same';
      e.conflict = false;
    }
    undoStack.push(reverse);
    toast(`已重命名 ${reverse.length} 个文件`);
  } catch (err) {
    toast(String(err), true);
  }
  recompute();
});

btnUndo.addEventListener('click', async () => {
  const last = undoStack.pop();
  if (!last) return;
  try {
    await invoke('restore_batch', { ops: last });
    // 逆操作：old 是改名后的路径，new 是原路径
    const byCur = new Map(last.map((o) => [o.old.toLowerCase(), o.new]));
    for (const e of entries) {
      const back = byCur.get(e.path.toLowerCase());
      if (!back) continue;
      e.path = back;
      e.name = back.slice(Math.max(back.lastIndexOf('\\'), back.lastIndexOf('/')) + 1);
    }
    toast('已撤销上一批改名');
  } catch (err) {
    toast(String(err), true);
  }
  recompute();
});

// ---------- 拖拽导入 ----------

function toast(msg, isErr) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), isErr ? 4200 : 2400);
}

const scrim = $('dropScrim');
if (currentWindow) {
  currentWindow.onDragDropEvent((ev) => {
    const p = ev.payload;
    if (p.type === 'enter' || p.type === 'over') scrim.classList.add('on');
    else if (p.type === 'leave') scrim.classList.remove('on');
    else if (p.type === 'drop') {
      scrim.classList.remove('on');
      if (p.paths?.length) importPaths(p.paths);
    }
  });
}

document.addEventListener('contextmenu', (e) => e.preventDefault());

// 初始：让控件禁用态与圆点先就位
syncControls();
showTab('overall');
recompute();

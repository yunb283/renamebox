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

// ---------- 自定义 Select（替换原生 <select>） ----------
// 保留原 <select> 隐藏，用自定义按钮+菜单，点击后只改原 select.value 并派 change。
// 任何外部代码读 .value / 写 .value 都保持兼容。
(function initCustomSelects() {
  const originalSelects = []; // [ { native, sel } ]

  function labelOf(opt) {
    return opt.textContent.trim();
  }

  function syncLabel(native, sel) {
    const btn = sel.querySelector('.sel-btn');
    const cur = native.options[native.selectedIndex];
    btn.textContent = cur ? labelOf(cur) : '';
  }

  function closeAll() {
    originalSelects.forEach(({ sel }) => sel.classList.remove('open'));
  }

  document.querySelectorAll('select').forEach((native) => {
    const sel = document.createElement('div');
    sel.className = 'sel';
    // 从原生 select 的 title 继承提示
    if (native.title) sel.setAttribute('title', native.title);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sel-btn';
    btn.setAttribute('tabindex', native.getAttribute('tabindex') || '0');

    const menu = document.createElement('div');
    menu.className = 'sel-menu';
    native.querySelectorAll('option').forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'sel-item';
      item.dataset.value = opt.value;
      item.textContent = labelOf(opt);
      item.addEventListener('click', () => {
        native.value = opt.value;
        native.dispatchEvent(new Event('change', { bubbles: true }));
        closeAll();
        syncLabel(native, sel);
      });
      menu.appendChild(item);
    });

    sel.appendChild(btn);
    sel.appendChild(menu);

    // 原 select 的 .value 外部可能被脚本改，用 observer 同步按钮文字
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (desc && !native.__valuePatched) {
      native.__valuePatched = true;
      Object.defineProperty(native, 'value', {
        configurable: true,
        enumerable: true,
        get() { return desc.get.call(this); },
        set(v) {
          desc.set.call(this, v);
          syncLabel(this, sel);
        },
      });
    }
    native.addEventListener('change', () => syncLabel(native, sel));

    // 放原 select 后面（原 select 留在 DOM 但隐藏，现有 .style.width 设置仍继承）
    native.style.display = 'none';
    native.after(sel);
    // 同步 sel-btn 宽度（让原 select 上的 inline width 样式生效到外观）
    const w = native.style.width;
    if (w) sel.style.width = w;

    syncLabel(native, sel);
    originalSelects.push({ native, sel });

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const isOpen = sel.classList.contains('open');
      closeAll();
      if (!isOpen) sel.classList.add('open');
    });
  });

  // 点空白 / Esc 关闭
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.sel')) closeAll();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeAll();
  });

  // 暴露给外部手动刷新菜单项（preset 列表增删时需要）
  window.__rbRefreshCustomSelect = function (nativeId) {
    const entry = originalSelects.find(({ native }) => native.id === nativeId);
    if (!entry) return;
    const { native, sel } = entry;
    const menu = sel.querySelector('.sel-menu');
    menu.innerHTML = '';
    native.querySelectorAll('option').forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'sel-item';
      item.dataset.value = opt.value;
      item.textContent = labelOf(opt);
      item.addEventListener('click', () => {
        native.value = opt.value;
        native.dispatchEvent(new Event('change', { bubbles: true }));
        closeAll();
        syncLabel(native, sel);
      });
      menu.appendChild(item);
    });
    syncLabel(native, sel);
  };
})();

// ---------- 模态 Prompt 组件 ----------
// window.prompt 的替代品：返回 Promise<string | null>
function rbPrompt(title, message, placeholder = '', defaultValue = '') {
  return new Promise((resolve) => {
    const scrim = $('modalScrim');
    $('modalTitle').textContent = title;
    const textEl = $('modalText');
    const input = $('modalInput');
    const cancel = $('modalCancel');
    if (message) {
      textEl.hidden = false;
      textEl.textContent = message;
    } else {
      textEl.hidden = true;
    }
    if (placeholder !== '' || defaultValue !== '') {
      input.hidden = false;
      input.value = defaultValue;
      input.placeholder = placeholder;
      input.focus();
      input.select();
    } else {
      input.hidden = true;
    }
    cancel.hidden = false;
    scrim.hidden = false;

    const cleanup = () => {
      scrim.hidden = true;
      input.hidden = true;
      textEl.hidden = true;
      cancel.hidden = true;
      input.onkeydown = null;
      $('modalOk').onclick = null;
      cancel.onclick = null;
      scrim.onclick = null;
    };

    const submit = () => {
      const val = input.hidden ? '' : input.value.trim();
      cleanup();
      resolve(val);
    };
    const cancel_ = () => { cleanup(); resolve(null); };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel_(); }
    };
    $('modalOk').onclick = submit;
    cancel.onclick = cancel_;
    scrim.onclick = (e) => { if (e.target === scrim) cancel_(); };
  });
}

// ---------- 全局快捷键拦截 ----------
(function blockShortcuts() {
  const NON_EDITABLE = /^(INPUT|TEXTAREA)$/;
  // 这些 keyCode / key 值一律拦
  const BLOCK_ALL = new Set([
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ]);
  function onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    const isEditing = NON_EDITABLE.test(tag) && !e.target.readOnly;
    // Tab 全局拦截 —— 不允许焦点跳出我们设计的路径
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); return; }
    if (BLOCK_ALL.has(e.key)) { e.preventDefault(); e.stopPropagation(); return; }
    // 带 Ctrl/Meta 的浏览器级快捷键（输入框里也不应触发浏览器操作）
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (['a','c','v','x','z','y','f','g','h','j','l','n','o','p','r','s','t','w','+','-','=','0'].includes(k)) {
        // A/C/V/X/Z/Y 在输入框里放行（正常编辑）
        if (isEditing && ['a','c','v','x','z','y'].includes(k)) return;
        e.preventDefault(); e.stopPropagation();
        return;
      }
    }
    // Alt 相关菜单
    if (e.altKey) { e.preventDefault(); e.stopPropagation(); }
  }
  document.addEventListener('keydown', onKey, true);
})();

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
      target: radioVal('replaceTarget') || 'both',
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

// 反向：把 rules 对象写回 DOM（应用一个预设）
function applyRules(rules) {
  if (!rules) return;
  const r = rules.overall || {};
  const elSet = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  const chk = (sel, v) => { const el = $(sel); if (el) el.checked = !!v; };
  const radioSet = (name, val) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach((rb) => {
      rb.checked = rb.value === val;
    });
  };
  // overall
  radioSet('nameMode', r.nameMode || 'keep');
  elSet('incStart', r.incStart ?? 1);
  elSet('incDigits', r.incDigits ?? 0);
  elSet('numPrefix', r.numPrefix ?? '');
  elSet('numStart', r.numStart ?? 1);
  elSet('numDigits', r.numDigits ?? 0);
  elSet('convert', r.convert || 'none');
  radioSet('extMode', r.extMode || 'keep');
  // extTo 下拉里没有的选项走自定义
  const knownExts = ['mp4', 'pdf', 'txt', 'jpg', 'png', 'zip', 'rar', '7z'];
  if (r.extTo && !knownExts.includes(r.extTo)) {
    elSet('extTo', '__custom');
    elSet('extToCustom', r.extTo);
  } else {
    elSet('extTo', r.extTo || 'mp4');
    elSet('extToCustom', '');
  }
  // replace
  const rp = rules.replace || {};
  chk('replaceOn', rp.enabled);
  elSet('replaceFind', rp.find || '');
  elSet('replaceTo', rp.to || '');
  chk('replaceRegex', rp.useRegex);
  chk('replaceCase', rp.caseSensitive);
  radioSet('replaceTarget', rp.target || 'both');
  // remove
  const rm = rules.remove || {};
  chk('removeOn', rm.enabled);
  radioSet('removeMode', rm.mode || 'content');
  elSet('removeContent', rm.content || '');
  chk('removeRegex', rm.useRegex);
  chk('removeCase', rm.caseSensitive);
  elSet('posFrom', rm.posFrom ?? 1);
  elSet('posTo', rm.posTo ?? 0);
  // add
  const ad = rules.add || {};
  chk('addOn', ad.enabled);
  elSet('addPrefix', ad.prefix || '');
  elSet('addSuffix', ad.suffix || '');
  radioSet('addTarget', ad.target || 'name');
  // seq
  const sq = rules.seq || {};
  chk('seqOn', sq.enabled);
  elSet('seqStart', sq.start ?? 1);
  elSet('seqStep', sq.step ?? 1);
  elSet('seqDigits', sq.digits ?? 2);
  elSet('seqPad', sq.padChar || '0');
  radioSet('seqPos', sq.position || 'before');
  elSet('seqSep', sq.sep ?? '_');
  // template
  const tp = rules.template || {};
  chk('tplOn', tp.enabled);
  elSet('tplText', tp.text || '');
  // filter + options
  const fl = rules.filter || {};
  elSet('filterKw', fl.keyword || '');
  elSet('filterExt', fl.exts || '');
  // options 项（顶层）
  chk('importRecursive', rules.importRecursive);
  chk('confirmExec', rules.confirmExec !== false);
  chk('skipConflict', rules.skipConflict !== false);
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
const redoStack = [];
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
    // 文件和文件夹都进入列表，文件夹在 status 列会显示 tag
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
      isDir: !!it.is_dir,
      checked: true,
      pass: true,
      newName: it.name,
      status: 'same',
      conflict: false,
      warnings: [],
      random6: Math.floor(Math.random() * 900000) + 100000,
      random7: Math.floor(Math.random() * 9000000) + 1000000,
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
    const stays = !e.pass || !e.checked || e.status !== 'ok';
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

  // 跳过冲突行时，其原名仍被占用；逐层传播，避免其余操作撞上这些文件。
  let changed;
  do {
    changed = false;
    for (const e of entries) if (e.conflict) occupied.add(keyOf(e.dir, e.name));
    for (const e of entries) {
      if (e.pass && e.checked && e.status === 'ok' && !e.conflict && occupied.has(keyOf(e.dir, e.newName))) {
        e.conflict = true;
        changed = true;
      }
    }
  } while (changed);

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
    if (e.isDir) tag = '<span class="tag folder">文件夹</span>' + (
      !e.pass ? '<span class="tag same">已过滤</span>' :
      !e.checked ? '<span class="tag same">未选择</span>' :
      e.status === 'empty' || e.status === 'illegal' ? `<span class="tag bad" title="${esc(e.warnings.join('、'))}">名称或规则无效</span>` :
      e.conflict ? '<span class="tag bad">重名冲突</span>' :
      e.status === 'same' ? '<span class="tag same">未变化</span>' :
      '<span class="tag rename">待改名</span>'
    );
    else if (!e.pass) tag = '<span class="tag same">已过滤</span>';
    else if (!e.checked) tag = '<span class="tag same">未选择</span>';
    else if (e.status === 'empty') tag = '<span class="tag bad">名称为空</span>';
    else if (e.status === 'illegal') tag = `<span class="tag bad" title="${esc(e.warnings.join('、'))}">名称或规则无效</span>`;
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
        `<td title="${esc(e.warnings.join('、'))}" class="new-name ${e.status === 'ok' && !e.conflict ? '' : 'unchanged'}${changed ? ' flash' : ''}">${esc(e.newName)}</td>` +
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
  btnRedo.disabled = busy || redoStack.length === 0;
  btnRedo.textContent = redoStack.length ? `重做(${redoStack.length})` : '重做';
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
    undoStack.push({ reverse, forward: ops });
    redoStack.length = 0;
    persistUndo();
    toast(`已重命名 ${reverse.length} 个文件`);
  } catch (err) {
    toast(String(err), true);
  }
  recompute();
});

btnUndo.addEventListener('click', async () => {
  const item = undoStack.pop();
  if (!item) return;
  busy = true;
  render();
  try {
    await invoke('restore_batch', { ops: item.reverse });
    // 逆操作：reverse 里 old 是改名后的路径，new 是原路径
    const byCur = new Map(item.reverse.map((o) => [o.old.toLowerCase(), o.new]));
    for (const e of entries) {
      const back = byCur.get(e.path.toLowerCase());
      if (!back) continue;
      e.path = back;
      e.name = back.slice(Math.max(back.lastIndexOf('\\'), back.lastIndexOf('/')) + 1);
    }
    redoStack.push(item);
    toast('已撤销上一批改名');
  } catch (err) {
    toast(String(err), true);
  } finally {
    busy = false;
  }
  persistUndo();
  recompute();
});

btnRedo.addEventListener('click', async () => {
  const item = redoStack.pop();
  if (!item) return;
  busy = true;
  render();
  try {
    await invoke('restore_batch', { ops: item.forward });
    // 正向 ops：old → new，内存条目跟着同步
    const byOld = new Map(item.forward.map((o) => [o.old.toLowerCase(), { new: o.new, name: o.new.slice(Math.max(o.new.lastIndexOf('\\'), o.new.lastIndexOf('/')) + 1) }]));
    for (const e of entries) {
      const hit = byOld.get(e.path.toLowerCase());
      if (!hit) continue;
      e.path = hit.new;
      e.name = hit.name;
      e.newName = hit.name;
      e.status = 'same';
      e.conflict = false;
    }
    undoStack.push(item);
    toast('已重做');
  } catch (err) {
    toast(String(err), true);
  } finally {
    busy = false;
  }
  persistUndo();
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

// ---------- 持久化：规则预设 + 撤销/重做 ----------

const LS = {
  presets: 'rb.presets.v1',          // { name: rules, ... }
  current: 'rb.currentRules.v1',    // 关闭时自动保存的当前规则
  active: 'rb.activePreset.v1',
  undo: 'rb.undo.v1',
  redo: 'rb.redo.v1',
};
const MAX_UNDO = 20;

function safeLS(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch { /* 配额满 / 隐私模式 —— 静默忽略 */ }
}
function loadJSON(key, fallback) {
  const raw = safeLS(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function persistUndo() {
  safeLS(LS.undo, JSON.stringify(undoStack.slice(-MAX_UNDO)));
  safeLS(LS.redo, JSON.stringify(redoStack.slice(-MAX_UNDO)));
}

// 每次规则变更自动把当前值存一份，下次打开直接恢复
function persistCurrentRules() {
  safeLS(LS.current, JSON.stringify(collectRules()));
}

function loadPresets() {
  return loadJSON(LS.presets, {});
}
function savePresets(map) {
  safeLS(LS.presets, JSON.stringify(map));
}

// 刷新预设下拉：value 是 name
function refreshPresetUI() {
  const map = loadPresets();
  const names = Object.keys(map).sort();
  const sel = $('presetList');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— 当前 —</option>' +
    names.map((n) => `<option value="${n}">${esc(n)}</option>`).join('');
  if (cur && cur in map) sel.value = cur;
  const active = safeLS(LS.active);
  if (!cur && active && active in map) sel.value = active;
  // 同步自定义下拉的菜单项
  window.__rbRefreshCustomSelect?.('presetList');
  $('presetDelete').disabled = !sel.value;
}

$('presetList').addEventListener('change', () => {
  const name = $('presetList').value;
  if (!name) {
    safeLS(LS.active, '');
    return;
  }
  const map = loadPresets();
  if (map[name]) {
    applyRules(map[name]);
    safeLS(LS.active, name);
    recompute();
  }
  $('presetDelete').disabled = false;
});

$('presetSave').addEventListener('click', () => {
  const name = $('presetList').value;
  if (!name) return toast('请先选一个预设名，或点「另存为…」', true);
  const map = loadPresets();
  map[name] = collectRules();
  savePresets(map);
  safeLS(LS.active, name);
  refreshPresetUI();
  toast(`已保存预设「${name}」`);
});

$('presetSaveAs').addEventListener('click', async () => {
  const name = await rbPrompt('保存为新预设', '', '预设名');
  if (name === null) return;
  const trim = name.trim();
  if (!trim) return toast('预设名不能为空', true);
  const map = loadPresets();
  map[trim] = collectRules();
  savePresets(map);
  safeLS(LS.active, trim);
  refreshPresetUI();
  $('presetList').value = trim;
  window.__rbRefreshCustomSelect?.('presetList');
  toast(`已保存预设「${trim}」`);
});

$('presetDelete').addEventListener('click', () => {
  const name = $('presetList').value;
  if (!name) return;
  const map = loadPresets();
  delete map[name];
  savePresets(map);
  safeLS(LS.active, '');
  refreshPresetUI();
  toast(`已删除预设「${name}」`);
});

// 规则变更时写入「当前」快照；预设另存是显式动作
rulePanel.addEventListener('input', persistCurrentRules);
rulePanel.addEventListener('change', persistCurrentRules);

// 打开时：恢复上次的规则（如果上次是某个预设，也同步选中）
(function restoreSession() {
  // 1. 撤销/重做栈
  try {
    const u = loadJSON(LS.undo, []);
    const r = loadJSON(LS.redo, []);
    if (Array.isArray(u)) undoStack.push(...u);
    if (Array.isArray(r)) redoStack.push(...r);
  } catch { /* 版本不匹配就放弃 */ }

  // 2. 预设
  refreshPresetUI();

  // 3. 上次关闭时的当前规则
  const current = loadJSON(LS.current, null);
  if (current) {
    try { applyRules(current); } catch { /* 旧版本存储格式变化时忽略 */ }
  }
})();

// 初始：让控件禁用态与圆点先就位
syncControls();
showTab('overall');
recompute();
persistCurrentRules();

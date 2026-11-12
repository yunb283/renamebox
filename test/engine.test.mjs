import { computeNewName, passesFilter, splitName, convertText, formatSeq } from '../src/js/rename-engine.js';

const base = {
  overall: { nameMode: 'keep', incStart: 1, convert: 'none', extMode: 'keep', extTo: '' },
  replace: { enabled: false, find: '', to: '', useRegex: false, caseSensitive: false },
  remove: { enabled: false, mode: 'content', content: '', useRegex: false, caseSensitive: false, posFrom: 1, posTo: 0 },
  add: { enabled: false, prefix: '', suffix: '', target: 'name' },
  seq: { enabled: false, start: 1, step: 1, digits: 3, padChar: '0', position: 'before', sep: '' },
  template: { enabled: false, text: '' },
};
const R = (patch) => JSON.parse(JSON.stringify({ ...base, ...patch }));

let fails = 0;
const t = (label, got, want) => {
  const ok = got === want;
  if (!ok) { fails++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};
const name = (n, rules, i = 0) => computeNewName({ name: n, parentName: 'dir' }, i, rules).newName;

t('split no ext', splitName('README').base, 'README');
t('split dotfile', splitName('.gitignore').base, '.gitignore');
t('split multi dot', splitName('a.tar.gz').ext, 'gz');

t('upper', name('photo.png', R({ overall: { ...base.overall, nameMode: 'upper' } })), 'PHOTO.png');
t('title', name('hello world.txt', R({ overall: { ...base.overall, nameMode: 'title' } })), 'Hello world.txt');
t('ext upper', name('a.png', R({ overall: { ...base.overall, extMode: 'upper' } })), 'a.PNG');
t('ext to', name('a.png', R({ overall: { ...base.overall, extMode: 'to', extTo: '.jpg' } })), 'a.jpg');
t('ext del', name('a.png', R({ overall: { ...base.overall, extMode: 'del' } })), 'a');

t('replace literal', name('IMG_1.png', R({ replace: { enabled: true, find: 'IMG', to: '照片', useRegex: false, caseSensitive: true } })), '照片_1.png');
t('replace case-insens', name('img_1.png', R({ replace: { enabled: true, find: 'IMG', to: 'X', useRegex: false, caseSensitive: false } })), 'X_1.png');
t('replace regex group', name('a12b.png', R({ replace: { enabled: true, find: '(\\d+)', to: '[$1]', useRegex: true, caseSensitive: false } })), 'a[12]b.png');
t('replace $ literal safe', name('a.png', R({ replace: { enabled: true, find: 'a', to: 'x$y', useRegex: false, caseSensitive: true } })), 'x$y.png');

t('remove content', name('draft_final.txt', R({ remove: { enabled: true, mode: 'content', content: 'draft_', useRegex: false, caseSensitive: true } })), 'final.txt');
t('remove position 1-5', name('12345abc.txt', R({ remove: { enabled: true, mode: 'position', posFrom: 1, posTo: 5 } })), 'abc.txt');

t('add prefix name', name('a.txt', R({ add: { enabled: true, prefix: 'pre-', suffix: '', target: 'name' } })), 'pre-a.txt');
t('add suffix full', name('a.txt', R({ add: { enabled: true, prefix: '', suffix: '_bak', target: 'full' } })), 'a.txt_bak');

t('seq before pad', name('a.txt', R({ seq: { ...base.seq, enabled: true, digits: 3, position: 'before' } }), 0), '001a.txt');
t('seq after sep', name('a.txt', R({ seq: { ...base.seq, enabled: true, digits: 2, position: 'after', sep: '_' } }), 4), 'a_05.txt');
t('seq start+step', formatSeq(3, { start: 10, step: 5, digits: 0, padChar: 'none' }), '25');
t('seq pad space', formatSeq(0, { start: 1, step: 1, digits: 3, padChar: 'space' }), '  1');

t('template', name('a.png', R({ template: { enabled: true, text: '{parent}_{num}_{name}.{ext}' }, seq: { ...base.seq, enabled: true, digits: 2, position: 'template' } }), 2), 'dir_03_a.png');
t('template + upper', name('a.png', R({ template: { enabled: true, text: 'x{name}' }, overall: { ...base.overall, nameMode: 'upper' } }), 0), 'XA.png');

t('chain replace+seq+upper', name('img_01.png', R({
  replace: { enabled: true, find: 'img', to: 'photo', useRegex: false, caseSensitive: false },
  seq: { ...base.seq, enabled: true, digits: 3, position: 'before', sep: '-' },
  overall: { ...base.overall, nameMode: 'keep' },
}), 0), '001-photo_01.png');

t('illegal stripped', name('a.png', R({ add: { enabled: true, prefix: 'x<y>', suffix: '', target: 'name' } })), 'xya.png');
t('stem emptied -> empty', computeNewName({ name: 'a.png' }, 0, R({ remove: { enabled: true, mode: 'position', posFrom: 1, posTo: 99 } })).status, 'empty');
t('empty from full delete', computeNewName({ name: 'a' }, 0, R({ remove: { enabled: true, mode: 'position', posFrom: 1, posTo: 99 } })).status, 'empty');

t('convert n2cn', convertText('第3章', 'n2cn'), '第三章');
t('convert n2cn 10', convertText('10', 'n2cn'), '十');
t('convert n2cn 105', convertText('105', 'n2cn'), '一百零五');
t('convert cn2n', convertText('第二十三章', 'cn2n'), '第23章');
t('convert s2t', convertText('云图文件', 's2t'), '雲圖文件');
t('convert t2s', convertText('雲圖文件', 't2s'), '云图文件');
t('convert pinyin', convertText('图片文件', 'pinyin'), 'TPWJ');
t('convert pinyin keeps ascii', convertText('照片2024', 'pinyin'), 'ZP2024');

t('filter keyword', passesFilter({ name: 'IMG_1.png' }, { keyword: 'img', exts: '' }), true);
t('filter ext miss', passesFilter({ name: 'a.txt' }, { keyword: '', exts: 'png,jpg' }), false);
t('filter ext hit', passesFilter({ name: 'a.PNG' }, { keyword: '', exts: 'png' }), true);

t('increase pad', name('a.png', R({ overall: { ...base.overall, nameMode: 'increase', incStart: 1, incDigits: 3 } }), 0), '001.png');
t('increase no pad', name('a.png', R({ overall: { ...base.overall, nameMode: 'increase', incStart: 1, incDigits: 0 } }), 9), '10.png');
t('prefix num', name('a.png', R({ overall: { ...base.overall, nameMode: 'prefixNum', numPrefix: 'IMG_', numStart: 1, numDigits: 3 } }), 1), 'IMG_002.png');

// 模板：mtime / size / sizeKB 走文件元数据
const md1 = computeNewName({ name: 'a.png', parentName: 'dir', mtime: 1700000000, size: 1024 }, 0,
  R({ template: { enabled: true, text: '{mtime}_{size}b.{ext}' } })).newName;
t('template metadata mtime/size', md1, '1700000000_1024b.png');

// sizeKB 字段
const md2 = computeNewName({ name: 'a.png', size: 2048 }, 0,
  R({ template: { enabled: true, text: '{sizeKB}' } })).newName;
t('template sizeKB', md2, '2.0');

t('replace name only', name('txt.txt', R({ replace: { enabled: true, find: 'txt', to: 'md', target: 'name' } })), 'md.txt');
t('replace extension only', name('txt.txt', R({ replace: { enabled: true, find: 'txt', to: 'md', target: 'ext' } })), 'txt.md');

// 不合法规则不能被静默跳过，随机预览在同一条目上保持稳定。
const badRegex = R({ replace: { enabled: true, find: '[', to: '', useRegex: true, caseSensitive: false }, add: { enabled: true, prefix: 'x', suffix: '', target: 'name' } });
t('invalid regex blocks row', computeNewName({ name: 'a.txt' }, 0, badRegex).status, 'illegal');
t('reserved Windows name', computeNewName({ name: 'a.txt' }, 0, R({ template: { enabled: true, text: 'CON.txt' } })).status, 'illegal');
t('trailing dot invalid', computeNewName({ name: 'a.txt' }, 0, R({ add: { enabled: true, prefix: '', suffix: '.', target: 'full' } })).status, 'illegal');
const randomRules = R({ template: { enabled: true, text: '{rand}' } });
t('stable random token', computeNewName({ name: 'a.txt', random6: 123456 }, 0, randomRules).newName, '123456.txt');
t('literal regex metacharacters', name('a[b].txt', R({ replace: { enabled: true, find: '[b]', to: 'x', useRegex: false, caseSensitive: true } })), 'ax.txt');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

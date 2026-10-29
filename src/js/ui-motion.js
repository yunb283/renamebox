// 顶部 chrome 的微交互：页签药丸滑动、点击涟漪、图标弹出/旋转。
// 只碰 transform / opacity，不动 width/left 这类会触发 layout 的属性。

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

export function prefersReduced() {
  return reduced.matches;
}

// 把「药丸」挪到 target 上：位置写进 CSS 变量，由那里的 transition 补间
export function placePill(pill, target) {
  if (!pill || !target) return;
  pill.style.setProperty('--x', `${target.offsetLeft}px`);
  pill.style.setProperty('--y', `${target.offsetTop}px`);
  pill.style.setProperty('--w', `${target.offsetWidth}px`);
  pill.style.height = `${target.offsetHeight}px`;
}

// 重新触发一次性动画：先摘类、强制回流、再加回去
export function popOnce(el, cls) {
  if (!el || reduced.matches) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// 点击涟漪：从落点扩散；键盘触发无坐标时退化为中心扩散
export function ripple(el, ev) {
  if (!el || reduced.matches) return;
  const host = el.querySelector('.ripple-clip') || el;
  const box = host.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const size = Math.max(box.width, box.height) * 2.2;
  const px = ev && ev.clientX ? ev.clientX - box.left : box.width / 2;
  const py = ev && ev.clientY ? ev.clientY - box.top : box.height / 2;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.left = `${px - size / 2}px`;
  dot.style.top = `${py - size / 2}px`;
  host.appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove(), { once: true });
}

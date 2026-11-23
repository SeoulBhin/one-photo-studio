// 외곽선 편집기: 사진 위에 축(세로선)과 오른쪽 외곽선 점을 그리고, 손으로 고친다.
//  - 점 끌기 / 선 위 더블클릭 = 점 추가 / 점 우클릭 = 점 삭제(3개는 남김) / 축 끌기
// 좌표는 사진 비율(0~1). 바뀔 때마다 onChange(profile) 를 부른다.

const HIT = 9;     // 점을 잡는 반경(px)
const MIN_POINTS = 3;

export class Editor {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.image = null;
    this.profile = null;
    this.drag = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('dblclick', (e) => this.add(e));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.remove(e); });
    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
  }

  set(image, profile) {
    this.image = image;
    this.profile = profile && { ...profile, points: profile.points.map(p => ({ ...p })) };
    this.fit();
  }

  fit() {
    if (!this.image) return;
    const box = this.canvas.parentElement.getBoundingClientRect();
    const iw = this.image.naturalWidth || this.image.width, ih = this.image.naturalHeight || this.image.height;
    const k = Math.min(box.width / iw, box.height / ih);
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.floor(iw * k)); this.h = Math.max(1, Math.floor(ih * k));
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  // 사진 비율 ↔ 화면 px
  toScreen(p) { return { x: (this.profile.axisX + p.r) * this.w, y: p.y * this.h }; }
  sorted() { return [...this.profile.points].sort((a, b) => a.y - b.y); }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (!this.image) return;
    ctx.drawImage(this.image, 0, 0, w, h);
    if (!this.profile) return;
    const pts = this.sorted();
    const ax = this.profile.axisX * w;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, w, h);
    // 병 모양(양쪽)을 밝게 다시 보여 준다
    ctx.beginPath();
    ctx.moveTo(ax, pts[0].y * h);
    for (const p of pts) { const s = this.toScreen(p); ctx.lineTo(s.x, s.y); }
    for (const p of [...pts].reverse()) { const s = this.toScreen(p); ctx.lineTo(2 * ax - s.x, s.y); }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(this.image, 0, 0, w, h);
    ctx.restore();
    // 축
    ctx.strokeStyle = '#2f6f62'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, h); ctx.stroke();
    // 왼쪽 거울선
    ctx.strokeStyle = 'rgba(47,111,98,0.55)';
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toScreen(p); i ? ctx.lineTo(2 * ax - s.x, s.y) : ctx.moveTo(2 * ax - s.x, s.y); });
    ctx.stroke(); ctx.setLineDash([]);
    // 오른쪽 외곽선 + 점
    ctx.strokeStyle = '#2f6f62'; ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.stroke();
    for (const p of pts) {
      const s = this.toScreen(p);
      ctx.beginPath(); ctx.arc(s.x, s.y, p === this.drag?.point ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#2f6f62'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  nearest(m) {
    let best = null, bd = HIT;
    for (const p of this.profile.points) {
      const s = this.toScreen(p), d = Math.hypot(s.x - m.x, s.y - m.y);
      if (d <= bd) { bd = d; best = p; }
    }
    return best;
  }

  down(e) {
    if (!this.profile || e.button !== 0) return;
    const m = this.local(e);
    const point = this.nearest(m);
    if (point) this.drag = { point };
    else if (Math.abs(m.x - this.profile.axisX * this.w) < 6) this.drag = { axis: true };
    else return;
    this.canvas.setPointerCapture(e.pointerId);
    this.draw();
  }

  move(e) {
    if (!this.profile) return;
    const m = this.local(e);
    if (!this.drag) {
      const hover = this.nearest(m) ? 'grab' : Math.abs(m.x - this.profile.axisX * this.w) < 6 ? 'ew-resize' : 'crosshair';
      this.canvas.style.cursor = hover;
      return;
    }
    if (this.drag.axis) {
      // 축만 옮기고 외곽선 점은 사진 위 제자리에 둔다(반지름을 축과의 거리로 다시 잰다)
      const next = clamp(m.x / this.w, 0.02, 0.98), dx = next - this.profile.axisX;
      for (const p of this.profile.points) p.r = Math.max(0, p.r - dx);
      this.profile.axisX = next;
    } else {
      const p = this.drag.point;
      p.y = clamp(m.y / this.h, 0, 1);
      p.r = clamp(m.x / this.w - this.profile.axisX, 0, 1);
    }
    this.draw();
    this.emit();
  }

  up(e) {
    if (!this.drag) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.draw();
  }

  // 오른쪽 선 위를 더블클릭하면 그 자리에 점을 끼운다
  add(e) {
    if (!this.profile) return;
    const m = this.local(e);
    if (this.nearest(m)) return; // 점 위 더블클릭은 추가가 아니다
    const pts = this.sorted();
    let best = -1, bd = 12;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = this.toScreen(pts[i]), b = this.toScreen(pts[i + 1]);
      const d = segDist(m, a, b);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    this.profile.points.push({ y: clamp(m.y / this.h, 0, 1), r: clamp(m.x / this.w - this.profile.axisX, 0, 1) });
    this.draw();
    this.emit();
  }

  remove(e) {
    if (!this.profile || this.profile.points.length <= MIN_POINTS) return;
    const p = this.nearest(this.local(e));
    if (!p) return;
    this.profile.points.splice(this.profile.points.indexOf(p), 1);
    this.draw();
    this.emit();
  }

  emit() { this.onChange?.(this.profile); }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

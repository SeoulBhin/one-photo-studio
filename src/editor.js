// 외곽선 편집기: 사진 위에 축(세로선)과 오른쪽 외곽선 점, 뚜껑 경계선, 라벨 자리를 그리고 손으로 고친다.
//  - 점 끌기 / 선 위 더블클릭 = 점 추가 / 점 우클릭 = 점 삭제(3개는 남김) / 축 끌기 / 뚜껑 경계선 위아래로 끌기
// 좌표는 사진 비율(0~1). 바뀔 때마다 onChange(profile, capY) 를 부른다.

// 색은 화면 테마 토큰에서 받는다(setColors). 받기 전 기본값
let INK = 'black', ACC = 'firebrick', SHADE = 'rgba(246,245,242,0.55)', FONT = 'sans-serif';

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
    this.capY = null;
    this.label = null; // { y0, y1 } 병 높이 비율(0 = 바닥). 화면에 자리만 보여 준다
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('dblclick', (e) => this.add(e));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.remove(e); });
    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
  }

  set(image, profile, capY = null) {
    this.image = image;
    this.profile = profile && { ...profile, points: profile.points.map(p => ({ ...p })) };
    this.capY = capY;
    this.fit();
  }

  setLabel(label) { this.label = label; this.draw(); }

  // 테마 토큰(글자색·강조색·바탕·글꼴)을 캔버스에 쓸 값으로
  setColors({ ink, accent, shade, font }) {
    if (ink) INK = ink;
    if (accent) ACC = accent;
    if (shade) SHADE = shade;
    if (font) FONT = font;
    this.draw();
  }

  // 병 위·아래 끝(사진 비율)
  span() { const ys = this.profile.points.map(p => p.y); return [Math.min(...ys), Math.max(...ys)]; }

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
    const [top, bottom] = this.span();
    // 병 바깥을 살짝 덮어 따낸 모양이 떠 보이게
    ctx.save();
    ctx.fillStyle = SHADE;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.moveTo(ax, pts[0].y * h);
    for (const p of pts) { const s = this.toScreen(p); ctx.lineTo(s.x, s.y); }
    for (const p of [...pts].reverse()) { const s = this.toScreen(p); ctx.lineTo(2 * ax - s.x, s.y); }
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
    const rMax = Math.max(...pts.map(p => p.r)) * w;
    // 라벨 자리(병 높이 비율 → 사진 좌표)
    if (this.label) {
      const y1 = (bottom - this.label.y0 * (bottom - top)) * h, y0 = (bottom - this.label.y1 * (bottom - top)) * h;
      ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = ACC;
      ctx.fillRect(ax - rMax, y0, rMax * 2, y1 - y0);
      ctx.restore();
      ctx.strokeStyle = ACC; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.strokeRect(ax - rMax + 0.5, y0 + 0.5, rMax * 2 - 1, y1 - y0 - 1);
      ctx.setLineDash([]);
      tag(ctx, '라벨', ax - rMax - 6, y0 + 2, 'right', ACC);
    }
    // 축
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = INK; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax + 0.5, 0); ctx.lineTo(ax + 0.5, h); ctx.stroke();
    // 왼쪽 거울선
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toScreen(p); i ? ctx.lineTo(2 * ax - s.x, s.y) : ctx.moveTo(2 * ax - s.x, s.y); });
    ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    // 뚜껑 경계선
    if (this.capY != null) {
      const cy = Math.round(this.capY * h) + 0.5;
      ctx.strokeStyle = ACC; ctx.lineWidth = this.drag?.cap ? 2 : 1.25;
      ctx.beginPath(); ctx.moveTo(ax - rMax - 14, cy); ctx.lineTo(ax + rMax + 14, cy); ctx.stroke();
      tag(ctx, '뚜껑', ax + rMax + 18, cy - 7, 'left', ACC);
    }
    // 오른쪽 외곽선 + 점
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.stroke();
    for (const p of pts) {
      const s = this.toScreen(p), on = p === this.drag?.point;
      ctx.beginPath(); ctx.arc(s.x, s.y, on ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? INK : 'white'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
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
    else if (this.nearCap(m)) this.drag = { cap: true };
    else if (Math.abs(m.x - this.profile.axisX * this.w) < 6) this.drag = { axis: true };
    else return;
    this.canvas.setPointerCapture(e.pointerId);
    this.draw();
  }

  move(e) {
    if (!this.profile) return;
    const m = this.local(e);
    if (!this.drag) {
      const hover = this.nearest(m) ? 'grab' : this.nearCap(m) ? 'ns-resize' : Math.abs(m.x - this.profile.axisX * this.w) < 6 ? 'ew-resize' : 'crosshair';
      this.canvas.style.cursor = hover;
      return;
    }
    if (this.drag.cap) {
      const [top, bottom] = this.span();
      this.capY = clamp(m.y / this.h, top, bottom);
    } else if (this.drag.axis) {
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

  nearCap(m) { return this.capY != null && Math.abs(m.y - this.capY * this.h) < 5; }

  emit() { this.onChange?.(this.profile, this.capY); }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 선 옆 작은 이름표
function tag(ctx, text, x, y, align, color) {
  ctx.font = `500 11px ${FONT}`;
  const tw = ctx.measureText(text).width, pad = 4, bw = tw + pad * 2;
  const bx = align === 'right' ? x - bw : x;
  ctx.fillStyle = 'white'; ctx.fillRect(bx, y, bw, 15);
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, 14);
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + pad, y + 8);
}

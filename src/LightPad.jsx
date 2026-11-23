// 조명 판: 위에서 내려다본 세트. 아래쪽이 정면, 가운데일수록 머리 위.
// 판은 캔버스 하나로 그리고 색은 테마 토큰에서 읽는다.
import { useEffect, useRef } from 'react';
import { resolveColor } from './tokens.js';

const SIZE = 120;

function toXY({ azimuth, elevation }) {
  const a = (azimuth * Math.PI) / 180, d = 0.12 + 0.8 * (1 - elevation / 90);
  return [SIZE / 2 + (SIZE / 2 - 6) * d * Math.sin(a), SIZE / 2 + (SIZE / 2 - 6) * d * Math.cos(a)];
}

export function LightPad({ light, onChange }) {
  const ref = useRef(null);

  useEffect(() => {
    const c = ref.current, dpr = window.devicePixelRatio || 1;
    c.width = SIZE * dpr; c.height = SIZE * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const tok = (n, f) => resolveColor(c, n, f);
    const surface = tok('--color-background-card', 'white'), line = tok('--color-border', 'gray');
    const ink = tok('--color-text-primary', 'black'), muted = tok('--color-text-secondary', 'gray');
    const lamp = tok('--color-icon-warning', 'orange'), font = css.fontFamily;
    g.clearRect(0, 0, SIZE, SIZE);
    g.fillStyle = surface; g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2); g.fill(); g.stroke();
    g.setLineDash([3, 3]);
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 30, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    const [x, y] = toXY(light);
    g.strokeStyle = muted; g.beginPath(); g.moveTo(SIZE / 2, SIZE / 2); g.lineTo(x, y); g.stroke();
    g.fillStyle = ink; g.beginPath(); g.arc(SIZE / 2, SIZE / 2, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = lamp; g.strokeStyle = ink; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = muted; g.font = `10.5px ${font}`; g.textAlign = 'center'; g.fillText('정면', SIZE / 2, SIZE - 6);
  }, [light]);

  function move(e) {
    const r = ref.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const d = Math.min(1, Math.max(0, (Math.hypot(x, y) / 0.92 - 0.12) / 0.8));
    onChange({ azimuth: (Math.atan2(x, y) * 180) / Math.PI, elevation: Math.max(8, 90 * (1 - d)) });
  }

  return (
    <canvas
      ref={ref}
      role="slider"
      aria-label="조명 위치: 위에서 본 세트, 아래쪽이 정면"
      aria-valuetext={`방향 ${Math.round(light.azimuth)}°, 높이 ${Math.round(light.elevation)}°`}
      data-testid="pad"
      style={{ width: SIZE, height: SIZE, cursor: 'crosshair', touchAction: 'none', flex: 'none' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); }}
    />
  );
}

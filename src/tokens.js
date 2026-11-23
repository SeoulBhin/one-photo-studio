// 테마 토큰(light-dark() 로 정의된 색 포함)을 캔버스가 쓸 수 있는 rgb 값으로 바꾼다
export function resolveColor(el, token, fallback) {
  const prev = el.style.color;
  el.style.color = `var(${token})`;
  const out = getComputedStyle(el).color;
  el.style.color = prev;
  return out && out !== 'rgba(0, 0, 0, 0)' ? out : fallback;
}

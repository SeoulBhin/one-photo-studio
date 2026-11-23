// stone 테마(따뜻한 돌·슬레이트)를 그대로 쓰고 글꼴만 Pretendard 로 바꾼다
import { defineTheme } from '@astryxdesign/core/theme';
import { stoneTheme } from '@astryxdesign/theme-stone';

const SANS = 'Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';

export const studioTheme = defineTheme({
  name: 'studio',
  extends: stoneTheme,
  tokens: {
    '--font-family-body': SANS,
    '--font-family-heading': SANS,
    '--font-family-code': 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  },
});

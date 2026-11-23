import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 빌드 결과(dist/)를 serve.py 가 127.0.0.1 에서만 내보낸다
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
});

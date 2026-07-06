import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 배포 타깃별 base 경로 분기:
//  - GitHub Pages: /HK_Judge/  (DEPLOY_TARGET=ghpages, 리포 이름과 일치해야 함)
//  - 로컬 dev / Firebase Hosting: /
const base = process.env.DEPLOY_TARGET === 'ghpages' ? '/HK_Judge/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5300 },
});

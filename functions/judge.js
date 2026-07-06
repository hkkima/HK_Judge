// 채점 실행 공급자 계층.
//   1차: Cloud Run 러너(JUDGE_URL 설정 시) — 안정적, 운영자 통제, UTF-8 기본.
//   폴백: Wandbox 공개 API — Cloud Run 미설정/일시 실패 시 자동 전환.
//   둘 다 같은 반환 형태 → index.js 의 judgeOne 이 그대로 판정.
import { cloudRunRun, cloudRunConfigured } from './cloudrun.js';
import { wandboxRun, normalizeOutput, mapPool, sleep } from './wandbox.js';

export { normalizeOutput, mapPool };

export async function runOnce(args) {
  if (cloudRunConfigured()) {
    // Cloud Run 짧게 재시도 후, 그래도 안 되면 Wandbox 로 폴백(가용성 우선).
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await cloudRunRun(args);
      } catch (e) {
        if (attempt === 2) break;
        await sleep(400);
      }
    }
  }
  return wandboxRun(args);
}

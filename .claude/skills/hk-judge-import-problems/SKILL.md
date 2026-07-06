---
name: hk-judge-import-problems
description: HK_Judge(C# 코딩 문제판)에 문제를 일괄 등록한다. 사용자가 "# 문제 N. 제목 / 문제 설명 / 입력·출력 형식 / 예제 / 힌트 / 템플릿 코드 / 테스트 케이스 표" 양식의 마크다운(한 개 또는 여러 개)을 주며 "문제로 넣어줘", "이것도 넣어줘", "HK_Judge에 등록", "코딩 문제 추가"라고 할 때 사용한다. tools/import-problems.mjs 파서+임포터로 problems/problemTests에 업서트하고, 채점·포인트 지급까지 검증한다.
---

# HK_Judge 문제 일괄 등록

사용자가 아래 양식의 마크다운을 주면 `C:\HK_Bot\HK_Judge` 앱(라이브: hkkima.github.io/HK_Judge, 백엔드 `hk-chess-betting`)에 문제로 등록한다.

## 입력 양식 계약 (문제마다 반복)
```
# 문제 N. 제목
## 문제 설명 …
## 입력 형식 …
## 출력 형식 …
## 예제 입력 / ## 예제 출력   (### 로 써도 됨)
## 힌트 …
### 템플릿 코드        ← 바로 뒤 ```csharp … ``` 코드블록 = 학습자 시작 코드
### 테스트 케이스      ← 바로 뒤 | # | 입력 | 출력 | 표
```
- 테스트 표: 셀의 `<br>` = 줄바꿈, 백틱은 제거. **첫 행 = 공개 예제, 나머지 = 비공개(정답 숨김)**.
- `# 문제`로 시작하는 블록만 인식(상단 소개/구분선 `---`은 무시). `## 설명~힌트`가 문제 statement가 되고, 템플릿·테스트 표는 분리 저장된다.

## 절차

1. **저장**: 받은 마크다운을 `examples/<세트이름>.md`로 저장한다(예: `examples/set3-loops.md`).

2. **파싱 점검(dry-run)** — 쓰기 전에 반드시 확인:
   ```
   cd C:\HK_Bot\HK_Judge
   node tools/import-problems.mjs --file examples/<파일>.md --prefix <접두> --reward <포인트> --start-order <시작순번> --dry-run
   ```
   문제 수·제목·`tests=`개수·`tpl=O`가 맞는지 본다. `tpl=X`나 `tests=0`이면 양식을 고친다.
   - `--prefix`: 문서 id 접두(기존 세트와 겹치지 않게). 연산자편=`op`, 조건문편=`cond` 사용 중.
   - `--start-order`: 목록 정렬 순번. 기존 마지막 order 다음부터(연산자 1~5, 조건문 11~15 사용 중 → 다음 세트는 21부터 권장).
   - `--reward`: 문제당 포인트(현재 세트들은 1000).

3. **한글/실수 출력 주의(사전 검증)**: 기대 출력에 **비ASCII(한글 등)** 나 **소수점**이 있으면, 채점 컴파일러(Wandbox mono)에서 그 값이 그대로 나오는지 미리 확인한다. Wandbox로 레퍼런스 풀이를 한 번 돌려 기대값과 바이트 일치하는지 본다.
   - 한글은 서버가 `Console.OutputEncoding`을 UTF-8로 자동 주입하므로 정상 출력된다(학생 코드 수정 불필요). 그래도 새 유형이면 한 번 확인 권장.
   - 실수는 .NET 기본 포맷(불변 로케일, 소수점 `.`)을 따른다. 표의 기대값이 이와 다르면(반올림/자릿수) 표를 맞춘다.

4. **등록(쓰기)**: dry-run이 깨끗하면 `--dry-run`을 빼고 실행한다. 성공 시 `created/updated: <id>` 가 문제 수만큼 출력된다.
   - 인증: `tools/`에 `firebase-admin`이 설치돼 있어야 한다(`cd tools && npm install`). 서비스 계정 키 기본 경로는 `C:/HK_Bot/hk-chess-betting-firebase-adminsdk-fbsvc-018b7a64ea.json`(리포 밖, 커밋 금지). 다른 키는 `--key`로.

5. **검증(선택이나 권장)**: 임시 계정으로 레퍼런스 풀이를 제출해 `allPassed=true`·`awarded`를 확인하고, 끝나면 **반드시 정리**한다(임시 user·solved·submissions 삭제 + 지급분만큼 `meta/stockBoard.housePool`을 `FieldValue.increment(+합계)`로 원복 — 지급은 하우스 풀에서 나가므로 총 포인트 보존). 이전 세트 검증 시 이 패턴을 사용했다.

## 주의
- **포인트 증가·문제 쓰기는 서버(Admin SDK)만**. 이 도구가 그 경로다. 클라이언트는 읽기 전용.
- 최초 정답에만 1회 지급(중복 방지는 `solved/{userId__problemId}`). reward만 바꾸려면 `problems/{id}.reward`만 업데이트.
- 자세한 데이터 모델·배포 규칙은 리포의 `CLAUDE.md` 참고. 채점 백엔드 교체는 `functions/wandbox.js`.

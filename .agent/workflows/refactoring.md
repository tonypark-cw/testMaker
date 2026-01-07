---
description: Workflow for code refactoring to ensure consistency and documentation
---
이 워크플로우는 코드 리팩토링 작업 시 일관성과 문서화를 보장하기 위해 사용합니다.

1. **분석 (Analyze)**: 대상 파일을 분석하여 개선이 필요한 부분(예: 고정지연(static wait), 취약한 셀렉터(weak selector), 모달 동기화 누락 등)을 식별합니다.

2. **계획 및 문서화 (Plan & Document)**: **!!중요!!** `docs/PROJECT_BRIEFING.md` 파일에 "Refactoring Plan" 항목을 추가합니다.
   - **중요**: `implementation_plan.md` 아티팩트의 핵심 내용(목표, 변경 사항)을 요약하여 브리핑 문서에 반드시 포함시켜야 합니다.
   - 작성 형식:
     ```markdown
     ### [YYYY-MM-DD] Refactoring Plan: [기능/파일명]
     - **Goal**: ...
     - **Scope**:
       - [ ] 작업 항목
     ```

3. **승인 (Approval)**: 작성한 계획에 대해 사용자 검토(`notify_user`)를 요청하여 승인을 받습니다.

4. **실행 (Execute)**: 코드를 변경합니다.

5. **검증 (Verify)**: 안정성 검증을 위한 테스트 실행 명령어를 제공합니다. 실행 여부를 묻지 말고, 사용자가 복사해서 바로 실행할 수 있도록 명령어만 코드 블록으로 제시하세요.

6. **문서 현행화 (Update Docs)**: `docs/PROJECT_BRIEFING.md`에 계획된 항목을 완료(check) 처리하거나, 새로 발견된 패턴이 있다면 "Lesson Learned"에 추가합니다.

# 설정 안내서 (Supabase · 구글 로그인 · Netlify)

비유: 집을 지으려면 **땅(Supabase 프로젝트) → 출입 열쇠(구글 로그인) → 주소(Netlify)** 순서로 준비합니다.
아래 1~4번은 사용자가 직접 해야 하는 계정 작업입니다. 끝나면 **5번의 값 2개**만 알려주세요.

## 1. Supabase 프로젝트 만들기 (장부 보관소)

1. https://supabase.com 에 가입 (GitHub 또는 구글 계정으로 가능)
2. **New project** → 이름 예: `sannae-tofu`, 지역은 **Northeast Asia (Seoul)**, DB 비밀번호는 안전한 곳에 보관
3. 프로젝트가 만들어지면 왼쪽 **SQL Editor** → **New query**
4. 이 저장소의 `supabase/schema.sql` 내용을 **전부** 붙여넣고 **Run**
   - "Success" 가 나오면 표(장소, 주문, 배달, 입금 등)와 보안 규칙이 만들어진 것입니다.
   - 여러 번 실행해도 안전합니다.

## 2. 구글 로그인 열쇠 만들기

### 2-1. Google Cloud 에서 로그인용 ID 발급
1. https://console.cloud.google.com → 새 프로젝트 만들기
2. **API 및 서비스 → OAuth 동의 화면**: 사용자 유형 **외부**, 앱 이름 `산내면 콩두부`, 이메일 입력 후 저장
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID** → 유형 **웹 애플리케이션**
4. **승인된 리디렉션 URI** 에 아래 주소 추가 (프로젝트 주소는 Supabase **Project Settings → API** 의 Project URL)

   ```
   https://<내 프로젝트 ID>.supabase.co/auth/v1/callback
   ```
5. 만들어진 **클라이언트 ID** 와 **클라이언트 보안 비밀번호** 를 복사

### 2-2. Supabase 에 연결
1. Supabase → **Authentication → Providers → Google** → Enable
2. 위의 클라이언트 ID / 비밀번호 붙여넣고 저장

## 3. 관리자 등록 (허용할 구글 이메일)

구글 로그인만으로는 아무나 관리자가 되지 않습니다. **등록된 이메일만** 관리자 화면을 볼 수 있습니다.
SQL Editor 에서 아래를 실행하세요 (이메일은 본인 것으로 변경, 여러 명이면 줄 추가).

```sql
insert into admins(email, name) values ('your.name@gmail.com', '홍길동');
```

## 4. Netlify 로 웹 주소 만들기

1. https://netlify.com 가입 → **Add new site → Import an existing project → GitHub**
2. 저장소 `hyunjupk-bot/roulette260701` 선택, 배포할 브랜치 선택 (빌드 명령 없음, 게시 폴더는 `/`)
3. 배포가 끝나면 `https://xxxx.netlify.app` 주소가 생깁니다.
4. 이 주소를 Supabase 에 등록: **Authentication → URL Configuration**
   - **Site URL**: 위 Netlify 주소
   - **Redirect URLs**: 같은 주소 (`https://xxxx.netlify.app/**`)

## 5. 저에게 알려줄 값

| 항목 | 위치 | 비고 |
|---|---|---|
| Project URL | Supabase → Project Settings → API | `https://...supabase.co` |
| anon(publishable) key | 같은 화면 | 웹에 공개되어도 되는 키 (보안은 DB 규칙이 담당) |

> **주의**: `service_role` (secret) 키는 **절대 공유하지 마세요.** 이 키는 모든 보안 규칙을 무시합니다.
> 이 프로젝트는 anon 키만 사용합니다.

그 밖에 필요한 것
- 장소 엑셀 파일 (열 구성 예: `구분(경로당/캠핑장) | 이름 | 마을 | 주소 | 담당자 | 연락처`)
- 콩두부 실제 단가

## 보안 설계 요약

- 비로그인 사용자(직접 주문)는 테이블을 **직접 읽거나 쓸 수 없고**, 정해진 3개 기능만 사용할 수 있습니다.
  - 장소 목록 조회 (연락처는 포함되지 않음)
  - 주문 접수 (장소에 등록된 연락처와 일치해야 하며, 항상 `접수대기` 상태로 저장)
  - 내 주문 확인 (장소 + 연락처가 일치할 때만)
- 관리자 기능(주문 확정, 배달 처리, 입금, 장소 관리)은 `admins` 에 등록된 구글 계정만 가능합니다.
- 주문이 `접수대기` 인 동안은 배달·청구에 반영되지 않으며, 관리자가 확정해야 배달 일정이 생성됩니다.

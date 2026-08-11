# 그룹홈맵 정적 배포본

## 파일 구성

- `index.html`: Kakao Maps JS SDK, MarkerClusterer, 필터/목록/오버레이 UI
- `data.json`: 지도와 차트에서 사용하는 정규화 데이터
- `geocoding_failures.json`: Kakao 주소 지오코딩 실패 또는 미실행 시설 목록
- `assets/sigungu-centers.json`: 주소 지오코딩 실패 시 쓰는 시군구 중심 대체 좌표
- `scripts/prepare-data.mjs`: 원본 JSON 정규화 및 Kakao Local API 1회성 지오코딩
- `geocode-windows.cmd`: Windows에서 REST 키를 입력받아 지오코딩을 실행하는 도우미
- `AGILE_GAP_ANALYSIS.md`: 우슐랭 레퍼런스 대비 갭과 다음 스프린트 계획

## 현재 좌표 상태 (갱신: 지오코딩 완료)

`data.json` 520개 시설 좌표 상태:

- 주소 지오코딩 성공(Kakao Local, `geocodeStatus: "address"`): **518개**
- 시군구 중심 대체 좌표(`geocodeStatus: "fallback_sigungu_center"`): **2개**
  (부산 강서구 열린그룹홈, 경기 부천시 맑은샘우리집 — 원문 주소로 Kakao Local API 검색 결과 없음)
- 실패/대체 상세 내역은 `geocoding_failures.json` 참고

재지오코딩이 필요하면(주소 정정 등) 아래 절차를 그대로 다시 실행하면 됩니다.

```cmd
geocode-windows.cmd
```

실행 후 검은 창에 Kakao REST API 키를 붙여넣으면 `data.json`과 `geocoding_failures.json`이 갱신됩니다.
REST 키는 프론트 코드에 저장하지 않습니다.

직접 명령어로 실행하려면 Windows CMD에서는 이렇게 씁니다.

```cmd
set KAKAO_REST_API_KEY=발급받은_REST_API_키
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\prepare-data.mjs --geocode
```

PowerShell에서는 이렇게 씁니다.

```powershell
$env:KAKAO_REST_API_KEY="발급받은_REST_API_키"
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\prepare-data.mjs --geocode
```

## Kakao API 키 적용 (⚠ 배포 전 필수 — 키 재발급 필요)

**보안 조치 사항**: 이전 버전의 `index.html`에 담겨 있던 JavaScript 키가 스크린샷을 통해 외부에 노출된 이력이 있어, 해당 키는 폐기하고 `index.html`의 값을 `YOUR_KAKAO_JAVASCRIPT_KEY` 플레이스홀더로 되돌려 두었습니다. **아래 절차로 반드시 새 키를 발급받아 교체한 뒤 배포하세요.**

1. [Kakao Developers](https://developers.kakao.com/) 콘솔에서 기존 애플리케이션의 키를 **재발급**하거나 신규 애플리케이션을 만듭니다.
2. 제품 설정에서 Kakao Map API 사용을 활성화합니다.
3. **플랫폼 > Web**에 로컬 테스트 도메인 `http://localhost:8080`과 실제 배포 도메인만 정확히 등록합니다(다른 도메인 미등록 확인 — 이 등록이 없으면 키가 노출돼도 타인이 도용 불가하므로 가장 중요한 방어선입니다).
4. `set-kakao-js-key-windows.cmd`를 실행해 새 JavaScript 키를 `index.html`의 `GROUPHOME_MAP_CONFIG.kakaoJavaScriptKey`에 반영합니다. (직접 `index.html`을 열어 값만 바꿔도 됩니다.)
5. REST API 키는 `scripts/prepare-data.mjs --geocode` 실행 때만 환경변수로 사용하고 배포본(`index.html`, `data.json` 등)에는 절대 넣지 않습니다.
6. 배포 후 주기적으로(예: 분기 1회) Kakao Developers 콘솔에서 등록 도메인 목록과 키 사용량을 점검해 이상 트래픽 여부를 확인합니다.

## 로컬 확인

정적 파일이므로 프로젝트 폴더에서 서버만 띄우면 됩니다.

```powershell
python -m http.server 8080
```

브라우저에서 `http://localhost:8080/`을 엽니다.
Kakao 지도가 보이려면 Kakao Developers의 JavaScript SDK 도메인에 `http://localhost:8080`이 등록되어 있어야 합니다.

# 실버잡 홈페이지에 '일자리 날씨' 끼워 넣기

공개 주소: https://sungo-bae.github.io/miniature-octo-spoon/
예시 페이지: https://sungo-bae.github.io/miniature-octo-spoon/embed-example.html

기존 실버잡 홈페이지의 한 페이지(예: "우리 동네 일자리") 안에 아래 코드 두 줄을 넣으면 됩니다.
데이터는 매일 아침 자동으로 바뀌므로, 한 번 넣어 두면 더 고칠 것이 없습니다.

## 1. 붙여 넣을 코드

```html
<div class="silverjob-weather" data-accent="#005bac" data-bg="#ffffff"></div>
<script src="https://sungo-bae.github.io/miniature-octo-spoon/embed.js" defer></script>
```

- 내용 높이에 맞춰 상자 높이가 자동으로 바뀝니다. 스크롤바가 두 개 생기지 않습니다.
- 실버잡 로고 줄은 숨겨집니다. 기존 홈페이지 머리말이 그 역할을 합니다.

### 맞춤 설정 (`data-…`)

| 설정 | 예 | 뜻 |
|---|---|---|
| `data-accent` | `#005bac` | 머리띠 색. 홈페이지 대표색으로 바꾸세요. |
| `data-bg` | `#ffffff` | 바탕색. 홈페이지 바탕이 흰색이면 `#ffffff`를 넣으세요. |
| `data-region` | `서울특별시` | 처음 보여줄 지역. 생략하면 방문자가 마지막으로 고른 지역이나 전국을 보여줍니다. |
| `data-lock` | `1` | `data-region`과 함께 쓰면 지역 선택을 숨기고 그 지역만 보여줍니다. 지역 센터 홈페이지에 알맞습니다. |
| `data-theme` | `light` | `light` 또는 `dark`. 생략하면 방문자 기기 설정을 따릅니다. 홈페이지가 밝은 색이면 `light`를 권장합니다. |

지역 이름은 `서울특별시`, `경기도`, `부산광역시`, `전북특별자치도`, `전남광주`처럼 화면의 지역 목록과 같게 씁니다.

## 2. 홈페이지 종류별로 넣는 곳

| 홈페이지 | 넣는 곳 |
|---|---|
| 직접 만든 사이트 (HTML) | 원하는 페이지의 본문에 위 두 줄을 그대로 넣습니다. |
| React / Next.js | 아래 '코드로 만든 사이트' 참고 |
| 아임웹 | 페이지 편집 → 섹션 추가 → **코드** 위젯 → 위 두 줄 붙여넣기 |
| 워드프레스 | 블록 편집기 → **사용자 정의 HTML** 블록 → 위 두 줄 붙여넣기 |
| 윅스 | 추가 → 임베드 → **HTML 임베드** → 코드 입력. 윅스는 높이 자동 조절이 안 되므로 상자 높이를 3,200px 정도로 직접 지정합니다. |
| 네이버 블로그·카페 등 스크립트가 막힌 곳 | 끼워 넣기가 안 됩니다. 공개 주소로 **링크**를 거세요. |

### 코드로 만든 사이트 (React / Next.js)

```jsx
import Script from "next/script";

export default function JobWeather() {
  return (
    <>
      <div className="silverjob-weather" data-accent="#005bac" data-bg="#ffffff" />
      <Script src="https://sungo-bae.github.io/miniature-octo-spoon/embed.js" strategy="afterInteractive" />
    </>
  );
}
```

스크립트 없이 `<iframe>`만 쓰는 방법도 있습니다. 이 경우 높이가 자동으로 맞춰지지 않습니다.

```html
<iframe src="https://sungo-bae.github.io/miniature-octo-spoon/?embed=1&accent=%23005bac&bg=%23ffffff"
        title="실버잡 일자리 날씨" style="width:100%;height:3200px;border:0" loading="lazy"></iframe>
```

## 3. 확인

1. 넣은 페이지를 열어 '일자리 날씨'가 보이는지 확인합니다.
2. 휴대폰에서도 열어 글자가 잘리지 않는지 확인합니다.
3. 안 보이면 홈페이지 관리 화면에서 외부 스크립트나 iframe을 막는 보안 설정이 있는지 확인합니다.

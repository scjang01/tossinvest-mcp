# tossinvest-mcp

[![MCP Badge](https://lobehub.com/badge/mcp/scjang01-tossinvest-mcp)](https://lobehub.com/mcp/scjang01-tossinvest-mcp)

## 프로그램 개요

`tossinvest-mcp`는 토스증권 Open API(현재가 조회, 주문, 잔고 조회 등)를 OpenAI 서비스, Claude Desktop, Cursor 같은 MCP 지원 앱에서 사용할 수 있게 해주는 로컬 MCP 서버입니다.

쉽게 말해, 이 프로그램을 MCP 클라이언트에 등록하면 AI에게 다음처럼 요청할 수 있습니다.

```text
삼성전자 현재가를 조회해줘.
```

```text
내 토스증권 보유 주식을 보여줘.
```

```text
대기 중인 주문 목록을 보여줘.
```

이 프로그램은 사용자의 컴퓨터에서만 실행됩니다.

## 가장 중요한 주의사항

토스증권 Open API에는 샌드박스나 모의투자 환경이 없습니다.

거래 기능을 켜면 실제 계좌에 실제 주문을 생성, 정정, 취소할 수 있습니다. 처음 사용할 때는 반드시 거래 기능을 켜지 말고 조회 기능부터 확인하세요.

기본 설정에서는 주문 생성, 정정, 취소 도구가 등록되지 않습니다.


## 프로그램으로 할 수 있는 기능 및 특징

거래 기능을 켜지 않아도 아래 기능을 사용할 수 있습니다.

- 국내/미국 주식 현재가 조회
- 호가 조회
- 최근 체결 내역 조회
- 캔들 차트 조회
- 상한가/하한가 조회
- 종목 기본 정보 조회
- 매수 유의사항 조회
- 환율 조회
- 국내/미국 장 운영 시간 조회
- 계좌 목록 조회
- 보유 주식 조회
- 매수 가능 금액 조회
- 판매 가능 수량 조회
- 매매 수수료 조회
- 주문 목록 조회
- 주문 상세 조회

거래 기능을 켠 경우 사용할 수 있는 도구:

- `toss_create_order`: 주문 생성
- `toss_modify_order`: 주문 정정
- `toss_cancel_order`: 주문 취소

특징:

- `npx tossinvest-mcp`로 실행되므로 별도 프로그램 설치 과정이 짧습니다.
- API Key와 Secret Key는 환경변수로 전달합니다.
- OAuth 토큰은 내부에서 자동 발급하고, 만료 60초 전에 자동 갱신합니다.
- 계좌가 필요한 기능은 기본적으로 `accountSeq` 1번 계좌를 사용합니다.
- 계좌가 여러 개이거나 다른 계좌를 쓰고 싶으면 `TOSSINVEST_ACCOUNT` 값으로 변경할 수 있습니다.
- 주문 생성, 정정, 취소 기능은 기본적으로 꺼져 있습니다.
- 주문 기능을 켜도 기본값에서는 `confirmOrderAction: true` 확인값이 없으면 주문 API를 호출하지 않습니다.
- 주문 한도, 매도/시장가 차단, 종목 허용목록, 일일 한도 같은 가드레일을 환경변수로 켤 수 있고, 모든 검사는 토스증권 주문 API 호출 전에 서버에서 강제됩니다. (아래 `거래 가드레일` 참고)


중요: `toss_modify_order`는 기존 주문을 그 자리에서 수정하는 단순 PATCH가 아닙니다. 토스증권 API는 원주문을 대체하는 방식으로 처리하며, 정정 후 새 `orderId`를 반환합니다. 이후 주문 상세 조회, 재정정, 취소에는 새로 받은 `orderId`를 사용하세요.

## 설치방법

아래 순서대로 진행하면 됩니다.

### 1. Node.js 설치 확인

터미널 또는 PowerShell을 열고 아래 명령어를 입력합니다.

```bash
node -v
```

`v20` 이상이 나오면 다음 단계로 넘어가면 됩니다.

Node.js가 없거나 버전이 낮다면 https://nodejs.org 에서 LTS 버전을 설치한 뒤 터미널을 새로 열어 다시 확인하세요.

### 2. 토스증권 Open API Key 준비

토스증권 WTS에 로그인한 뒤 Open API 설정 화면으로 이동합니다.

그 화면에서 아래 값을 발급받아 둡니다.

- `API Key`
- `Secret Key`

이 두 값은 MCP 설정에 넣어야 합니다. 다른 사람에게 공유하지 마세요.

### 3. 허용 IP 등록

토스증권 Open API는 허용된 IP에서만 호출할 수 있습니다. 이 설정이 빠져 있으면 `허용되지 않은 IP 주소입니다.` 같은 오류가 발생합니다.

먼저 현재 컴퓨터의 공인 IP를 확인합니다. 아래 명령어를 사용하세요.

PowerShell (Windows):

```powershell
(Invoke-WebRequest -UseBasicParsing https://api.ipify.org).Content
```

macOS 또는 Linux 터미널:

```bash
curl https://api.ipify.org
```

나온 IP 주소를 토스증권 WTS의 Open API 설정 화면에서 허용 IP 목록에 추가합니다.

대략적인 흐름:

1. 토스증권 WTS에 로그인합니다.
2. 설정 - Open API 메뉴로 이동합니다.
3. 허용 IP 관리 영역을 찾습니다.
4. 위에서 확인한 공인 IP를 추가합니다.

### 4. MCP 클라이언트에 등록

MCP 클라이언트의 설정 파일 또는 MCP Servers 설정 화면에 아래 내용을 추가합니다.

```json
{
  "mcpServers": {
    "tossinvest": {
      "command": "npx",
      "args": ["tossinvest-mcp"],
      "env": {
        "TOSSINVEST_API_KEY": "발급받은-API-Key",
        "TOSSINVEST_SECRET_KEY": "발급받은-Secret-Key"
      }
    }
  }
}
```

설정 후 MCP 클라이언트를 완전히 종료했다가 다시 실행하세요.

처음 실행할 때 npm이 `tossinvest-mcp` 패키지를 자동으로 내려받습니다.

### 5. 계좌번호 확인

처음에는 `TOSSINVEST_ACCOUNT`를 넣지 않아도 됩니다. 이 프로그램은 기본값으로 `accountSeq` 1번 계좌를 사용합니다.

다만 계좌가 여러 개이거나 1번 계좌가 맞는지 확인하고 싶다면 계좌 목록을 조회하세요.

MCP 클라이언트에서 다음처럼 요청합니다.

```text
토스증권 계좌 목록을 조회해줘.
```

응답에서 `accountSeq` 값을 찾습니다. 다른 계좌를 기본 계좌로 쓰고 싶다면 설정에 아래 값을 추가하거나 바꾸면 됩니다.

```json
"TOSSINVEST_ACCOUNT": "1"
```

예를 들어 `accountSeq`가 `2`인 계좌를 쓰고 싶다면 이렇게 설정합니다.

```json
"TOSSINVEST_ACCOUNT": "2"
```

계좌번호를 명시한 전체 예시는 다음과 같습니다.

```json
{
  "mcpServers": {
    "tossinvest": {
      "command": "npx",
      "args": ["tossinvest-mcp"],
      "env": {
        "TOSSINVEST_API_KEY": "발급받은-API-Key",
        "TOSSINVEST_SECRET_KEY": "발급받은-Secret-Key",
        "TOSSINVEST_ACCOUNT": "1"
      }
    }
  }
}
```

`TOSSINVEST_ACCOUNT`를 설정하지 않으면 기본값 `1`을 사용합니다. 설정하면 보유 주식, 주문 목록, 매수 가능 금액처럼 계좌가 필요한 기능에서 해당 계좌를 기본으로 사용합니다.

### 6. 조회 기능 테스트

MCP 클라이언트에서 아래처럼 요청해 봅니다.

```text
삼성전자 현재가를 조회해줘.
```

```text
내 토스증권 보유 주식을 보여줘.
```

```text
AAPL 최근 체결 내역 10개를 조회해줘.
```

```text
대기 중인 주문 목록을 보여줘.
```

## 거래 기능 켜기

다시 한 번 확인하세요. 토스증권 Open API에는 샌드박스가 없습니다. 거래 기능을 켜면 실제 주문이 나갈 수 있습니다.

거래 기능을 사용하려면 MCP 설정의 `env`에 아래 값을 추가합니다.

```json
"TOSSINVEST_ENABLE_TRADING": "true"
```

전체 예시:

```json
{
  "mcpServers": {
    "tossinvest": {
      "command": "npx",
      "args": ["tossinvest-mcp"],
      "env": {
        "TOSSINVEST_API_KEY": "발급받은-API-Key",
        "TOSSINVEST_SECRET_KEY": "발급받은-Secret-Key",
        "TOSSINVEST_ACCOUNT": "1",
        "TOSSINVEST_ENABLE_TRADING": "true"
      }
    }
  }
}
```

거래 기능을 켜도 주문 도구는 추가 확인값이 없으면 실행되지 않습니다. 주문 생성, 정정, 취소 도구는 요청 입력에 `confirmOrderAction: true`가 있어야 토스증권 API를 호출합니다.

### `confirmOrderAction`을 true로 넣는 방법

`confirmOrderAction`은 MCP 설정에 넣는 환경변수가 아닙니다. 주문 생성, 정정, 취소 도구를 호출할 때마다 들어가는 주문 요청 입력값입니다.

예를 들어 주문 생성 도구의 실제 입력은 이런 형태입니다.

```json
{
  "confirmOrderAction": true,
  "symbol": "005930",
  "side": "BUY",
  "orderType": "LIMIT",
  "quantity": "1",
  "price": "70000"
}
```

MCP 클라이언트에서 자연어로 요청할 때는 아래처럼 명확히 말하는 것이 좋습니다.

```text
토스증권에서 삼성전자 1주를 70000원 지정가로 매수 주문해줘.
실제 주문 실행을 확인하며 confirmOrderAction 값을 true로 넣어줘.
```

정정이나 취소도 마찬가지입니다.

```text
이 주문을 71000원으로 정정해줘.
실제 주문 정정을 확인하며 confirmOrderAction 값을 true로 넣어줘.
```

```text
이 주문을 취소해줘.
실제 주문 취소를 확인하며 confirmOrderAction 값을 true로 넣어줘.
```

클라이언트에 따라 주문 도구 실행 전에 승인 버튼이나 확인 창을 보여줄 수 있습니다. 그 경우에도 `confirmOrderAction: true`가 주문 tool 입력에 포함되어야 합니다.

### 확인값 없이 주문 실행하기 (자동화)

> 참고: 이전 버전의 `TOSSINVEST_YOLO_TRADING` 옵션은 제거되었습니다. 확인값을 끄더라도 나머지 가드레일은 그대로 적용됩니다.

자동화 환경처럼 매번 `confirmOrderAction: true`를 넣기 어렵다면 확인 요구만 끌 수 있습니다.

```json
"TOSSINVEST_REQUIRE_ORDER_CONFIRMATION": "false"
```

이 값을 끄면 `confirmOrderAction` 없이도 주문을 보낼 수 있지만, 주문 한도·매도/시장가 차단·종목 허용목록·일일 한도 등 켜져 있는 다른 가드레일은 계속 적용됩니다. 확인값을 끄기 전에 금액/일일 한도를 함께 설정해 두는 것을 강력히 권장합니다.

## 거래 가드레일

주문이 토스증권 API에 도달하기 전에 서버가 정책을 강제합니다. 모든 옵션은 개별적으로 켤 수 있으며 기본값은 보수적입니다.

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `TOSSINVEST_REQUIRE_ORDER_CONFIRMATION` | `true` | 생성/정정/취소에 `confirmOrderAction: true`를 요구합니다 |
| `TOSSINVEST_MAX_ORDER_AMOUNT_KRW` | 없음 | 단일 주문 한도(원). 추정 금액이 초과하면 차단 |
| `TOSSINVEST_MAX_ORDER_AMOUNT_USD` | 없음 | 단일 주문 한도(달러). 통화 변환은 하지 않습니다 |
| `TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_KRW` | 없음 | 이 MCP로 보낸 당일(KST) 주문 누적 금액 한도(원) |
| `TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_USD` | 없음 | 이 MCP로 보낸 당일(KST) 주문 누적 금액 한도(달러) |
| `TOSSINVEST_DAILY_MAX_ORDER_COUNT` | 없음 | 이 MCP로 보낸 당일(KST) 주문 건수 한도 |
| `TOSSINVEST_ALLOWED_SYMBOLS` | 없음 | 콤마로 구분한 종목 허용목록 (예: `005930,AAPL,VOO`) |
| `TOSSINVEST_ALLOW_SELL_ORDERS` | `false` | 매도 주문 생성 허용 여부. 취소에는 영향 없음 |
| `TOSSINVEST_ALLOW_MARKET_ORDERS` | `false` | 시장가 주문 허용 여부. 끄면 모든 `MARKET` 주문 차단 |
| `TOSSINVEST_MARKET_ORDER_BUFFER_PCT` | `5` | 시장가 매수 추정에 더하는 버퍼(%) |
| `TOSSINVEST_LOCK_ACCOUNT` | `true` | 입력 `accountSeq`가 `TOSSINVEST_ACCOUNT`와 다르면 차단 |
| `TOSSINVEST_GUARD_STATE_PATH` | OS 데이터 폴더 | 일일 한도 추적용 가드 상태 파일 경로 |

참고 사항:

- **통화별 한도**: KRW 한도만 설정하면 USD 주문에는 단일/일일 금액 한도가 적용되지 않습니다(그 반대도 마찬가지). 두 통화를 모두 거래한다면 양쪽 한도를 설정하세요.
- **일일 한도 범위**: 이 MCP를 통해 성공한 주문만 가드 상태 파일에 기록·집계합니다. 토스앱 등 계좌의 다른 활동은 포함하지 않습니다(단일 세션·단일 MCP 전제).
- **일일 한도 집계 방식**: 생성과 정정 주문이 당일 건수/금액에 집계됩니다(정정은 새 주문 1건으로 카운트하고, 대체된 원주문은 체결된 금액만 반영). 취소는 한도에 포함되지 않으며 항상 허용됩니다(리스크 축소 경로를 막지 않기 위함). 한도 검사 시 당일 미체결 주문은 토스 API로 현재 상태를 조회해 `체결금액 + 미체결 잔량`으로 매번 재계산하고, 체결·취소·거부·정정완료된 주문은 실제 체결금액만 확정 반영합니다. 미체결 주문 조회에 실패하면 검증 불가로 간주해 신규 주문을 차단합니다.
- **추정 불가 시 차단**: 가격·호가·통화를 확정할 수 없거나 상태 파일을 읽을 수 없으면 안전을 위해 주문을 차단합니다.
- **clientOrderId**: 입력에 없으면 `tossinvest-mcp-YYYYMMDD-` 접두로 자동 생성합니다.

## 환경변수 설명

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `TOSSINVEST_API_KEY` | 예 | 토스증권 Open API 화면의 API Key |
| `TOSSINVEST_SECRET_KEY` | 예 | 토스증권 Open API 화면의 Secret Key |
| `TOSSINVEST_ACCOUNT` | 아니오 | 기본으로 사용할 토스증권 `accountSeq`. 미설정 시 `1` |
| `TOSSINVEST_BASE_URL` | 아니오 | 기본값은 `https://openapi.tossinvest.com` |
| `TOSSINVEST_ENABLE_TRADING` | 아니오 | `true`로 설정해야 주문 생성, 정정, 취소 도구가 등록됩니다 |

거래 가드레일 관련 환경변수는 위의 `거래 가드레일` 표를 참고하세요.

## 문제 해결

### `node` 명령을 찾을 수 없다고 나옵니다

Node.js가 설치되어 있지 않거나 PATH에 등록되지 않은 상태입니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 터미널을 새로 열고 다시 시도하세요.

### `허용되지 않은 IP 주소입니다.` 오류가 나옵니다

현재 컴퓨터의 공인 IP가 토스증권 Open API 허용 IP 목록에 등록되지 않은 상태입니다.

이 문서의 `설치방법 > 3. 허용 IP 등록` 단계를 다시 확인해 현재 공인 IP를 등록하세요. 집, 회사, 카페, VPN 등 네트워크가 바뀌면 공인 IP가 바뀔 수 있습니다.

### MCP 클라이언트에 도구가 보이지 않습니다

설정 JSON 문법이 올바른지 확인하고, MCP 클라이언트를 완전히 종료한 뒤 다시 실행하세요. `TOSSINVEST_API_KEY`와 `TOSSINVEST_SECRET_KEY`가 비어 있으면 서버가 시작되지 않습니다.

### 계좌 조회는 되는데 보유 주식 조회가 실패합니다

보유 주식, 주문, 매수 가능 금액 같은 계좌 관련 기능에는 `accountSeq`가 필요합니다. 이 프로그램은 기본값으로 `1`을 사용합니다. 계좌 목록 조회 결과에서 다른 `accountSeq`를 써야 한다면 `TOSSINVEST_ACCOUNT`를 그 값으로 바꾸고 다시 실행하세요.

### 주문 도구가 보이지 않습니다

정상입니다. 기본값으로는 주문 도구가 등록되지 않습니다. 실제 거래를 허용하려면 `TOSSINVEST_ENABLE_TRADING`을 `true`로 설정해야 합니다.

### `TOSSINVEST_ENABLE_TRADING`을 `true`로 설정했는데도 주문이 안 됩니다

주문 도구가 보이더라도 기본 설정에서는 주문 요청마다 `confirmOrderAction: true`가 필요합니다.

AI에게 주문을 요청할 때 아래처럼 확인값을 넣으라고 명시하세요.

```text
실제 주문 실행을 확인하며 confirmOrderAction 값을 true로 넣어줘.
```

자동화 환경처럼 매번 이 값을 넣기 어렵다면 `TOSSINVEST_REQUIRE_ORDER_CONFIRMATION=false`로 확인 요구만 끌 수 있습니다. 이때도 금액·일일·매도·시장가 등 켜져 있는 다른 가드레일은 계속 적용됩니다.

### 주문 정정 후 기존 orderId로 조회한 내용이 이상합니다

토스증권 주문 정정은 새 `orderId`를 반환합니다. 정정 응답의 새 `orderId`를 사용하세요.

## 개발자용

이 저장소를 직접 받아 개발하려면:

```bash
npm install
npm run typecheck
npm test
npm run build
```

실제 주문 없이 주문 도구 흐름을 mock 서버로 테스트하려면:

```bash
npm run smoke:trading:mock
```

## 면책조항

이 프로그램은 토스증권 Open API를 MCP에서 사용할 수 있게 연결해 주는 도구입니다. 투자 자문, 투자 권유, 매매 추천, 수익 보장 서비스를 제공하지 않습니다.

이 프로그램을 사용해 조회한 정보, AI가 생성한 답변, AI가 제안한 주문 내용은 부정확하거나 지연되거나 사용자의 의도와 다를 수 있습니다. 모든 투자 판단과 주문 실행 및 프로그램 사용의 최종 책임은 사용자에게 있습니다.

거래 기능을 켜고 주문 생성, 정정, 취소 도구를 사용하는 경우 실제 계좌에 실제 주문이 전송될 수 있습니다. 주문 전 종목, 가격, 수량, 주문 유형, 계좌를 반드시 직접 확인하세요.

현재 이 프로젝트는 개발중인 프로젝트로서, 이 프로젝트의 개발자와 배포자는 이 프로그램 사용으로 발생하는 투자 손실, 주문 실수, API 장애, 데이터 오류, 클라이언트 오작동, AI 응답 오류 등에 대해 책임지지 않습니다.

## 라이선스

MIT License

토스증권 Open API 공식 문서: https://developers.tossinvest.com/docs

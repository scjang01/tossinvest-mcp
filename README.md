# tossinvest-mcp

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
- 주문 기능을 켜도 `confirmOrderAction: true` 확인값이 없으면 주문 API를 호출하지 않습니다.
- 고급 옵션으로 `TOSSINVEST_YOLO_TRADING=true`를 켜면 `confirmOrderAction` 없이도 주문 API를 호출할 수 있습니다. 이 옵션은 실수 방지 장치를 줄이므로 권장하지 않습니다.


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

### 확인값 없이 주문 실행하기

일반적으로는 권장하지 않습니다. 하지만 자동화 환경처럼 매번 `confirmOrderAction: true`를 넣기 어렵다면 아래 값을 추가할 수 있습니다.

```json
"TOSSINVEST_YOLO_TRADING": "true"
```

이 옵션은 `TOSSINVEST_ENABLE_TRADING=true`가 켜져 있을 때만 의미가 있습니다. 둘 다 켜면 주문 생성, 정정, 취소 도구가 `confirmOrderAction` 없이도 토스증권 API를 호출할 수 있습니다.

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
        "TOSSINVEST_ENABLE_TRADING": "true",
        "TOSSINVEST_YOLO_TRADING": "true"
      }
    }
  }
}
```

이 설정은 실수로 주문이 나갈 가능성을 높입니다. 처음 설치하거나 일반 사용 중에는 켜지 않는 것을 권장합니다.

## 환경변수 설명

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `TOSSINVEST_API_KEY` | 예 | 토스증권 Open API 화면의 API Key |
| `TOSSINVEST_SECRET_KEY` | 예 | 토스증권 Open API 화면의 Secret Key |
| `TOSSINVEST_ACCOUNT` | 아니오 | 기본으로 사용할 토스증권 `accountSeq`. 미설정 시 `1` |
| `TOSSINVEST_BASE_URL` | 아니오 | 기본값은 `https://openapi.tossinvest.com` |
| `TOSSINVEST_ENABLE_TRADING` | 아니오 | `true`로 설정해야 주문 생성, 정정, 취소 도구가 등록됩니다 |
| `TOSSINVEST_YOLO_TRADING` | 아니오 | `true`로 설정하면 주문 도구에서 `confirmOrderAction` 없이도 API를 호출합니다. 권장하지 않습니다 |

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

자동화 환경처럼 매번 이 값을 넣기 어렵다면 `TOSSINVEST_YOLO_TRADING=true`를 사용할 수 있지만, 이 옵션은 실수로 주문이 나갈 위험을 높이므로 권장하지 않습니다.

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

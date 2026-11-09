import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TossClient } from "../toss/client.js";
import { dateSchema } from "../toss/schemas.js";
import { registrar, runTool } from "./common.js";
export function registerExtendedMarketTools(
  server: McpServer,
  client: TossClient,
): void {
  const register = registrar(server);
  register(
    "toss_list_stocks",
    {
      title: "마켓별 전체 종목 조회",
      description:
        "마켓별 전체 종목 조회. 마켓(거래소)별 종목 리스트를 조회합니다. 종목 유니버스 구성 용도이며, 토스증권에서 거래 가능한 종목만 제공합니다.\n`status`·`securityType`·`commonShare` 로 유니버스를 필터링할 수 있습니다.\n\n**정렬**: `symbol` 오름차순. 필터 조건에 해당하는 종목을 페이지네이션 없이 한 번에 반환합니다.\n\n**응답 규모**: 마켓당 최대 수천 건(예: NASDAQ 약 2,800건, gzip 응답 약 30KB). 일 배치로 갱신되는 저변동 데이터이므로 하루 1회 조회 후 로컬 캐싱을 권장합니다.\n\n**관련 API**: 여기서 얻은 `symbol` 로 [`GET /api/v1/stocks`](#operation/getStocks)(다건 상세 조회)를 호출해 종목명·통화·상장상태 등 상세 정보를 채울 수 있습니다.\n\n**Rate Limits Group**: `STOCK_ALL`\n",
      inputSchema: {
        market: z.enum([
          "KOSPI",
          "KOSDAQ",
          "NYSE",
          "NASDAQ",
          "AMEX",
          "KR_ETC",
          "US_ETC",
        ]),
        status: z.enum(["SCHEDULED", "ACTIVE", "DELISTED"]).optional(),
        securityType: z
          .enum([
            "STOCK",
            "FOREIGN_STOCK",
            "DEPOSITARY_RECEIPT",
            "INFRASTRUCTURE_FUND",
            "REIT",
            "ETF",
            "FOREIGN_ETF",
            "ETN",
            "STOCK_WARRANTS",
          ])
          .optional(),
        commonShare: z.boolean().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/stocks/all`,
          query: {
            market: input.market,
            status: input.status,
            securityType: input.securityType,
            commonShare: input.commonShare,
          },
        });
      }),
  );
  register(
    "toss_get_stock_investor_trading",
    {
      title: "투자자별 매매동향 조회",
      description:
        "투자자별 매매동향 조회. 국내(KR) 종목의 투자자별 매매동향을 일별 거래량 시계열로 조회합니다. 개인·외국인·기관·기타법인\n4개 투자자 분류의 매수·매도·순매수 거래량을 최신순으로 제공하며, 기관은 7개 세부 분류(`breakdown`)를\n함께 제공합니다. 외국인 보유 현황(`foreignerHolding`)과 CFD 잔고(`cfd`)도 일자별로 포함합니다.\n\n- 국내(KR) 종목만 지원합니다. 다른 시장의 종목은 400 `unsupported-market` 으로 응답합니다.\n- 거래량은 KRX·NXT 통합 기준이며, 모든 수량은 주식 수(주) 정수입니다. 순매수(`netBuyVolume`)는\n  매수 − 매도로 계산되며 음수면 순매도입니다. 거래대금(금액) 축은 제공하지 않습니다.\n- `foreigner` 는 등록외국인 기준입니다. 시장 지표의 투자자별 매매대금\n  (`GET /api/v1/market-indicators/{symbol}/investor-trading`, 등록·미등록 합계)과 기준이 다릅니다.\n- 당일 기록은 장중 잠정치로 제공합니다. 잠정치가 제공되지 않는 `individual`(개인)·\n  `institution.breakdown`(기관 세부)·`otherCorporation`(기타법인)·`foreignerHolding`(외국인 보유)·\n  `cfd`(CFD 잔고)는 null 이며, `updatedAt` 으로 마지막 갱신 시각을 확인할 수 있습니다.\n- 다음 페이지는 응답의 `nextUntil` 값을 `until` 파라미터로 전달해 조회합니다.\n\n**데이터 적시성**: 하나의 일자 기록은 시간에 걸쳐 완성됩니다. 투자자별 매매동향 확정치와\n외국인 보유(`foreignerHolding`)는 해당 일자 저녁에 반영됩니다. CFD 잔고(`cfd`)는 다음 영업일 새벽(T+1)에\n반영되며, 외국인 보유는 다음 영업일 오전에 확정치로 한 번 더 갱신될 수 있습니다.\n`updatedAt` 은 이 모든 반영을 포함한 기록 전체의 마지막 갱신 시각입니다.\n\n**Rate Limits Group**: `STOCK_TRADING_TREND`\n",
      inputSchema: {
        symbol: z.string().min(1).regex(new RegExp("^[A-Za-z0-9.\\-]+$")),
        count: z.number().int().min(1).max(100).optional(),
        until: dateSchema.optional(),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/stocks/${encodeURIComponent(input.symbol)}/investor-trading`,
          query: { count: input.count, until: input.until },
        });
      }),
  );
  register(
    "toss_get_stock_program_trades",
    {
      title: "프로그램매매 동향 조회",
      description:
        "프로그램매매 동향 조회. 국내(KR) 종목의 프로그램매매 동향을 일별 거래량 시계열로 조회합니다. 차익거래(`arbitrage`)·\n비차익거래(`nonArbitrage`) 각각의 매수·매도·순매수 거래량을 최신순으로 제공합니다.\n\n- 국내(KR) 종목만 지원합니다. 다른 시장의 종목은 400 `unsupported-market` 으로 응답합니다.\n- KRX 시장 거래만 집계하며 NXT 거래는 포함하지 않습니다. 모든 수량은 주식 수(주) 정수입니다.\n  순매수(`netBuyVolume`)는 매수 − 매도로 계산되며 음수면 순매도입니다. 거래대금(금액) 축은 제공하지 않습니다.\n- 다음 페이지는 응답의 `nextUntil` 값을 `until` 파라미터로 전달해 조회합니다.\n\n**데이터 적시성**: 당일 기록도 제공되며, 장 종료 전까지 갱신될 수 있습니다.\n\n**Rate Limits Group**: `STOCK_TRADING_TREND`\n",
      inputSchema: {
        symbol: z.string().min(1).regex(new RegExp("^[A-Za-z0-9.\\-]+$")),
        count: z.number().int().min(1).max(100).optional(),
        until: dateSchema.optional(),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/stocks/${encodeURIComponent(input.symbol)}/program-trades`,
          query: { count: input.count, until: input.until },
        });
      }),
  );
  register(
    "toss_get_stock_short_selling",
    {
      title: "공매도 동향 조회",
      description:
        "공매도 동향 조회. 국내(KR) 종목의 공매도 동향을 일별 시계열로 조회합니다. 공매도 거래량·거래대금과 함께\n해당 일자 전체 거래량·거래대금 대비 공매도 비중을 최신순으로 제공합니다.\n\n- 국내(KR) 종목만 지원합니다. 다른 시장의 종목은 400 `unsupported-market` 으로 응답합니다.\n- 모든 금액은 원화(KRW)이며, 별도의 통화 필드는 제공하지 않습니다.\n- 비중(`shortSellingVolumeRate`·`shortSellingAmountRate`)의 분모는 정규장 외 세션\n  (장전·장후 시간외종가, 애프터마켓)을 포함한 해당 일자 누적 거래량·거래대금입니다.\n  분모 데이터가 없는 날짜는 비중이 null, 분모가 0 이면 `0` 입니다.\n- 다음 페이지는 응답의 `nextUntil` 값을 `until` 파라미터로 전달해 조회합니다.\n\n**데이터 적시성**: 일별 확정치는 해당 일자 저녁에 반영됩니다.\n\n**Rate Limits Group**: `STOCK_TRADING_TREND`\n",
      inputSchema: {
        symbol: z.string().min(1).regex(new RegExp("^[A-Za-z0-9.\\-]+$")),
        count: z.number().int().min(1).max(100).optional(),
        until: dateSchema.optional(),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/stocks/${encodeURIComponent(input.symbol)}/short-selling`,
          query: { count: input.count, until: input.until },
        });
      }),
  );
  register(
    "toss_get_stock_credit_trades",
    {
      title: "신용거래 동향 조회",
      description:
        "신용거래 동향 조회. 국내(KR) 종목의 신용거래 동향을 일별 시계열로 조회합니다. 신용융자(`marginLoan`)·신용대주(`stockLoan`)\n각각의 신규·상환·잔고 수량과 잔고 비율·공여율을 최신순으로 제공합니다.\n\n- 국내(KR) 종목만 지원합니다. 다른 시장의 종목은 400 `unsupported-market` 으로 응답합니다.\n- 자기신용과 유통금융을 합산한 값이며, 모든 수량은 주식 수(주) 정수입니다.\n- `stockLoan`(신용대주)은 주식을 빌려 매도하는 개인 신용거래입니다. 기관 간 대차거래\n  (`GET /api/v1/stocks/{symbol}/securities-lending`)와는 다른 데이터입니다.\n- 해당 일자에 융자·대주 중 한쪽 데이터만 있으면 없는 쪽 객체는 null 입니다.\n- 다음 페이지는 응답의 `nextUntil` 값을 `until` 파라미터로 전달해 조회합니다.\n\n**데이터 적시성**: 다음 영업일 새벽에 반영됩니다(T+1). 최신 기록은 전 영업일입니다.\n\n**Rate Limits Group**: `STOCK_TRADING_TREND`\n",
      inputSchema: {
        symbol: z.string().min(1).regex(new RegExp("^[A-Za-z0-9.\\-]+$")),
        count: z.number().int().min(1).max(100).optional(),
        until: dateSchema.optional(),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/stocks/${encodeURIComponent(input.symbol)}/credit-trades`,
          query: { count: input.count, until: input.until },
        });
      }),
  );
  register(
    "toss_get_stock_securities_lending",
    {
      title: "대차거래 동향 조회",
      description:
        "대차거래 동향 조회. 국내(KR) 종목의 대차거래 동향을 일별 시계열로 조회합니다. 대차 체결·상환·잔고 수량과\n잔고 금액을 최신순으로 제공합니다.\n\n- 국내(KR) 종목만 지원합니다. 다른 시장의 종목은 400 `unsupported-market` 으로 응답합니다.\n- 모든 금액은 원화(KRW)이며, 별도의 통화 필드는 제공하지 않습니다.\n- 대차거래는 기관 투자자 간 주식 대여·차입 거래입니다. 주식을 빌려 매도하는 개인 신용거래인\n  신용대주(`GET /api/v1/stocks/{symbol}/credit-trades` 의 `stockLoan`)와는 다른 데이터입니다.\n- 다음 페이지는 응답의 `nextUntil` 값을 `until` 파라미터로 전달해 조회합니다.\n\n**데이터 적시성**: 일별 확정치는 해당 일자 저녁에 반영됩니다.\n\n**Rate Limits Group**: `STOCK_TRADING_TREND`\n",
      inputSchema: {
        symbol: z.string().min(1).regex(new RegExp("^[A-Za-z0-9.\\-]+$")),
        count: z.number().int().min(1).max(100).optional(),
        until: dateSchema.optional(),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/stocks/${encodeURIComponent(input.symbol)}/securities-lending`,
          query: { count: input.count, until: input.until },
        });
      }),
  );
  register(
    "toss_get_rankings",
    {
      title: "주식 랭킹 조회",
      description:
        "주식 랭킹 조회. 지정한 시장(`marketCountry`) · 기간(`duration`) · 기준(`type`)의 주식 랭킹을 조회합니다. 상위 100위까지 제공합니다.\n\n- `TOP_GAINERS` / `TOP_LOSERS` 는 `duration=realtime` 을 지원하지 않습니다 (400 `unsupported-ranking-duration`).\n- `tradingVolume` / `tradingAmount` 의 집계 기준은 `type` 이 결정합니다 — `TOSS_SECURITIES_*` 는 토스증권 체결 기준, 그 외(`MARKET_*` / `TOP_*`)는 시장 전체 기준.\n- `price.basePrice` 는 `TOP_GAINERS` / `TOP_LOSERS` 만 `duration` 시작 시점 기준가이며, 나머지 타입은 `duration` 과 무관하게 항상 전일 기준가입니다. `price.changeRate` 도 같은 의미를 따릅니다 (기간 등락률 vs 전일 대비 등락률).\n- 응답 항목 수는 `count` 보다 적을 수 있습니다 (시세 조회에 실패한 종목은 제외).\n- 랭킹이 집계되지 않은 조합은 에러가 아닌 빈 `rankings` 배열로 응답하며, 이때 `rankedAt` 은 null 입니다.\n\n**Rate Limits Group**: `RANKING`\n",
      inputSchema: {
        type: z.enum([
          "MARKET_TRADING_AMOUNT",
          "MARKET_TRADING_VOLUME",
          "TOP_GAINERS",
          "TOP_LOSERS",
          "TOSS_SECURITIES_TRADING_AMOUNT",
          "TOSS_SECURITIES_TRADING_VOLUME",
        ]),
        marketCountry: z.enum(["KR", "US"]),
        duration: z.enum(["realtime", "1d", "1w", "1mo", "3mo", "6mo", "1y"]),
        excludeInvestmentCaution: z.boolean().optional(),
        count: z.number().int().min(1).max(100).optional(),
      },
    },
    (input) =>
      runTool(async () => {
        if (
          ["TOP_GAINERS", "TOP_LOSERS"].includes(input.type) &&
          input.duration === "realtime"
        )
          throw new Error("TOP_GAINERS/TOP_LOSERS do not support realtime.");
        return client.request({
          path: `/api/v1/rankings`,
          query: {
            type: input.type,
            marketCountry: input.marketCountry,
            duration: input.duration,
            excludeInvestmentCaution: input.excludeInvestmentCaution,
            count: input.count,
          },
        });
      }),
  );
  register(
    "toss_get_investor_trading_rankings",
    {
      title: "투자자별 순매수·순매도 랭킹 조회",
      description:
        "국내 주식·ETF의 외국인·기관·개인별 순매수·순매도 랭킹을 원화 거래액 기준으로 조회합니다. count는 각 투자자의 순매수·순매도 목록에 각각 적용되며 기본값과 최댓값은 100입니다. 최근 영업일 데이터만 제공하며 과거 날짜 조회는 지원하지 않습니다. 투자자별 기준 시각 rankedAt을 확인하세요. 개인 데이터는 정규장 종료 전에는 직전 영업일 기준일 수 있습니다. 시세는 포함하지 않으므로 필요하면 반환된 symbol로 toss_get_prices를 호출하세요.",
      inputSchema: {
        count: z.number().int().min(1).max(100).optional(),
      },
    },
    ({ count }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/rankings/investor-trading",
          query: { count },
        }),
      ),
  );
  register(
    "toss_get_market_indicator_prices",
    {
      title: "시장 지표 현재가 조회",
      description:
        "시장 지표 현재가 조회. 시장 지표(국내 지수·국채)의 현재가를 조회합니다. 최대 200건 까지 다건 조회를 지원하며 콤마(`,`)로 구분합니다.\n\n지원 심볼은 그룹 상단 **Market Indicators** 설명의 심볼 카탈로그(8종)를 따르며, 카탈로그에 없는 심볼은\n400 `unsupported-symbol` 로 응답합니다.\n\n**Rate Limits Group**: `MARKET_INDICATOR`\n",
      inputSchema: {
        symbols: z
          .string()
          .regex(/^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/)
          .refine((v) => v.split(",").length <= 200),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/market-indicators/prices`,
          query: { symbols: input.symbols },
        });
      }),
  );
  register(
    "toss_get_market_indicator_candles",
    {
      title: "시장 지표 캔들 차트 조회",
      description:
        "시장 지표 캔들 차트 조회. 시장 지표(국내 지수·국채)의 캔들(OHLCV) 차트 데이터를 조회합니다. 최대 200개 봉을 반환합니다.\n\n봉은 최신순(`timestamp` 내림차순)으로 정렬됩니다 — 배열의 첫 요소가 가장 최근 봉, 마지막 요소가 가장 오래된 봉입니다.\n\n지원 심볼은 그룹 상단 **Market Indicators** 설명의 심볼 카탈로그(8종)와 동일하며, 카탈로그에 없는 심볼은\n400 `unsupported-symbol` 로 응답합니다. 개별 종목의 캔들은 `GET /api/v1/candles` 를 사용하세요.\n\n분봉(`1m`)은 지수(`KOSPI`·`KOSDAQ`)만 지원합니다. 국채(`KR_BOND_*`)는 일봉(`1d`)만 지원하며, 분봉 요청 시\n400 `invalid-request` 로 응답합니다.\n\n**Rate Limits Group**: `MARKET_INDICATOR_CHART`\n",
      inputSchema: {
        symbol: z.string().min(1).regex(new RegExp("^[A-Za-z0-9_]+$")),
        interval: z.enum(["1m", "1d"]),
        count: z.number().int().min(1).max(200).optional(),
        before: z.string().datetime({ offset: true }).optional(),
      },
    },
    (input) =>
      runTool(async () => {
        if (input.symbol.startsWith("KR_BOND_") && input.interval === "1m")
          throw new Error("Bond indicators support 1d only.");
        return client.request({
          path: `/api/v1/market-indicators/${encodeURIComponent(input.symbol)}/candles`,
          query: {
            interval: input.interval,
            count: input.count,
            before: input.before,
          },
        });
      }),
  );
  register(
    "toss_get_market_indicator_investor_trading",
    {
      title: "투자자별 매매대금 조회",
      description:
        "투자자별 매매대금 조회. KRX 시장(코스피·코스닥)의 투자자별 매매대금을 조회합니다. 개인·외국인·기관·기타법인 4개 투자자 분류의\n매수·매도 거래대금을 집계 단위(`interval`)별 기록으로 최신순 제공하며, 기관은 7개 세부 분류(`breakdown`)를\n함께 제공합니다.\n\n- `KOSPI` / `KOSDAQ` 만 지원합니다. 그 외 심볼은 400 `unsupported-symbol` 로 응답합니다.\n- 모든 거래대금은 원화(KRW) 정수이며, 별도의 통화 필드는 제공하지 않습니다.\n- 4개 분류(개인·외국인·기관·기타법인)의 매수 합계와 매도 합계는 시장 전체 기준으로 서로 같습니다.\n- `foreigner` 는 외국인 전체 합계(등록·미등록 외국인 포함)이며, `institution` 의 `buyAmount`/`sellAmount` 는\n  `breakdown` 7개 항목의 합과 일치합니다.\n- 당일 기록은 장 종료 전까지 갱신될 수 있는 잠정치입니다. `updatedAt` 으로 마지막 갱신 시각을 확인하세요.\n- 다음 페이지는 응답의 `nextUntil` 값을 `until` 파라미터로 전달해 조회합니다.\n\n**Rate Limits Group**: `MARKET_INDICATOR`\n",
      inputSchema: {
        symbol: z.enum(["KOSPI", "KOSDAQ"]),
        interval: z.enum(["1d", "1w", "1mo", "1y"]),
        count: z.number().int().min(1).max(100).optional(),
        until: dateSchema.optional(),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/market-indicators/${encodeURIComponent(input.symbol)}/investor-trading`,
          query: {
            interval: input.interval,
            count: input.count,
            until: input.until,
          },
        });
      }),
  );
  register(
    "toss_list_sectors",
    {
      title: "섹터 목록 조회",
      description:
        "섹터 목록 조회. 토스증권 섹터 분류 전체를 계층 정보와 함께 한 번에 반환합니다.\n\n- 섹터는 토스증권 자체 산업 분류로, 한 종목이 여러 섹터에 속할 수 있습니다.\n- `depth` 0 = 대분류, 1 = 중분류, 2 = 소분류이며, `parentSectorId` 로 상위 섹터를 따라가면 전체 계층을 만들 수 있습니다.\n- 정렬은 `depth` 오름차순, 같은 depth 안에서는 `sectorId` 오름차순(숫자 기준)입니다.\n- 자주 바뀌지 않으므로 하루 한 번만 조회해 저장해 두고 쓰는 것을 권장합니다. 다른 섹터 API 의 `sectorId` 입력값은 이 목록에서 확인합니다.\n\n**Rate Limits Group**: `SECTOR`\n",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        return client.request({ path: `/api/v1/sectors`, query: {} });
      }),
  );
  register(
    "toss_get_sector_rankings",
    {
      title: "섹터 랭킹 조회",
      description:
        "섹터 랭킹 조회. 지정한 시장(`marketCountry`) · 기간(`duration`) · 기준(`type`)의 섹터 랭킹을 조회합니다. 상위 100위까지 한 번에 제공합니다.\n\n- 대상은 대분류(`depth` 0)와 중분류(`depth` 1) 섹터이며, 소분류(`depth` 2)는 포함되지 않습니다.\n- 소속 종목이 너무 적거나 해당 시장·기간의 데이터가 없는 섹터는 랭킹에 나타나지 않습니다.\n- `TOP_GAINERS` 는 `changeRate`, `MARKET_TRADING_AMOUNT` 는 `tradingAmount` 가 랭킹 기준값입니다. `tradingAmount` · `marketCapitalization` 은 데이터가 없으면 null 이고, `changeRate` 는 항상 값이 있습니다.\n- 금액은 US 도 원화(KRW) 환산값이며 통화는 각 항목의 `currency` 로 표기됩니다.\n- 응답 항목 수는 100건보다 적을 수 있고, 데이터가 없는 조합은 에러가 아닌 빈 `rankings` 배열로 응답합니다.\n\n**Rate Limits Group**: `SECTOR_RANKING`\n",
      inputSchema: {
        type: z.enum(["TOP_GAINERS", "MARKET_TRADING_AMOUNT"]),
        marketCountry: z.enum(["KR", "US"]),
        duration: z.enum(["1d", "1w", "1mo", "3mo", "6mo", "1y"]),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/sectors/rankings`,
          query: {
            type: input.type,
            marketCountry: input.marketCountry,
            duration: input.duration,
          },
        });
      }),
  );
  register(
    "toss_get_sector",
    {
      title: "섹터 상세 조회",
      description:
        "섹터 상세 조회. 섹터의 기본 정보(이름 · 계층 · 한 줄 요약)와 지정한 시장(`marketCountry`) 기준 기간별 등락률을 조회합니다.\n\n- 기본 정보는 시장과 무관하며, `performance.changeRates` 만 `marketCountry` 기준입니다.\n- `changeRates` 는 `duration` 순서(`1d` → `1y`)로 항상 6건이며, 데이터가 없는 기간은 `changeRate` 가 null 입니다 (예: 해당 시장에 구성 종목이 없는 섹터).\n- 등락률은 소수비율입니다.\n- 목록(`GET /api/v1/sectors`)에 없는 `sectorId` 는 404 `sector-not-found` 로 응답합니다.\n\n**Rate Limits Group**: `SECTOR`\n",
      inputSchema: {
        sectorId: z.string().min(1).regex(new RegExp("^[A-Za-z0-9_-]{1,40}$")),
        marketCountry: z.enum(["KR", "US"]),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/sectors/${encodeURIComponent(input.sectorId)}`,
          query: { marketCountry: input.marketCountry },
        });
      }),
  );
  register(
    "toss_get_sector_stocks",
    {
      title: "섹터 구성 주식 조회",
      description:
        "섹터 구성 주식 조회. 섹터(하위 섹터 포함)에 속한 보통주 전체를 지정한 시장(`marketCountry`) 기준으로 시가총액 내림차순 반환합니다.\n\n- `volume` · `tradingAmount` 는 당일 누적값이며, 시세가 없는 종목은 null 입니다.\n- 금액은 US 종목도 원화(KRW) 환산값이며 통화는 각 항목의 `currency` 로 표기됩니다.\n- 상장폐지된 종목은 제외됩니다.\n- 목록(`GET /api/v1/sectors`)에 없는 `sectorId` 는 404 `sector-not-found` 로 응답합니다.\n\n**Rate Limits Group**: `SECTOR`\n",
      inputSchema: {
        sectorId: z.string().min(1).regex(new RegExp("^[A-Za-z0-9_-]{1,40}$")),
        marketCountry: z.enum(["KR", "US"]),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/sectors/${encodeURIComponent(input.sectorId)}/stocks`,
          query: { marketCountry: input.marketCountry },
        });
      }),
  );
  register(
    "toss_get_sector_etfs",
    {
      title: "섹터 관련 ETF 조회",
      description:
        "섹터 관련 ETF 조회. 이 섹터로 분류된 ETF 전체를 지정한 시장(`marketCountry`) 기준으로 반환합니다 (하위 섹터 미포함).\n\n- 직전 분기 시가총액이 큰 순서이며, 시가총액 정보가 없는 ETF 는 뒤에 옵니다.\n- 심볼과 이름만 제공합니다. 시세는 `GET /api/v1/prices`, 종목 기본 정보는 `GET /api/v1/stocks` 를 사용하세요.\n- 상장폐지된 ETF 는 제외됩니다.\n- 목록(`GET /api/v1/sectors`)에 없는 `sectorId` 는 404 `sector-not-found` 로 응답합니다.\n\n**Rate Limits Group**: `SECTOR`\n",
      inputSchema: {
        sectorId: z.string().min(1).regex(new RegExp("^[A-Za-z0-9_-]{1,40}$")),
        marketCountry: z.enum(["KR", "US"]),
      },
    },
    (input) =>
      runTool(async () => {
        return client.request({
          path: `/api/v1/sectors/${encodeURIComponent(input.sectorId)}/etfs`,
          query: { marketCountry: input.marketCountry },
        });
      }),
  );
}

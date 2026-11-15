import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TossClient } from "../toss/client.js";
import { dateSchema, dateTimeSchema } from "../toss/schemas.js";
import { registrar, runTool } from "./common.js";

const DEFAULT_RANKINGS_COUNT = 20;
const DEFAULT_INVESTOR_RANKINGS_COUNT = 10;
const DEFAULT_INDICATOR_CANDLES_COUNT = 20;

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
        "거래소별 토스 거래 가능 종목 전체를 심볼순으로 반환합니다. 페이지 없음; status·securityType·commonShare로 좁히세요. 개별 종목 상세는 toss_get_stocks.",
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
        symbolsOnly: z
          .boolean()
          .optional()
          .describe(
            "true이면 전체 결과를 심볼 문자열 배열로 반환합니다. 종목 정보도 필요하면 생략하세요.",
          ),
      },
    },
    (input) =>
      runTool(async () => {
        const response = await client.request<{ result: unknown }>({
          path: `/api/v1/stocks/all`,
          query: {
            market: input.market,
            status: input.status,
            securityType: input.securityType,
            commonShare: input.commonShare,
          },
        });
        if (!input.symbolsOnly) return response;

        if (!Array.isArray(response.result))
          throw new Error("Toss returned an invalid stock list.");
        const symbols = response.result.map((stock: unknown) => {
          if (
            !stock ||
            typeof stock !== "object" ||
            !("symbol" in stock) ||
            typeof stock.symbol !== "string" ||
            stock.symbol.length === 0
          )
            throw new Error("Toss returned a stock without a valid symbol.");
          return stock.symbol;
        });
        return { ...response, result: symbols };
      }),
  );
  register(
    "toss_get_stock_investor_trading",
    {
      title: "투자자별 매매동향 조회",
      description:
        "국내 종목의 투자자별 일별 매수·매도·순매수 거래량(주). KRX·NXT 합산, 외국인은 등록 기준. 기관 세부·외국인 보유·CFD 포함. 장중 잠정치에서 미제공 항목은 null; updatedAt 확인. 다음 페이지: nextUntil → until.",
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
        "국내 종목의 차익·비차익 프로그램 일별 매수·매도·순매수 거래량(주). KRX만 집계하며 당일은 변동 가능. 다음 페이지: nextUntil → until.",
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
        "국내 종목의 일별 공매도 거래량·거래대금(KRW)·비중. 비중의 분모는 시간외 포함 당일 거래량·거래대금이며 미제공은 null. 다음 페이지: nextUntil → until.",
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
        "국내 종목의 신용융자·신용대주 일별 수량(주)과 비율. 기관 간 대차와 별개. 미제공 항목은 null, 최신 기록은 전 영업일. 다음 페이지: nextUntil → until.",
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
        "국내 종목의 기관 간 일별 대차 체결·상환·잔고(수량·KRW). 신용대주와 별개. 다음 페이지: nextUntil → until.",
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
      description: `국내·미국 주식의 시장·기간별 랭킹. count 기본 ${DEFAULT_RANKINGS_COUNT}, 최대 100; 첫 호출에 필요한 건수 지정. TOP_GAINERS/TOP_LOSERS는 realtime 불가. TOSS_SECURITIES_*는 토스 체결 기준. 급등락 기준가는 기간 시작가, 그 외는 전일 기준가. 데이터가 없으면 빈 목록.`,
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
            count: input.count ?? DEFAULT_RANKINGS_COUNT,
          },
        });
      }),
  );
  register(
    "toss_get_investor_trading_rankings",
    {
      title: "투자자별 순매수·순매도 랭킹 조회",
      description: `국내 주식·ETF의 외국인·기관·개인 순매수/순매도 랭킹(KRW). 최근 영업일만. count는 투자자·방향별 적용(기본 ${DEFAULT_INVESTOR_RANKINGS_COUNT}, 최대 100); 첫 호출에 필요한 건수 지정. 투자자별 rankedAt 확인; 장중 개인은 전 영업일일 수 있습니다. 시세 미포함.`,
      inputSchema: {
        count: z.number().int().min(1).max(100).optional(),
      },
    },
    ({ count }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/rankings/investor-trading",
          query: { count: count ?? DEFAULT_INVESTOR_RANKINGS_COUNT },
        }),
      ),
  );
  register(
    "toss_get_market_indicator_prices",
    {
      title: "시장 지표 현재가 조회",
      description:
        "국내 지수(KOSPI·KOSDAQ)와 한국 국채(KR_BOND_*) 현재가. 지수는 포인트, 국채는 수익률(%). symbols는 쉼표 구분, 최대 200개.",
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
      description: `국내 지수·국채 OHLCV, 최신순. 지수만 분봉 지원; 국채는 일봉만. count 기본 ${DEFAULT_INDICATOR_CANDLES_COUNT}, 최대 200; 첫 호출에 필요한 봉 수 지정. nextBefore를 시간대 포함 ISO 8601 값 그대로 before에 전달.`,
      inputSchema: {
        symbol: z.string().min(1).regex(new RegExp("^[A-Za-z0-9_]+$")),
        interval: z.enum(["1m", "1d"]),
        count: z.number().int().min(1).max(200).optional(),
        before: dateTimeSchema.optional(),
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
            count: input.count ?? DEFAULT_INDICATOR_CANDLES_COUNT,
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
        "코스피·코스닥 투자자별 매수·매도 거래대금(KRW). 등록·미등록 외국인 합산, 기관 세부 분류 포함. 당일 잠정치; updatedAt 확인. 다음 페이지: nextUntil → until.",
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
        "토스 섹터 분류 전체와 계층 정보(depth·parentSectorId)를 조회합니다. 다른 섹터 도구에서 반환된 sectorId를 사용하세요.",
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
        "시장·기간별 섹터 등락률 또는 거래대금 랭킹. 대·중분류만, 최대 100위. 미국 금액도 KRW 환산; 데이터가 없으면 빈 목록.",
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
        "섹터 상세·계층 및 선택한 시장의 기간별 등락률(소수비율). 미제공 기간은 null. sectorId는 toss_list_sectors에서 확인하세요.",
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
        "섹터와 하위 섹터의 보통주 전체를 선택한 시장 기준 시가총액순으로 조회합니다. 거래량·거래대금은 당일 누적, 미국 금액도 KRW 환산.",
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
        "해당 섹터의 ETF 심볼과 이름. 하위 섹터는 제외합니다. 시세는 toss_get_prices를 사용하세요.",
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

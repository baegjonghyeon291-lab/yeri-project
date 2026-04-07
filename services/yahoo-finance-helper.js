/**
 * yahoo-finance-helper.js
 * yahoo-finance2 라이브러리 기반 데이터 모듈
 *
 * 제공 기능:
 * - getYahooPrice(ticker)       — 현재가/등락/52주
 * - getYahooHistory(ticker)     — 90일 주가 이력
 * - getYahooTechnicals(ticker)  — RSI/EMA (로컬 계산)
 * - getYahooFundamentals(ticker)— PER/EPS/섹터
 * - getYahooNews(ticker)        — 최신 뉴스
 * - searchYahooTicker(query)    — 회사명 → ticker 검색
 */

let yf;
try {
    const YahooFinanceClass = require('yahoo-finance2').default;
    yf = new YahooFinanceClass({ suppressNotices: ['yahooSurvey'] });
} catch (e) {
    console.warn('[Yahoo] yahoo-finance2 로드 실패:', e.message);
    yf = null;
}

// ─────────────────────────────────────────────
// 내부 헬퍼: RSI 계산 (종가 배열 기반)
// ─────────────────────────────────────────────
function calcRSI(closes, period = 14) {
    if (!closes || closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
    }
    if (avgLoss === 0) return 100;
    return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

// EMA 계산
function calcEMA(closes, period) {
    if (!closes || closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return parseFloat(ema.toFixed(2));
}

// MACD 계산 (12, 26, 9)
function calcMACD(closes) {
    if (!closes || closes.length < 35) return null;
    const ema12 = [];
    const ema26 = [];
    const k12 = 2 / 13;
    const k26 = 2 / 27;
    let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    for (let i = 12; i < closes.length; i++) {
        e12 = (closes[i] - e12) * k12 + e12;
        ema12[i] = e12;
    }
    for (let i = 26; i < closes.length; i++) {
        e26 = (closes[i] - e26) * k26 + e26;
        ema26[i] = e26;
    }
    const macdLine = [];
    for (let i = 26; i < closes.length; i++) {
        macdLine.push(ema12[i] - ema26[i]);
    }
    const signalK = 2 / 10;
    let signal = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    for (let j = 9; j < macdLine.length; j++) {
        signal = (macdLine[j] - signal) * signalK + signal;
    }
    const macdFinal = macdLine[macdLine.length - 1];
    const hist = macdFinal - signal;
    return {
        macd: parseFloat(macdFinal).toFixed(4),
        signal: parseFloat(signal).toFixed(4),
        hist: parseFloat(hist).toFixed(4),
        trend: hist >= 0 ? '상승 모멘텀 ↑' : '하락 모멘텀 ↓'
    };
}

// ─────────────────────────────────────────────
// 현재가 데이터
// ─────────────────────────────────────────────
async function getYahooPrice(ticker) {
    if (!yf) return null;
    try {
        const quote = await yf.quote(ticker, {}, { validateResult: false });
        if (!quote?.regularMarketPrice) return null;
        return {
            current:    parseFloat(quote.regularMarketPrice),
            open:       quote.regularMarketOpen ?? null,
            high:       quote.regularMarketDayHigh ?? null,
            low:        quote.regularMarketDayLow ?? null,
            prevClose:  quote.regularMarketPreviousClose ?? null,
            change:     quote.regularMarketChange ?? null,
            changePct:  quote.regularMarketChangePercent ?? null,
            volume:     quote.regularMarketVolume ?? null,
            fifty2High: quote.fiftyTwoWeekHigh ?? null,
            fifty2Low:  quote.fiftyTwoWeekLow ?? null,
            source: 'Yahoo',
        };
    } catch (e) {
        console.warn(`[Yahoo/Price] ${ticker} 실패: ${e.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────
// 가격 이력 (90일)
// ─────────────────────────────────────────────
async function getYahooHistory(ticker) {
    if (!yf) return null;
    try {
        const endDate   = new Date();
        const startDate = new Date(Date.now() - 90 * 86400000);
        const result = await yf.historical(ticker, {
            period1: startDate.toISOString().slice(0, 10),
            period2: endDate.toISOString().slice(0, 10),
            interval: '1d',
        }, { validateResult: false });

        if (!result?.length) return null;
        const closes = result.map(r => r.close).filter(Boolean);
        const len = closes.length;
        const latest = closes[len - 1];
        const pct = (a, b) => (((b - a) / a) * 100).toFixed(2);

        return {
            latest,
            change1W:  pct(closes[Math.max(0, len - 6)], latest),
            change1M:  pct(closes[Math.max(0, len - 22)], latest),
            change3M:  pct(closes[0], latest),
            high52w:   Math.max(...closes).toFixed(2),
            low52w:    Math.min(...closes).toFixed(2),
            closes:    closes.slice(-30),
            source:    'Yahoo',
        };
    } catch (e) {
        console.warn(`[Yahoo/History] ${ticker} 실패: ${e.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────
// 기술 지표 (이력 기반 로컬 계산)
// ─────────────────────────────────────────────
async function getYahooTechnicals(ticker) {
    if (!yf) return null;
    try {
        const endDate   = new Date();
        const startDate = new Date(Date.now() - 200 * 86400000); // SMA200 위해 여유있게
        const result = await yf.historical(ticker, {
            period1: startDate.toISOString().slice(0, 10),
            period2: endDate.toISOString().slice(0, 10),
            interval: '1d',
        }, { validateResult: false });

        if (!result?.length) return null;
        const closes = result.map(r => r.close).filter(Boolean);

        const rsi    = calcRSI(closes);
        const ema20  = calcEMA(closes, 20);
        const ema50  = calcEMA(closes, 50);
        const sma200 = closes.length >= 200
            ? parseFloat((closes.slice(-200).reduce((a, b) => a + b, 0) / 200).toFixed(2))
            : null;

        return {
            rsi,
            rsiSignal: rsi ? (rsi < 30 ? '과매도' : rsi > 70 ? '과매수' : '중립') : 'N/A',
            macd:      calcMACD(closes),
            ema20:     ema20?.toString() ?? null,
            ema50:     ema50?.toString() ?? null,
            sma200:    sma200?.toString() ?? null,
            avgVolume: null,
            stoch:     null,
            source:    'Yahoo (calc)',
        };
    } catch (e) {
        console.warn(`[Yahoo/Tech] ${ticker} 실패: ${e.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────
// 펀더멘털 데이터
// ─────────────────────────────────────────────
async function getYahooFundamentals(ticker) {
    if (!yf) return null;
    try {
        const [quote, summary] = await Promise.allSettled([
            yf.quote(ticker, {}, { validateResult: false }),
            yf.quoteSummary(ticker, {
                modules: [
                    'defaultKeyStatistics',
                    'summaryProfile',
                    'financialData',
                    'incomeStatementHistory',
                    'calendarEvents',
                    'summaryDetail',
                ]
            }, { validateResult: false }),
        ]);

        const q  = quote.status === 'fulfilled' ? quote.value : null;
        const s  = summary.status === 'fulfilled' ? summary.value : null;
        const ks = s?.defaultKeyStatistics;
        const fd = s?.financialData;
        const sp = s?.summaryProfile;
        const sd = s?.summaryDetail;

        // 손익계산서 (연간 최신 2기 비교)
        const inc0 = s?.incomeStatementHistory?.incomeStatementHistory?.[0];
        const inc1 = s?.incomeStatementHistory?.incomeStatementHistory?.[1];

        const revenue     = inc0?.totalRevenue ?? fd?.totalRevenue?.raw ?? null;
        const prevRevenue = inc1?.totalRevenue ?? null;
        const netIncome   = inc0?.netIncome ?? null;
        const grossProfit = inc0?.grossProfit ?? null;
        const opIncome    = inc0?.totalOperatingExpenses != null && revenue != null
            ? revenue - (inc0.totalOperatingExpenses ?? 0) : null;
        // freeCashFlow: financialData에서 직접 추출 (숫자값, .raw 없음)
        const freeCashFlow = fd?.freeCashflow ?? null;

        // YoY 매출 성장률
        const revenueGrowthYoY = revenue && prevRevenue
            ? (((revenue - prevRevenue) / Math.abs(prevRevenue)) * 100).toFixed(1) + '%'
            : fd?.revenueGrowth ? (fd.revenueGrowth * 100).toFixed(1) + '%' : null;

        // 다음 실적 발표일
        const earningsDateRaw = s?.calendarEvents?.earnings?.earningsDate?.[0];
        const nextEarningsDate = earningsDateRaw
            ? (earningsDateRaw instanceof Date
                ? earningsDateRaw.toISOString().slice(0, 10)
                : typeof earningsDateRaw === 'number'
                    ? new Date(earningsDateRaw * 1000).toISOString().slice(0, 10)
                    : null)
            : null;

        const exDateRaw = s?.calendarEvents?.exDividendDate ?? sd?.exDividendDate;
        const exDividendDate = exDateRaw
            ? (exDateRaw instanceof Date 
                ? exDateRaw.toISOString().slice(0, 10) 
                : typeof exDateRaw === 'number'
                    ? new Date(exDateRaw * 1000).toISOString().slice(0, 10)
                    : null)
            : null;

        if (!q && !s) return null;

        return {
            companyName:      q?.longName || q?.shortName || ticker,
            sector:           sp?.sector || null,
            industry:         sp?.industry || null,
            mktCap:           q?.marketCap ?? null,
            beta:             ks?.beta?.toFixed(2) ?? null,
            peRatio:          q?.trailingPE?.toFixed(2) ?? null,
            forwardPE:        q?.forwardPE?.toFixed(2) ?? null,
            eps:              q?.epsTrailingTwelveMonths?.toFixed(2) ?? null,
            pbRatio:          ks?.priceToBook?.toFixed(2) ?? null,
            roe:              fd?.returnOnEquity ? (fd.returnOnEquity * 100).toFixed(1) + '%' : null,
            netMargin:        fd?.profitMargins ? (fd.profitMargins * 100).toFixed(1) + '%' : null,
            debtToEquity:     fd?.debtToEquity?.toFixed(2) ?? null,
            revenueGrowthYoY,
            // ── 재무 핵심 4대 지표 ──
            revenue,
            grossProfit,
            netIncome,
            operatingIncome:  opIncome,
            freeCashFlow,
            nextEarningsDate,
            dividendYield:    sd?.dividendYield ?? null,
            dividendRate:     sd?.dividendRate ?? null,
            exDividendDate,
            source:           'Yahoo',
        };
    } catch (e) {
        console.warn(`[Yahoo/Fundamentals] ${ticker} 실패: ${e.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────
// 뉴스
// ─────────────────────────────────────────────
async function getYahooNews(ticker) {
    if (!yf) return null;
    try {
        const result = await yf.search(ticker, { newsCount: 6 }, { validateResult: false });
        const items = result?.news || [];
        if (!items.length) return null;
        return items.map(n => ({
            title:       n.title,
            url:         n.link || n.url || '',
            source:      n.publisher || 'Yahoo Finance',
            publishedAt: n.providerPublishTime
                ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10)
                : null,
        }));
    } catch (e) {
        console.warn(`[Yahoo/News] ${ticker} 실패: ${e.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────
// 종목 검색 (ticker-search.js에서 사용)
// ─────────────────────────────────────────────
async function searchYahooTicker(query) {
    if (!yf) return [];
    try {
        const result = await yf.search(query, { quotesCount: 5, newsCount: 0 }, { validateResult: false });
        const quotes = result?.quotes || [];
        return quotes
            .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
            .slice(0, 5)
            .map(q => ({
                ticker:   q.symbol,
                name:     q.longname || q.shortname || q.symbol,
                exchange: q.exchange,
                source:   'Yahoo',
            }));
    } catch (e) {
        console.warn(`[Yahoo/Search] "${query}" 실패: ${e.message}`);
        return [];
    }
}

module.exports = {
    getYahooPrice,
    getYahooHistory,
    getYahooTechnicals,
    getYahooFundamentals,
    getYahooNews,
    searchYahooTicker,
};

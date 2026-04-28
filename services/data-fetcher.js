/**
 * data-fetcher.js — Full multi-source pipeline with tiered fallback chains
 *
 * Price:         TwelveData → Polygon → RapidAPI(Yahoo) → Tiingo → Yahoo(yf2)
 * Technicals:    TwelveData → AlphaVantage → Yahoo(yf2 로컸계산)
 * Fundamentals:  FMP → Finnhub → NasdaqDataLink → EODHD
 * News:          NewsAPI → Finnhub → Yahoo(yf2)
 * Analyst:       FMP → Finnhub
 * Macro:         FRED → NasdaqDataLink
 * SEC Filings:   data.sec.gov (free, no key)
 * KR 재무:       DART + Yahoo(yf2 .KS)
 */
const axios = require('axios');
const yahoo = require('./yahoo-finance-helper');
const naver = require('./naver-finance-helper');

// ─────────────────────────────────────────────
// API 호출 통계 추적 (세션당)
// ─────────────────────────────────────────────
const apiStats = new Map(); // label → { calls, success, fail, totalMs }

function recordStat(label, success, ms) {
    if (!apiStats.has(label)) apiStats.set(label, { calls: 0, success: 0, fail: 0, totalMs: 0 });
    const s = apiStats.get(label);
    s.calls++;
    s.totalMs += ms;
    if (success) s.success++; else s.fail++;
}

function getApiStats() {
    const out = {};
    for (const [label, s] of apiStats) {
        out[label] = {
            calls: s.calls,
            success: s.success,
            fail: s.fail,
            failRate: s.calls ? ((s.fail / s.calls) * 100).toFixed(0) + '%' : 'n/a',
            avgMs: s.calls ? Math.round(s.totalMs / s.calls) : 0,
        };
    }
    return out;
}

// ─────────────────────────────────────────────
// 60초 메모리 캐시 (동일 종목 재요청 시 캐시 우선)
// ─────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 60 * 1000;

function fromCache(key) {
    const e = cache.get(key);
    if (!e) return null;
    if (Date.now() - e.ts < CACHE_TTL) return e.data;
    // TTL 초과해도 stale data 보관 (fallback 최후 보루)
    return null;
}
function staleCache(key) {
    const e = cache.get(key);
    return e ? e.data : null;
}
function toCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

// ─────────────────────────────────────────────
// Safe fetch — timeout + 에러 없이 null 반환 + 실패 로깅
// ─────────────────────────────────────────────
const API_TIMEOUT = 6000; // 6초 기본 타임아웃 (기존 2초 → API 응답 여유 확보)

function withTimeout(promise, ms = API_TIMEOUT) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
    ]);
}

async function safeGet(label, fn, timeoutMs = API_TIMEOUT) {
    const t0 = Date.now();
    try {
        const r = await withTimeout(fn(), timeoutMs);
        const elapsed = Date.now() - t0;
        const ok = r !== null && r !== undefined && r !== false;
        recordStat(label, ok, elapsed);
        if (ok) {
            console.log(`[${label}] success (${elapsed}ms)`);
            return r;
        } else {
            console.log(`[${label}] fail (no data, ${elapsed}ms)`);
            return null;
        }
    } catch (e) {
        const elapsed = Date.now() - t0;
        recordStat(label, false, elapsed);
        const reason = e.message === 'TIMEOUT' ? `TIMEOUT ${timeoutMs/1000}s` : e.message?.slice(0, 60);
        console.log(`[${label}] ❌ fail (${reason}, ${elapsed}ms)`);
        return null;
    }
}

// ─────────────────────────────────────────────
// Fallback runner — sources 순서대로 시도 + 감사 기록
// ─────────────────────────────────────────────
// 질문 1개당 provider 감사 로그 수집기
let _currentAudit = null;

function getAuditCollector() {
    if (!_currentAudit) _currentAudit = { attempted: {}, failed: {}, succeeded: {}, sourceMap: {} };
    return _currentAudit;
}
function resetAuditCollector() { _currentAudit = null; }
function getAuditSnapshot() { return _currentAudit ? { ..._currentAudit } : null; }

async function withFallback(label, sources) {
    const audit = getAuditCollector();
    audit.attempted[label] = sources.map(s => s[0]);
    audit.failed[label] = [];
    
    for (let i = 0; i < sources.length; i++) {
        const [name, fn] = sources[i];
        const result = await safeGet(name, fn);
        if (result !== null && result !== undefined) {
             if (i > 0) console.log(`[${name}] fallback used for ${label}`);
             audit.succeeded[label] = name;
             audit.sourceMap[label] = name;
             return result;
        }
        // 실패 기록
        const stat = apiStats.get(name);
        const reason = stat ? (stat.fail > stat.success ? 'no data / error' : 'empty response') : 'unknown';
        audit.failed[label] = audit.failed[label] || [];
        audit.failed[label].push({ provider: name, reason });
    }
    console.warn(`[${label}] All sources failed`);
    audit.succeeded[label] = 'NONE';
    audit.sourceMap[label] = 'FAILED';
    return null;
}

// ═══════════════════════════════════════════════════════
// ① PRICE DATA — TwelveData → Polygon → Tiingo → Yahoo
// ═══════════════════════════════════════════════════════
async function getPriceData(ticker) {
    const cacheKey = `price_${ticker}`;
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || /^[0-9]{6}$/.test(ticker);

    if (isKR) {
        const yfTicker = /^[0-9]{6}$/.test(ticker) ? `${ticker}.KS` : ticker;
        const data = await withFallback('PriceKR', [
            ['Yahoo/yahoo-finance2 (KR)', () => yahoo.getYahooPrice(yfTicker)]
        ]);
        if (data) toCache(cacheKey, data);
        return data;
    }

    const data = await withFallback('PriceUS', [
        ['TwelveData', async () => {
            const key = process.env.TWELVEDATA_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${key}`, { timeout: 2000 });
            const d = res.data;
            if (d.status === 'error') return null;
            return {
                current: parseFloat(d.close),
                open: parseFloat(d.open),
                high: parseFloat(d.high),
                low: parseFloat(d.low),
                prevClose: parseFloat(d.previous_close),
                change: parseFloat(d.change),
                changePct: parseFloat(d.percent_change),
                volume: parseInt(d.volume),
                fifty2High: parseFloat(d['52_week']['high']),
                fifty2Low: parseFloat(d['52_week']['low']),
                source: 'TwelveData'
            };
        }],
        // 2순위: Polygon
        ['Polygon', async () => {
            const key = process.env.POLYGON_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?apiKey=${key}`, { timeout: 2000 });
            const r = res.data.results?.[0];
            if (!r) return null;
            const q = await axios.get(`https://api.polygon.io/v2/last/trade/${ticker}?apiKey=${key}`, { timeout: 2000 }).catch(() => null);
            const current = q?.data?.results?.p || r.c;
            return {
                current: parseFloat(current),
                open: r.o, high: r.h, low: r.l, prevClose: r.c,
                change: parseFloat((current - r.c).toFixed(2)),
                changePct: parseFloat(((current - r.c) / r.c * 100).toFixed(2)),
                volume: r.v, source: 'Polygon'
            };
        }],
        // 3순위: RapidAPI Yahoo Finance — 추가 보강
        ['RapidAPI/Yahoo', async () => {
            const key = process.env.RAPIDAPI_KEY;
            if (!key) return null;
            const res = await axios.get(`https://yahoo-finance15.p.rapidapi.com/api/v1/markets/stock/quotes?ticker=${ticker}`, {
                headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'yahoo-finance15.p.rapidapi.com' },
                timeout: 3000
            }).catch(() => null);
            const d = res?.data?.body?.[0];
            if (!d || !d.regularMarketPrice) return null;
            return {
                current: d.regularMarketPrice,
                open: d.regularMarketOpen,
                high: d.regularMarketDayHigh,
                low: d.regularMarketDayLow,
                prevClose: d.regularMarketPreviousClose,
                change: d.regularMarketChange,
                changePct: d.regularMarketChangePercent,
                volume: d.regularMarketVolume,
                fifty2High: d.fiftyTwoWeekHigh,
                fifty2Low: d.fiftyTwoWeekLow,
                source: 'RapidAPI/Yahoo'
            };
        }],
        // 4순위: Yahoo Finance (yf2) — 한국 포함 보편적
        ['Yahoo/yahoo-finance2', () => yahoo.getYahooPrice(ticker)]
    ]);

    if (data) toCache(cacheKey, data);
    return data;
}

// ═══════════════════════════════════════════════════════
// ② PRICE HISTORY — TwelveData → Polygon → Tiingo
// ═══════════════════════════════════════════════════════
async function getPriceHistory(ticker) {
    const cacheKey = `history_${ticker}`;
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || /^[0-9]{6}$/.test(ticker);

    if (isKR) {
        const yfTicker = /^[0-9]{6}$/.test(ticker) ? `${ticker}.KS` : ticker;
        const data = await withFallback('HistoryKR', [
            ['Yahoo/yahoo-finance2 (KR)', () => yahoo.getYahooHistory(yfTicker, 90)]
        ]);
        if (data) toCache(cacheKey, data);
        return data;
    }

    const data = await withFallback('HistoryUS', [
        ['TwelveData', async () => {
            const key = process.env.TWELVEDATA_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=65&apikey=${key}`, { timeout: 10000 });
            const values = res.data?.values;
            if (!values?.length) return null;
            const closes = values.map(v => parseFloat(v.close)).reverse();
            const len = closes.length;
            const latest = closes[len - 1];
            const pct = (a, b) => (((b - a) / a) * 100).toFixed(2);
            return {
                latest,
                change1W: pct(closes[Math.max(0, len - 6)], latest),
                change1M: pct(closes[Math.max(0, len - 22)], latest),
                change3M: pct(closes[0], latest),
                high52w: Math.max(...closes).toFixed(2),
                low52w: Math.min(...closes).toFixed(2),
                closes: closes.slice(-30), // Increased for charts
                source: 'TwelveData'
            };
        }],
        ['Polygon', async () => {
            const key = process.env.POLYGON_API_KEY;
            if (!key) return null;
            const to = new Date().toISOString().slice(0, 10);
            const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
            const res = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?apiKey=${key}&limit=90`, { timeout: 10000 });
            const results = res.data?.results;
            if (!results?.length) return null;
            const closes = results.map(r => r.c);
            const len = closes.length;
            const latest = closes[len - 1];
            const pct = (a, b) => (((b - a) / a) * 100).toFixed(2);
            return {
                latest,
                change1W: pct(closes[Math.max(0, len - 6)], latest),
                change1M: pct(closes[Math.max(0, len - 22)], latest),
                change3M: pct(closes[0], latest),
                high52w: Math.max(...closes).toFixed(2),
                low52w: Math.min(...closes).toFixed(2),
                closes: closes.slice(-30), // Increased for charts
                source: 'Polygon'
            };
        }],
        ['Tiingo', async () => {
            const key = process.env.TIINGO_API_KEY;
            if (!key) return null;
            const endDate = new Date().toISOString().slice(0, 10);
            const startDate = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
            const res = await axios.get(`https://api.tiingo.com/tiingo/daily/${ticker}/prices?startDate=${startDate}&endDate=${endDate}&token=${key}`, { timeout: 10000 });
            const data = res.data;
            if (!data?.length) return null;
            const closes = data.map(d => d.close);
            const len = closes.length;
            const latest = closes[len - 1];
            const pct = (a, b) => (((b - a) / a) * 100).toFixed(2);
            return {
                latest,
                change1W: pct(closes[Math.max(0, len - 6)], latest),
                change1M: pct(closes[Math.max(0, len - 22)], latest),
                change3M: pct(closes[0], latest),
                high52w: Math.max(...closes).toFixed(2),
                low52w: Math.min(...closes).toFixed(2),
                closes: closes.slice(-30), // Increased for charts
                source: 'Tiingo'
            };
        }],
        ['Yahoo/yahoo-finance2', () => yahoo.getYahooHistory(ticker)]
    ]);

    if (data) toCache(cacheKey, data);
    return data;
}

// ═══════════════════════════════════════════════════════
// ③ TECHNICAL INDICATORS — TwelveData → AlphaVantage
// ═══════════════════════════════════════════════════════
async function getTechnicalIndicators(ticker) {
    const cacheKey = `tech_${ticker}`;
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    // 0순위: Yahoo Finance 로컬 계산 (무료·무제한, rate limit 없음) — 먼저 시작해서 병렬 대기
    const yahooPromise = safeGet('Tech/Yahoo', () => yahoo.getYahooTechnicals(ticker), 10000);

    // 1순위: TwelveData (7개 병렬 호출 → 12초 타임아웃 부여)
    const td = await safeGet('Tech/TwelveData', async () => {
        const key = process.env.TWELVEDATA_API_KEY;
        if (!key) return null;
        const [rsiR, macdR, ema20R, ema50R, sma200R, volR, stochR] = await Promise.allSettled([
            axios.get(`https://api.twelvedata.com/rsi?symbol=${ticker}&interval=1day&time_period=14&apikey=${key}`, { timeout: 10000 }),
            axios.get(`https://api.twelvedata.com/macd?symbol=${ticker}&interval=1day&apikey=${key}`, { timeout: 10000 }),
            axios.get(`https://api.twelvedata.com/ema?symbol=${ticker}&interval=1day&time_period=20&apikey=${key}`, { timeout: 10000 }),
            axios.get(`https://api.twelvedata.com/ema?symbol=${ticker}&interval=1day&time_period=50&apikey=${key}`, { timeout: 10000 }),
            axios.get(`https://api.twelvedata.com/sma?symbol=${ticker}&interval=1day&time_period=200&apikey=${key}`, { timeout: 10000 }),
            axios.get(`https://api.twelvedata.com/volume?symbol=${ticker}&interval=1day&outputsize=5&apikey=${key}`, { timeout: 10000 }),
            axios.get(`https://api.twelvedata.com/stoch?symbol=${ticker}&interval=1day&apikey=${key}`, { timeout: 10000 })
        ]);
        const val = (r, path) => { try { return r.status === 'fulfilled' ? r.value.data?.values?.[0]?.[path] : null; } catch { return null; } };
        const rsiNum = val(rsiR, 'rsi') ? parseFloat(val(rsiR, 'rsi')) : null;
        const macdV = macdR.status === 'fulfilled' ? macdR.value.data?.values?.[0] : null;
        const vols = volR.status === 'fulfilled' ? volR.value.data?.values?.map(v => parseInt(v.volume)).filter(Boolean) : null;
        const stochV = stochR.status === 'fulfilled' ? stochR.value.data?.values?.[0] : null;

        if (!rsiNum && !macdV && !val(ema20R, 'ema')) return null;

        return {
            rsi: rsiNum,
            rsiSignal: rsiNum ? (rsiNum < 30 ? '과매도' : rsiNum > 70 ? '과매수' : '중립') : 'N/A',
            macd: macdV ? {
                macd: parseFloat(macdV.macd).toFixed(4),
                signal: parseFloat(macdV.macd_signal).toFixed(4),
                hist: parseFloat(macdV.macd_hist).toFixed(4),
                trend: parseFloat(macdV.macd_hist) >= 0 ? '상승 모멘텀 ↑' : '하락 모멘텀 ↓'
            } : null,
            ema20: val(ema20R, 'ema') ? parseFloat(val(ema20R, 'ema')).toFixed(2) : null,
            ema50: val(ema50R, 'ema') ? parseFloat(val(ema50R, 'ema')).toFixed(2) : null,
            sma200: val(sma200R, 'value') ? parseFloat(val(sma200R, 'value')).toFixed(2) : null,
            avgVolume: vols?.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null,
            stoch: stochV ? { k: parseFloat(stochV.slow_k).toFixed(2), d: parseFloat(stochV.slow_d).toFixed(2) } : null,
            source: 'TwelveData'
        };
    }, 12000);
    if (td) { toCache(cacheKey, td); return td; }

    // 2순위: Yahoo Finance 로컬 계산 결과 대기 (이미 병렬로 시작함)
    const yh = await yahooPromise;
    if (yh) { toCache(cacheKey, yh); return yh; }

    // 3순위: AlphaVantage (RSI only, 25 calls/day 아끼기 위해 마지막)
    const av = await safeGet('Tech/AlphaVantage', async () => {
        const key = process.env.ALPHAVANTAGE_API_KEY;
        if (!key) return null;
        const res = await axios.get('https://www.alphavantage.co/query', {
            params: { function: 'RSI', symbol: ticker, interval: 'daily', time_period: 14, series_type: 'close', apikey: key },
            timeout: 10000
        });
        const d = res.data?.['Technical Analysis: RSI'];
        if (!d) return null;
        const latest = Object.values(d)[0];
        const rsiNum = parseFloat(latest?.RSI);
        if (!rsiNum || isNaN(rsiNum)) return null;
        return {
            rsi: rsiNum,
            rsiSignal: rsiNum < 30 ? '과매도' : rsiNum > 70 ? '과매수' : '중립',
            macd: null, ema20: null, ema50: null, sma200: null, avgVolume: null, stoch: null,
            source: 'AlphaVantage'
        };
    }, 12000);
    if (av) { toCache(cacheKey, av); return av; }

    return null;
}

// ═══════════════════════════════════════════════════════
// ④ BOLLINGER BANDS — AlphaVantage → Polygon
// ═══════════════════════════════════════════════════════
async function getBollingerBands(ticker) {
    return withFallback('BBands', [
        ['AlphaVantage', async () => {
            const key = process.env.ALPHAVANTAGE_API_KEY;
            if (!key) return null;
            const res = await axios.get('https://www.alphavantage.co/query', {
                params: { function: 'BBANDS', symbol: ticker, interval: 'daily', time_period: 20, series_type: 'close', apikey: key },
                timeout: 10000
            });
            const d = res.data?.['Technical Analysis: BBANDS'];
            if (!d) return null;
            const v = Object.values(d)[0];
            return {
                upper: parseFloat(v?.['Real Upper Band']).toFixed(2),
                middle: parseFloat(v?.['Real Middle Band']).toFixed(2),
                lower: parseFloat(v?.['Real Lower Band']).toFixed(2),
                source: 'AlphaVantage'
            };
        }]
    ]);
}

// ═══════════════════════════════════════════════════════
// ⑤ FUNDAMENTALS — Yahoo(yf2) → Finnhub → EODHD
// ═══════════════════════════════════════════════════════
async function getFundamentals(ticker) {
    const cacheKey = `fund_${ticker}`;
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    const data = await withFallback('Fundamentals', [
        // 1순위: FMP (가장 근본적이고 정확한 재무 데이터 API)
        ['FMP', async () => {
            const key = process.env.FMP_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${key}`, { timeout: 8000 }).catch(() => null);
            const metricsRes = await axios.get(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${key}`, { timeout: 8000 }).catch(() => null);
            const quoteRes = await axios.get(`https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${key}`, { timeout: 8000 }).catch(() => null);
            
            const p = res?.data?.[0];
            const m = metricsRes?.data?.[0];
            const q = quoteRes?.data?.[0];
            if (!p && !m && !q) return null;

            return {
                companyName: p?.companyName,
                sector: p?.sector,
                industry: p?.industry,
                mktCap: p?.mktCap || q?.marketCap,
                beta: p?.beta ? parseFloat(p.beta).toFixed(2) : null,
                peRatio: q?.pe ? parseFloat(q.pe).toFixed(2) : (m?.peRatioTTM ? parseFloat(m.peRatioTTM).toFixed(2) : null),
                eps: q?.eps ? parseFloat(q.eps).toFixed(2) : null,
                forwardPE: null,
                pbRatio: m?.pbRatioTTM ? parseFloat(m.pbRatioTTM).toFixed(2) : null,
                debtToEquity: m?.debtToEquityTTM ? parseFloat(m.debtToEquityTTM).toFixed(2) : null,
                netMargin: null,
                roe: m?.roeTTM ? (parseFloat(m.roeTTM) * 100).toFixed(1) + '%' : null,
                revenueGrowthYoY: null,
                revenue: null,
                grossProfit: null,
                nextEarningsDate: q?.earningsAnnouncement,
                source: 'FMP'
            };
        }],

        // 2순위: Finnhub (글로벌 주식 재무 지표)
        ['Finnhub', async () => {
            const key = process.env.FINNHUB_API_KEY;
            if (!key) return null;
            const [profileR, metricR] = await Promise.allSettled([
                axios.get(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${key}`, { timeout: 8000 }),
                axios.get(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${key}`, { timeout: 8000 })
            ]);
            const profile = profileR.status === 'fulfilled' ? profileR.value.data : null;
            const metric  = metricR.status  === 'fulfilled' ? metricR.value.data?.metric : null;
            if (!profile?.name && !metric) return null;
            return {
                companyName: profile?.name,
                sector: profile?.ggroup || profile?.gsector,
                industry: profile?.finnhubIndustry,
                mktCap: profile?.marketCapitalization ? profile.marketCapitalization * 1e6 : null,
                beta: metric?.beta ? parseFloat(metric.beta).toFixed(2) : null,
                peRatio: metric?.peNormalizedAnnual ? parseFloat(metric.peNormalizedAnnual).toFixed(2) : null,
                eps: metric?.epsNormalizedAnnual ? parseFloat(metric.epsNormalizedAnnual).toFixed(2) : null,
                forwardPE: metric?.forwardPE ? parseFloat(metric.forwardPE).toFixed(2) : null,
                pbRatio: metric?.pbAnnual ? parseFloat(metric.pbAnnual).toFixed(2) : null,
                debtToEquity: metric?.totalDebt_totalEquityAnnual ? parseFloat(metric.totalDebt_totalEquityAnnual).toFixed(2) : null,
                netMargin: metric?.netProfitMarginAnnual ? parseFloat(metric.netProfitMarginAnnual).toFixed(1) + '%' : null,
                roe: metric?.roaAnnual ? parseFloat(metric.roaAnnual).toFixed(1) + '%' : null,
                revenueGrowthYoY: metric?.revenueGrowthAnnual ? parseFloat(metric.revenueGrowthAnnual).toFixed(1) + '%' : null,
                revenue: metric?.revenueTTM ? metric.revenueTTM * 1e6 : null,
                grossProfit: null,
                nextEarningsDate: null,
                source: 'Finnhub'
            };
        }],

        // 3순위: NasdaqDataLink (Quandl) — 재무 보강
        ['NasdaqDataLink', async () => {
            const key = process.env.NASDAQ_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://data.nasdaq.com/api/v3/datasets/WIKI/${ticker}.json?rows=1&api_key=${key}`, { timeout: 8000 }).catch(() => null);
            const dataset = res?.data?.dataset;
            if (!dataset?.data?.[0]) return null;
            const columns = dataset.column_names;
            const row = dataset.data[0];
            const colIdx = (name) => { const i = columns.indexOf(name); return i >= 0 ? row[i] : null; };
            return {
                companyName: dataset.name?.split(' Prices')[0] || ticker,
                sector: null, industry: null,
                mktCap: null, beta: null,
                peRatio: null, eps: null, forwardPE: null, pbRatio: null,
                debtToEquity: null, netMargin: null, roe: null,
                revenueGrowthYoY: null, revenue: null, grossProfit: null,
                nextEarningsDate: null,
                // NasdaqDataLink은 OHLCV 데이터 위주 — 보조 교차검증 용도
                _ndlClose: colIdx('Close'), _ndlVolume: colIdx('Volume'),
                source: 'NasdaqDataLink'
            };
        }],

        // 4순위: EODHD
        ['EODHD', async () => {
            const key = process.env.EODHD_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://eodhd.com/api/fundamentals/${ticker}.US?api_token=${key}&fmt=json`, { timeout: 10000 });
            const d = res.data;
            const gen = d?.General;
            const hi = d?.Highlights;
            const val = d?.Valuation;
            if (!gen) return null;
            return {
                companyName: gen.Name,
                sector: gen.Sector,
                industry: gen.Industry,
                mktCap: hi?.MarketCapitalization,
                beta: hi?.Beta,
                peRatio: hi?.PERatio ? parseFloat(hi.PERatio).toFixed(2) : null,
                eps: hi?.EPS ? parseFloat(hi.EPS).toFixed(2) : null,
                forwardPE: hi?.ForwardPE ? parseFloat(hi.ForwardPE).toFixed(2) : null,
                pbRatio: val?.PriceBookMRQ ? parseFloat(val.PriceBookMRQ).toFixed(2) : null,
                debtToEquity: null,
                netMargin: hi?.ProfitMargin ? (parseFloat(hi.ProfitMargin) * 100).toFixed(1) + '%' : null,
                roe: hi?.ReturnOnEquityTTM ? (parseFloat(hi.ReturnOnEquityTTM) * 100).toFixed(1) + '%' : null,
                revenueGrowthYoY: hi?.QuarterlyRevenueGrowthYOY ? (parseFloat(hi.QuarterlyRevenueGrowthYOY) * 100).toFixed(1) + '%' : null,
                revenue: hi?.RevenueTTM,
                grossProfit: null,
                nextEarningsDate: null,
                source: 'EODHD'
            };
        }]
    ]);

    if (data) toCache(cacheKey, data);
    return data;
}


async function getNews(query, ticker = null) {
    const results = await Promise.allSettled([
        // 1. Finnhub
        safeGet('Finnhub', async () => {
            const key = process.env.FINNHUB_API_KEY;
            if (!key || !ticker) return [];
            const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
            const to = new Date().toISOString().slice(0, 10);
            const res = await axios.get(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${key}`, { timeout: 8000 });
            return (res.data || []).slice(0, 5).map(a => ({
                title: a.headline, description: a.summary,
                source: a.source, publishedAt: new Date(a.datetime * 1000).toISOString().slice(0, 10), url: a.url
            }));
        }),
        // 2. NewsAPI
        safeGet('NewsAPI', async () => {
            const key = process.env.NEWS_API_KEY;
            if (!key) return [];
            const res = await axios.get('https://newsapi.org/v2/everything', {
                params: { q: query, sortBy: 'publishedAt', pageSize: 6, language: 'en', apiKey: key },
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YeriBot/1.0)' },
                timeout: 8000
            });
            return (res.data.articles || []).map(a => ({
                title: a.title, description: a.description,
                source: a.source?.name, publishedAt: a.publishedAt?.slice(0, 10), url: a.url
            }));
        })
    ]);

    // Merge and deduplicate by title
    const all = [];
    for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.length) all.push(...r.value);
    }

    // Yahoo fallback (뉴스가 아예 없을 때만)
    if (!all.length && ticker) {
        const yhNews = await yahoo.getYahooNews(ticker);
        if (yhNews?.length) all.push(...yhNews);
    }

    const seen = new Set();
    return all.filter(n => {
        if (!n.title || seen.has(n.title)) return false;
        seen.add(n.title);
        return true;
    }).slice(0, 8);
}

// ═══════════════════════════════════════════════════════
// ⑦ ANALYST RATINGS — FMP → Finnhub
// ═══════════════════════════════════════════════════════
async function getAnalystRatings(ticker) {
    return withFallback('AnalystRatings', [
        ['FMP', async () => {
            const key = process.env.FMP_API_KEY;
            if (!key) return null;
            const [ratingR, priceTargetR] = await Promise.allSettled([
                axios.get(`https://financialmodelingprep.com/api/v3/analyst-stock-recommendations/${ticker}?limit=5&apikey=${key}`, { timeout: 8000 }),
                axios.get(`https://financialmodelingprep.com/api/v3/price-target-consensus/${ticker}?apikey=${key}`, { timeout: 8000 })
            ]);
            const ratings = ratingR.status === 'fulfilled' ? ratingR.value.data?.slice(0, 5) : [];
            const consensus = priceTargetR.status === 'fulfilled' ? priceTargetR.value.data?.[0] : null;
            if (!ratings?.length && !consensus) return null;
            return {
                consensus: {
                    targetHigh: consensus?.targetHigh,
                    targetLow: consensus?.targetLow,
                    targetMean: consensus?.targetConsensus,
                    rating: consensus?.rating
                },
                recent: ratings.map(r => ({
                    firm: r.analystName,
                    rating: r.recommendationKey,
                    date: r.date
                })),
                source: 'FMP'
            };
        }],
        ['Finnhub', async () => {
            const key = process.env.FINNHUB_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${key}`, { timeout: 8000 });
            const latest = res.data?.[0];
            if (!latest) return null;
            return {
                consensus: {
                    targetHigh: null, targetLow: null, targetMean: null,
                    rating: latest.strongBuy > latest.sell ? 'Buy' : 'Hold'
                },
                recent: [{
                    firm: 'Consensus', rating: `strongBuy:${latest.strongBuy} buy:${latest.buy} hold:${latest.hold} sell:${latest.sell}`,
                    date: latest.period
                }],
                source: 'Finnhub'
            };
        }]
    ]);
}

// ═══════════════════════════════════════════════════════
// ⑧ SEC FILINGS — data.sec.gov (free)
// ═══════════════════════════════════════════════════════
async function getSECFilings(ticker) {
    return safeGet('SEC', async () => {
        // Get CIK from SEC company lookup
        const lookupRes = await axios.get(
            `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&dateRange=custom&startdt=${new Date(Date.now() - 90*86400000).toISOString().slice(0,10)}&enddt=${new Date().toISOString().slice(0,10)}&forms=10-K,10-Q,8-K`,
            { timeout: 10000, headers: { 'User-Agent': 'YeriProject contact@example.com' } }
        );
        const hits = lookupRes.data?.hits?.hits || [];
        return hits.slice(0, 5).map(h => ({
            form: h._source?.['file-type'],
            date: h._source?.period_of_report,
            description: h._source?.display_names?.[0] + ': ' + h._source?.['biz_location'],
            url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${h._source?.entity_id}&type=${h._source?.['file-type']}&dateb=&owner=include&count=5`
        }));
    });
}

// ═══════════════════════════════════════════════════════
// ⑨ MACRO DATA — FRED → Nasdaq Data Link
// ═══════════════════════════════════════════════════════
async function getMacroData() {
    const cacheKey = 'macro';
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    const data = await withFallback('Macro', [
        // FRED — VIX/금리/CPI 확인된 정상 동작
        ['FRED', async () => {
            const key = process.env.FRED_API_KEY?.trim();
            if (!key) return null;
            const seriesIds = ['FEDFUNDS', 'CPIAUCSL', 'UNRATE', 'DGS10', 'VIXCLS', 'T10YIE'];
            const results = await Promise.allSettled(seriesIds.map(s =>
                axios.get('https://api.stlouisfed.org/fred/series/observations', {
                    params: { series_id: s, api_key: key, file_type: 'json', sort_order: 'desc', limit: 1 },
                    timeout: 8000
                })
            ));
            const extract = (r) => r.status === 'fulfilled' ? r.value.data?.observations?.[0]?.value : null;
            return {
                federalFundsRate: extract(results[0]),
                cpi: extract(results[1]),
                unemployment: extract(results[2]),
                tenYearYield: extract(results[3]),
                vix: extract(results[4]),
                breakEvenInflation: extract(results[5]),
                dataDate: new Date().toISOString().slice(0, 10),
                source: 'FRED'
            };
        }],
        // FRED 실패 시 Yahoo (VIX, 10Y채권 금리만이라도 확보)
        ['YahooFallback', async () => {
            const [vix, tnx] = await Promise.allSettled([
                yahoo.getYahooPrice('^VIX'),
                yahoo.getYahooPrice('^TNX')
            ]);
            
            const vixVal = vix.status === 'fulfilled' ? vix.value?.current : null;
            const tnxVal = tnx.status === 'fulfilled' ? tnx.value?.current : null;
            
            if (!vixVal && !tnxVal) return null;
            
            return {
                federalFundsRate: null,
                cpi: null,
                unemployment: null,
                tenYearYield: tnxVal,
                vix: vixVal,
                breakEvenInflation: null,
                dataDate: new Date().toISOString().slice(0, 10),
                source: 'Yahoo'
            };
        }]
    ]);

    if (data) toCache(cacheKey, data);
    return data;
}

// ═══════════════════════════════════════════════════════
// ⑩ MARKET INDICES — Finnhub → Polygon → TwelveData
// ═══════════════════════════════════════════════════════
async function getMarketIndices() {
    const cacheKey = 'indices';
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    const symbolSets = [
        { provider: 'Finnhub', symbols: { 'S&P 500': '^GSPC', 'NASDAQ': '^IXIC', 'DOW': '^DJI' }, fn: async (sym) => {
            const key = process.env.FINNHUB_API_KEY;
            if (!key) return null;
            const res = await axios.get('https://finnhub.io/api/v1/quote', { params: { symbol: sym, token: key }, timeout: 5000 });
            return { current: res.data.c, changePct: res.data.dp };
        }},
        { provider: 'Polygon', symbols: { 'S&P 500': 'SPY', 'NASDAQ': 'QQQ', 'DOW': 'DIA' }, fn: async (sym) => {
            const key = process.env.POLYGON_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${sym}/prev?apiKey=${key}`, { timeout: 5000 });
            const r = res.data.results?.[0];
            if (!r) return null;
            return { current: r.c, changePct: ((r.c - r.o) / r.o * 100) };
        }},
        { provider: 'Yahoo', symbols: { 'S&P 500': '^GSPC', 'NASDAQ': '^IXIC', 'DOW': '^DJI' }, fn: async (sym) => {
            const data = await yahoo.getYahooPrice(sym);
            if (!data) return null;
            return { current: data.current, changePct: data.changePercent };
        }}
    ];

    const results = {};
    for (const [name] of Object.entries(symbolSets[0].symbols)) {
        for (const { provider, symbols, fn } of symbolSets) {
            const sym = symbols[name];
            const result = await safeGet(`Index/${provider}/${name}`, () => fn(sym));
            if (result) { results[name] = result; break; }
        }
    }
    toCache(cacheKey, results);
    return results;
}

// ═══════════════════════════════════════════════════════
// ⑪ KR DISCLOSURES — DART
// ═══════════════════════════════════════════════════════
async function getKoreanDisclosures(corpCode) {
    const key = process.env.DART_API_KEY;
    if (!key || !corpCode) return null;
    return safeGet('DART', async () => {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
        const res = await axios.get('https://opendart.fss.or.kr/api/list.json', {
            params: { crtfc_key: key, corp_code: corpCode, bgn_de: thirtyAgo, end_de: today, page_count: 7 },
            timeout: 8000
        });
        return (res.data?.list || []).map(d => ({ date: d.rcept_dt, name: d.report_nm }));
    });
}

// ═══════════════════════════════════════════════════════
// ORCHESTRATORS
// ═══════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// 60초 오케스트레이션 캐시 (중복 호출 완전 방어)
// ─────────────────────────────────────────────
const orchestrationCache = new Map();
const ORCHESTRATION_TTL = 60 * 1000;

/**
 * Full stock data bundle: price + history + technicals + fundamentals + news + macro + analyst + SEC
 */
async function fetchAllStockData(ticker, companyName = null, corpCode = null) {
    const query = companyName || ticker;
    const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || /^[0-9]{6}$/.test(ticker);

    const cacheKey = `ALL_${ticker}`;
    const cached = orchestrationCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ORCHESTRATION_TTL) {
        console.log(`\n[DataFetcher] ⚡ Orchestration Cache HIT for: ${ticker} (TTL 60s)`);
        return cached.data;
    }

    console.log(`\n[DataFetcher] Starting full pipeline for: ${ticker}`);
    resetAuditCollector(); // 새 파이프라인 시작 = 감사 로그 초기화

    let [price, history, technical, bbands, fundamentals, news, macro, analystRatings, secFilings, disclosures] = await Promise.all([
        getPriceData(ticker),
        getPriceHistory(ticker),
        getTechnicalIndicators(ticker),
        getBollingerBands(ticker),
        getFundamentals(ticker),
        getNews(query, ticker),
        getMacroData(),
        !isKR ? getAnalystRatings(ticker) : Promise.resolve(null),
        !isKR ? getSECFilings(ticker) : Promise.resolve(null),
        corpCode ? getKoreanDisclosures(corpCode) : Promise.resolve(null)
    ]);

    // ★ Yahoo 보강 — 핵심 데이터(가격/기술지표/재무)가 없으면 Yahoo로 재시도
    if (!price) {
        console.log(`[DataFetcher] ⚡ ${ticker} 가격 누락 → Yahoo 직접 재시도`);
        price = await safeGet('Price/Yahoo-retry', () => yahoo.getYahooPrice(ticker));
    }
    if (!technical) {
        console.log(`[DataFetcher] ⚡ ${ticker} 기술지표 누락 → Yahoo 직접 재시도`);
        technical = await safeGet('Tech/Yahoo-retry', () => yahoo.getYahooTechnicals(ticker));
    }
    if (!history) {
        console.log(`[DataFetcher] ⚡ ${ticker} 이력 누락 → Yahoo 직접 재시도`);
        history = await safeGet('History/Yahoo-retry', () => yahoo.getYahooHistory(ticker));
    }
    if (!fundamentals || isKR) {
        if (isKR) {
            console.log(`[DataFetcher] ⚡ ${ticker} 한국 주식 재무 → Naver 파이프라인으로 조회`);
            const nav = await safeGet('Fund/Naver', () => naver.getNaverFundamentals(ticker));
            if (nav) fundamentals = { ...fundamentals, ...nav, source: nav.source || 'Naver Finance' };
        } else if (!fundamentals) {
            console.log(`[DataFetcher] ⚡ ${ticker} 재무 누락 → Yahoo 직접 재시도`);
            fundamentals = await safeGet('Fund/Yahoo-retry', () => yahoo.getYahooFundamentals(ticker));
        }
    }

    // companyName 보강 — fundamentals에서 가져온 이름 사용
    if ((!companyName || companyName === ticker) && fundamentals?.companyName) {
        companyName = fundamentals.companyName;
    }

    // Compute simple support/resistance from candle data
    let supportResist = null;
    if (history?.closes?.length >= 5) {
        const sorted = [...history.closes].sort((a, b) => a - b);
        supportResist = {
            support: sorted[Math.floor(sorted.length * 0.2)].toFixed(2),
            resistance: sorted[Math.floor(sorted.length * 0.8)].toFixed(2)
        };
    }

    // ── 신뢰도 계산 및 메타데이터 주입 ──
    const rely = computeDataReliability({ price, technical, fundamentals, news, macro });
    const metadata = {
        sources: {
            price: price?.source || '없음',
            technical: technical?.source || '없음',
            fundamentals: fundamentals?.source || '없음',
            news: news?.length ? news[0]?.source || 'Finnhub/NewsAPI' : '없음',
            macro: macro?.source || '없음'
        },
        confidence: rely.label,
        reason: rely.reason,
        tier: rely.tier
    };

    // ── 검증 로그 (디버그/감사용) ──────────────────────────────
    const vLog = [
        `\n${'═'.repeat(50)}`,
        `[검증로그] ticker resolved:  ${ticker}`,
        `[검증로그] price source:     ${price?.source || '❌ FAILED'} | current: ${price?.current ?? 'N/A'}`,
        `[검증로그] RSI loaded:       ${technical?.rsi != null ? technical.rsi.toFixed(2) : '❌ N/A'} | source: ${technical?.source || 'none'}`,
        `[검증로그] EMA20:            ${technical?.ema20 ?? 'N/A'} | EMA50: ${technical?.ema50 ?? 'N/A'}`,
        `[검증로그] fundamentals:     ${fundamentals?.source || '❌ FAILED'} | PER: ${fundamentals?.peRatio ?? 'N/A'}`,
        `[검증로그] news count:       ${news?.length || 0}`,
        `[검증로그] macro source:     ${macro?.source || '❌ FAILED'} | VIX: ${macro?.vix ?? 'N/A'}`,
        `[검증로그] analyst:          ${analystRatings?.source || 'none'} | target: ${analystRatings?.consensus?.targetMean ?? 'N/A'}`,
        `[검증로그] support/resist:   ${supportResist ? `S:${supportResist.support} R:${supportResist.resistance}` : 'N/A'}`,
        `[검증로그] 52w high/low:     ${price?.fifty2High ?? 'N/A'} / ${price?.fifty2Low ?? 'N/A'}`,
        `[검증로그] 💡 Confidence:    ${metadata.confidence} (${metadata.tier})`,
        `${'─'.repeat(50)}`,
    ];
    // ── 상세 Provider Audit 로그 (per-query) ──
    const auditData = getAuditSnapshot();
    if (auditData) {
        vLog.push(`[ProviderAudit] ═══ 상세 감사 로그 ═══`);
        vLog.push(`[ProviderAudit] symbol: ${ticker}`);
        for (const [category, providers] of Object.entries(auditData.attempted)) {
            const succeeded = auditData.succeeded[category] || 'NONE';
            const failed = (auditData.failed[category] || []).map(f => `${f.provider}(${f.reason})`).join(', ');
            vLog.push(`[ProviderAudit] ${category.padEnd(16)} → attempted: [${providers.join(', ')}]`);
            vLog.push(`[ProviderAudit] ${' '.repeat(16)}   succeeded: ${succeeded}`);
            if (failed) vLog.push(`[ProviderAudit] ${' '.repeat(16)}   failed: ${failed}`);
        }
        vLog.push(`[ProviderAudit] ─── final_source_map ───`);
        for (const [cat, src] of Object.entries(auditData.sourceMap)) {
            vLog.push(`[ProviderAudit]   ${cat} → ${src}`);
        }
        // 추가: Yahoo retry 등 withFallback 밖 호출도 기록
        vLog.push(`[ProviderAudit]   news → ${news?.length ? (news[0]?.source || 'Finnhub/NewsAPI') : 'NONE'}`);
        vLog.push(`[ProviderAudit]   bbands → ${bbands?.source || 'N/A'}`);
        vLog.push(`[ProviderAudit]   sec → ${secFilings?.length ? 'SEC.gov' : 'N/A'}`);
        vLog.push(`[ProviderAudit]   dart → ${disclosures?.length ? 'DART' : 'N/A'}`);
        vLog.push(`${'─'.repeat(50)}`);
    }
    vLog.push(`[DataFetcher] ✅ Pipeline complete for: ${ticker}`);
    console.log(vLog.join('\n'));

    // ── 이상치 검증: price/changePct null 또는 ±50% 초과 시 재조회 ──
    if (price && (price.current == null || isNaN(price.current))) {
        console.log(`[DataFetcher] ⚠️ 가격 이상치 감지 (null/NaN) → 캐시 or Yahoo 재조회`);
        const stale = staleCache(`price_${ticker}`);
        if (stale) { price = stale; }
        else { price = await safeGet('Price/Yahoo-anomaly', () => yahoo.getYahooPrice(ticker)) || price; }
    }
    if (price && price.changePct != null && Math.abs(price.changePct) > 50) {
        console.log(`[DataFetcher] ⚠️ 변동률 이상치 (${price.changePct}%) → Yahoo 재검증`);
        const verify = await safeGet('Price/Yahoo-verify', () => yahoo.getYahooPrice(ticker));
        if (verify && verify.changePct != null && Math.abs(verify.changePct) < 50) {
            price = verify;
        }
    }

    // ── 최소 응답 보장: 절대 "데이터 없음"으로 끝내지 않는다 ──
    if (!price || price.current == null) {
        console.log(`[DataFetcher] 🛟 최소 응답 보장 발동 → stale 캐시 탐색`);
        const stale = staleCache(`price_${ticker}`);
        if (stale) {
            price = { ...stale, _stale: true };
            console.log(`[DataFetcher] 🛟 stale 캐시 사용 (price: ${price.current})`);
        } else {
            price = { current: null, changePct: null, source: 'UNAVAILABLE', _stale: true };
            console.log(`[DataFetcher] 🛟 최소 스켈레톤 반환 (가격 미확보)`);
        }
    }

    const finalData = { 
        ticker, 
        companyName: companyName || ticker, 
        price, 
        history, 
        technical, 
        bbands, 
        fundamentals, 
        news, 
        macro, 
        analystRatings, 
        secFilings, 
        disclosures, 
        supportResist, 
        metadata, 
        _providerAudit: auditData,
        fetchedAt: Date.now()
    };
    orchestrationCache.set(cacheKey, { ts: Date.now(), data: finalData });
    return finalData;
}

async function fetchMarketData() {
    const [indices, macro, news] = await Promise.all([
        getMarketIndices(),
        getMacroData(),
        getNews('stock market economy inflation federal reserve interest rates')
    ]);
    return { indices, macro, news };
}

async function fetchSectorData(sectorInfo) {
    const tickers = sectorInfo.tickers.slice(0, 2);
    const [stocks, marketData] = await Promise.all([
        Promise.all(tickers.map(t => fetchAllStockData(t))),
        fetchMarketData()
    ]);
    return { sector: sectorInfo.sector, stocks, marketData };
}

// ═══════════════════════════════════════════════════════
// 데이터 신뢰도 산출 시스템 — FULL / PARTIAL / NO_DATA
// ═══════════════════════════════════════════════════════
function computeDataReliability(data) {
    const hasPrice = data.price?.current != null;
    const hasTech = data.technical?.rsi != null;
    const hasFund = data.fundamentals?.peRatio != null || data.fundamentals?.revenue != null;

    let reliability, label, emoji, reason;

    if (!hasPrice) {
        reliability = 'FAIL';
        label = '실패';
        emoji = '🔴';
        reason = '가격도 없음 → 분석 자체 중단';
    } else if (hasTech && hasFund) {
        reliability = 'HIGH';
        label = '높음';
        emoji = '🟢';
        reason = '가격 + 기술 + 재무 모두 존재';
    } else if (hasTech) {
        reliability = 'MEDIUM';
        label = '중간';
        emoji = '🟡';
        reason = '가격 + 기술만 존재';
    } else {
        reliability = 'LOW';
        label = '낮음';
        emoji = '🟠';
        reason = '가격만 존재';
    }

    const missing = [!hasPrice && '가격', !hasTech && '기술', !hasFund && '재무'].filter(Boolean);
    const available = [hasPrice && '가격', hasTech && '기술', hasFund && '재무'].filter(Boolean);

    const summary = {
        tier: reliability === 'FAIL' ? 'NO_DATA' : (reliability === 'HIGH' ? 'FULL' : 'PARTIAL'),
        reliability,
        label,
        emoji,
        reason,
        pct: reliability === 'HIGH' ? 100 : reliability === 'MEDIUM' ? 66 : reliability === 'LOW' ? 33 : 0,
        missing,
        available
    };

    console.log(`[DataReliability] ${emoji} ${summary.tier} (${summary.pct}%) — 신뢰도: ${reliability}`);
    console.log(`[DataReliability] ✅ 확보: ${available.join(', ') || 'none'}`);
    if (missing.length) console.log(`[DataReliability] ❌ 미확보: ${missing.join(', ')}`);

    return summary;
}

// ═══════════════════════════════════════════════════════
// ⑫ DEEP METRIC RETRIEVAL (fact_answer 전용 다중 소스 탐색)
// ═══════════════════════════════════════════════════════
async function fetchDeepMetric(ticker, metricClass) {
    if (!metricClass) return { status: 'NO_DATA' };

    console.log(`[DeepMetric] 🔍 ${ticker}의 ${metricClass} 지표 심층 탐색 시작...`);

    // 한국 티커 .KS 처리: US 전용 API에서는 순수 숫자만 사용
    const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || /^[0-9]{6}$/.test(ticker);
    const usTicker = isKR ? ticker.replace(/\.(KS|KQ)$/, '') : ticker;

    // 문자열 값 안전 파싱 헬퍼 ("10.8%" → 10.8, "5.79" → 5.79)
    const safeParse = (v) => {
        if (v == null) return null;
        if (typeof v === 'number') return isNaN(v) ? null : v;
        const n = parseFloat(String(v).replace('%', ''));
        return isNaN(n) ? null : n;
    };

    // metricClass 별 처리 로직
    const extractors = {
        'PER': {
            fmp: (q, m) => safeParse(q?.pe) ?? safeParse(m?.peRatioTTM) ?? null,
            finnhub: (m) => safeParse(m?.peNormalizedAnnual) ?? safeParse(m?.peBasicExclExtraTTM) ?? null,
            eodhd: (hi, val) => safeParse(hi?.PERatio) ?? safeParse(val?.TrailingPE) ?? safeParse(val?.ForwardPE) ?? null,
            yahoo: (f) => safeParse(f?.peRatio) ?? safeParse(f?.pe) ?? null,
            rapidapi: (d) => safeParse(d?.trailingPE) ?? null,
            fullData: (data) => safeParse(data?.fundamentals?.peRatio) ?? safeParse(data?.fundamentals?.pe) ?? null,
            format: v => `PER은 ${parseFloat(v).toFixed(2)}배입니다.`
        },
        'PBR': {
            fmp: (q, m) => safeParse(m?.pbRatioTTM) ?? null,
            finnhub: (m) => safeParse(m?.pbAnnual) ?? null,
            eodhd: (hi, val) => safeParse(val?.PriceBookMRQ) ?? null,
            yahoo: (f) => safeParse(f?.pbRatio) ?? safeParse(f?.priceToBook) ?? null,
            rapidapi: (d) => safeParse(d?.priceToBook) ?? null,
            fullData: (data) => safeParse(data?.fundamentals?.pbRatio) ?? null,
            format: v => `PBR은 ${parseFloat(v).toFixed(2)}배입니다.`
        },
        'ROE': {
            fmp: (q, m) => { const v = safeParse(m?.roeTTM); return v != null ? v * 100 : null; },
            finnhub: (m) => safeParse(m?.roeAnnual) ?? safeParse(m?.roeTTM) ?? null,
            eodhd: (hi, val) => { const v = safeParse(hi?.ReturnOnEquityTTM); return v != null ? v * 100 : null; },
            yahoo: (f) => {
                // Yahoo returns ROE as "10.8%" string or raw float
                const raw = f?.roe;
                if (raw == null) return null;
                const n = safeParse(raw);
                if (n == null) return null;
                // 이미 % 포맷이면 그대로, 아니면 *100
                return n > 1 ? n : n * 100;
            },
            rapidapi: (d) => { const v = safeParse(d?.returnOnEquity); return v != null ? v * 100 : null; },
            fullData: (data) => {
                const raw = data?.fundamentals?.roe;
                if (raw == null) return null;
                const n = safeParse(raw);
                if (n == null) return null;
                return n > 1 ? n : n * 100;
            },
            format: v => `ROE는 ${parseFloat(v).toFixed(1)}%입니다.`
        },
        'EPS': {
            fmp: (q, m) => safeParse(q?.eps) ?? null,
            finnhub: (m) => safeParse(m?.epsNormalizedAnnual) ?? null,
            eodhd: (hi, val) => safeParse(hi?.EPS) ?? null,
            yahoo: (f) => safeParse(f?.eps) ?? null,
            rapidapi: (d) => safeParse(d?.epsTrailingTwelveMonths) ?? null,
            fullData: (data) => safeParse(data?.fundamentals?.eps) ?? null,
            format: v => {
                const currency = isKR ? '₩' : '$';
                return `EPS(주당순이익)는 ${currency}${parseFloat(v).toFixed(2)}입니다.`;
            }
        },
        'DIVIDEND': {
            fmp: (q, m) => { const v = safeParse(m?.dividendYieldTTM); return v != null ? v * 100 : (safeParse(m?.dividendYieldPercentageTTM) ?? null); },
            finnhub: (m) => safeParse(m?.dividendYieldIndicatedAnnual) ?? safeParse(m?.dividendYield5Y) ?? null,
            eodhd: (hi, val) => { const v = safeParse(hi?.DividendYield); return v != null ? v * 100 : null; },
            yahoo: (f) => { const v = safeParse(f?.dividendYield); return v != null ? v * 100 : null; },
            rapidapi: (d) => safeParse(d?.dividendYield) ?? null,
            fullData: (data) => {
                const v = safeParse(data?.fundamentals?.dividendYield);
                return v != null ? v * 100 : null;
            },
            format: v => `배당수익률은 ${parseFloat(v).toFixed(2)}%입니다.`
        },
        'FCF': {
            fmp: (q, m) => { const v = safeParse(m?.freeCashFlowPerShareTTM); return v ? (v * (q?.sharesOutstanding || 1)) : null; },
            finnhub: (m) => null,
            eodhd: (hi, val) => null,
            yahoo: (f) => safeParse(f?.freeCashFlow) ?? null,
            rapidapi: (d) => null,
            fullData: (data) => safeParse(data?.fundamentals?.freeCashFlow) ?? null,
            format: v => {
                const abs = Math.abs(parseFloat(v));
                if (isKR) return `자유현금흐름(FCF)은 ₩${(abs/1e12).toFixed(2)}T입니다.`;
                return `자유현금흐름(FCF)은 $${(abs/1e9).toFixed(2)}B입니다.`;
            }
        },
        'DEBT': {
            fmp: (q, m) => safeParse(m?.debtToEquityTTM) ?? null,
            finnhub: (m) => safeParse(m?.totalDebt_totalEquityAnnual) ?? null,
            eodhd: (hi, val) => null,
            yahoo: (f) => safeParse(f?.debtToEquity) ?? null,
            rapidapi: (d) => safeParse(d?.debtToEquity) ?? null,
            fullData: (data) => safeParse(data?.fundamentals?.debtToEquity) ?? null,
            format: v => `부채비율(D/E)은 ${parseFloat(v).toFixed(2)}입니다.`
        }
    };

    const ex = extractors[metricClass];
    if (!ex) return { status: 'NO_DATA' };

    const sources = [
        {
            name: 'Yahoo',
            fetch: async () => {
                const f = await yahoo.getYahooFundamentals(ticker);
                return f ? ex.yahoo(f) : null;
            }
        },
        {
            name: 'Finnhub',
            fetch: async () => {
                const key = process.env.FINNHUB_API_KEY;
                if (!key) return null;
                // Finnhub 한국 주식도 지원 (티커 그대로)
                const res = await axios.get(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${key}`, { timeout: 3000 }).catch(()=>null);
                return res?.data?.metric ? ex.finnhub(res.data.metric) : null;
            }
        },
        {
            name: 'FMP',
            fetch: async () => {
                const key = process.env.FMP_API_KEY;
                if (!key) return null;
                const fmpTicker = isKR ? usTicker : ticker;
                const [qRes, mRes] = await Promise.all([
                    axios.get(`https://financialmodelingprep.com/api/v3/quote/${fmpTicker}?apikey=${key}`, { timeout: 3000 }).catch(()=>null),
                    axios.get(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${fmpTicker}?apikey=${key}`, { timeout: 3000 }).catch(()=>null)
                ]);
                return ex.fmp(qRes?.data?.[0], mRes?.data?.[0]);
            }
        },
        {
            name: 'RapidAPI',
            fetch: async () => {
                const key = process.env.RAPIDAPI_KEY;
                if (!key) return null;
                const res = await axios.get(`https://yahoo-finance15.p.rapidapi.com/api/v1/markets/stock/quotes?ticker=${ticker}`, {
                    headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'yahoo-finance15.p.rapidapi.com' },
                    timeout: 3000
                }).catch(() => null);
                const d = res?.data?.body?.[0];
                return d ? ex.rapidapi(d) : null;
            }
        },
        {
            name: 'EODHD',
            fetch: async () => {
                const key = process.env.EODHD_API_KEY;
                if (!key) return null;
                const suffix = isKR ? '.KO' : '.US';
                const eoTicker = isKR ? usTicker : ticker;
                const res = await axios.get(`https://eodhd.com/api/fundamentals/${eoTicker}${suffix}?api_token=${key}&fmt=json`, { timeout: 3000 }).catch(()=>null);
                return res?.data ? ex.eodhd(res.data.Highlights, res.data.Valuation) : null;
            }
        }
    ];

    let foundValue = null;
    let foundSource = null;
    const attemptLog = [];

    for (const src of sources) {
        try {
            const val = await src.fetch();
            const parsed = safeParse(val);
            attemptLog.push({ name: src.name, result: parsed != null ? 'OK' : 'no data' });
            if (parsed != null) {
                foundValue = parsed;
                foundSource = src.name;
                console.log(`[DeepMetric] ✅ ${ticker} ${metricClass} = ${parsed} (출처: ${src.name})`);
                break;
            }
        } catch(e) {
            attemptLog.push({ name: src.name, result: e.message?.slice(0, 40) });
        }
    }

    // 탐색 로그 출력
    console.log(`[DeepMetric] 탐색 결과: ${attemptLog.map(a => `${a.name}(${a.result})`).join(' → ')}`);

    // 풀 데이터 fallback: 단일 지표 탐색이 다 실패하면, 전체 fetchAllStockData의 cached 데이터에서 추출 시도
    if (foundValue == null && ex.fullData) {
        const cachedKey = `ALL_${ticker}`;
        const cached = orchestrationCache.get(cachedKey);
        if (cached) {
            const fullVal = ex.fullData(cached.data);
            if (fullVal != null) {
                foundValue = fullVal;
                foundSource = 'Cached/' + (cached.data?.fundamentals?.source || 'Unknown');
                console.log(`[DeepMetric] 🛡️ 캐시 fallback: ${ticker} ${metricClass} = ${fullVal} (출처: ${foundSource})`);
            }
        }
    }

    if (foundValue != null) {
        if (metricClass === 'DIVIDEND' && parseFloat(foundValue) === 0) {
            console.log(`[DeepMetric] 🔍 ${ticker} 배당 0 확인 -> NO_DIVIDEND`);
            return { status: 'NO_DIVIDEND', formattedText: '현재 배당을 지급하지 않습니다 (무배당).' };
        }
        
        return {
            status: 'SUCCESS',
            value: foundValue,
            source: foundSource,
            formattedText: ex.format(foundValue) + ` (출처: ${foundSource})`
        };
    }

    if (metricClass === 'DIVIDEND') {
        console.log(`[DeepMetric] ❌ ${ticker} 배당 정보 5개 소스 모두 없음 -> NO_DIVIDEND 간주`);
        return { status: 'NO_DIVIDEND', formattedText: '현재 배당을 지급하지 않습니다 (무배당).' };
    }

    console.log(`[DeepMetric] ❌ ${ticker} ${metricClass} 끝내 못찾음 -> NO_DATA`);
    return { status: 'NO_DATA' };
}

module.exports = { fetchAllStockData, fetchMarketData, fetchSectorData, getMacroData, getApiStats, computeDataReliability, fetchDeepMetric, getAuditSnapshot, resetAuditCollector };

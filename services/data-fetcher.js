/**
 * data-fetcher.js — Full multi-source pipeline with tiered fallback chains
 *
 * Price:         TwelveData → Polygon → Tiingo → Yahoo(yf2)
 * Technicals:    TwelveData → AlphaVantage → Yahoo(yf2 로컸계산)
 * Fundamentals:  Yahoo(yf2) → Finnhub → EODHD
 * News:          NewsAPI → Finnhub → Yahoo(yf2)
 * Analyst:       Finnhub → Yahoo(yf2)
 * Macro:         FRED
 * SEC Filings:   data.sec.gov (free, no key)
 * KR 재무:       DART + Yahoo(yf2 .KS)
 */
const axios = require('axios');
const yahoo = require('./yahoo-finance-helper');

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
// 5분 메모리 캐시
// ─────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function fromCache(key) {
    const e = cache.get(key);
    return e && Date.now() - e.ts < CACHE_TTL ? e.data : null;
}
function toCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

// ─────────────────────────────────────────────
// Safe fetch — 에러 없이 null 반환 + 통계 기록
// ─────────────────────────────────────────────
async function safeGet(label, fn) {
    const t0 = Date.now();
    try {
        const r = await fn();
        const ok = r !== null && r !== undefined;
        recordStat(label, ok, Date.now() - t0);
        if (ok) console.log(`[\u2705 ${label}] OK`);
        return r;
    } catch (e) {
        const status = e.response?.status;
        recordStat(label, false, Date.now() - t0);
        const reason = status === 403 ? 'invalid key/plan'
            : status === 429 ? 'rate limited'
            : status === 404 ? 'not found'
            : (e.code || e.message?.slice(0, 60));
        console.warn(`[\u26a0\ufe0f  ${label}] Failed (${reason})`);
        return null;
    }
}

// ─────────────────────────────────────────────
// Fallback runner — sources 순서대로 시도
// ─────────────────────────────────────────────
async function withFallback(label, sources) {
    for (const [name, fn] of sources) {
        const result = await safeGet(`${label}/${name}`, fn);
        if (result !== null && result !== undefined) return result;
    }
    console.warn(`[\u274c ${label}] All sources failed`);
    return null;
}

// ═══════════════════════════════════════════════════════
// ① PRICE DATA — TwelveData → Polygon → Tiingo → Yahoo
// ═══════════════════════════════════════════════════════
async function getPriceData(ticker) {
    const cacheKey = `price_${ticker}`;
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    const data = await withFallback('Price', [
        ['TwelveData', async () => {
            const key = process.env.TWELVEDATA_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${key}`, { timeout: 8000 });
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
            const res = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?apiKey=${key}`, { timeout: 8000 });
            const r = res.data.results?.[0];
            if (!r) return null;
            const q = await axios.get(`https://api.polygon.io/v2/last/trade/${ticker}?apiKey=${key}`, { timeout: 5000 }).catch(() => null);
            const current = q?.data?.results?.p || r.c;
            return {
                current: parseFloat(current),
                open: r.o, high: r.h, low: r.l, prevClose: r.c,
                change: parseFloat((current - r.c).toFixed(2)),
                changePct: parseFloat(((current - r.c) / r.c * 100).toFixed(2)),
                volume: r.v, source: 'Polygon'
            };
        }],
        // 3순위: Yahoo Finance (yf2) — 한국 포함 보편적
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

    const data = await withFallback('History', [
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

    // Primary: TwelveData (all in one)
    const td = await safeGet('Tech/TwelveData', async () => {
        const key = process.env.TWELVEDATA_API_KEY;
        if (!key) return null;
        const [rsiR, macdR, ema20R, ema50R, sma200R, volR, stochR] = await Promise.allSettled([
            axios.get(`https://api.twelvedata.com/rsi?symbol=${ticker}&interval=1day&time_period=14&apikey=${key}`, { timeout: 8000 }),
            axios.get(`https://api.twelvedata.com/macd?symbol=${ticker}&interval=1day&apikey=${key}`, { timeout: 8000 }),
            axios.get(`https://api.twelvedata.com/ema?symbol=${ticker}&interval=1day&time_period=20&apikey=${key}`, { timeout: 8000 }),
            axios.get(`https://api.twelvedata.com/ema?symbol=${ticker}&interval=1day&time_period=50&apikey=${key}`, { timeout: 8000 }),
            axios.get(`https://api.twelvedata.com/sma?symbol=${ticker}&interval=1day&time_period=200&apikey=${key}`, { timeout: 8000 }),
            axios.get(`https://api.twelvedata.com/volume?symbol=${ticker}&interval=1day&outputsize=5&apikey=${key}`, { timeout: 8000 }),
            axios.get(`https://api.twelvedata.com/stoch?symbol=${ticker}&interval=1day&apikey=${key}`, { timeout: 8000 })
        ]);
        const val = (r, path) => { try { return r.status === 'fulfilled' ? r.value.data?.values?.[0]?.[path] : null; } catch { return null; } };
        const rsiNum = val(rsiR, 'rsi') ? parseFloat(val(rsiR, 'rsi')) : null;
        const macdV = macdR.status === 'fulfilled' ? macdR.value.data?.values?.[0] : null;
        const vols = volR.status === 'fulfilled' ? volR.value.data?.values?.map(v => parseInt(v.volume)).filter(Boolean) : null;
        const stochV = stochR.status === 'fulfilled' ? stochR.value.data?.values?.[0] : null;

        if (!rsiNum && !macdV && !val(ema20R, 'ema')) return null; // API 호출이 완전히 막힌 경우 (Rate Limit 등) -> 다음 Fallback으로 넘기기

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
    });
    if (td) { toCache(cacheKey, td); return td; }

    // Fallback: AlphaVantage (RSI only)
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
    });
    if (av) { toCache(cacheKey, av); return av; }

    // Final Fallback: Yahoo Finance (로컬 계산)
    const yh = await safeGet('Tech/Yahoo', () => yahoo.getYahooTechnicals(ticker));
    if (yh) toCache(cacheKey, yh);
    return yh;
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
        // 1순위: Yahoo Finance (FCF/Revenue/NetIncome/ROE 등 핵심 재무 안정 제공)
        ['Yahoo/yahoo-finance2', () => yahoo.getYahooFundamentals(ticker)],

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

        // 3순위: EODHD
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
        // NewsAPI
        safeGet('News/NewsAPI', async () => {
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
        }),
        // Finnhub
        safeGet('News/Finnhub', async () => {
            const key = process.env.FINNHUB_API_KEY;
            if (!key || !ticker) return [];
            const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
            const to = new Date().toISOString().slice(0, 10);
            const res = await axios.get(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${key}`, { timeout: 8000 });
            return (res.data || []).slice(0, 5).map(a => ({
                title: a.headline, description: a.summary,
                source: a.source, publishedAt: new Date(a.datetime * 1000).toISOString().slice(0, 10), url: a.url
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

/**
 * Full stock data bundle: price + history + technicals + fundamentals + news + macro + analyst + SEC
 */
async function fetchAllStockData(ticker, companyName = null, corpCode = null) {
    const query = companyName || ticker;
    const isKR = ticker.endsWith('.KS');
    console.log(`\n[DataFetcher] Starting full pipeline for: ${ticker}`);

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
    if (!fundamentals) {
        console.log(`[DataFetcher] ⚡ ${ticker} 재무 누락 → Yahoo 직접 재시도`);
        fundamentals = await safeGet('Fund/Yahoo-retry', () => yahoo.getYahooFundamentals(ticker));
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
        `${'─'.repeat(50)}`,
        `[DataFetcher] ✅ Pipeline complete for: ${ticker}`,
    ];
    console.log(vLog.join('\n'));

    return { ticker, companyName: companyName || ticker, price, history, technical, bbands, fundamentals, news, macro, analystRatings, secFilings, disclosures, supportResist };
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
    const checks = {
        price:        { weight: 30, ok: data.price?.current != null },
        technical:    { weight: 25, ok: data.technical?.rsi != null },
        fundamentals: { weight: 20, ok: data.fundamentals?.peRatio != null || data.fundamentals?.revenue != null },
        news:         { weight: 15, ok: (data.news?.length || 0) >= 1 },
        macro:        { weight: 10, ok: data.macro?.vix != null },
    };

    let totalWeight = 0;
    let earnedWeight = 0;
    const available = [];
    const missing = [];

    for (const [key, { weight, ok }] of Object.entries(checks)) {
        totalWeight += weight;
        if (ok) {
            earnedWeight += weight;
            available.push(key);
        } else {
            missing.push(key);
        }
    }

    const pct = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

    // 등급 결정
    let tier, label, emoji;
    if (!checks.price.ok) {
        // 가격 데이터조차 없으면 무조건 NO_DATA
        tier = 'NO_DATA';
        label = '분석 불가';
        emoji = '🔴';
    } else if (pct >= 80) {
        tier = 'FULL';
        label = '전체 분석 가능';
        emoji = '🟢';
    } else {
        // 가격 데이터만 있다면 최소한 부분 분석(PARTIAL)은 보장
        tier = 'PARTIAL';
        label = '부분 분석 가능';
        emoji = '🟡';
    }

    const reliability = pct >= 80 ? 'HIGH' : pct >= 50 ? 'MEDIUM' : 'LOW';

    const summary = {
        tier,         // FULL | PARTIAL | NO_DATA
        reliability,  // HIGH | MEDIUM | LOW
        label,
        emoji,
        pct: Math.round(pct),
        available,
        missing,
        detail: Object.fromEntries(
            Object.entries(checks).map(([k, v]) => [k, { loaded: v.ok, weight: v.weight }])
        ),
    };

    console.log(`[DataReliability] ${emoji} ${tier} (${summary.pct}%) — 신뢰도: ${reliability}`);
    console.log(`[DataReliability] ✅ 확보: ${available.join(', ') || 'none'}`);
    if (missing.length) console.log(`[DataReliability] ❌ 미확보: ${missing.join(', ')}`);

    return summary;
}

module.exports = { fetchAllStockData, fetchMarketData, fetchSectorData, getMacroData, getApiStats, computeDataReliability };

/**
 * data-fetcher.js — Full multi-source pipeline with tiered fallback chains
 *
 * Price:         TwelveData → Polygon → Tiingo → Yahoo Finance (RapidAPI)
 * Technicals:    TwelveData → AlphaVantage
 * Fundamentals:  FMP → EODHD → Yahoo Finance (RapidAPI)
 * News:          NewsAPI → Finnhub → Yahoo Finance (RapidAPI)
 * Macro:         FRED → Nasdaq Data Link
 * SEC Filings:   data.sec.gov (free, no key)
 * KR Disclos.:   DART
 */
const axios = require('axios');

// ─────────────────────────────────────────────
// Simple 5-minute in-memory cache
// ─────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function fromCache(key) {
    const e = cache.get(key);
    return e && Date.now() - e.ts < CACHE_TTL ? e.data : null;
}
function toCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

// ─────────────────────────────────────────────
// Safe fetch — never throws, always returns null on error
// ─────────────────────────────────────────────
async function safeGet(label, fn) {
    try {
        const r = await fn();
        if (r !== null && r !== undefined) console.log(`[✅ ${label}] OK`);
        return r;
    } catch (e) {
        const status = e.response?.status;
        console.warn(`[⚠️  ${label}] Failed (${status || e.code || e.message})`);
        return null;
    }
}

// ─────────────────────────────────────────────
// Fallback runner — tries sources in order
// ─────────────────────────────────────────────
async function withFallback(label, sources) {
    for (const [name, fn] of sources) {
        const result = await safeGet(`${label}/${name}`, fn);
        if (result !== null && result !== undefined) return result;
    }
    console.warn(`[❌ ${label}] All sources failed`);
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
        ['Polygon', async () => {
            const key = process.env.POLYGON_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?apiKey=${key}`, { timeout: 8000 });
            const r = res.data.results?.[0];
            if (!r) return null;
            // Get current quote
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
        ['Tiingo', async () => {
            const key = process.env.TIINGO_API_KEY;
            if (!key) return null;
            const res = await axios.get(`https://api.tiingo.com/tiingo/daily/${ticker}/prices?token=${key}`, { timeout: 8000 });
            const d = res.data?.[0];
            if (!d) return null;
            return {
                current: d.close, open: d.open, high: d.high, low: d.low,
                prevClose: d.adjClose, change: null, changePct: null,
                volume: d.volume, source: 'Tiingo'
            };
        }],
        ['Yahoo/RapidAPI', async () => {
            const key = process.env.RAPIDAPI_KEY;
            if (!key) return null;
            const res = await axios.get('https://yahoo-finance15.p.rapidapi.com/api/v1/markets/quote', {
                params: { ticker, type: 'STOCKS' },
                headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'yahoo-finance15.p.rapidapi.com' },
                timeout: 8000
            });
            const d = res.data?.body;
            if (!d) return null;
            const currentPrice = d.regularMarketPrice ?? d.price ?? null;
            if (!currentPrice) return null; // 가격 없으면 소스 무효
            return {
                current: currentPrice,
                open: d.regularMarketOpen ?? null,
                high: d.regularMarketDayHigh ?? null,
                low: d.regularMarketDayLow ?? null,
                prevClose: d.regularMarketPreviousClose ?? null,
                change: d.regularMarketChange ?? null,
                changePct: d.regularMarketChangePercent ?? null,
                volume: d.regularMarketVolume ?? null,
                fifty2High: d.fiftyTwoWeekHigh ?? null,
                fifty2Low: d.fiftyTwoWeekLow ?? null,
                source: 'Yahoo'
            };
        }]
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
        }]
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
        return {
            rsi: rsiNum,
            rsiSignal: rsiNum < 30 ? '과매도' : rsiNum > 70 ? '과매수' : '중립',
            macd: null, ema20: null, ema50: null, sma200: null, avgVolume: null, stoch: null,
            source: 'AlphaVantage'
        };
    });
    if (av) toCache(cacheKey, av);
    return av;
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
// ⑤ FUNDAMENTALS — FMP → EODHD → Yahoo Finance
// ═══════════════════════════════════════════════════════
async function getFundamentals(ticker) {
    const cacheKey = `fund_${ticker}`;
    const cached = fromCache(cacheKey);
    if (cached) return cached;

    const data = await withFallback('Fundamentals', [
        ['FMP', async () => {
            const key = process.env.FMP_API_KEY;
            if (!key) return null;
            const [profileR, ratiosR, incomeR, earningsR] = await Promise.allSettled([
                axios.get(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${key}`, { timeout: 8000 }),
                axios.get(`https://financialmodelingprep.com/api/v3/ratios-ttm/${ticker}?apikey=${key}`, { timeout: 8000 }),
                axios.get(`https://financialmodelingprep.com/api/v3/income-statement/${ticker}?limit=4&apikey=${key}`, { timeout: 8000 }),
                axios.get(`https://financialmodelingprep.com/api/v3/earning_calendar?symbol=${ticker}&apikey=${key}`, { timeout: 8000 })
            ]);
            const profile = profileR.status === 'fulfilled' ? profileR.value.data?.[0] : {};
            const ratios = ratiosR.status === 'fulfilled' ? ratiosR.value.data?.[0] : {};
            const income = incomeR.status === 'fulfilled' ? incomeR.value.data : [];
            const earnings = earningsR.status === 'fulfilled' ? earningsR.value.data : [];
            const latestIncome = income?.[0] || {};
            const prevIncome = income?.[1] || {};
            const revGrowth = latestIncome.revenue && prevIncome.revenue
                ? (((latestIncome.revenue - prevIncome.revenue) / prevIncome.revenue) * 100).toFixed(1) + '%'
                : null;
            const nextEarnings = earnings?.find(e => new Date(e.date) > new Date());
            return {
                companyName: profile?.companyName,
                sector: profile?.sector,
                industry: profile?.industry,
                mktCap: profile?.mktCap,
                beta: profile?.beta,
                peRatio: ratios?.priceEarningsRatioTTM ? parseFloat(ratios.priceEarningsRatioTTM).toFixed(2) : null,
                eps: ratios?.epsTTM ? parseFloat(ratios.epsTTM).toFixed(2) : null,
                forwardPE: ratios?.priceToEarningsRatio ? parseFloat(ratios.priceToEarningsRatio).toFixed(2) : null,
                pbRatio: ratios?.priceToBookRatioTTM ? parseFloat(ratios.priceToBookRatioTTM).toFixed(2) : null,
                debtToEquity: ratios?.debtEquityRatioTTM ? parseFloat(ratios.debtEquityRatioTTM).toFixed(2) : null,
                netMargin: ratios?.netProfitMarginTTM ? (parseFloat(ratios.netProfitMarginTTM) * 100).toFixed(1) + '%' : null,
                roe: ratios?.returnOnEquityTTM ? (parseFloat(ratios.returnOnEquityTTM) * 100).toFixed(1) + '%' : null,
                revenueGrowthYoY: revGrowth,
                revenue: latestIncome.revenue,
                grossProfit: latestIncome.grossProfit,
                nextEarningsDate: nextEarnings?.date || null,
                nextEarningsEPS: nextEarnings?.eps || null,
                source: 'FMP'
            };
        }],
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
                debtToEquity: hi?.TotalDebt ? null : null,
                netMargin: hi?.ProfitMargin ? (parseFloat(hi.ProfitMargin) * 100).toFixed(1) + '%' : null,
                roe: hi?.ReturnOnEquityTTM ? (parseFloat(hi.ReturnOnEquityTTM) * 100).toFixed(1) + '%' : null,
                revenueGrowthYoY: hi?.QuarterlyRevenueGrowthYOY ? (parseFloat(hi.QuarterlyRevenueGrowthYOY) * 100).toFixed(1) + '%' : null,
                revenue: hi?.RevenueTTM,
                grossProfit: null,
                nextEarningsDate: null,
                source: 'EODHD'
            };
        }],
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
        ['Yahoo/RapidAPI', async () => {
            const key = process.env.RAPIDAPI_KEY;
            if (!key) return null;
            const res = await axios.get('https://yahoo-finance15.p.rapidapi.com/api/v1/markets/quote', {
                params: { ticker, type: 'STOCKS' },
                headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'yahoo-finance15.p.rapidapi.com' },
                timeout: 8000
            });
            const d = res.data?.body;
            if (!d) return null;
            return {
                companyName: d.longName || d.shortName,
                sector: d.sector,
                industry: d.industry,
                mktCap: d.marketCap,
                beta: d.beta,
                peRatio: d.trailingPE ? parseFloat(d.trailingPE).toFixed(2) : null,
                eps: d.epsTrailingTwelveMonths ? parseFloat(d.epsTrailingTwelveMonths).toFixed(2) : null,
                forwardPE: d.forwardPE ? parseFloat(d.forwardPE).toFixed(2) : null,
                pbRatio: d.priceToBook ? parseFloat(d.priceToBook).toFixed(2) : null,
                debtToEquity: null,
                netMargin: null, roe: null,
                revenueGrowthYoY: null,
                revenue: d.totalRevenue,
                grossProfit: null,
                nextEarningsDate: null,
                source: 'Yahoo'
            };
        }]
    ]);

    if (data) toCache(cacheKey, data);
    return data;
}


// ═══════════════════════════════════════════════════════
// ⑥ NEWS — NewsAPI → Finnhub → Yahoo Finance
// ═══════════════════════════════════════════════════════
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
        ['NasdaqDataLink', async () => {
            const key = process.env.NASDAQ_API_KEY;
            if (!key) return null;
            // Use Quandl/Nasdaq Data Link for FRED-equivalent data
            const res = await axios.get(`https://data.nasdaq.com/api/v3/datasets/FRED/FEDFUNDS.json?api_key=${key}&rows=1`, { timeout: 8000 });
            const rate = res.data?.dataset?.data?.[0]?.[1];
            return {
                federalFundsRate: rate ? String(rate) : null,
                cpi: null, unemployment: null, tenYearYield: null, vix: null,
                dataDate: new Date().toISOString().slice(0, 10),
                source: 'NASDAQ'
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

    const [price, history, technical, bbands, fundamentals, news, macro, analystRatings, secFilings, disclosures] = await Promise.all([
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

    // Compute simple support/resistance from candle data
    let supportResist = null;
    if (history?.closes?.length >= 5) {
        const sorted = [...history.closes].sort((a, b) => a - b);
        supportResist = {
            support: sorted[Math.floor(sorted.length * 0.2)].toFixed(2),
            resistance: sorted[Math.floor(sorted.length * 0.8)].toFixed(2)
        };
    }

    console.log(`[DataFetcher] ✅ Pipeline complete for: ${ticker}`);
    console.log(`[DataSource] price_source=${price?.source || 'none'} | fundamental_source=${fundamentals?.source || 'none'} | news_count=${news?.length || 0} | macro_source=${macro?.source || 'none'}`);
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

module.exports = { fetchAllStockData, fetchMarketData, fetchSectorData, getMacroData };

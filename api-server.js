/**
 * api-server.js — yeri-project REST API 서버
 * 실행: node api-server.js
 * 기본 포트: 3001
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

// ── 필수 환경변수 검증 (Render 배포 실패 방지) ─────────────────────
const REQUIRED_ENV = ['OPENAI_API_KEY'];
const MISSING_ENV = REQUIRED_ENV.filter(k => !process.env[k]);
if (MISSING_ENV.length) {
    console.error('');
    console.error('╔══════════════════════════════════════════════╗');
    console.error('║  ❌  FATAL: Required ENV vars are missing    ║');
    console.error('╠══════════════════════════════════════════════╣');
    MISSING_ENV.forEach(k => console.error(`║  →  ${k.padEnd(40)}║`));
    console.error('╠══════════════════════════════════════════════╣');
    console.error('║  Set these in Render → Environment Variables ║');
    console.error('╚══════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
}

// Optional env 경고 (기능 제한)
const OPTIONAL_ENV = ['FINNHUB_API_KEY', 'TWELVEDATA_API_KEY',
    'ALPHAVANTAGE_API_KEY', 'FMP_API_KEY', 'NEWS_API_KEY'];
const missingOpt = OPTIONAL_ENV.filter(k => !process.env[k]);
if (missingOpt.length) {
    console.warn(`⚠️  Optional ENV missing (limited features): ${missingOpt.join(', ')}`);
}

const maskedKey = process.env.OPENAI_API_KEY.substring(0, 7) + '...';
console.log(`✅ OPENAI_API_KEY: ${maskedKey} confirmed`);


const express = require('express');
const cors = require('cors');

const {
    analyzeStock, analyzeStockBuyTiming, analyzeStockSellTiming,
    analyzeStockRisk, analyzeStockEarnings, analyzeStockCasual,
    analyzeStockOverheat, analyzeStockValuation, analyzeStockComparison,
    analyzeETF, analyzePortfolio, analyzeRecommendation,
    analyzeMarket, analyzeSector, classifyQuery, fallbackChat
} = require('./services/analyzer');
const { fetchAllStockData, fetchMarketData, fetchSectorData, computeDataReliability } = require('./services/data-fetcher');
const {
    resolveStock, resolveSector, isDeepAnalysisRequest,
    hasStockKeyword, hasEarningsKeyword, isETF, isLeveragedETF,
    getETFPeers, parsePortfolio, isPortfolioInput,
    isRecommendationKeyword, toFinnhubKRFormat, resolveKoreanTicker,
    findClosestAlias, extractCompanyName, suggestCandidates,
    resolveComparisonStocks, getCompanyDesc,
    SECTOR_MAP
} = require('./utils/ticker-util');
const { generateWatchlistBriefing, generateMarketBriefing } = require('./services/briefing_service');
const { searchTicker } = require('./services/ticker-search');
const { buildPerformanceReport } = require('./services/recommendation-tracker');
const { generateRecommendations } = require('./services/recommendation-engine');
const sessions = require('./services/session');
const watchlistStore = require('./services/watchlist-store');
const userSettings = require('./services/user-settings');
const { scanWatchlist, invalidateCache } = require('./services/alert-engine');

const app = express();
app.use(cors());
app.use(express.json());

// ── 정적 파일 서빙 (웹앱 프론트엔드) ──────────────────────────────
const webappDist = path.join(__dirname, 'yeri-webapp', 'dist');
app.use(express.static(webappDist));

// Render는 PORT 환경변수를 자동 주입 — API_PORT fallback 유지
const PORT = process.env.PORT || process.env.API_PORT || 3001;

// ── 루트 / 안내 응답 ───────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        ok: true,
        service: 'yeri-project',
        version: '1.0.0',
        status: 'running',
        endpoints: [
            'GET  /health',
            'GET  /api/health',
            'POST /api/chat',
            'GET  /api/watchlist/:userId',
            'POST /api/watchlist/:userId/add',
            'POST /api/watchlist/:userId/remove',
            'POST /api/watchlist/:userId/style',
            'GET  /api/briefing/:userId',
            'POST /api/portfolio/analyze',
            'GET  /api/market',
        ],
    });
});

// ── 헬스 체크 ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'yeri-project', status: 'running', time: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
    res.json({ ok: true, status: 'running', time: new Date().toISOString() });
});

// ── 채팅: 메시지 처리 ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    const { text, chatId = 'web-default', userId = 'web-user' } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    try {
        const useDeep = isDeepAnalysisRequest(text);
        let session = sessions.get(chatId) || sessions.create(chatId);
        const messages = [];

        // 추천 — 데이터 기반 엔진으로 교체
        if (isRecommendationKeyword(text) || text.includes('추천') || text.includes('뭐 사')) {
            try {
                const recs = await generateRecommendations();
                messages.push({
                    type: 'recommendation',
                    content: '📊 오늘의 추천 종목입니다 (데이터 기반 엄격 필터 적용)',
                    data: recs,
                });
            } catch (err) {
                console.error('[API /chat] 추천 엔진 실패:', err.message);
                messages.push({ type: 'text', content: '추천 데이터를 가져오는 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
            }
            return res.json({ messages });
        }

        // 시장 분석
        const intent = await classifyQuery(text);
        if (intent.type === 'market' || text.includes('시장') && !resolveStock(text)) {
            const data = await fetchMarketData();
            const report = await analyzeMarket(data, useDeep, 'normal');
            messages.push({ type: 'analysis', content: report });
            return res.json({ messages });
        }

        // 종목 지정 분석이 최우선 (섹터 오탐지 방지 - 예: "bbai"에 "ai"가 포함되어 섹터로 판단되는 문제 방지)
        const stockResult = resolveStock(text);
        
        // 종목 비교 분석 — 비교 키워드가 있을 때만 비교 분기 진입
        const COMPARISON_KEYWORDS = ['vs', 'VS', 'versus', '비교', '차이', '이랑', '랑', '대비', '어느게나아', '뭐가나아', '뭐가좋아', '둘중'];
        const hasComparisonKeyword = COMPARISON_KEYWORDS.some(k => text.replace(/\s/g, '').includes(k));
        const comparisonResult = hasComparisonKeyword ? resolveComparisonStocks(text) : null;

        if (comparisonResult) {
            const stocks = comparisonResult;
            let tickerA = stocks.stockA.ticker;
            let nameA = stocks.stockA.name;
            let tickerB = stocks.stockB.ticker;
            let nameB = stocks.stockB.name;

            // 한국 종목 처리
            if (stocks.stockA.market === 'KR') {
                const krA = resolveKoreanTicker(tickerA);
                if (krA) { tickerA = toFinnhubKRFormat(krA.ticker); nameA = krA.name; }
                else { tickerA = toFinnhubKRFormat(tickerA); }
            }
            if (stocks.stockB.market === 'KR') {
                const krB = resolveKoreanTicker(tickerB);
                if (krB) { tickerB = toFinnhubKRFormat(krB.ticker); nameB = krB.name; }
                else { tickerB = toFinnhubKRFormat(tickerB); }
            }

            const [dataA, dataB] = await Promise.all([
                fetchAllStockData(tickerA, nameA, stocks.stockA.corpCode || null),
                fetchAllStockData(tickerB, nameB, stocks.stockB.corpCode || null),
            ]);

            const report = await analyzeStockComparison(dataA, dataB, useDeep, 'normal');
            messages.push({ type: 'analysis', content: report, ticker: `${tickerA} vs ${tickerB}`, name: `${nameA} vs ${nameB}` });
            return res.json({ messages });
        }

        // 종목 단일 분석
        if (stockResult) {
            let ticker = stockResult.ticker;
            let name = stockResult.name;
            let market = stockResult.market;
            let corpCode = stockResult.corpCode || null;

            console.log(`[API /chat] ▶ resolve 결과: input="${text}" → ticker=${ticker}, name=${name}, market=${market}`);

            if (market === 'KR') {
                const krInfo = resolveKoreanTicker(ticker);
                if (krInfo) {
                    ticker = toFinnhubKRFormat(krInfo.ticker);
                    name = krInfo.name;
                    corpCode = krInfo.corpCode;
                } else {
                    ticker = toFinnhubKRFormat(ticker);
                }
            }

            // intent 결정 — compare_stocks는 단일 종목 분기에서 무시
            let stockIntent = 'full_analysis';
            if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
            else if (isETF(ticker)) stockIntent = 'etf_analysis';
            else if (intent.intent && intent.intent !== 'fallback' && intent.intent !== 'compare_stocks') stockIntent = intent.intent;

            const data = await fetchAllStockData(ticker, name, corpCode);
            data.investmentContext = session.context;

            // ★ 데이터 신뢰도 검증 — 가격조차 없으면 분석 불가 응답
            const reliability = computeDataReliability(data);
            if (reliability.tier === 'NO_DATA') {
                console.warn(`[API /chat] ❌ ${ticker} 데이터 부족 (${reliability.pct}%) — 분석 거부`);
                const noDataMsg = `"${name || ticker}" (${ticker})의 실시간 데이터를 가져올 수 없었어요.\n\n` +
                    `가능한 원인:\n` +
                    `• 거래 시간 외이거나 데이터 제공사에서 해당 종목을 지원하지 않을 수 있어요\n` +
                    `• 소형주/신규 상장 종목은 데이터가 제한적일 수 있어요\n\n` +
                    `정확한 분석을 위해 잠시 후 다시 시도하거나, 정확한 티커를 확인해 주세요!`;
                messages.push({ type: 'text', content: noDataMsg });
                return res.json({ messages });
            }

            // PARTIAL 데이터일 때도 경고를 data에 포함
            if (reliability.tier === 'PARTIAL') {
                data._dataWarning = `⚠️ 일부 데이터 미확보 (신뢰도 ${reliability.pct}%). 누락: ${reliability.missing.join(', ')}`;
            }

            let report;
            switch (stockIntent) {
                case 'buy_timing':      report = await analyzeStockBuyTiming(data, useDeep, 'normal'); break;
                case 'sell_timing':     report = await analyzeStockSellTiming(data, useDeep, 'normal'); break;
                case 'risk_check':      report = await analyzeStockRisk(data, useDeep, 'normal'); break;
                case 'earnings_check':  report = await analyzeStockEarnings(data, useDeep, 'normal'); break;
                case 'overheat_check':  report = await analyzeStockOverheat(data, useDeep, 'normal'); break;
                case 'valuation_check': report = await analyzeStockValuation(data, useDeep, 'normal'); break;
                case 'etf_analysis':
                    report = await analyzeETF(data, useDeep, 'normal', {
                        isLeveraged: isLeveragedETF(ticker),
                        peers: getETFPeers(ticker) || []
                    });
                    break;
                default:
                    report = await (useDeep ? analyzeStock(data, useDeep, 'normal') : analyzeStockCasual(data, useDeep, 'normal'));
            }

            sessions.update(chatId, {
                lastAnalyzedTicker: ticker, lastAnalyzedName: name,
                lastAnalyzedMarket: market, lastTickerTime: Date.now(),
            });

            const expectedQuestions = [
                `${name || ticker} 최근 뉴스 요약해줘`,
                `${name || ticker} 실적 전망 살펴보기`,
                `${name || ticker} 경쟁사와 비교해줘`
            ];

            messages.push({ type: 'analysis', content: report, ticker, name, expectedQuestions });
            return res.json({ messages });
        }

        // 섹터 분석 (종목 매칭이 안 된 경우에만)
        const sectorInfo = resolveSector(text);
        if (sectorInfo || (intent.type === 'sector' && intent.sectorKey)) {
            const key = sectorInfo
                ? Object.keys(SECTOR_MAP).find(k => SECTOR_MAP[k].sector === sectorInfo.sector) || 'ai'
                : intent.sectorKey;
            const sectorData = await fetchSectorData(SECTOR_MAP[key]);
            const report = await analyzeSector(sectorData, useDeep, 'normal');
            messages.push({ type: 'analysis', content: report });
            return res.json({ messages });
        }



        // 포트폴리오
        if (isPortfolioInput(text)) {
            const items = parsePortfolio(text);
            if (items && items.length >= 2) {
                const report = await analyzePortfolio(items, useDeep, 'normal');
                messages.push({ type: 'analysis', content: report });
                return res.json({ messages });
            }
        }

        // 종목 키워드는 있는데 resolveStock이 실패한 경우 —
        // 1) 유사 종목 제안 (findClosestAlias 하드코딩 기반)
        // 2) ticker-search API 기반 자동 검색
        if (hasStockKeyword(text)) {
            const extracted = extractCompanyName(text) || text;

            // ── 1) suggestCandidates — Levenshtein 기반 후보 추천 ──
            const suggestion = suggestCandidates(extracted);

            // tier=HIGH (≥0.85): 자동 분석 진행
            if (suggestion.tier === 'HIGH' && suggestion.resolved) {
                console.log(`[API /chat] suggestCandidates HIGH: "${extracted}" → ${suggestion.resolved.ticker}`);
                let ticker = suggestion.resolved.ticker;
                let name = suggestion.resolved.name;
                let market = suggestion.resolved.market;
                let corpCode = suggestion.resolved.corpCode || null;

                if (market === 'KR') {
                    const krInfo = resolveKoreanTicker(ticker);
                    if (krInfo) { ticker = toFinnhubKRFormat(krInfo.ticker); name = krInfo.name; corpCode = krInfo.corpCode; }
                    else { ticker = toFinnhubKRFormat(ticker); }
                }

                const data = await fetchAllStockData(ticker, name, corpCode);
                data.investmentContext = session.context;
                const reliability = computeDataReliability(data);
                if (reliability.tier === 'NO_DATA') {
                    messages.push({ type: 'text', content: `"${name}" (${ticker})의 실시간 데이터를 가져올 수 없었어요.\n\n잠시 후 다시 시도하거나, 정확한 티커를 확인해 주세요!` });
                    return res.json({ messages });
                }
                if (reliability.tier === 'PARTIAL') {
                    data._dataWarning = `⚠️ 일부 데이터 미확보 (신뢰도 ${reliability.pct}%). 누락: ${reliability.missing.join(', ')}`;
                }
                const report = await (useDeep ? analyzeStock(data, useDeep, 'normal') : analyzeStockCasual(data, useDeep, 'normal'));
                sessions.update(chatId, { lastAnalyzedTicker: ticker, lastAnalyzedName: name, lastTickerTime: Date.now() });
                messages.push({ type: 'analysis', content: report, ticker, name });
                return res.json({ messages });
            }

            // tier=MED (0.5~0.85): 후보 선택 UI 반환
            if (suggestion.tier === 'MED' && suggestion.candidates.length > 0) {
                console.log(`[API /chat] suggestCandidates MED: "${extracted}" → ${suggestion.candidates.length}개 후보`);
                messages.push({
                    type: 'candidates',
                    content: `입력하신 "${extracted}"에 해당하는 종목을 정확히 찾지 못했습니다.\n혹시 아래 종목 중 하나를 말씀하신 건가요?`,
                    candidates: suggestion.candidates.slice(0, 3).map(c => ({
                        ticker: c.ticker,
                        name: c.name,
                        market: c.market,
                        confidence: c.confidence,
                        tier: c.tier,
                        desc: getCompanyDesc(c.ticker) || null,
                    })),
                });
                return res.json({ messages });
            }

            // ── 2) ticker-search API 폴백 (suggest도 LOW인 경우) ──
            let searchResult;
            try {
                searchResult = await searchTicker(extracted);
            } catch (err) {
                console.warn('[API /chat] ticker-search 실패:', err.message);
                searchResult = { found: false, auto: false, ticker: null, candidates: [] };
            }

            if (searchResult.found && searchResult.auto) {
                console.log(`[API /chat] 자동 검색: "${extracted}" → ${searchResult.ticker}`);
                const ticker = searchResult.ticker;
                const name   = searchResult.name || ticker;

                const data = await fetchAllStockData(ticker, name, null);
                data.investmentContext = session.context;

                const reliability = computeDataReliability(data);
                if (reliability.tier === 'NO_DATA') {
                    messages.push({ type: 'text', content: `"${name}" (${ticker})의 실시간 데이터를 가져올 수 없었어요.\n\n잠시 후 다시 시도하거나, 정확한 티커를 확인해 주세요!` });
                    return res.json({ messages });
                }
                if (reliability.tier === 'PARTIAL') {
                    data._dataWarning = `⚠️ 일부 데이터 미확보 (신뢰도 ${reliability.pct}%). 누락: ${reliability.missing.join(', ')}`;
                }

                const searchIntent = await classifyQuery(text);
                let stockIntent = 'full_analysis';
                if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
                else if (isETF(ticker)) stockIntent = 'etf_analysis';
                else if (searchIntent.intent && searchIntent.intent !== 'fallback' && searchIntent.intent !== 'compare_stocks') stockIntent = searchIntent.intent;

                let report;
                switch (stockIntent) {
                    case 'buy_timing':      report = await analyzeStockBuyTiming(data, useDeep, 'normal'); break;
                    case 'sell_timing':     report = await analyzeStockSellTiming(data, useDeep, 'normal'); break;
                    case 'risk_check':      report = await analyzeStockRisk(data, useDeep, 'normal'); break;
                    case 'earnings_check':  report = await analyzeStockEarnings(data, useDeep, 'normal'); break;
                    case 'etf_analysis':    report = await analyzeETF(data, useDeep, 'normal', { isLeveraged: isLeveragedETF(ticker), peers: getETFPeers(ticker) || [] }); break;
                    default:                report = await (useDeep ? analyzeStock(data, useDeep, 'normal') : analyzeStockCasual(data, useDeep, 'normal'));
                }

                sessions.update(chatId, { lastAnalyzedTicker: ticker, lastAnalyzedName: name, lastTickerTime: Date.now() });
                messages.push({ type: 'analysis', content: report, ticker, name });
                return res.json({ messages });
            }

            // ticker-search에서 후보가 있으면 → candidates로 반환
            if (searchResult.found && searchResult.candidates.length > 0) {
                messages.push({
                    type: 'candidates',
                    content: `"${extracted}"에 해당하는 종목을 여러 개 찾았어요.\n혹시 아래 종목 중 하나를 말씀하신 건가요?`,
                    candidates: searchResult.candidates.slice(0, 3).map(c => ({
                        ticker: c.ticker,
                        name: c.name,
                        market: 'US',
                        confidence: c.confidence,
                        tier: c.confidence >= 0.85 ? 'HIGH' : c.confidence >= 0.5 ? 'MED' : 'LOW',
                        desc: getCompanyDesc(c.ticker) || null,
                    })),
                });
                return res.json({ messages });
            }

            // ── 3) 모두 실패 ──
            const noMatchMsg = `"${extracted}"에 해당하는 종목을 찾지 못했어요.\n\n정확한 티커(예: NVDA, TSLA, 005930)나 종목명(예: 엔비디아, 테슬라, 삼성전자)으로 다시 입력해 주세요!`;
            messages.push({ type: 'text', content: noMatchMsg });
            return res.json({ messages });
        }

        // Fallback
        const reply = await fallbackChat(text, 'normal');
        messages.push({ type: 'text', content: reply });
        res.json({ messages });

    } catch (err) {
        console.error('[API /chat]', err.message);
        res.status(500).json({ error: err.message });
    }
});
// ── 추천 API ─────────────────────────────────────────────────────
app.get('/api/recommendations', async (req, res) => {
    try {
        const recs = await generateRecommendations();
        res.json({ ok: true, ...recs });
    } catch (err) {
        console.error('[API /recommendations]', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── 관심종목 ──────────────────────────────────────────────────────
app.get('/api/watchlist/:userId', (req, res) => {
    const list = watchlistStore.get(req.params.userId);
    const style = watchlistStore.getStyle(req.params.userId);
    res.json({ list, style });
});

app.post('/api/watchlist/:userId/add', (req, res) => {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const result = watchlistStore.add(req.params.userId, ticker.toUpperCase());
    res.json({ result, list: watchlistStore.get(req.params.userId) });
});

app.post('/api/watchlist/:userId/remove', (req, res) => {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const result = watchlistStore.remove(req.params.userId, ticker.toUpperCase());
    res.json({ result, list: watchlistStore.get(req.params.userId) });
});

app.post('/api/watchlist/:userId/style', (req, res) => {
    const { style } = req.body;
    watchlistStore.setStyle(req.params.userId, style);
    res.json({ ok: true });
});

// ── 시장 브리핑 (단독) ────────────────────────────────────────────
app.get('/api/briefing/market', async (req, res) => {
    try {
        const report = await generateMarketBriefing();
        res.json({ report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 브리핑 ────────────────────────────────────────────────────────
app.get('/api/briefing/:userId', async (req, res) => {
    try {
        const list = watchlistStore.get(req.params.userId);
        if (!list.length) return res.json({ report: '', list: [] });
        const report = await generateWatchlistBriefing(list);
        res.json({ report, list });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 포트폴리오 분석 ───────────────────────────────────────────────
app.post('/api/portfolio/analyze', async (req, res) => {
    const { items } = req.body; // [{ name, ticker, weight }]
    if (!items || items.length < 2) return res.status(400).json({ error: 'items (min 2) required' });
    try {
        const report = await analyzePortfolio(items, false, 'normal');
        res.json({ report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 성과 리포트 ───────────────────────────────────────────────────
app.get('/api/performance/:userId', (req, res) => {
    try {
        const report = buildPerformanceReport(req.params.userId);
        res.json({ report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 시장 분석 (단독) ─────────────────────────────────────────────
app.get('/api/market', async (req, res) => {
    try {
        const data = await fetchMarketData();
        const report = await analyzeMarket(data, false, 'normal');
        res.json({ report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 웹앱 알림 엔진 ───────────────────────────────────────────────
// GET /api/alerts/:userId          — 관심종목 알림/상태 조회 (5분 캐시)
// GET /api/alerts/:userId?refresh=true — 캐시 무시하고 즉시 재스캔
app.get('/api/alerts/:userId', async (req, res) => {
    const { chatId } = req.params;
    const forceRefresh = req.query.refresh === 'true';
    try {
        if (forceRefresh) invalidateCache(chatId);
        const result = await scanWatchlist(chatId);
        res.json({
            ok: true,
            chatId,
            alertCount: result.alertCount || 0,
            alerts: result.alerts || [],
            stocks: result.stocks || [],
            updatedAt: result.updatedAt,
        });
    } catch (err) {
        console.error('[/api/alerts]', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/alerts/:userId/summary — 알림 배지 숫자만 빠르게 반환
app.get('/api/alerts/:userId/summary', async (req, res) => {
    const { chatId } = req.params;
    try {
        const result = await scanWatchlist(chatId);
        res.json({
            ok: true,
            alertCount: result.alertCount || 0,
            highCount: (result.alerts || []).filter(a => a.level === 'high').length,
            updatedAt: result.updatedAt,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});


// ── 유사 종목 추천 엔드포인트 ───────────────────────────────────────
// GET /api/suggest?q=엔비디어  → 후보 3~5개 + confidence 반환
app.get('/api/suggest', (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ ok: false, error: 'q 파라미터 필요' });
    try {
        const result = suggestCandidates(q);
        res.json({ ok: true, ...result });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── 종목 멀티 가격 조회 (포트폴리오용) ─────────────────────────────
// GET /api/stocks/min-data?tickers=AAPL,TSLA
app.get('/api/stocks/min-data', async (req, res) => {
    const tickersRaw = req.query.tickers || '';
    const tickers = tickersRaw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (!tickers.length) return res.json({ ok: true, data: {} });

    try {
        const results = await Promise.all(tickers.map(async (t) => {
            const priceData = await fetchAllStockData(t).catch(() => null);
            if (!priceData || !priceData.price) return [t, null];
            return [t, {
                price: priceData.price.current,
                changePct: priceData.price.changePct,
                currency: t.endsWith('.KS') || t.endsWith('.KQ') ? '₩' : '$'
            }];
        }));
        res.json({ ok: true, data: Object.fromEntries(results) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── SPA fallback — API 이외 GET 요청은 webapp index.html 서빙 ──
app.use((req, res) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(path.join(webappDist, 'index.html'));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Server running on port ${PORT}`);
    console.log(`   → Root:   https://yeri-project.onrender.com/`);
    console.log(`   → Health: https://yeri-project.onrender.com/health`);
    console.log(`   → Chat:   POST /api/chat`);
});

module.exports = app;

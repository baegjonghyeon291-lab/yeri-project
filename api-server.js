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
    analyzeMarket, analyzeSector, classifyQuery, fallbackChat, computeScore,
    normalizeData, validateData, computeScore6, classifyNewsItems
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

// hash 기반 JS/CSS는 1년 캐시 (immutable) — Vite가 파일명에 hash를 넣으므로 안전
app.use('/assets', express.static(path.join(webappDist, 'assets'), {
    maxAge: '365d',
    immutable: true
}));
// index.html 등 나머지는 항상 최신 확인 (no-cache)
app.use(express.static(webappDist, {
    maxAge: 0,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Render는 PORT 환경변수를 자동 주입 — API_PORT fallback 유지
const PORT = process.env.PORT || process.env.API_PORT || 3001;

// ── 배포 버전 확인 엔드포인트 ─────────────────────────────────────
let deployedHash = 'unknown';
try {
    const { execSync } = require('child_process');
    deployedHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch { /* Render에서 git 없으면 fallback */ }

app.get('/api/version', (req, res) => {
    res.json({
        commitHash: deployedHash,
        deployedAt: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV || 'development',
        distExists: require('fs').existsSync(webappDist),
        distFiles: require('fs').existsSync(path.join(webappDist, 'assets'))
            ? require('fs').readdirSync(path.join(webappDist, 'assets'))
            : []
    });
});

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

        // 1. 종목 비교 분석
        const COMPARISON_KEYWORDS = ['vs', 'VS', 'versus', '비교', '차이', '이랑', '랑', '대비', '어느게나아', '뭐가나아', '뭐가좋아', '둘중'];
        const hasComparisonKeyword = COMPARISON_KEYWORDS.some(k => text.replace(/\s/g, '').includes(k));
        const comparisonResult = hasComparisonKeyword ? resolveComparisonStocks(text) : null;

        if (comparisonResult) {
            const stocks = comparisonResult;
            let tickerA = stocks.stockA.ticker;
            let nameA = stocks.stockA.name;
            let tickerB = stocks.stockB.ticker;
            let nameB = stocks.stockB.name;

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

        // 2. 단일 종목 (Ticker Engine: normalize -> exact -> alias -> fuzzy)
        const extracted = extractCompanyName(text) || text.trim();
        const suggestion = suggestCandidates(extracted);
        const isStockIntent = hasStockKeyword(text) || (text.length <= 15 && !text.includes('안녕') && !text.includes('고마워'));

        // HIGH: 올바른 점수(0.85 이상) 이거나 정확히 일치 -> 바로 분석 수행
        if (suggestion.tier === 'HIGH' && suggestion.resolved) {
            let ticker = suggestion.resolved.ticker;
            let name = suggestion.resolved.name;
            let market = suggestion.resolved.market;
            let corpCode = suggestion.resolved.corpCode || null;

            console.log(`[API /chat] ▶ resolve 결과 (HIGH): input="${text}" → ticker=${ticker}, name=${name}, market=${market}`);
            if (market === 'KR') {
                const krInfo = resolveKoreanTicker(ticker);
                if (krInfo) { ticker = toFinnhubKRFormat(krInfo.ticker); name = krInfo.name; corpCode = krInfo.corpCode; }
                else { ticker = toFinnhubKRFormat(ticker); }
            }

            let stockIntent = 'full_analysis';
            if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
            else if (isETF(ticker)) stockIntent = 'etf_analysis';
            else if (intent.intent && intent.intent !== 'fallback' && intent.intent !== 'compare_stocks') stockIntent = intent.intent;

            const data = await fetchAllStockData(ticker, name, corpCode);
            data.investmentContext = session.context;

            const reliability = computeDataReliability(data);
            if (reliability.tier === 'NO_DATA') {
                console.warn(`[API /chat] ❌ ${ticker} 데이터 부족 (${reliability.pct}%) — 분석 거부`);
                messages.push({ type: 'text', content: `"${name || ticker}" (${ticker})의 실시간 데이터를 가져올 수 없었어요.\n잠시 후 다시 시도하거나 티커를 확인해 주세요!` });
                return res.json({ messages });
            }

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
                    report = await analyzeETF(data, useDeep, 'normal', { isLeveraged: isLeveragedETF(ticker), peers: getETFPeers(ticker) || [] });
                    break;
                default:
                    report = await (useDeep ? analyzeStock(data, useDeep, 'normal') : analyzeStockCasual(data, useDeep, 'normal'));
            }

            sessions.update(chatId, { lastAnalyzedTicker: ticker, lastAnalyzedName: name, lastAnalyzedMarket: market, lastTickerTime: Date.now() });

            // UI 렌더링용 구조화 데이터
            const score = computeScore(data);
            // 6대 점수 + 정규화 데이터
            const normalized = normalizeData(data);
            const { cleaned, warnings } = validateData(normalized, data);
            const newsAn = { positive: [], negative: [], neutral: [], total: 0 };
            if (data.news?.length) {
                const pk = ['beat','surge','growth','buy','upgrade','profit','rally','bullish'];
                const nk = ['miss','fall','drop','downgrade','sell','loss','cut','bearish'];
                for (const n of data.news.slice(0, 8)) {
                    const t = (n.title||'').toLowerCase();
                    const p = pk.filter(k => t.includes(k)).length;
                    const ng = nk.filter(k => t.includes(k)).length;
                    newsAn.total++;
                    if (p > ng) newsAn.positive.push(n);
                    else if (ng > p) newsAn.negative.push(n);
                    else newsAn.neutral.push(n);
                }
            }
            const s6 = computeScore6(cleaned, newsAn);
            const newsClassified = classifyNewsItems(data.news);

            // 핵심 지표 추출 (프론트 카드 UI용)
            const metrics = {};
            for (const [k, v] of Object.entries(cleaned)) {
                if (v._removed || v.value == null) continue;
                if (typeof v.value === 'object' && k === 'macd') continue;
                metrics[k] = { value: v.value, source: v.source };
            }

            const analysisData = {
                verdict: score.verdict,
                action: score.action,
                totalScore: s6.overall || (score.normalized !== null ? score.normalized * 10 : 0),
                scores: {
                    growth: s6.growth,
                    profitability: s6.profitability,
                    stability: s6.stability,
                    valuation: s6.valuation,
                    momentum: s6.momentum,
                    newsSentiment: s6.newsSentiment,
                },
                metrics,
                scoreReasons: s6.reasons || {},
                newsClassified: newsClassified.slice(0, 5),
                warnings,
                peers: null
            };

            const expectedQuestions = [`${name || ticker} 왜 오를까?`, `${name || ticker} 왜 내릴까?`, `${name || ticker} 경쟁사와 비교해줘`];
            messages.push({ type: 'analysis', content: report, ticker, name, expectedQuestions, analysisData });
            return res.json({ messages });
        }

        // MED / LOW (유사 종목 및 대체 추천 종목 제시)
        if ((suggestion.tier === 'MED' || suggestion.tier === 'LOW') && isStockIntent) {
            let candidatesToShow = suggestion.candidates || [];
            let prefixMsg = `입력하신 "${extracted}"에 해당하는 종목을 정확히 찾지 못했습니다.\n혹시 아래 종목 중 하나를 말씀하신 건가요?\n`;

            // LOW인데 후보조차 0개면 대중적인 인기 종목이라도 강제로 추천 리스트에 포함
            if (candidatesToShow.length === 0) {
                prefixMsg = `"${extracted}"와(과) 일치하는 종목이 없습니다.\n대신 많은 분들이 찾는 💡주요 우량 종목을 추천해 드릴게요.\n`;
                candidatesToShow = [
                    { ticker: 'NVDA', name: 'NVIDIA', market: 'US', corpCode: null },
                    { ticker: 'TSLA', name: 'Tesla', market: 'US', corpCode: null },
                    { ticker: 'AAPL', name: 'Apple', market: 'US', corpCode: null },
                    { ticker: '005930', name: '삼성전자', market: 'KR', corpCode: '00126380' }
                ];
            }

            console.log(`[API /chat] suggestCandidates fallback: "${extracted}" → ${candidatesToShow.length}개 후보 표시`);
            
            const enrichedCandidates = await Promise.all(candidatesToShow.slice(0, 4).map(async c => {
                let price = null, changePct = null;
                try {
                    const data = await fetchAllStockData(c.ticker, c.name, c.corpCode || null);
                    if (data?.price?.current != null) {
                        price = data.price.current;
                        changePct = data.price.changePct;
                    }
                } catch(e) {}
                
                const desc = getCompanyDesc(c.ticker) || null;
                return { ...c, desc, price, changePct, confidence: c.confidence || 0.5 };
            }));

            // 유사도 내림차순 정렬
            enrichedCandidates.sort((a, b) => b.confidence - a.confidence);

            const contentLines = [prefixMsg];
            enrichedCandidates.forEach(c => {
                const currency = c.ticker.endsWith('.KS') || c.ticker.endsWith('.KQ') ? '₩' : '$';
                const dStr = c.desc ? ` (${c.desc})` : '';
                const priceInfo = c.price != null
                    ? ` / ${currency}${c.price.toLocaleString()} / ${c.changePct > 0 ? '+' : ''}${c.changePct?.toFixed(2) || '0.00'}%`
                    : ' / 가격 정보 없음';
                
                contentLines.push(`• ${c.ticker} - ${c.name}${dStr}${priceInfo}`);
            });

            messages.push({
                type: 'candidates',
                content: contentLines.join('\n'),
                candidates: enrichedCandidates
            });
            return res.json({ messages });
        }

        // 3. 섹터 분석
        const sectorInfo = resolveSector(text);
        if (sectorInfo || (intent.type === 'sector' && intent.sectorKey)) {
            const key = sectorInfo ? Object.keys(SECTOR_MAP).find(k => SECTOR_MAP[k].sector === sectorInfo.sector) || 'ai' : intent.sectorKey;
            const sectorData = await fetchSectorData(SECTOR_MAP[key]);
            const report = await analyzeSector(sectorData, useDeep, 'normal');
            messages.push({ type: 'analysis', content: report });
            return res.json({ messages });
        }

        // 4. 포트폴리오 분석
        if (isPortfolioInput(text)) {
            const items = parsePortfolio(text);
            if (items && items.length >= 2) {
                const report = await analyzePortfolio(items, useDeep, 'normal');
                messages.push({ type: 'analysis', content: report });
                return res.json({ messages });
            }
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
// GET /api/suggest?q=엔비디어  → 후보 3~5개 + confidence + exchange + currentPrice 반환

// ── GET /api/hot-stocks (홈 화면 로비 노출용 핫 종목) ─────────────
app.get('/api/hot-stocks', async (req, res) => {
    try {
        const topTickers = ['NVDA', 'TSLA', 'AAPL', 'MSTR', 'PLTR'];
        const results = [];
        
        for (const t of topTickers) {
            // 캐싱된 fetchAllStockData 호출 (매우 빠름)
            const data = await fetchAllStockData(t);
            results.push({
                ticker: data.ticker,
                name: data.companyName,
                price: data.price?.current || null,
                changePct: data.price?.changePct || null
            });
        }
        res.json({ ok: true, data: results });
    } catch (error) {
        console.error('[API /hot-stocks] Error:', error);
        res.status(500).json({ ok: false, message: '핫 종목 조회 실패' });
    }
});

app.get('/api/suggest', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ ok: false, error: 'q 파라미터 필요' });
    try {
        // 1단계: 로컬 사전 검색 (즉시, ~0ms)
        const localResult = suggestCandidates(q);

        // 로컬 사전에서 HIGH 매칭이면 즉시 반환 (빠른 응답)
        if (localResult.tier === 'HIGH' && localResult.candidates.length > 0) {
            const enriched = await enrichCandidatesWithPrice(localResult.candidates.slice(0, 3));
            return res.json({ ok: true, ...localResult, candidates: enriched });
        }

        // 2단계: 실제 API 검색 (Finnhub → Polygon → Yahoo, ~1-3초)
        let apiCandidates = [];
        try {
            const apiResult = await searchTicker(q);
            if (apiResult.found && apiResult.candidates?.length > 0) {
                apiCandidates = apiResult.candidates.map(c => ({
                    ticker: c.ticker,
                    name: c.name,
                    market: (c.ticker || '').includes('.KS') || (c.ticker || '').includes('.KQ') ? 'KR' : 'US',
                    exchange: c.exchange || c.source || null,
                    confidence: c.confidence ?? 0.7,
                }));
            }
        } catch (apiErr) {
            console.warn(`[/api/suggest] API fallback 실패: ${apiErr.message}`);
        }

        // 3단계: 로컬 + API 결과 병합
        const merged = mergeSuggestResults(localResult, apiCandidates);

        // 4단계: 상위 후보에 currentPrice 보강
        merged.candidates = await enrichCandidatesWithPrice(merged.candidates.slice(0, 5));

        res.json({ ok: true, ...merged });
    } catch (e) {
        console.error(`[/api/suggest] 에러:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── 검색 결과 병합 헬퍼 ──────────────────────────────────────────────
function mergeSuggestResults(localResult, apiCandidates) {
    const seen = new Set((localResult.candidates || []).map(c => c.ticker));
    const newFromApi = (apiCandidates || []).filter(c => !seen.has(c.ticker));
    const allCandidates = [...(localResult.candidates || []), ...newFromApi].slice(0, 5);

    if (!allCandidates.length) {
        return { input: localResult.input, resolved: null, confidence: 0, tier: 'LOW', candidates: [] };
    }

    const bestConf = Math.max(...allCandidates.map(c => c.confidence || 0));
    const tier = bestConf >= 0.85 ? 'HIGH' : bestConf >= 0.5 ? 'MED' : 'LOW';
    const best = allCandidates[0];

    return {
        input: localResult.input,
        resolved: tier === 'HIGH' ? { ticker: best.ticker, name: best.name, market: best.market } : null,
        confidence: bestConf,
        tier,
        candidates: allCandidates.map(c => ({
            ...c,
            tier: (c.confidence || 0) >= 0.85 ? 'HIGH' : (c.confidence || 0) >= 0.5 ? 'MED' : 'LOW',
        })),
    };
}

// ── 후보에 currentPrice 보강 (병렬, 3초 타임아웃) ─────────────────
async function enrichCandidatesWithPrice(candidates) {
    if (!candidates || !candidates.length) return [];
    try {
        const enriched = await Promise.all(candidates.map(async (c) => {
            try {
                const priceData = await Promise.race([
                    fetchAllStockData(c.ticker),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
                ]);
                return {
                    ...c,
                    exchange: c.exchange || priceData?.price?.source || null,
                    currentPrice: priceData?.price?.current ?? null,
                    changePct: priceData?.price?.changePct ?? null,
                };
            } catch {
                return { ...c, currentPrice: null, changePct: null };
            }
        }));
        return enriched;
    } catch {
        return candidates;
    }
}

// ── 종목 상세 분석용 통합 데이터 엔드포인트 ─────────────────────────
// GET /api/stock/:ticker
app.get('/api/stock/:ticker', async (req, res) => {
    let ticker = (req.params.ticker || '').trim().toUpperCase();
    if (!ticker) return res.status(400).json({ ok: false, error: 'ticker 파라미터 필요' });

    try {
        // 로컬 티커 리졸버 (아이온큐 -> IONQ 등) 통과
        const resolved = resolveStock(ticker);
        if (resolved) {
            ticker = resolved.ticker;
        }

        const data = await fetchAllStockData(ticker, resolved?.name, resolved?.corpCode);
        
        // 반환 구조 매핑 (null 안전 처리)
        res.json({
            ok: true,
            ticker: data.ticker,
            name: data.companyName,
            price: {
                current: data.price?.current ?? null,
                changePct: data.price?.changePct ?? null,
                open: data.price?.open ?? null,
                high: data.price?.high ?? null,
                low: data.price?.low ?? null,
                prevClose: data.price?.prevClose ?? null,
                volume: data.price?.volume ?? null,
            },
            fundamentals: {
                marketCap: data.fundamentals?.mktCap ?? null,
                peRatio: data.fundamentals?.peRatio ?? null,
                pbRatio: data.fundamentals?.pbRatio ?? null,
                eps: data.fundamentals?.eps ?? null,
                revenue: data.fundamentals?.revenue ?? null,
            },
            chart: {
                change1W: data.history?.change1W ?? null,
                change1M: data.history?.change1M ?? null,
                history: data.history?.closes || [],
            },
            news: (data.news || []).slice(0, 5).map(n => ({
                title: n.title,
                source: n.source,
                publishedAt: n.publishedAt,
                url: n.url
            })),
            metadata: data.metadata || {}
        });
    } catch (e) {
        console.error(`[/api/stock/:ticker] 에러:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});
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
        // index.html은 항상 최신 버전을 강제로 제공
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
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

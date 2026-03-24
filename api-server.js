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
const OPTIONAL_ENV = ['TELEGRAM_BOT_TOKEN', 'FINNHUB_API_KEY', 'TWELVEDATA_API_KEY',
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
const { fetchAllStockData, fetchMarketData, fetchSectorData } = require('./services/data-fetcher');
const {
    resolveStock, resolveSector, isDeepAnalysisRequest,
    hasStockKeyword, hasEarningsKeyword, isETF, isLeveragedETF,
    getETFPeers, parsePortfolio, isPortfolioInput,
    isRecommendationKeyword, toFinnhubKRFormat, resolveKoreanTicker,
    SECTOR_MAP
} = require('./utils/ticker-util');
const { generateWatchlistBriefing } = require('./services/briefing_service');
const { buildPerformanceReport } = require('./services/recommendation-tracker');
const sessions = require('./services/session');
const watchlistStore = require('./services/watchlist-store');
const userSettings = require('./services/user-settings');

const app = express();
app.use(cors());
app.use(express.json());

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
            'GET  /api/watchlist/:chatId',
            'POST /api/watchlist/:chatId/add',
            'POST /api/watchlist/:chatId/remove',
            'POST /api/watchlist/:chatId/style',
            'GET  /api/briefing/:chatId',
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

        // 추천
        if (isRecommendationKeyword(text) || text.includes('추천') || text.includes('뭐 사')) {
            const data = await fetchMarketData();
            const userStyle = watchlistStore.getStyle(chatId);
            const report = await analyzeRecommendation(data, useDeep, 'normal', userStyle);
            messages.push({ type: 'analysis', content: report });
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

        // 섹터 분석
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

        // 종목 분석
        const stockResult = resolveStock(text);
        if (stockResult) {
            let ticker = stockResult.ticker;
            let name = stockResult.name;
            let market = stockResult.market;
            let corpCode = stockResult.corpCode || null;

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

            // intent 결정
            let stockIntent = 'full_analysis';
            if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
            else if (isETF(ticker)) stockIntent = 'etf_analysis';
            else if (intent.intent && intent.intent !== 'fallback') stockIntent = intent.intent;

            const data = await fetchAllStockData(ticker, name, corpCode);
            data.investmentContext = session.context;

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

            messages.push({ type: 'analysis', content: report, ticker, name });
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

        // Fallback
        const reply = await fallbackChat(text, 'normal');
        messages.push({ type: 'text', content: reply });
        res.json({ messages });

    } catch (err) {
        console.error('[API /chat]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 관심종목 ──────────────────────────────────────────────────────
app.get('/api/watchlist/:chatId', (req, res) => {
    const list = watchlistStore.get(req.params.chatId);
    const style = watchlistStore.getStyle(req.params.chatId);
    res.json({ list, style });
});

app.post('/api/watchlist/:chatId/add', (req, res) => {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const result = watchlistStore.add(req.params.chatId, ticker.toUpperCase());
    res.json({ result, list: watchlistStore.get(req.params.chatId) });
});

app.post('/api/watchlist/:chatId/remove', (req, res) => {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const result = watchlistStore.remove(req.params.chatId, ticker.toUpperCase());
    res.json({ result, list: watchlistStore.get(req.params.chatId) });
});

app.post('/api/watchlist/:chatId/style', (req, res) => {
    const { style } = req.body;
    watchlistStore.setStyle(req.params.chatId, style);
    res.json({ ok: true });
});

// ── 브리핑 ────────────────────────────────────────────────────────
app.get('/api/briefing/:chatId', async (req, res) => {
    try {
        const list = watchlistStore.get(req.params.chatId);
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Server running on port ${PORT}`);
    console.log(`   → Root:   https://yeri-project.onrender.com/`);
    console.log(`   → Health: https://yeri-project.onrender.com/health`);
    console.log(`   → Chat:   POST /api/chat`);
});

module.exports = app;

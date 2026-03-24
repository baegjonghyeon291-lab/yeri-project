/**
 * discord-bot.js — Discord AI 주식 분석 비서 (Full Version)
 *
 * 실행: node discord-bot.js
 * ※ 텔레그램(index.js)과 완전히 독립 실행
 * ※ 분석 엔진은 텔레그램과 100% 공유
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const { Client, GatewayIntentBits } = require('discord.js');

// ── 공유 서비스 모듈 (텔레그램과 동일) ───────────────────────────
const {
    analyzeStock, analyzeStockBuyTiming, analyzeStockSellTiming,
    analyzeStockRisk, analyzeStockEarnings, analyzeStockCasual,
    analyzeStockOverheat, analyzeStockValuation, analyzeStockComparison,
    analyzeETF, analyzePortfolio, analyzeRecommendation,
    analyzeMarket, analyzeSector, classifyQuery, fallbackChat
} = require('./services/analyzer');
const { fetchAllStockData, fetchMarketData, fetchSectorData } = require('./services/data-fetcher');
const {
    resolveStock, resolveSector, resolveKoreanTicker,
    isDeepAnalysisRequest, hasStockKeyword, hasEarningsKeyword,
    isETF, isLeveragedETF, getETFPeers, parsePortfolio,
    isPortfolioInput, isRecommendationKeyword, parseNumberedFollowup,
    findClosestAlias, toFinnhubKRFormat, SECTOR_MAP
} = require('./utils/ticker-util');
const { generatePriceChartUrl } = require('./utils/chart-util');
const { generateWatchlistBriefing } = require('./services/briefing_service');
const { buildPerformanceReport } = require('./services/recommendation-tracker');
const sessions = require('./services/session');
const watchlistStore = require('./services/watchlist-store');
const userSettings = require('./services/user-settings');

// ── 유효성 검사 ─────────────────────────────────────────────────────
if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN이 .env에 없습니다.');
    process.exit(1);
}

// ── Discord 클라이언트 ────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const processingUsers = new Set();

// ── 상수 ─────────────────────────────────────────────────────────
const SIGNATURE = '\n성공적인 투자를 응원합니다 🙂';

// ── 유틸 ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendLong(channel, text) {
    const MAX = 1900;
    if (!text) return;
    if (text.length <= MAX) { await channel.send(text); return; }
    const lines = text.split('\n');
    let chunk = '';
    for (const line of lines) {
        if ((chunk + '\n' + line).length > MAX) {
            if (chunk) await channel.send(chunk);
            chunk = line;
        } else {
            chunk = chunk ? chunk + '\n' + line : line;
        }
    }
    if (chunk) await channel.send(chunk);
}

function isCompareQuery(text) {
    const lower = text.replace(/\s/g, '').toLowerCase();
    return /vs\.?/.test(lower) || lower.includes('비교') || lower.includes('어느게나아');
}

function resolveCompareStocks(text) {
    const vsMatch = text.match(/(.+?)\s+(?:vs\.?|대|versus|비교)\s+(.+)/i);
    if (!vsMatch) return null;
    const r1 = resolveStock(vsMatch[1].trim());
    const r2 = resolveStock(vsMatch[2].trim());
    if (!r1 || !r2) return null;
    return { ticker1: r1.ticker, name1: r1.name, ticker2: r2.ticker, name2: r2.name };
}

function isRecommendationQuery(text) {
    const keywords = ['추천', '뭐 사', '뭘 사', '좋은 주식', '뭐가 좋', '좋은 종목', '추천해'];
    return keywords.some(k => text.toLowerCase().includes(k));
}

// ── 분석 실행 ─────────────────────────────────────────────────────
async function executeStockAnalysis(channel, chatId, userId, session) {
    let { pendingTicker, pendingName, pendingMarket, pendingCorpCode, useDeep } = session;
    const intent = session.pendingIntent || 'full_analysis';

    console.log(`[Discord-Pipeline] ticker=${pendingTicker} intent=${intent} deep=${useDeep}`);

    if (pendingMarket === 'KR') {
        const krInfo = resolveKoreanTicker(pendingTicker);
        if (krInfo) {
            pendingTicker = toFinnhubKRFormat(krInfo.ticker);
            pendingName = krInfo.name;
            pendingCorpCode = krInfo.corpCode;
        } else {
            pendingTicker = toFinnhubKRFormat(pendingTicker);
        }
    }

    const modelLabel = useDeep ? '심층 분석 (o3)' : '분석';
    const waitMsg = await channel.send(`🔍 **${pendingName || pendingTicker}** ${modelLabel} 중... ⏳\n(약 30~60초 소요)`);

    try {
        const data = await fetchAllStockData(pendingTicker, pendingName, pendingCorpCode);
        data.investmentContext = session.context;

        let report;
        switch (intent) {
            case 'overheat_check':    report = await analyzeStockOverheat(data, useDeep, 'normal'); break;
            case 'valuation_check':   report = await analyzeStockValuation(data, useDeep, 'normal'); break;
            case 'buy_timing':        report = await analyzeStockBuyTiming(data, useDeep, 'normal'); break;
            case 'sell_timing':       report = await analyzeStockSellTiming(data, useDeep, 'normal'); break;
            case 'risk_check':        report = await analyzeStockRisk(data, useDeep, 'normal'); break;
            case 'earnings_check':    report = await analyzeStockEarnings(data, useDeep, 'normal'); break;
            case 'etf_analysis':
                report = await analyzeETF(data, useDeep, 'normal', {
                    isLeveraged: isLeveragedETF(pendingTicker),
                    peers: getETFPeers(pendingTicker) || []
                });
                break;
            case 'full_analysis':
            default:
                if (isETF(pendingTicker)) {
                    report = await analyzeETF(data, useDeep, 'normal', {
                        isLeveraged: isLeveragedETF(pendingTicker),
                        peers: getETFPeers(pendingTicker) || []
                    });
                } else {
                    report = await (useDeep ? analyzeStock(data, useDeep, 'normal') : analyzeStockCasual(data, useDeep, 'normal'));
                }
        }

        await waitMsg.delete().catch(() => {});

        // 차트 이미지
        const chartUrl = generatePriceChartUrl(pendingTicker, pendingName, data.history);
        if (chartUrl) {
            await channel.send({ content: `📈 **${pendingName || pendingTicker}** Price Chart`, files: [chartUrl] }).catch(() => {});
        }

        await sendLong(channel, report);
        await channel.send(`💾 관심종목 추가: \`!add ${pendingName || pendingTicker}\``);

        sessions.update(chatId, {
            state: 'awaiting_followup',
            lastAnalyzedTicker: pendingTicker,
            lastAnalyzedName: pendingName,
            lastAnalyzedCorpCode: pendingCorpCode,
            lastAnalyzedMarket: pendingMarket,
            lastAnalyzedSector: data.fundamentals?.sector,
            lastIntent: intent,
            lastTickerTime: Date.now(),
        });

        await channel.send(
`💬 **추가 분석:**
1️⃣  섹터/경쟁사 비교
2️⃣  3개월 전망
3️⃣  지금 매수 가능?
4️⃣  매도 타이밍
5️⃣  비슷한 종목 추천
번호를 입력하세요.`
        );
    } catch (err) {
        console.error('[Discord] executeStockAnalysis:', err.message);
        await waitMsg.edit(`❌ 분석 실패: ${err.message}`).catch(() => {});
        sessions.reset(chatId);
    }
}

async function handleMarketAnalysis(channel, chatId, useDeep) {
    const wait = await channel.send('🌐 시장 전체 분석 중... ⏳\n(약 30~60초 소요)');
    try {
        const data = await fetchMarketData();
        const report = await analyzeMarket(data, useDeep, 'normal');
        await wait.delete().catch(() => {});
        await sendLong(channel, report);
    } catch (err) {
        await wait.edit(`❌ 시장 분석 실패: ${err.message}`).catch(() => {});
    }
}

async function handleSectorAnalysis(channel, chatId, sectorKey, useDeep) {
    const sectorInfo = SECTOR_MAP[sectorKey];
    if (!sectorInfo) return handleMarketAnalysis(channel, chatId, useDeep);
    const wait = await channel.send(`📡 **${sectorInfo.sector}** 섹터 분석 중... ⏳`);
    try {
        const data = await fetchSectorData(sectorInfo);
        const report = await analyzeSector(data, useDeep, 'normal');
        await wait.delete().catch(() => {});
        await sendLong(channel, report);
        sessions.reset(chatId);
    } catch (err) {
        await wait.edit(`❌ 섹터 분석 실패: ${err.message}`).catch(() => {});
    }
}

async function handleRecommendation(channel, chatId, useDeep) {
    const userStyle = watchlistStore.getStyle(chatId);
    const styleLabel = { 단타: '⚡단타', 스윙: '🔄스윙', 장기: '🌱장기' }[userStyle] || userStyle;
    const wait = await channel.send(`🔍 시장 스캔 중... ⏳\n투자 스타일: ${styleLabel} 기준`);
    try {
        const data = await fetchMarketData();
        const report = await analyzeRecommendation(data, useDeep, 'normal', userStyle);
        await wait.delete().catch(() => {});
        await sendLong(channel, report);

        // 번호 선택용 추천 목록 저장
        const recMatches = [...report.matchAll(/\b(\d+)\.\s+([A-Z]{1,6})(?:\s+\(?([^)\n]+)\)?)?/g)];
        if (recMatches.length) {
            const suggestedList = recMatches.slice(0, 5).map(m => ({
                index: parseInt(m[1], 10),
                ticker: m[2],
                name: (m[3] || m[2]).trim().replace(/[()]/g, ''),
                market: 'US',
                corpCode: null,
            }));
            sessions.setSuggestedList(chatId, suggestedList);
        }
    } catch (err) {
        await wait.edit(`❌ 추천 분석 실패: ${err.message}`).catch(() => {});
    }
}

async function handleStockComparison(channel, chatId, ticker1, name1, ticker2, name2, useDeep) {
    const wait = await channel.send(`🔍 **${name1} vs ${name2}** 비교 분석 중... ⏳`);
    try {
        const [data1, data2] = await Promise.all([
            fetchAllStockData(ticker1, name1, null),
            fetchAllStockData(ticker2, name2, null),
        ]);
        const report = await analyzeStockComparison(data1, data2, useDeep, 'normal');
        await wait.delete().catch(() => {});
        await sendLong(channel, report);
        sessions.reset(chatId);
    } catch (err) {
        await wait.edit(`❌ 비교 분석 실패: ${err.message}`).catch(() => {});
        sessions.reset(chatId);
    }
}

async function handlePortfolioAnalysis(channel, chatId, portfolioItems, useDeep) {
    const labels = portfolioItems.map(p => `${p.name}(${p.weight}%)`).join(', ');
    const wait = await channel.send(`📊 **포트폴리오 분석** 중... ⏳\n[${labels}]`);
    try {
        const report = await analyzePortfolio(portfolioItems, useDeep, 'normal');
        await wait.delete().catch(() => {});
        await sendLong(channel, report);
    } catch (err) {
        await wait.edit(`❌ 포트폴리오 분석 실패: ${err.message}`).catch(() => {});
    }
}

async function handleFollowUpChoice(channel, chatId, userId, choice, session) {
    const ticker = session.lastAnalyzedTicker;
    const name   = session.lastAnalyzedName;
    const sector = session.lastAnalyzedSector;
    const useDeep = session.useDeep;
    sessions.update(chatId, { state: 'idle' });

    if (choice === '1') {
        // 섹터 비교
        let sectorKey = Object.keys(SECTOR_MAP).find(k =>
            sector?.toLowerCase().includes(k) ||
            SECTOR_MAP[k].sector.toLowerCase().includes(sector?.toLowerCase() || '')
        ) || Object.keys(SECTOR_MAP).find(k => SECTOR_MAP[k].tickers?.includes(ticker)) || 'ai';
        await handleSectorAnalysis(channel, chatId, sectorKey, useDeep);
    } else if (choice === '2') {
        // 3개월 전망
        const wait = await channel.send(`📅 **${name || ticker}** 3개월 전망 분석 중... ⏳`);
        try {
            const data = await fetchAllStockData(ticker, name, null);
            data.investmentContext = { ...session.context, horizon: '스윙 (3개월 전망 중심)' };
            const report = await analyzeStock(data, useDeep, 'normal');
            await wait.delete().catch(() => {});
            await sendLong(channel, report);
        } catch (err) { await wait.edit(`❌ ${err.message}`).catch(() => {}); }
        sessions.reset(chatId);
    } else if (choice === '3') {
        // 지금 매수
        sessions.update(chatId, { pendingTicker: ticker, pendingName: name, pendingMarket: session.lastAnalyzedMarket, pendingCorpCode: session.lastAnalyzedCorpCode, pendingIntent: 'buy_timing', useDeep, state: 'analyzing' });
        await executeStockAnalysis(channel, chatId, userId, sessions.get(chatId));
    } else if (choice === '4') {
        // 매도 타이밍
        sessions.update(chatId, { pendingTicker: ticker, pendingName: name, pendingMarket: session.lastAnalyzedMarket, pendingCorpCode: session.lastAnalyzedCorpCode, pendingIntent: 'sell_timing', useDeep, state: 'analyzing' });
        await executeStockAnalysis(channel, chatId, userId, sessions.get(chatId));
    } else if (choice === '5') {
        await channel.send(`💡 비슷한 섹터의 추천 종목을 알고 싶으시면:\n**!market** 또는 종목명을 직접 입력해 주세요!${SIGNATURE}`);
        sessions.reset(chatId);
    } else {
        await channel.send(`1~5 중 번호를 입력해 주세요.`);
        sessions.update(chatId, { state: 'idle' });
    }
}

// ── 메인 메시지 핸들러 ────────────────────────────────────────────
async function handleDiscordMessage(message) {
    const text   = message.content.trim();
    const userId = message.author.id;
    const chatId = message.channel.id;
    const channel = message.channel;

    console.log(`📩 [Discord] [${message.author.username}] ${text}`);

    const useDeep = isDeepAnalysisRequest(text);
    let session = sessions.get(chatId) || sessions.create(chatId);

    // ── 명령어: !help ──────────────────────────────────────────
    if (text === '!help' || text === '도움말') {
        await channel.send(
`📈 **AI 주식 분석 비서**

💬 **자연어 질문**
• \`삼성전자 어때?\` / \`TSLA 분석\`
• \`언제 사?\` / \`언제 팔아?\` / \`리스크\`
• \`지금 시장 어때?\`
• \`반도체 전망\`
• \`요즘 뭐 살까?\`
• \`NVDA vs TSLA 비교\`
• \`NVDA 풀분석\` — 심층(o3)

📋 **명령어**
• \`!watchlist\` — 관심종목
• \`!add AAPL\` — 추가
• \`!remove AAPL\` — 제거
• \`!brief\` — 브리핑
• \`!market\` — 시장 분석
• \`!performance\` — 추천 성과
• \`!style 단타|스윙|장기\` — 투자 스타일
`
        );
        return;
    }

    // ── 명령어: !market ────────────────────────────────────────
    if (text === '!market' || text === '/market') {
        await handleMarketAnalysis(channel, chatId, useDeep);
        return;
    }

    // ── 명령어: !watchlist ─────────────────────────────────────
    if (text === '!watchlist' || text === '/watchlist') {
        const list = watchlistStore.get(chatId);
        const style = watchlistStore.getStyle(chatId);
        const styleLabel = { 단타: '⚡ 단타', 스윙: '🔄 스윙', 장기: '🌱 장기' }[style] || style;
        if (!list.length) { await channel.send('📋 관심 종목이 없습니다. `!add AAPL` 로 추가하세요!'); return; }
        await channel.send(`📋 **관심 종목** (스타일: ${styleLabel})\n\n${list.map((t, i) => `${i+1}. ${t}`).join('\n')}\n\n\`!brief\` 로 브리핑 받기`);
        return;
    }

    // ── 명령어: !add ───────────────────────────────────────────
    if (text.startsWith('!add ') || text.startsWith('/add ')) {
        const ticker = text.split(' ')[1]?.toUpperCase();
        if (!ticker) { await channel.send('사용법: `!add AAPL`'); return; }
        watchlistStore.setChatId(userId, chatId);
        const result = watchlistStore.add(chatId, ticker);
        if (result === true) await channel.send(`✅ **${ticker}** 추가 완료! 30분마다 자동 감시합니다.`);
        else if (result === 'limit_reached') await channel.send(`⚠️ 관심종목 최대 개수에 도달했습니다.`);
        else await channel.send(`ℹ️ **${ticker}**는 이미 목록에 있습니다.`);
        return;
    }

    // ── 명령어: !remove ────────────────────────────────────────
    if (text.startsWith('!remove ') || text.startsWith('/remove ')) {
        const ticker = text.split(' ')[1]?.toUpperCase();
        if (!ticker) { await channel.send('사용법: `!remove AAPL`'); return; }
        const removed = watchlistStore.remove(chatId, ticker);
        await channel.send(removed ? `🗑️ **${ticker}** 제거 완료!` : `ℹ️ **${ticker}**는 목록에 없습니다.`);
        return;
    }

    // ── 명령어: !brief ─────────────────────────────────────────
    if (text === '!brief' || text === '/brief') {
        const list = watchlistStore.get(chatId);
        if (!list.length) { await channel.send('📋 관심 종목이 없습니다. `!add AAPL` 로 추가하세요!'); return; }
        const wait = await channel.send(`📊 **관심 종목(${list.length}개)** 브리핑 생성 중... ⏳`);
        try {
            const report = await generateWatchlistBriefing(list);
            await wait.delete().catch(() => {});
            await sendLong(channel, report);
        } catch (err) { await wait.edit(`❌ 브리핑 오류: ${err.message}`).catch(() => {}); }
        return;
    }

    // ── 명령어: !performance ───────────────────────────────────
    if (text === '!performance' || text === '/performance') {
        try {
            const report = buildPerformanceReport(userId);
            await sendLong(channel, report);
        } catch (err) { await channel.send(`❌ 성과 조회 실패: ${err.message}`); }
        return;
    }

    // ── 명령어: !style ─────────────────────────────────────────
    if (text.startsWith('!style')) {
        const arg = text.replace('!style', '').trim();
        const STYLES = { 단타: '단타', 스윙: '스윙', 장기: '장기' };
        if (!arg) {
            const cur = watchlistStore.getStyle(chatId);
            await channel.send(`현재 스타일: **${cur}**\n변경: \`!style 단타\` | \`!style 스윙\` | \`!style 장기\``);
            return;
        }
        if (!STYLES[arg]) { await channel.send('`!style 단타 | 스윙 | 장기` 로 선택하세요.'); return; }
        watchlistStore.setStyle(chatId, arg);
        await channel.send(`✅ 투자 스타일 **${arg}** 설정 완료!`);
        return;
    }

    // ── STATE: awaiting_context (투자 기간 선택) ─────────────
    if (session.state === 'awaiting_context') {
        const lower = text.toLowerCase();
        let horizon = session.context?.horizon;
        if (text === '1' || lower.includes('단타') || lower.includes('단기')) horizon = '단타';
        else if (text === '2' || lower.includes('스윙') || lower.includes('중기')) horizon = '스윙';
        else if (text === '3' || lower.includes('장기')) horizon = '장기';
        else if (lower.includes('바로') || lower.includes('skip')) horizon = horizon || '스윙';
        sessions.updateContext(chatId, { horizon });
        sessions.update(chatId, { state: 'analyzing' });
        await executeStockAnalysis(channel, chatId, userId, sessions.get(chatId));
        return;
    }

    // ── STATE: awaiting_followup (1~5 선택) ──────────────────
    if (session.state === 'awaiting_followup') {
        const isNum = /^[1-5]$/.test(text.trim());
        if (isNum) {
            await handleFollowUpChoice(channel, chatId, userId, text.trim(), session);
            return;
        }
        sessions.update(chatId, { state: 'idle' });
        // 새 질문으로 처리 (fall through)
    }

    // ── 번호 선택 후속 질문 ───────────────────────────────────
    const numberedFollowup = parseNumberedFollowup(text);
    if (numberedFollowup) {
        const list = sessions.getSuggestedList(chatId);
        if (list && list.length) {
            const { index, intent } = numberedFollowup;
            const item = list.find(i => i.index === index);
            if (item) {
                sessions.update(chatId, {
                    lastAnalyzedTicker: item.ticker, lastAnalyzedName: item.name,
                    lastAnalyzedMarket: item.market || 'US', lastAnalyzedCorpCode: item.corpCode || null,
                    lastTickerTime: Date.now(),
                });
                sessions.update(chatId, {
                    state: 'awaiting_context', pendingTicker: item.ticker, pendingName: item.name,
                    pendingMarket: item.market || 'US', pendingCorpCode: null,
                    pendingIntent: intent || 'full_analysis', useDeep,
                });
                await executeStockAnalysis(channel, chatId, userId, sessions.get(chatId));
                return;
            }
        }
    }

    // ── 추천 ──────────────────────────────────────────────────
    if (isRecommendationQuery(text) || isRecommendationKeyword(text)) {
        await handleRecommendation(channel, chatId, useDeep);
        return;
    }

    // ── 포트폴리오 ────────────────────────────────────────────
    if (isPortfolioInput(text)) {
        const items = parsePortfolio(text);
        if (items && items.length >= 2) {
            await handlePortfolioAnalysis(channel, chatId, items, useDeep);
            return;
        }
    }

    // ── 종목 비교 ─────────────────────────────────────────────
    if (isCompareQuery(text)) {
        const cr = resolveCompareStocks(text);
        if (cr) {
            await handleStockComparison(channel, chatId, cr.ticker1, cr.name1, cr.ticker2, cr.name2, useDeep);
            return;
        }
    }

    // ── 로컬 종목 매핑 우선 분석 ──────────────────────────────
    const stockResult = resolveStock(text);
    if (stockResult && (hasStockKeyword(text) || hasEarningsKeyword(text))) {
        let stockIntent = 'full_analysis';
        if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
        if (isETF(stockResult.ticker)) stockIntent = 'etf_analysis';

        const focusedIntents = ['buy_timing', 'sell_timing', 'risk_check', 'overheat_check', 'valuation_check'];
        const intent = await classifyQuery(text);
        if (intent && intent.intent !== 'fallback') stockIntent = intent.intent || stockIntent;

        sessions.update(chatId, {
            state: focusedIntents.includes(stockIntent) ? 'analyzing' : 'awaiting_context',
            pendingTicker: stockResult.ticker,
            pendingName: stockResult.name,
            pendingMarket: stockResult.market,
            pendingCorpCode: stockResult.corpCode || null,
            pendingIntent: stockIntent,
            useDeep,
        });

        if (focusedIntents.includes(stockIntent) || session.context?.horizon) {
            sessions.update(chatId, { state: 'analyzing' });
            await executeStockAnalysis(channel, chatId, userId, sessions.get(chatId));
        } else {
            await channel.send(
`🤔 **${stockResult.name}(${stockResult.ticker})** 분석 전에 확인할게요!

📅 **투자 기간이 어떻게 되나요?**
1️⃣  단타 (1일~1주)
2️⃣  스윙 (1주~3개월)
3️⃣  장기 (3개월 이상)

_(바로 분석 원하시면 "바로" 입력)_`
            );
        }
        return;
    }

    // ── 시장/섹터 intent ──────────────────────────────────────
    const intent = await classifyQuery(text);
    if (intent.type === 'market') {
        await handleMarketAnalysis(channel, chatId, useDeep);
        return;
    }
    if (intent.type === 'sector' && intent.sectorKey) {
        await handleSectorAnalysis(channel, chatId, intent.sectorKey, useDeep);
        return;
    }

    // ── 섹터 자연어 감지 ──────────────────────────────────────
    const sectorInfo = resolveSector(text);
    if (sectorInfo) {
        const key = Object.keys(SECTOR_MAP).find(k => SECTOR_MAP[k].sector === sectorInfo.sector) || 'ai';
        await handleSectorAnalysis(channel, chatId, key, useDeep);
        return;
    }

    // ── 컨텍스트 기억 (20분 이내 후속 질문) ─────────────────
    if (hasStockKeyword(text) && sessions.isTickerContextValid(chatId) && session.lastAnalyzedTicker) {
        const prevTicker = session.lastAnalyzedTicker;
        const prevName   = session.lastAnalyzedName || prevTicker;
        const prevMarket = session.lastAnalyzedMarket || 'US';
        const prevCorpCode = session.lastAnalyzedCorpCode || null;
        let stockIntent = intent.intent || 'full_analysis';
        if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
        sessions.update(chatId, {
            state: 'analyzing',
            pendingTicker: prevTicker, pendingName: prevName,
            pendingMarket: prevMarket, pendingCorpCode: prevCorpCode,
            pendingIntent: stockIntent, useDeep,
        });
        await executeStockAnalysis(channel, chatId, userId, sessions.get(chatId));
        return;
    }

    // ── 유사 종목 제안 ────────────────────────────────────────
    if (hasStockKeyword(text)) {
        const closest = findClosestAlias(text);
        if (closest) {
            await channel.send(`🤔 혹시 **${closest.name}**(${closest.ticker})을 말씀하시는 건가요?\n"${closest.ticker} 어때?" 로 다시 질문해 주세요!`);
        } else {
            await channel.send(`🤔 종목을 찾지 못했습니다. 정확한 종목명이나 티커를 입력해 주세요.\n예: \`엔비디아\`, \`NVDA\`, \`삼성전자\`${SIGNATURE}`);
        }
        return;
    }

    // ── Fallback: 일반 대화 ───────────────────────────────────
    try {
        const reply = await fallbackChat(text, 'normal');
        await sendLong(channel, reply);
    } catch (err) {
        await channel.send(`❌ 응답 생성 오류: ${err.message}`);
    }
}

// ── Discord 이벤트 ────────────────────────────────────────────────
client.once('clientReady', (c) => {
    console.log('══════════════════════════════════');
    console.log(`✅ 디코 봇 준비됨: ${c.user.tag}`);
    console.log(`📡 Guilds: ${c.guilds.cache.size}`);
    console.log('══════════════════════════════════');
    console.log('📨 메시지 수신 대기 중...');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    if (processingUsers.has(userId)) return;
    processingUsers.add(userId);

    try {
        await handleDiscordMessage(message);
    } catch (err) {
        console.error('[Discord] Unhandled error:', err.message);
        await message.channel.send(`❌ 처리 중 오류: ${err.message}`).catch(() => {});
    } finally {
        processingUsers.delete(userId);
    }
});

// ── 봇 로그인 ─────────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
    console.error('❌ Discord 로그인 실패:', err.message);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n👋 Discord Bot 종료 중...');
    client.destroy();
    process.exit(0);
});
process.on('unhandledRejection', (reason) => {
    console.error('[Discord] UnhandledRejection:', reason);
});

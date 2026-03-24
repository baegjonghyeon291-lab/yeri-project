/**
 * telegram.js — Conversational AI Analyst
 * Session state, follow-up menu (1-5), watchlist, signature message
 */
const TelegramBot = require('node-telegram-bot-api');
const { fetchAllStockData, fetchMarketData, fetchSectorData } = require('./data-fetcher');
const { analyzeStock, analyzeStockBuyTiming, analyzeStockSellTiming, analyzeStockRisk, analyzeStockEarnings, analyzeStockCasual, analyzeStockOverheat, analyzeStockValuation, analyzeStockComparison, analyzeETF, analyzePortfolio, analyzeRecommendation, analyzeMarket, analyzeSector, classifyQuery, fallbackChat } = require('./analyzer');
const { resolveKoreanTicker, resolveUSCompany, resolveStock, resolveSector, toFinnhubKRFormat, isDeepAnalysisRequest, hasStockKeyword, hasEarningsKeyword, getPeers, getETFPeers, findClosestAlias, isETF, isLeveragedETF, parsePortfolio, isPortfolioInput, isRecommendationKeyword, parseNumberedFollowup, SECTOR_MAP } = require('../utils/ticker-util');
const { generatePriceChartUrl } = require('../utils/chart-util');
const { generateWatchlistBriefing } = require('./briefing_service');
const { buildPerformanceReport } = require('./recommendation-tracker');
const userSettings = require('./user-settings');
const sessions = require('./session');
const watchlistStore = require('./watchlist-store');

const processingChats = new Set();
const processedMessageIds = new Set();
const userWatchlists = {};

const fs = require('fs');
const path = require('path');
const PID_FILE = path.join(__dirname, '../bot.pid');

let bot;

const SIGNATURE = '\n💚 귀염둥이 예리의 성공적이 투자를 응원합니다♡';

// ─────────────────────────────────────────────────────────
// GREETING DETECTION
// ─────────────────────────────────────────────────────────
const GREETING_PATTERNS = ['하이', '안녕', 'hello', 'hi', 'ㅎㅇ', '반가워', '안뇽', '헬로', 'hey', '하잉', 'ㅎㅎ'];

function isGreeting(text) {
    const lower = text.toLowerCase().trim();
    return GREETING_PATTERNS.some(g => lower === g || lower === g + '!' || lower === g + '~' || lower === g + '요' || lower === g + '하세요');
}
// ─────────────────────────────────────────────────────────
// NATURAL LANGUAGE WATCHLIST REGISTRATION DETECTOR
// "나 관심종목 1,2,3야" / "내 관심종목은 A,B,C야"
// ─────────────────────────────────────────────────────────
/**
 * 자연어로 관심종목을 등록하는 메시지 감지
 * 예: "나 관심종목 NVDA, DUOL, 삼성전자야"
 * @returns {string[]|null} 감지된 종목 목록 또는 null
 */
function detectNaturalWatchlistInput(text) {
    const t = text.trim();
    // 트리거 패턴: "관심종목" + "이야/야/이에요/은/는" 포함
    const triggerPattern = /관심종목/;
    const confirmPattern = /(야$|이야$|이에요$|임$|이야\.?$|야\.?$)/;
    if (!triggerPattern.test(t)) return null;

    // 종목 추출: 쉼표/공백/슬래시로 구분된 티커나 종목명
    // 트리거 단어 제거 후 파싱
    const stripped = t
        .replace(/내\s*관심\s*종목\s*(은|는|이|가)?/g, '')
        .replace(/나\s*관심\s*종목\s*(은|는|이|가)?/g, '')
        .replace(/관심\s*종목\s*(은|는|이|가)?/g, '')
        .replace(/(이야|야|이에요|임|이다|입니다)\.?$/g, '')
        .replace(/[,、/\\]/g, ' ')
        .trim();

    if (!stripped) return null;

    // 띄어쓰기로 분리, 1~15자 토큰만 종목으로 인정
    const tokens = stripped.split(/\s+/).filter(tok => tok.length >= 1 && tok.length <= 15);
    return tokens.length > 0 ? tokens : null;
}


// ─────────────────────────────────────────────────────────
// USER TONE DETECTION
// ─────────────────────────────────────────────────────────
function isYeriUser(from) {
    if (!from) return false;
    const firstName = (from.first_name || '').trim();
    const username = (from.username || '').toLowerCase().trim();
    return firstName === '예리' || username === 'yeri';
}

function getUserTone(from) {
    return isYeriUser(from) ? 'cute' : 'normal';
}

const SIGNATURE_CUTE = '\n💚 귀염둥이 예리의 성공적인 투자를 응원합니다♡';
const SIGNATURE_NORMAL = '\n성공적인 투자를 응원합니다 🙂';

function getSignature(tone) {
    return tone === 'cute' ? SIGNATURE_CUTE : SIGNATURE_NORMAL;
}

// ─────────────────────────────────────────────────────────
// INITIALIZE
// ─────────────────────────────────────────────────────────
function initBot(token) {
    if (!token) return;

    // Masked token logging
    const masked = token.substring(0, 6) + '...' + token.substring(token.length - 4);
    console.log(`🤖 [Telegram] Initializing with token: ${masked}`);

    // Single instance check using PID file
    if (fs.existsSync(PID_FILE)) {
        const oldPid = fs.readFileSync(PID_FILE, 'utf8');
        try {
            process.kill(parseInt(oldPid, 10), 0);
            console.warn(`⚠️  [Telegram] Detected another instance running (PID: ${oldPid}).`);
            console.warn(`   This might cause a 409 Conflict. Please ensure only one bot instance is active.`);
        } catch (e) {
            // Process doesn't exist, safe to overwrite
        }
    }
    fs.writeFileSync(PID_FILE, process.pid.toString());

    bot = new TelegramBot(token, { polling: true });

    // Error handling for 409 Conflict
    bot.on('polling_error', (err) => {
        if (err.message.includes('409 Conflict')) {
            console.error('🚨 [Telegram] 409 Conflict: Another instance is polling with the same token!');
            console.error('   Please stop any other running bot instances.');
        } else {
            console.error('[Telegram] Polling error:', err.message);
        }
    });

    // /start — 온보딩 플로우
    bot.onText(/\/start/, async (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const tone   = getUserTone(msg.from);
        sessions.create(chatId);
        watchlistStore.setChatId(userId, chatId);
        userSettings.set(chatId, {}); // 기본값 초기화

        const s = userSettings.get(chatId);
        const existingList = watchlistStore.get(chatId);

        // 이미 온보딩 완료 → 일반 시작 화면
        if (s.onboardingDone && existingList.length > 0) {
            return bot.sendMessage(chatId,
`👋 ${tone === 'cute' ? '귀염둥이 예리야' : '안녕하세요'} 🙂

📌 **명령어:**
/watchlist — 관심 목록 조회
/add AAPL — 종목 추가
/brief — 관심종목 브리핑
/setbrief 08:30 — 브리핑 시간 설정
/setalert 10:00 — 추천 알림 시간
/settings — 현재 설정 확인
/performance — 추천 성과 리포트
/market — 시장 분석

💚 귀염둥이 예리의 성공적인 투자를 응원합니다♡`,
                { parse_mode: 'Markdown' });
        }

        // 온보딩 시작
        sessions.update(chatId, { state: 'onboarding_watchlist' });
        await bot.sendMessage(chatId,
            tone === 'cute'
                ? `귀염둥이 예리야 🙂\n앞으로 내가 관심종목 관리랑 투자 타이밍 도와줄게!\n\n먼저 네 관심종목 알려줘 😊\n(예: 엔비디아, 테슬라, 삼성전자)`
                : `안녕하세요 🙂\n투자 AI 비서 예리입니다.\n\n먼저 관심 종목을 알려주세요!\n(예: 엔비디아, 테슬라, 삼성전자)`);
    });

    // /market
    bot.onText(/\/market/, async (msg) => {
        await handleMarketAnalysis(msg.chat.id, msg.from.id, false);
    });

    // ─────────────────────────────────────────────
    // 설정 명령어 블록
    // ─────────────────────────────────────────────

    // /setbrief HH:MM — 브리핑 시간 설정
    bot.onText(/\/setbrief(.*)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const tone   = getUserTone(msg.from);
        const arg    = (match[1] || '').trim();
        const parsed = userSettings.parseTime(arg);
        if (!parsed) {
            return bot.sendMessage(chatId,
                tone === 'cute'
                    ? `시간은 08:30잘림 입력해줘 🙂\n(\uc608: /setbrief 08:30)`
                    : `시간은 HH:MM 형식으로 입력해주세요.\n(예: /setbrief 08:30)`);
        }
        userSettings.set(chatId, { briefingTime: parsed, briefingEnabled: true });
        bot.sendMessage(chatId,
            tone === 'cute'
                ? `알겠어 🙂\n매일 **${parsed}**에 브리핑 보내줄게!`
                : `설정 완료! 매일 **${parsed}**에 브리핑을 전송합니다.`,
            { parse_mode: 'Markdown' });
    });

    // /setalert HH:MM — 추천 알림 시간 설정
    bot.onText(/\/setalert(.*)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const tone   = getUserTone(msg.from);
        const arg    = (match[1] || '').trim();
        const parsed = userSettings.parseTime(arg);
        if (!parsed) {
            return bot.sendMessage(chatId,
                tone === 'cute'
                    ? `시간은 10:00처럼 입력해줘 🙂\n(예: /setalert 10:00)`
                    : `시간은 HH:MM 형식으로 입력해주세요. (예: /setalert 10:00)`);
        }
        const s = userSettings.get(chatId);
        const times = [...new Set([...(s.alertTimes || []), parsed])].sort();
        userSettings.set(chatId, { alertTimes: times, alertEnabled: true });
        bot.sendMessage(chatId,
            tone === 'cute'
                ? `알겠어 🙂\n현재 알림 시간: **${times.join(', ')}**`
                : `설정 완료! 알림 시간: **${times.join(', ')}**`,
            { parse_mode: 'Markdown' });
    });

    // /settimezone <tz>
    bot.onText(/\/settimezone(.*)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const tone   = getUserTone(msg.from);
        const arg    = (match[1] || '').trim();
        const tz     = userSettings.resolveTZ(arg);
        if (!tz) {
            return bot.sendMessage(chatId,
                `지원하는 시간대:\n${userSettings.SUPPORTED_TZ.join(' | ')}\n\n(예: /settimezone Asia/Seoul)`);
        }
        userSettings.set(chatId, { timezone: tz });
        bot.sendMessage(chatId,
            tone === 'cute'
                ? `시간대 **${tz}** 으로 설정했어 🙂`
                : `시간대가 **${tz}** 으로 설정되었습니다.`,
            { parse_mode: 'Markdown' });
    });

    // /settings — 현재 설정 확인
    bot.onText(/\/settings/, (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const tone   = getUserTone(msg.from);
        const s      = userSettings.get(chatId);
        const list   = watchlistStore.get(chatId);
        const localNow = userSettings.getCurrentLocalTime(s.timezone);

        const lines = [
            tone === 'cute' ? '귀염둥이 예리야 현재 설정이야 😊' : '현재 설정 정보입니다 🙂',
            '',
            `⏰ **브리핑 시간**: ${s.briefingTime} (${s.briefingEnabled ? 'ON' : 'OFF'})`,
            `🔔 **추천 알림**: ${s.alertTimes.length ? s.alertTimes.join(', ') : '워atcher 기본 30분'} (${s.alertEnabled ? 'ON' : 'OFF'})`,
            `🌍 **시간대**: ${s.timezone}`,
            `📅 **현재 로컨 시각**: ${localNow}`,
            `📋 **관심종목**: ${list.length ? list.join(', ') : '없음'}`,
            '',
            '창 변경 명령어: /setbrief | /setalert | /settimezone',
            '알림 ON/OFF: /alert on|off | /brief on|off',
        ];
        bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
    });

    // /alert on|off
    bot.onText(/\/alert(.*)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const tone   = getUserTone(msg.from);
        const arg    = (match[1] || '').trim().toLowerCase();
        if (arg === 'on') {
            userSettings.set(chatId, { alertEnabled: true });
            return bot.sendMessage(chatId, tone === 'cute' ? '자동 추천 알림 **ON** 폴을게 📣' : '자동 추천 알림이 활성화되었습니다.', { parse_mode: 'Markdown' });
        } else if (arg === 'off') {
            userSettings.set(chatId, { alertEnabled: false });
            return bot.sendMessage(chatId, tone === 'cute' ? '자동 추천 알림 **OFF** 할게 🔕' : '자동 추천 알림이 일시정지되었습니다.', { parse_mode: 'Markdown' });
        }
        const s = userSettings.get(chatId);
        bot.sendMessage(chatId, `현재 알림 상태: **${s.alertEnabled ? 'ON' : 'OFF'}**\n사용법: /alert on | /alert off`, { parse_mode: 'Markdown' });
    });

    // /brief on|off (on = 즉시 실행, off = 비활성화)
    bot.onText(/\/briefonoff(.*)/, (msg, match) => { // 충돌 방지용 내부 전용
        const arg = (match[1] || '').trim().toLowerCase();
        const userId = msg.from.id; const chatId = msg.chat.id;
        const tone = getUserTone(msg.from);
        if (arg === 'on')  {
            userSettings.set(chatId, { briefingEnabled: true });
            return bot.sendMessage(chatId, tone === 'cute' ? '보여줘 관심종목 브리핑 **ON** 폴게 🌞' : '브리핑이 활성화되었습니다.', { parse_mode: 'Markdown' });
        } else if (arg === 'off') {
            userSettings.set(chatId, { briefingEnabled: false });
            return bot.sendMessage(chatId, tone === 'cute' ? '휘주 관심종목 브리핑 **OFF** 할게' : '브리핑이 일시정지되었습니다.', { parse_mode: 'Markdown' });
        }
    });

    // /performance — 추천 성과 리포트
    bot.onText(/\/performance/, (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        try {
            const report = buildPerformanceReport(userId);
            bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(chatId, `❌ 성과 조회 실패: ${err.message}`);
        }
    });

    // /brief
    bot.onText(/\/brief/, async (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        watchlistStore.setChatId(userId, chatId);
        const list = watchlistStore.get(chatId);

        if (!list.length) {
            return bot.sendMessage(chatId, `📋 관심 종목이 없습니다.\n/add AAPL 로 먼저 추가해보세요!`);
        }

        const wait = await bot.sendMessage(chatId, `📊 **관심 종목(${list.length}개)** 요약 브리핑 생성 중... ⏳`);
        try {
            const report = await generateWatchlistBriefing(list);
            await safeDelete(chatId, wait.message_id);
            await sendLongMessage(chatId, report);
        } catch (err) {
            console.error('[Bot] Briefing error:', err.message);
            bot.editMessageText(`❌ 브리핑 생성 중 오류가 발생했습니다.`, { chat_id: chatId, message_id: wait.message_id });
        }
    });

    // /stock [TICKER]
    bot.onText(/\/stock (.+)/, async (msg, match) => {
        const input = match[1].trim();
        await startStockContextFlow(msg.chat.id, msg.from.id, input, null, 'US', null, isDeepAnalysisRequest(input));
    });

    // /watchlist — 관심종목 조회
    bot.onText(/\/watchlist/, (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        watchlistStore.setChatId(userId, chatId);
        const list = watchlistStore.get(chatId);
        const style = watchlistStore.getStyle(chatId);
        if (!list.length) {
            return bot.sendMessage(chatId,
                `📋 관심 종목이 없습니다.\n/add AAPL 로 추가하면 자동 감시가 시작됩니다!`);
        }
        const styleLabel = { 단타: '⚡ 단타', 스윙: '🔄 스윙', 장기: '🌱 장기' }[style] || style;
        bot.sendMessage(chatId,
            `📋 **관심 종목 목록** (투자 스타일: ${styleLabel})

${list.map((t, i) => `${i+1}. ${t}`).join('\n')}

💡 30분마다 자동 감시 중 — 신호 발생 시 알림을 드립니다.\n스타일 변경: /style 단타|스윙|장기`,
            { parse_mode: 'Markdown' });
    });

    // /add [TICKER] — 관심종목 추가
    bot.onText(/\/add (.+)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const tone   = getUserTone(msg.from);
        watchlistStore.setChatId(userId, chatId);
        const ticker = match[1].trim().toUpperCase();
        const added  = watchlistStore.add(chatId, ticker);
        const limit  = watchlistStore.getLimit();

        if (added === 'limit_reached') {
            const list = watchlistStore.get(chatId);
            return bot.sendMessage(chatId,
                tone === 'cute'
                    ? `귀염둥이 예리야 관심종목은 최대 ${limit}개까지 관리하는 게 좋아 😊\n\n👉 너무 많아지면 분석이 얕아질 수 있고, 가독성이 떨어질 수 있어\n\n그래도 더 등록하고 싶으면\n내가 예리 남편한테 말해서 늘려달라고 해놓을게 🙂\n\n현재 목록: ${list.join(', ')}`
                    : `관심종목은 최대 ${limit}개까지 관리할 수 있습니다 🙂\n\n👉 너무 많아지면 분석이 얕아지고 가독성이 떨어질 수 있어요.\n\n확장을 원하시면 운영자에게 문의해 주세요!\n\n현재 목록: ${list.join(', ')}`,
                { parse_mode: 'Markdown' }
            );
        } else if (added) {
            bot.sendMessage(chatId,
                `✅ **${ticker}** 관심 목록 추가 완료!\n\n📡 30분마다 자동 감시를 시작합니다.\nRSI 과매도, 이격 과대, 급등 신호 발생 시 자동 알림합니다.`,
                { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `ℹ️ ${ticker}는 이미 관심 목록에 있습니다.`);
        }
    });

    // /remove [TICKER] — 관심종목 제거
    bot.onText(/\/remove (.+)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const ticker = match[1].trim().toUpperCase();
        const removed = watchlistStore.remove(chatId, ticker);
        bot.sendMessage(chatId, removed
            ? `🗑️ **${ticker}** 관심 목록에서 제거했습니다.`
            : `ℹ️ ${ticker}는 목록에 없습니다.`,
            { parse_mode: 'Markdown' });
    });

    // /style — 투자 스타일 설정
    bot.onText(/\/style(.*)/, (msg, match) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const arg = (match[1] || '').trim();
        const STYLES = { '단타': '단타', '스윙': '스윙', '장기': '장기' };
        if (!arg) {
            const current = watchlistStore.getStyle(chatId);
            return bot.sendMessage(chatId,
                `⚙️ 현재 투자 스타일: **${current}**\n\n변경하려면:\n/style 단타 — 단기 RSI 기준\n/style 스윙 — 중기 기준 (기본값)\n/style 장기 — 장기 밸류 기준`,
                { parse_mode: 'Markdown' });
        }
        const validStyle = STYLES[arg];
        if (!validStyle) {
            return bot.sendMessage(chatId, `❌ 올바른 스타일을 선택해주세요:\n/style 단타 | /style 스윙 | /style 장기`);
        }
        watchlistStore.setStyle(chatId, validStyle);
        const desc = { 단타: 'RSI/MACD 중심 단기 신호', 스윙: '중기 이격도 + 추세 신호', 장기: '밸류에이션 + 성장성 기준' };
        bot.sendMessage(chatId,
            `✅ 투자 스타일을 **${validStyle}** 으로 설정했습니다!\n신호 기준: ${desc[validStyle]}`,
            { parse_mode: 'Markdown' });
    });

    // NATURAL LANGUAGE
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const msgId = msg.message_id;

        // Dedup: skip if this exact message was already processed
        if (processedMessageIds.has(msgId)) return;
        processedMessageIds.add(msgId);
        // Clean old IDs (keep last 200)
        if (processedMessageIds.size > 200) {
            const arr = [...processedMessageIds];
            arr.slice(0, arr.length - 200).forEach(id => processedMessageIds.delete(id));
        }

        if (processingChats.has(chatId)) return;
        processingChats.add(chatId);

        try {
            let session = sessions.get(chatId) || sessions.create(chatId);
            const text = msg.text.trim();
            const useDeep = isDeepAnalysisRequest(text);
            const tone = getUserTone(msg.from);
            sessions.update(chatId, { pendingTone: tone });

            // ── NATURAL WATCHLIST: "나 관심종목 NVDA, DUOL야" ──────
            const naturalWatchlistItems = detectNaturalWatchlistInput(text);
            if (naturalWatchlistItems && naturalWatchlistItems.length > 0) {
                watchlistStore.setChatId(userId, chatId);
                const added = [];
                const limit = watchlistStore.getLimit();
                let hitLimit = false;
                for (const item of naturalWatchlistItems) {
                    const resolved = resolveStock(item);
                    const ticker = resolved?.ticker || item.toUpperCase();
                    const result = watchlistStore.add(chatId, ticker);
                    if (result === true) added.push(ticker);
                    else if (result === 'limit_reached') { hitLimit = true; break; }
                }
                const allList = watchlistStore.get(chatId);
                const listStr = allList.map((t, i) => `${i+1}. ${t}`).join(', ');
                if (hitLimit) {
                    await bot.sendMessage(chatId,
                        tone === 'cute'
                            ? `귀염둥이 예리야 관심종목은 최대 ${limit}개까지 관리하는 게 좋아 😊\n\n👉 너무 많아지면 분석이 얕아질 수 있고, 가독성이 떨어질 수 있어\n\n그래도 더 등록하고 싶으면\n내가 예리 남편한테 말해서 늘려달라고 해놓을게 🙂\n\n현재 목록: ${listStr}`
                            : `관심종목은 최대 ${limit}개까지 관리할 수 있습니다 🙂\n\n확장을 원하시면 운영자에게 문의해 주세요!\n\n현재 목록: ${listStr}`);
                } else if (added.length > 0) {
                    await bot.sendMessage(chatId,
                        `알겠어 예리야! 내일부터 매일 아침 8:30에 ${added.join(', ')} 종목에 대해 브리핑해줄게 😊\n\n현재 관심종목: ${listStr}\n\n바로 보려면 /brief`);
                } else {
                    await bot.sendMessage(chatId, `ℹ️ 입력한 종목들이 이미 관심 목록에 있어! /watchlist 로 확인해봐`);
                }
                return;
            }

                        // ── GREETING: 인사 메시지 감지 ────────────────────
            if (isGreeting(text)) {
                const greetMsg = tone === 'cute'
                    ? `울 귀염둥이 하이 😊\n오늘은 어떤 투자 분석을 해볼까요?\n\n• 종목 분석 — _"삼성전자 어때?"_\n• 시장 분석 — _"지금 시장 어때?"_\n• 섹터 분석 — _"반도체 전망 어때?"_\n• 종목 추천 — _"요즘 뭐 살까?"_\n${getSignature(tone)}`
                    : `안녕하세요 🙂\n오늘은 어떤 투자 분석을 도와드릴까요?\n\n• 종목 분석 — _"삼성전자 어때?"_\n• 시장 분석 — _"지금 시장 어때?"_\n• 섹터 분석 — _"반도체 전망 어때?"_\n• 종목 추천 — _"요즘 뭐 살까?"_\n${getSignature(tone)}`;
                await bot.sendMessage(chatId, greetMsg, { parse_mode: 'Markdown' });
                return;
            }

            // ── NUMBERED FOLLOWUP: "1번 분석해줘", "두번째 리스크" ──
            const numberedFollowup = parseNumberedFollowup(text);
            if (numberedFollowup) {
                const list = sessions.getSuggestedList(chatId);
                if (!list || !list.length) {
                    await bot.sendMessage(chatId,
                        `지금 바로 선택할 추천 리스트가 없어요.\n원하면 제가 먼저 추천 종목부터 골라드릴게요! ("요즘 뭐 살까?" 라고 물어봐주세요)`,
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                const { index, intent } = numberedFollowup;
                const item = list.find(i => i.index === index);
                if (!item) {
                    await bot.sendMessage(chatId,
                        `${index}번 종목이 리스트에 없어요. /watchlist 또는 "추천해줘"로 다시 받아보세요.`
                    );
                    return;
                }
                // 컨텍스트 저장
                sessions.update(chatId, {
                    lastAnalyzedTicker:   item.ticker,
                    lastAnalyzedName:     item.name,
                    lastAnalyzedMarket:   item.market || 'US',
                    lastAnalyzedCorpCode: item.corpCode || null,
                    lastTickerTime:       Date.now(),
                });
                console.log(`[Bot] 번호 선택: ${index}번 → ${item.ticker} intent=${intent}`);
                await startStockContextFlow(chatId, userId, item.ticker, item.name, item.market || 'US', item.corpCode, useDeep, intent);
                return;
            }

            // ── STATE: onboarding_watchlist (관심종목 입력 대기) ──
            if (session.state === 'onboarding_watchlist') {
                watchlistStore.setChatId(userId, chatId);
                const limit = watchlistStore.getLimit();

                // 종목 파싱: 쉼표/공백 구분
                const rawItems = text.replace(/[,、/\\]/g, ' ').split(/\s+/).filter(t => t.length >= 1 && t.length <= 15);
                const added = [];
                for (const item of rawItems) {
                    const resolved = resolveStock(item);
                    const ticker   = resolved?.ticker || item.toUpperCase();
                    const name     = resolved?.name   || ticker;
                    const result   = watchlistStore.add(chatId, ticker);
                    if (result === true) added.push({ ticker, name });
                    if (added.length >= limit) break;
                }

                if (!added.length) {
                    await bot.sendMessage(chatId,
                        tone === 'cute'
                            ? `종목을 잘 못 알아들었어 😅\n다시 한 번 종목명 알려줘!\n(예: 엔비디아, 테슬라, 삼성전자)`
                            : `종목을 인식하지 못했어요 😅\n종목명을 다시 입력해주세요.\n(예: 엔비디아, 테슬라, 삼성전자)`);
                    return;
                }

                const listStr = added.map(a => `• ${a.name} (${a.ticker})`).join('\n');
                await bot.sendMessage(chatId,
                    tone === 'cute'
                        ? `귀염둥이 예리야 🙂\n너 관심종목 이렇게 맞지?\n\n${listStr}\n\n👉 이렇게 저장했어!\n\n이제 매일 브리핑은 몇 시에 받아볼래? 😊\n(예: 08:30)`
                        : `관심종목을 저장했습니다 🙂\n\n${listStr}\n\n매일 브리핑을 받을 시간을 알려주세요!\n(예: 08:30)`);
                sessions.update(chatId, { state: 'onboarding_time' });
                return;
            }

            // ── STATE: onboarding_time (브리핑 시간 입력 대기) ──
            if (session.state === 'onboarding_time') {
                const parsed = userSettings.parseTime(text.trim());
                if (!parsed) {
                    await bot.sendMessage(chatId,
                        tone === 'cute'
                            ? `시간은 08:30처럼 입력해줘 🙂`
                            : `시간은 HH:MM 형식으로 입력해주세요. (예: 08:30)`);
                    return;
                }
                userSettings.set(chatId, { briefingTime: parsed, briefingEnabled: true, onboardingDone: true });
                const list = watchlistStore.get(chatId);
                await bot.sendMessage(chatId,
                    tone === 'cute'
                        ? `알겠어 🙂\n매일 **${parsed}**에 브리핑 보내줄게!\n\n현재 관심종목: ${list.join(', ')}\n\n필요하면 언제든 종목 추가하거나 바꿀 수 있어 😊\n궁금한 종목 바로 물어봐도 돼! (예: "엔비디아 어때?")`
                        : `설정 완료! 🙂\n매일 **${parsed}**에 브리핑을 전송합니다.\n\n관심종목: ${list.join(', ')}\n\n언제든 질문하거나 종목을 추가하세요!`,
                    { parse_mode: 'Markdown' });
                sessions.update(chatId, { state: 'idle' });
                return;
            }

            // ── STATE: awaiting_context (투자 기간 선택) ──────
            if (session.state === 'awaiting_context') {
                await handleContextReply(chatId, userId, text, session);
                return;
            }

            // ── STATE: awaiting_followup (1~5 선택) ──────────
            // If user types a new question instead of 1-5, process it normally
            if (session.state === 'awaiting_followup') {
                const isFollowUpNumber = /^[1-5]$/.test(text.trim());
                if (isFollowUpNumber) {
                    await handleFollowUpChoice(chatId, userId, text, session);
                    return;
                }
                // Reset state and let the message be processed as a new question
                sessions.update(chatId, { state: 'idle' });
            }

            // ── STATE: awaiting_stock_confirm (종목 확인 응답) ──
            if (session.state === 'awaiting_stock_confirm') {
                const lower = text.toLowerCase().trim();
                const yes = ['네', '응', '맞아', '그래', '맞아요', '맞습니다', 'ㅇㅇ', 'ㅇ', '어', '예', 'yes', 'y'];
                if (yes.includes(lower)) {
                    sessions.update(chatId, { state: 'idle' });
                    await startStockContextFlow(chatId, userId, session.pendingTicker, session.pendingName, session.pendingMarket, session.pendingCorpCode, useDeep, 'full_analysis');
                    return;
                }
                // 아니오 → idle 복귀, 일반 대화로 처리
                sessions.update(chatId, { state: 'idle' });
                const reply = await fallbackChat(text, tone);
                await sendLongMessage(chatId, reply);
                return;
            }

            // ── Save watchlist from natural language ──────────
            if (isWatchlistRequest(text)) {
                await handleWatchlistNL(chatId, userId, text);
                return;
            }

            sessions.addHistory(chatId, 'user', text);

            // ── Recommendation / 추천 ───────────────────────
            if (isRecommendationQuery(text) || isRecommendationKeyword(text)) {
                await handleRecommendation(chatId, userId, useDeep, tone);
                return;
            }

            // ── 포트폴리오 감지 (종목 + 숫자 패턴) ──────────
            if (isPortfolioInput(text)) {
                const portfolioItems = parsePortfolio(text);
                if (portfolioItems && portfolioItems.length >= 2) {
                    await handlePortfolioAnalysis(chatId, userId, portfolioItems, useDeep, tone);
                    return;
                }
            }

            // ── classify intent ───────────────────────────────
            const intent = await classifyQuery(text);

            // ── [IntentDebug] 로그 ────────────────────────────
            const earlyDebug = resolveStock(text);
            console.log(`[IntentDebug] raw="${text}"`);
            console.log(`[IntentDebug] ticker="${earlyDebug?.ticker || intent.ticker || 'null'}"`);
            console.log(`[IntentDebug] intent="${intent.intent}"`);
            console.log(`[IntentDebug] type="${intent.type}"`);
            // ────────────────────────────────────────────────

            console.log(`[Bot] Intent: ${JSON.stringify(intent)}, Deep: ${useDeep}`);

            // Save intent for later use in analysis
            sessions.update(chatId, { pendingIntent: intent.intent || 'full_analysis' });

            // ── ★ PRIORITY: 로컬 종목 매핑을 GPT 분류보다 먼저 확인 ──
            // GPT가 "듀오링고 어때?"를 fallback으로 분류해도,
            // 로컬 US_COMPANY_MAP/KR_COMPANY_MAP에 있으면 종목 분석으로 강제 전환
            const earlyStockResult = resolveStock(text);
            const textHasStockKeyword = hasStockKeyword(text) || hasEarningsKeyword(text);

            if (earlyStockResult && (textHasStockKeyword || intent.type === 'stock' || intent.type === 'etf')) {
                // ★ 로컬 매핑 성공 + 주식 키워드 → 종목 분석으로 강제 라우팅
                let stockIntent = intent.intent || 'full_analysis';
                if (stockIntent === 'fallback') stockIntent = 'full_analysis';
                if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
                if (earlyStockResult.isETFResult || isETF(earlyStockResult.ticker)) stockIntent = 'etf_analysis';

                // ── compare_stocks: vs/비교 패턴 처리 ──────────────
                if (stockIntent === 'compare_stocks' || isCompareQuery(text)) {
                    const compareResult = resolveCompareStocks(text);
                    if (compareResult) {
                        console.log(`[IntentDebug] template="compare_stocks" ticker1="${compareResult.ticker1}" ticker2="${compareResult.ticker2}"`);
                        await handleStockComparison(chatId, userId, compareResult.ticker1, compareResult.name1, compareResult.ticker2, compareResult.name2, useDeep, tone);
                        return;
                    }
                }

                console.log(`[IntentDebug] template="${stockIntent}"`);
                console.log(`[Bot] ★ Local ticker override: ${earlyStockResult.ticker} (${earlyStockResult.name}), intent: ${stockIntent}`);
                await startStockContextFlow(chatId, userId, earlyStockResult.ticker, earlyStockResult.name, earlyStockResult.market, earlyStockResult.corpCode || null, useDeep, stockIntent);
                return;
            }

            // ── FALLBACK: 일반 대화 ────────────────────────
            // earlyStockResult가 없을 때만 fallback 처리
            if (intent.intent === 'fallback' || intent.type === 'general') {
                // ★ 마지막 방어: resolveStock이 매칭은 되지만 키워드가 없는 경우
                // 사용자에게 확인 질문
                if (earlyStockResult) {
                    const confirmMsg = `혹시 **${earlyStockResult.name}**(${earlyStockResult.ticker}) 종목을 말씀하신 걸까요?\\n그 기준으로 분석해드릴게요! 😊`;
                    sessions.update(chatId, {
                        state: 'awaiting_stock_confirm',
                        pendingTicker: earlyStockResult.ticker,
                        pendingName: earlyStockResult.name,
                        pendingMarket: earlyStockResult.market,
                        pendingCorpCode: earlyStockResult.corpCode || null,
                    });
                    await bot.sendMessage(chatId, confirmMsg, { parse_mode: 'Markdown' });
                    return;
                }

                const reply = await fallbackChat(text, tone);
                await sendLongMessage(chatId, reply);
                return;
            }

            if (intent.type === 'market') {
                await handleMarketAnalysis(chatId, userId, useDeep, tone);
                return;
            }

            if (intent.type === 'sector' && intent.sectorKey) {
                await handleSectorAnalysis(chatId, userId, intent.sectorKey, useDeep, tone);
                return;
            }

            // ── 포트폴리오 intent (분류기에서 감지) ──────────
            if (intent.intent === 'portfolio_analysis' || intent.type === 'portfolio') {
                const portfolioItems = parsePortfolio(text);
                if (portfolioItems && portfolioItems.length >= 2) {
                    await handlePortfolioAnalysis(chatId, userId, portfolioItems, useDeep, tone);
                    return;
                }
            }

            // ── 추천 intent ─────────────────────────────────
            if (intent.intent === 'recommendation') {
                await handleRecommendation(chatId, userId, useDeep, tone);
                return;
            }

            // ── Resolve ticker (unified) ─────────────────────
            let ticker = intent.ticker;
            let name = intent.name;
            let market = intent.market || 'US';
            let corpCode = null;
            let isETFResult = false;

            // 1) Try unified resolveStock (KR + US + direct ticker)
            const stockResult = resolveStock(text);
            if (stockResult) {
                ticker = stockResult.ticker;
                name = stockResult.name;
                market = stockResult.market;
                corpCode = stockResult.corpCode || null;
                isETFResult = stockResult.isETFResult || false;
            }

            // 2) If still no ticker, use GPT's suggestion
            if (!ticker && intent.ticker) {
                ticker = intent.ticker;
                name = intent.name;
                market = intent.market || 'US';
            }

            // 3) Try sector
            if (!ticker) {
                const sectorInfo = resolveSector(text);
                if (sectorInfo) {
                    const key = Object.keys(SECTOR_MAP).find(k => SECTOR_MAP[k].sector === sectorInfo.sector) || 'ai';
                    await handleSectorAnalysis(chatId, userId, key, useDeep, tone);
                    return;
                }
            }

            // 4) Route to analysis or fallback
            if (ticker) {
                let stockIntent = intent.intent || 'full_analysis';
                // Override intent if earnings keyword detected
                if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
                // Auto-route ETFs to ETF analysis
                if (isETFResult || isETF(ticker)) stockIntent = 'etf_analysis';
                await startStockContextFlow(chatId, userId, ticker, name, market, corpCode, useDeep, stockIntent);
            } else {
                // ── 주식 관련 intent 판별 ──
                const stockIntents = ['full_analysis', 'buy_timing', 'sell_timing', 'risk_check', 'earnings_check', 'etf_analysis'];
                const isStockIntent = stockIntents.includes(intent.intent) && (intent.type === 'stock' || intent.type === 'etf');
                const isStockRelated = hasStockKeyword(text) || hasEarningsKeyword(text) || isStockIntent;

                if (isStockRelated && sessions.isTickerContextValid(chatId)) {
                    // ── Context memory: 이전 분석 종목 재사용 (20분 이내) ──
                    // 예: "듀오링고 어때?" → 분석 후 "언제 사?" → DUOL 기준 매수 타이밍
                    const prevTicker = session.lastAnalyzedTicker;
                    const prevName = session.lastAnalyzedName || prevTicker;
                    const prevMarket = session.lastAnalyzedMarket || 'US';
                    const prevCorpCode = session.lastAnalyzedCorpCode || null;
                    let stockIntent = intent.intent || 'full_analysis';
                    if (hasEarningsKeyword(text)) stockIntent = 'earnings_check';
                    // If previous ticker was ETF, use ETF intent
                    if (isETF(prevTicker)) stockIntent = stockIntent === 'full_analysis' ? 'etf_analysis' : stockIntent;
                    console.log(`[Bot] Context memory: reusing ${prevTicker} (${prevName}) for "${text}"`);
                    await startStockContextFlow(chatId, userId, prevTicker, prevName, prevMarket, prevCorpCode, useDeep, stockIntent);
                } else if (isStockRelated && !sessions.isTickerContextValid(chatId) && session.lastAnalyzedTicker) {
                    // Context expired — prompt for ticker
                    const sig = getSignature(tone);
                    await bot.sendMessage(chatId,
                        `🕔 이전 분석 문맥이 만료되었어요.\n\n어떤 종목을 볼까요? 종목명이나 티커를 입력해 주세요!\n\n예: 애플, 엔비디아, TSLA, QQQ${sig}`,
                        { parse_mode: 'Markdown' }
                    );
                } else if (isStockRelated) {
                    // 매핑 실패 + 이전 세션 없음: 유사 종목 제안 (일반 대화 금지)
                    const closest = findClosestAlias(text);
                    const sig = getSignature(tone);
                    if (closest) {
                        await bot.sendMessage(chatId,
                            `🤔 혹시 **${closest.name}**(${closest.ticker})을(를) 말씀하신 걸까요?\n\n"${closest.name} 어때?" 또는 "${closest.ticker} 분석"으로 다시 질문해 주세요!${sig}`,
                            { parse_mode: 'Markdown' }
                        );
                    } else if (intent.name) {
                        // GPT가 종목명을 인식했지만 매핑에 없는 경우
                        await bot.sendMessage(chatId,
                            `🤔 혹시 해외주식 종목을 말씀하신 걸까요?\n\n**${intent.name}**${intent.ticker ? ` (${intent.ticker})` : ''} 기준으로 분석해 볼까요?\n\n정확한 종목명이나 티커를 입력해 주시면 바로 분석해 드릴게요.${sig}`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        await bot.sendMessage(chatId,
                            `🤔 혹시 주식 종목을 말씀하신 걸까요?\n\n종목명이나 티커를 입력해 주시면 바로 분석해 드릴게요.\n\n예: 애플, 엔비디아, 삼성전자, 테슬라\n    AAPL, NVDA, QQQ, 005930${sig}`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                } else {
                    const reply = await fallbackChat(text, tone);
                    await sendLongMessage(chatId, reply);
                }
            }
        } catch (err) {
            console.error('[Bot] Error:', err.message);
            bot.sendMessage(chatId, `❌ 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.${SIGNATURE}`).catch(() => {});
        } finally {
            setTimeout(() => processingChats.delete(chatId), 5000);
        }
    });

    console.log('✅ 예리 AI Bot started...');
    return bot;
}

// ─────────────────────────────────────────────────────────
// STOCK CONTEXT FLOW — Ask investment horizon first
// ─────────────────────────────────────────────────────────
async function startStockContextFlow(chatId, userId, ticker, name, market, corpCode, useDeep, stockIntent = 'full_analysis') {
    const session = sessions.get(chatId) || sessions.create(chatId);

    sessions.update(chatId, {
        state: 'awaiting_context',
        pendingTicker: ticker,
        pendingName: name || ticker,
        pendingMarket: market,
        pendingCorpCode: corpCode,
        pendingType: 'stock',
        pendingIntent: stockIntent,
        useDeep
    });

    // For focused intents (buy/sell/risk/overheat/valuation), skip horizon question
    const focusedIntents = ['buy_timing', 'sell_timing', 'risk_check', 'overheat_check', 'valuation_check'];
    if (focusedIntents.includes(stockIntent) || session.context.horizon) {
        sessions.update(chatId, { state: 'analyzing' });
        await executeStockAnalysis(chatId, userId, sessions.get(chatId));
        return;
    }

    const stockLabel = name || ticker;
    await bot.sendMessage(chatId, `
🤔 **${stockLabel}** 분석 전에 먼저 확인할게요!

📅 **투자 기간이 어떻게 되나요?**

1️⃣  단타 (1일~1주)
2️⃣  스윙 (1주~3개월)
3️⃣  장기 (3개월 이상)

번호로 답하거나, 아래도 함께 알려주시면 더 정확합니다:
• 목표 수익률 (예: 20%)
• 현재 보유 여부 (보유 중 / 미보유)
• 투자 성향: 공격 / 중립 / 안정

_(바로 분석 원하시면 "바로 분석" 입력)_
`.trim(), { parse_mode: 'Markdown' });
}

// ─────────────────────────────────────────────────────────
// Handle context reply (horizon selection)
// ─────────────────────────────────────────────────────────
async function handleContextReply(chatId, userId, text, session) {
    const lower = text.toLowerCase();

    if (lower.includes('바로') || lower.includes('skip') || lower.includes('그냥')) {
        sessions.update(chatId, { state: 'analyzing' });
        await executeStockAnalysis(chatId, userId, sessions.get(chatId));
        return;
    }

    let horizon = session.context.horizon;
    if (text === '1' || lower.includes('단타') || lower.includes('단기')) horizon = '단타';
    else if (text === '2' || lower.includes('스윙') || lower.includes('중기')) horizon = '스윙';
    else if (text === '3' || lower.includes('장기')) horizon = '장기';

    let riskProfile = session.context.riskProfile;
    if (lower.includes('공격')) riskProfile = '공격형';
    else if (lower.includes('안정')) riskProfile = '안정형';
    else if (lower.includes('중립') || lower.includes('보통')) riskProfile = '중립형';

    let holding = session.context.holding;
    if (lower.includes('보유 중')) holding = true;
    else if (lower.includes('미보유')) holding = false;

    let targetReturn = session.context.targetReturn;
    const returnMatch = text.match(/(\d+)\s*%/);
    if (returnMatch) targetReturn = returnMatch[1] + '%';

    sessions.updateContext(chatId, { horizon, riskProfile, holding, targetReturn });
    sessions.update(chatId, { state: 'analyzing' });
    await executeStockAnalysis(chatId, userId, sessions.get(chatId));
}

// ─────────────────────────────────────────────────────────
// Execute stock analysis
// ─────────────────────────────────────────────────────────
async function executeStockAnalysis(chatId, userId, session) {
    let { pendingTicker, pendingName, pendingMarket, pendingCorpCode, useDeep, pendingTone } = session;
    const tone = pendingTone || 'normal';
    const intent = session.pendingIntent || 'full_analysis';

    // ★ 디버그 로그 ★
    console.log('\n[Pipeline] ══════════════════════════════════════');
    console.log(`[Pipeline] raw_ticker  : ${pendingTicker}`);
    console.log(`[Pipeline] name        : ${pendingName}`);
    console.log(`[Pipeline] market      : ${pendingMarket}`);
    console.log(`[Pipeline] intent      : ${intent}`);
    console.log(`[Pipeline] useDeep     : ${useDeep}`);
    console.log('[Pipeline] ══════════════════════════════════════');

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
    const wait = await bot.sendMessage(chatId,
        `🔍 **${pendingName || pendingTicker}** ${modelLabel} 중... ⏳\n(약 30~60초 소요)`,
        { parse_mode: 'Markdown' }
    );

    try {
        const data = await fetchAllStockData(pendingTicker, pendingName, pendingCorpCode);
        data.investmentContext = session.context;

        // Route to intent-specific analyzer
        // Note: intent was already logged above
        let report;
        switch (intent) {
            case 'overheat_check':
                report = await analyzeStockOverheat(data, useDeep, tone);
                console.log(`[IntentDebug] dataSources=["FMP","TwelveData"] template="overheat_check"`);
                break;
            case 'valuation_check':
                report = await analyzeStockValuation(data, useDeep, tone);
                console.log(`[IntentDebug] dataSources=["FMP","AlphaVantage"] template="valuation_check"`);
                break;
            case 'buy_timing':
                report = await analyzeStockBuyTiming(data, useDeep, tone);
                break;
            case 'sell_timing':
                report = await analyzeStockSellTiming(data, useDeep, tone);
                break;
            case 'risk_check':
                report = await analyzeStockRisk(data, useDeep, tone);
                break;
            case 'earnings_check':
                report = await analyzeStockEarnings(data, useDeep, tone);
                break;
            case 'etf_analysis':
                report = await analyzeETF(data, useDeep, tone, {
                    isLeveraged: isLeveragedETF(pendingTicker),
                    peers: getETFPeers(pendingTicker) || []
                });
                break;
            case 'full_analysis':
                // Route ETFs to ETF-specific analyzer
                if (isETF(pendingTicker)) {
                    report = await analyzeETF(data, useDeep, tone, {
                        isLeveraged: isLeveragedETF(pendingTicker),
                        peers: getETFPeers(pendingTicker) || []
                    });
                } else {
                    report = await (useDeep ? analyzeStock(data, useDeep, tone) : analyzeStockCasual(data, useDeep, tone));
                }
                break;
            default:
                report = await analyzeStockCasual(data, useDeep, tone);
        }
        console.log(`[executeStockAnalysis] Intent: ${intent}, Model: ${useDeep ? 'deep' : 'default'}`);
        await safeDelete(chatId, wait.message_id);

        // Send Chart if available
        const chartUrl = generatePriceChartUrl(pendingTicker, pendingName, data.history);
        if (chartUrl) {
            await bot.sendPhoto(chatId, chartUrl, { caption: `📈 ${pendingName || pendingTicker} Price Chart` }).catch(() => {});
        }

        await sendLongMessage(chatId, report);

        // Save to watchlist prompt
        await bot.sendMessage(chatId,
            `💾 이 종목을 관심 종목에 추가하시겠어요?\n→ /add ${pendingName || pendingTicker}`,
            { parse_mode: 'Markdown' }
        );

        // Save session follow-up context + context memory timestamp
            sessions.update(chatId, {
                state: 'awaiting_followup',
                lastAnalyzedTicker: pendingTicker,
                lastAnalyzedName: pendingName,
                lastAnalyzedCorpCode: pendingCorpCode,
                lastAnalyzedMarket: pendingMarket,
                lastAnalyzedSector: data.fundamentals?.sector || data.fundamentals?.industry,
                lastIntent: intent,
                lastTickerTime: Date.now(),
            });
        sessions.addHistory(chatId, 'assistant', report.slice(0, 500));
    } catch (err) {
        console.error('[executeStockAnalysis]', err.message);
        await bot.editMessageText(`❌ 분석 실패: ${err.message}`, {
            chat_id: chatId, message_id: wait.message_id, parse_mode: 'Markdown'
        }).catch(() => {});
        sessions.reset(chatId);
    }
}

// ─────────────────────────────────────────────────────────
// Follow-up menu handler (1~5)
// ─────────────────────────────────────────────────────────
async function handleFollowUpChoice(chatId, userId, text, session) {
    const choice = text.trim();
    const ticker = session.lastAnalyzedTicker;
    const name = session.lastAnalyzedName;
    const sector = session.lastAnalyzedSector;
    const tone = session.pendingTone || getUserTone({ first_name: '', username: '' });

    sessions.update(chatId, { state: 'idle' });

    if (choice === '1') {
        await handleSectorForTicker(chatId, userId, ticker, name, sector, session.useDeep, tone);
    } else if (choice === '2') {
        await handleOutlook3M(chatId, userId, ticker, name, session);
    } else if (choice === '3') {
        await handleBuyNow(chatId, userId, ticker, name, session);
    } else if (choice === '4') {
        await handleSellTiming(chatId, userId, ticker, name, session);
    } else if (choice === '5') {
        await handleIndustrySuggestion(chatId, userId, ticker, name, session.useDeep);
    } else {
        sessions.update(chatId, { state: 'idle' });
        await bot.sendMessage(chatId, buildFallbackMessage());
    }
}

// ─────────────────────────────────────────────────────────
// Follow-up sub-handlers
// ─────────────────────────────────────────────────────────
async function handleOutlook3M(chatId, userId, ticker, name, session) {
    const wait = await bot.sendMessage(chatId, `📅 **${name || ticker}** 향후 3개월 전망 분석 중... ⏳`, { parse_mode: 'Markdown' });
    try {
        const data = await fetchAllStockData(ticker, name, null);
        data.investmentContext = session.context;
        const { analyzeStock: az } = require('./analyzer');
        // Re-use analyzeStock but override context to ask specifically for 3-month outlook
        data.investmentContext = { ...session.context, horizon: '스윙 (3개월 전망 중심)', targetReturn: session.context.targetReturn };
        const report = await az(data, session.useDeep);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        sessions.reset(chatId);
    } catch (err) {
        await safeDelete(chatId, wait.message_id);
        bot.sendMessage(chatId, `❌ 분석 실패: ${err.message}`);
        sessions.reset(chatId);
    }
}

async function handleBuyNow(chatId, userId, ticker, name, session) {
    const wait = await bot.sendMessage(chatId, `🛒 **${name || ticker}** 지금 매수 가능 여부 분석 중... ⏳`, { parse_mode: 'Markdown' });
    try {
        const data = await fetchAllStockData(ticker, name, null);
        data.investmentContext = session.context;
        const { analyzeStock: az } = require('./analyzer');
        const report = await az(data, session.useDeep);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        sessions.reset(chatId);
    } catch (err) {
        await safeDelete(chatId, wait.message_id);
        bot.sendMessage(chatId, `❌ 분석 실패: ${err.message}`);
        sessions.reset(chatId);
    }
}

async function handleSellTiming(chatId, userId, ticker, name, session) {
    const wait = await bot.sendMessage(chatId, `📤 **${name || ticker}** 매도 타이밍 분석 중... ⏳`, { parse_mode: 'Markdown' });
    try {
        const data = await fetchAllStockData(ticker, name, null);
        data.investmentContext = session.context;
        const { analyzeStock: az } = require('./analyzer');
        const report = await az(data, session.useDeep);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        sessions.reset(chatId);
    } catch (err) {
        await safeDelete(chatId, wait.message_id);
        bot.sendMessage(chatId, `❌ 분석 실패: ${err.message}`);
        sessions.reset(chatId);
    }
}

async function handleSectorForTicker(chatId, userId, ticker, name, sectorName, useDeep, tone = 'normal') {
    const wait = await bot.sendMessage(chatId, `🔄 **${name || ticker}** (${sectorName || '관련'}) 비교 종목 분석 중... ⏳`, { parse_mode: 'Markdown' });
    try {
        // Try to find a matching sector key from SECTOR_MAP
        let sectorKey = Object.keys(SECTOR_MAP).find(key => 
            sectorName?.toLowerCase().includes(key) || 
            SECTOR_MAP[key].sector.toLowerCase().includes(sectorName?.toLowerCase())
        );

        // Fallback to searching by ticker if sector name mapping failed
        if (!sectorKey) {
            sectorKey = Object.keys(SECTOR_MAP).find(key => 
                SECTOR_MAP[key].tickers.includes(ticker)
            );
        }

        if (!sectorKey) {
            sectorKey = 'ai'; 
        }

        await safeDelete(chatId, wait.message_id);
        await handleSectorAnalysis(chatId, userId, sectorKey, useDeep, tone);
    } catch (err) {
        await safeDelete(chatId, wait.message_id);
        bot.sendMessage(chatId, `❌ 분석 실패: ${err.message}`);
        sessions.reset(chatId);
    }
}

async function handleIndustrySuggestion(chatId, userId, ticker, name, useDeep) {
    await bot.sendMessage(chatId, `💡 비슷한 섹터의 추천 종목을 알려드릴게요!\n어떤 섹터가 궁금하신가요?\n\n• 반도체 | AI | 전기차 | 바이오 | 금융 | 에너지\n\n섹터명을 입력해 주세요.${SIGNATURE}`);
    sessions.reset(chatId);
}

// ─────────────────────────────────────────────────────────
// Market Analysis
// ─────────────────────────────────────────────────────────
async function handleMarketAnalysis(chatId, userId, useDeep, tone = 'normal') {
    const wait = await bot.sendMessage(chatId, '🌐 시장 전체 분석 중... ⏳\n(약 30~60초 소요)');
    try {
        const data = await fetchMarketData();
        const report = await analyzeMarket(data, useDeep, tone);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        await bot.sendMessage(chatId, buildMarketFollowUp());
        sessions.addHistory(chatId, 'assistant', report.slice(0, 300));
    } catch (err) {
        console.error('[handleMarketAnalysis]', err.message);
        bot.editMessageText(`❌ 시장 분석 실패. 잠시 후 다시 시도해 주세요.${SIGNATURE}`, { chat_id: chatId, message_id: wait.message_id }).catch(() => {});
    }
}

// ─────────────────────────────────────────────────────────
// Sector Analysis
// ─────────────────────────────────────────────────────────
async function handleSectorAnalysis(chatId, userId, sectorKey, useDeep, tone = 'normal') {
    const sectorInfo = SECTOR_MAP[sectorKey];
    if (!sectorInfo) return handleMarketAnalysis(chatId, userId, useDeep);

    const wait = await bot.sendMessage(chatId,
        `📡 **${sectorInfo.sector}** 섹터 분석 중... ⏳\n(약 45~90초 소요)`,
        { parse_mode: 'Markdown' }
    );
    try {
        const data = await fetchSectorData(sectorInfo);
        const report = await analyzeSector(data, useDeep, tone);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        sessions.addHistory(chatId, 'assistant', report.slice(0, 300));
        sessions.reset(chatId);
    } catch (err) {
        console.error('[handleSectorAnalysis]', err.message);
        bot.editMessageText(`❌ 섹터 분석 실패.${SIGNATURE}`, { chat_id: chatId, message_id: wait.message_id }).catch(() => {});
    }
}

// ─────────────────────────────────────────────────────────
// Compare Query Detection & Resolver
// ─────────────────────────────────────────────────────────
function isCompareQuery(text) {
    const lower = text.replace(/\s/g, '').toLowerCase();
    return /vs\.?/.test(lower) || lower.includes('비교') || lower.includes('어느게나아') || lower.includes('둘중어느');
}

function resolveCompareStocks(text) {
    const vsMatch = text.match(/(.+?)\s+(?:vs\.?|대|versus|비교)\s+(.+)/i);
    if (!vsMatch) return null;
    const r1 = resolveStock(vsMatch[1].trim());
    const r2 = resolveStock(vsMatch[2].trim());
    if (!r1 || !r2) return null;
    return { ticker1: r1.ticker, name1: r1.name, ticker2: r2.ticker, name2: r2.name };
}

// ─────────────────────────────────────────────────────────
// Stock Comparison Handler
// ─────────────────────────────────────────────────────────
async function handleStockComparison(chatId, userId, ticker1, name1, ticker2, name2, useDeep, tone = 'normal') {
    const wait = await bot.sendMessage(chatId,
        `🔍 **${name1 || ticker1} vs ${name2 || ticker2}** 비교 분석 중... ⏳\n(약 30~60초 소요)`,
        { parse_mode: 'Markdown' }
    );
    try {
        const [data1, data2] = await Promise.all([
            fetchAllStockData(ticker1, name1, null),
            fetchAllStockData(ticker2, name2, null),
        ]);
        const report = await analyzeStockComparison(data1, data2, useDeep, tone);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        sessions.addHistory(chatId, 'assistant', report.slice(0, 400));
        sessions.reset(chatId);
    } catch (err) {
        console.error('[handleStockComparison]', err.message);
        await bot.editMessageText(`❌ 비교 분석 실패: ${err.message}`, {
            chat_id: chatId, message_id: wait.message_id
        }).catch(() => {});
        sessions.reset(chatId);
    }
}

// ─────────────────────────────────────────────────────────
// Recommendation
// ─────────────────────────────────────────────────────────
 async function handleRecommendation(chatId, userId, useDeep, tone = 'normal') {
    const userStyle = watchlistStore.getStyle(chatId);          // 단타 | 스윙 | 장기
    const styleLabel = { 단타: '⚡단타', 스윙: '🔄스윙', 장기: '🌱장기' }[userStyle] || userStyle;
    const wait = await bot.sendMessage(chatId,
        `🔍 시장 전체 스캔 후 엄격한 4단계 필터 적용 중... ⏳\n투자 스타일: ${styleLabel} 기준`);
    try {
        const data = await fetchMarketData();
        const report = await analyzeRecommendation(data, useDeep, tone, userStyle);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        sessions.addHistory(chatId, 'assistant', report.slice(0, 400));

        // 추천 목록 파싱 -> 번호 선택 후속 질문 대응 ("1번 분석해줘" 등)
        const recMatches = [...report.matchAll(/\b(\d+)\.\s+([A-Z]{1,6})(?:\s+\(?([^)\n]+)\)?)?/g)];
        if (recMatches.length) {
            const suggestedList = recMatches.slice(0, 5).map(m => ({
                index:    parseInt(m[1], 10),
                ticker:   m[2],
                name:     (m[3] || m[2]).trim().replace(/[()]/g, ''),
                market:   'US',
                corpCode: null,
            }));
            sessions.setSuggestedList(chatId, suggestedList);
            console.log('[handleRecommendation] 추천 리스트 저장:', suggestedList.map(s => s.ticker));
        }
    } catch (err) {
        console.error('[handleRecommendation]', err.message);
        bot.editMessageText(`❌ 추천 분석 실패.${getSignature(tone)}`, { chat_id: chatId, message_id: wait.message_id }).catch(() => {});
    }
}

// ─────────────────────────────────────────────────────────
// Portfolio Analysis
// ─────────────────────────────────────────────────────────
async function handlePortfolioAnalysis(chatId, userId, portfolioItems, useDeep, tone = 'normal') {
    const labels = portfolioItems.map(p => `${p.name}(${p.weight}%)`).join(', ');
    const wait = await bot.sendMessage(chatId,
        `📊 **포트폴리오 분석** 중... ⏳\n[구성: ${labels}]`,
        { parse_mode: 'Markdown' }
    );
    try {
        const report = await analyzePortfolio(portfolioItems, useDeep, tone);
        await safeDelete(chatId, wait.message_id);
        await sendLongMessage(chatId, report);
        sessions.addHistory(chatId, 'assistant', report.slice(0, 400));
    } catch (err) {
        console.error('[handlePortfolioAnalysis]', err.message);
        await bot.editMessageText(`❌ 포트폴리오 분석 실패: ${err.message}`, {
            chat_id: chatId, message_id: wait.message_id
        }).catch(() => {});
    }
}

// ─────────────────────────────────────────────────────────
// Watchlist from natural language
// ─────────────────────────────────────────────────────────
function isWatchlistRequest(text) {
    const lower = text.toLowerCase();
    return (lower.includes('관심') && (lower.includes('추가') || lower.includes('저장'))) ||
           lower.includes('watchlist') || lower.includes('위시리스트');
}

async function handleWatchlistNL(chatId, userId, text) {
    // Try to extract a ticker from the message
    const match = text.match(/([A-Z]{1,5}|\d{6})/);
    if (match) {
        const ticker = match[1];
        if (!userWatchlists[userId]) userWatchlists[userId] = [];
        if (!userWatchlists[userId].includes(ticker)) {
            userWatchlists[userId].push(ticker);
            await bot.sendMessage(chatId, `✅ **${ticker}** 관심 종목에 추가했습니다!\n\n현재 관심 종목: ${userWatchlists[userId].join(', ')}${SIGNATURE}`, { parse_mode: 'Markdown' });
        } else {
            await bot.sendMessage(chatId, `ℹ️ ${ticker}는 이미 관심 목록에 있습니다.${SIGNATURE}`);
        }
    } else {
        await bot.sendMessage(chatId, `어떤 종목을 추가할까요?\n예) /add AAPL${SIGNATURE}`);
    }
}

// ─────────────────────────────────────────────────────────
// Utility message builders
// ─────────────────────────────────────────────────────────
function buildMarketFollowUp() {
    return `💬 특정 종목이나 섹터가 궁금하시면:

• "_NVDA 어때?_" — 종목 분석
• "_반도체 섹터 전망_" — 섹터 분석  
• "_추천 종목 알려줘_" — AI 추천

${SIGNATURE}`;
}

function buildFallbackMessage() {
    return `🤔 어떤 분석을 원하시나요?

• 종목: _"삼성전자"_, _"AAPL"_, _"TSLA 분석"_
• 시장: _"지금 시장 어때?"_, _"미국장 위험해?"_
• 섹터: _"반도체 전망"_, _"AI 주식"_
• 추천: _"요즘 뭐 살까?"_

${SIGNATURE}`;
}

function isRecommendationQuery(text) {
    const keywords = ['추천', '뭐 사', '뭘 사', '좋은 주식', '뭐가 좋', '좋은 종목', '추천해'];
    return keywords.some(k => text.toLowerCase().includes(k));
}

// ─────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────
async function safeDelete(chatId, messageId) {
    try { await bot.deleteMessage(chatId, messageId); } catch {}
}

async function sendLongMessage(chatId, text) {
    const MAX = 4000;
    if (text.length <= MAX) return bot.sendMessage(chatId, text);
    let remaining = text;
    while (remaining.length > 0) {
        await bot.sendMessage(chatId, remaining.slice(0, MAX));
        remaining = remaining.slice(MAX);
        if (remaining.length > 0) await new Promise(r => setTimeout(r, 500));
    }
}

function getBot() { return bot; }

module.exports = { initBot, getBot };

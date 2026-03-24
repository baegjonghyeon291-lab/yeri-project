/**
 * daily-briefing.js
 * 유저별 브리핑 시간(user-settings) 기반 동적 스케줄
 * 매 1분 체크 → 각 유저의 로컬 시각과 설정 시간 비교
 */
const watchlistStore = require('./watchlist-store');
const userSettings   = require('./user-settings');
const { generateDailyBriefingText } = require('./briefing_service');

// 당일 발송 완료 방지: userId → 'YYYY-MM-DD HH:MM'
const lastBriefingKey = new Map();

function getTodayLocal(timezone) {
    try {
        const d = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        return d; // 'YYYY-MM-DD'
    } catch {
        const kst = new Date(Date.now() + 9 * 3600000);
        return kst.toISOString().slice(0, 10);
    }
}

function getCurrentLocalHHMM(timezone) {
    return userSettings.getCurrentLocalTime(timezone); // 'HH:MM'
}

// ─────────────────────────────────────────────
// 단일 유저 브리핑 전송
// ─────────────────────────────────────────────
async function sendBriefingToUser(bot, { userId, chatId, tickers }, tone = 'cute') {
    if (!chatId || !tickers.length) return;

    const settings = userSettings.get(userId);
    const today    = getTodayLocal(settings.timezone);
    const dedupKey = `${userId}:${today}:${settings.briefingTime}`;
    if (lastBriefingKey.get(dedupKey)) return;

    try {
        console.log(`[DailyBriefing] 발송 → user=${userId} 종목: ${tickers.join(',')} (${settings.briefingTime} ${settings.timezone})`);
        const opener = tone === 'cute' ? '귀염둥이 예리야 😊 오늘 관심종목 브리핑이야!\n\n' : '안녕하세요 🙂 오늘 관심종목 브리핑입니다!\n\n';
        const text   = opener + (await generateDailyBriefingText(tickers, false));

        // 4000자 제한 분할 전송
        const chunks = [];
        let cur = '';
        for (const line of text.split('\n')) {
            if ((cur + '\n' + line).length > 3800) { chunks.push(cur.trim()); cur = line; }
            else cur = cur ? cur + '\n' + line : line;
        }
        if (cur.trim()) chunks.push(cur.trim());

        for (const chunk of chunks) {
            await bot.sendMessage(chatId, chunk);
            await new Promise(r => setTimeout(r, 500));
        }
        lastBriefingKey.set(dedupKey, true);
        console.log(`[DailyBriefing] ✅ 완료: user=${userId}`);
    } catch (err) {
        console.error(`[DailyBriefing] user=${userId} 오류:`, err.message);
    }
}

// ─────────────────────────────────────────────
// 외부에서 즉시 강제 실행 (수동 /brief)
// ─────────────────────────────────────────────
async function runDailyBriefing(bot) {
    const users = watchlistStore.getAllUsers();
    if (!users.length) return;
    for (const user of users) {
        await sendBriefingToUser(bot, user);
        await new Promise(r => setTimeout(r, 2000));
    }
}

// ─────────────────────────────────────────────
// 스케줄러: 1분마다 전체 유저의 설정 시간 체크
// ─────────────────────────────────────────────
function startDailyBriefingScheduler(bot) {
    console.log('[DailyBriefing] 🟢 유저별 동적 브리핑 스케줄러 시작');

    setInterval(async () => {
        const users      = watchlistStore.getAllUsers();
        const allSettings = userSettings.getAll();

        for (const user of users) {
            const s   = allSettings.find(a => a.userId === String(user.userId)) ||
                        userSettings.get(user.userId);
            if (!s.briefingEnabled) continue;

            const localNow  = getCurrentLocalHHMM(s.timezone);
            const targetTime = s.briefingTime;

            if (localNow === targetTime) {
                const tone = 'cute'; // TODO: 유저 tone 저장 시 연동
                await sendBriefingToUser(bot, user, tone).catch(e =>
                    console.error('[DailyBriefing] 오류:', e.message)
                );
            }
        }
    }, 60 * 1000); // 1분마다
}

module.exports = { startDailyBriefingScheduler, runDailyBriefing, sendBriefingToUser };

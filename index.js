const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const client = require('./services/openai-client');
const { initBot } = require('./services/telegram');

const REQUIRED = ['OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN'];
const OPTIONAL = ['FINNHUB_API_KEY', 'TWELVEDATA_API_KEY', 'ALPHAVANTAGE_API_KEY',
    'FMP_API_KEY', 'NEWS_API_KEY', 'DART_API_KEY', 'FRED_API_KEY'];

console.log('══════════════════════════════════');
console.log('  📈 AI Stock Analysis Assistant  ');
console.log('══════════════════════════════════');

// Validate required
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
    console.error('❌ Missing required ENV vars:');
    missing.forEach(k => console.error(`   → ${k}`));
    console.error('\n📄 Copy .env.example → .env and fill in your keys');
    process.exit(1);
}

// Warn optional
const missingOpt = OPTIONAL.filter(k => !process.env[k]);
if (missingOpt.length) {
    console.warn('⚠️  Missing optional API keys (limited features):');
    missingOpt.forEach(k => console.warn(`   → ${k}`));
}

const defaultModel = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1';
const deepModel    = process.env.OPENAI_MODEL_DEEP    || 'o3';
console.log(`\n✅ Models: default=${defaultModel} | deep=${deepModel}`);

// Diagnostic: Check if OpenAI client is authenticated
(async () => {
    try {
        const masked = process.env.OPENAI_API_KEY ? 
            process.env.OPENAI_API_KEY.substring(0, 7) + '...' : 'MISSING';
        console.log(`📡 [Diagnostic] Checking OpenAI Key: ${masked}`);
    } catch (e) {}
})();

console.log('🤖 Starting Telegram Bot...\n');

initBot(process.env.TELEGRAM_BOT_TOKEN);

// 실시간 관심종목 감시 시작
const { startWatcher } = require('./services/watcher');
const { getBot } = require('./services/telegram');
const { startDailyBriefingScheduler } = require('./services/daily-briefing');
const { startPerformanceTracker } = require('./services/recommendation-tracker');
setTimeout(() => {
    const botInstance = getBot();
    if (botInstance) {
        startWatcher(botInstance);
        startDailyBriefingScheduler(botInstance);
        startPerformanceTracker();          // 수익률 추적 스케줄러 (6시간마다)
    }
}, 3000);

// Graceful shutdown
process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); process.exit(0); });
process.on('unhandledRejection', (reason) => { console.error('[Unhandled]', reason); });

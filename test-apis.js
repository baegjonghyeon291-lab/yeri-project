/**
 * test-apis.js — yeri-project API 실사용 점검
 * 사용법: node test-apis.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const https = require('https');
const http = require('http');

const results = {};

// ─── 유틸 ──────────────────────────────────────────────────
function log(tag, msg) {
    console.log(`[API TEST] ${tag.padEnd(18)} → ${msg}`);
}
function ok(name, detail) {
    results[name] = 'OK';
    log(name, `✅ success | ${detail}`);
}
function fail(name, reason) {
    results[name] = `FAIL (${reason})`;
    log(name, `❌ ${reason}`);
}
function keyStatus(envKey) {
    const val = process.env[envKey];
    if (!val || val.trim() === '') return null;
    return val.trim();
}

function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request(url, {
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            timeout: 10000,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

// ─── 각 API 테스트 ─────────────────────────────────────────

async function testOpenAI() {
    const name = 'OPENAI';
    const key = keyStatus('OPENAI_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
            body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'say ok' }], max_tokens: 5 }
        });
        if (r.status === 200 && r.body?.choices?.[0]) ok(name, `model=${r.body.model}`);
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 60)}`);
    } catch(e) { fail(name, e.message); }
}

async function testTelegram() {
    const name = 'TELEGRAM';
    const key = keyStatus('TELEGRAM_BOT_TOKEN');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://api.telegram.org/bot${key}/getMe`);
        if (r.status === 200 && r.body?.ok) ok(name, `bot=@${r.body.result.username}`);
        else fail(name, `HTTP ${r.status} - ${r.body?.description || ''}`);
    } catch(e) { fail(name, e.message); }
}

async function testNews() {
    const name = 'NEWS_API';
    const key = keyStatus('NEWS_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://newsapi.org/v2/everything?q=NVIDIA&pageSize=1&apiKey=${key}`);
        if (r.status === 200 && r.body?.articles?.length > 0) ok(name, `title="${r.body.articles[0].title?.slice(0,40)}"`);
        else if (r.status === 401) fail(name, '401 인증 실패 (무효 키)');
        else if (r.status === 426) fail(name, '426 플랜 업그레이드 필요');
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 60)}`);
    } catch(e) { fail(name, e.message); }
}

async function testFinnhub() {
    const name = 'FINNHUB';
    const key = keyStatus('FINNHUB_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${key}`);
        if (r.status === 200 && r.body?.c) ok(name, `AAPL price=${r.body.c}, high=${r.body.h}`);
        else if (r.status === 401 || r.status === 403) fail(name, `${r.status} 인증 실패`);
        else if (r.status === 429) fail(name, '429 rate limit');
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 60)}`);
    } catch(e) { fail(name, e.message); }
}

async function testAlphaVantage() {
    const name = 'ALPHAVANTAGE';
    const key = keyStatus('ALPHAVANTAGE_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=MSFT&apikey=${key}`);
        const quote = r.body?.['Global Quote'];
        if (r.status === 200 && quote?.['05. price']) ok(name, `MSFT price=${quote['05. price']}`);
        else if (r.body?.Note) fail(name, `rate limit - ${r.body.Note.slice(0,50)}`);
        else if (r.body?.Information) fail(name, `quota - ${r.body.Information.slice(0,50)}`);
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
    } catch(e) { fail(name, e.message); }
}

async function testFred() {
    const name = 'FRED';
    const key = keyStatus('FRED_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${key}&limit=1&sort_order=desc&file_type=json`);
        const obs = r.body?.observations?.[0];
        if (r.status === 200 && obs) ok(name, `FEDFUNDS(기준금리) value=${obs.value}, date=${obs.date}`);
        else if (r.status === 400) fail(name, `400 Bad Request - ${r.body?.error_message || ''}`);
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 60)}`);
    } catch(e) { fail(name, e.message); }
}

async function testTwelveData() {
    const name = 'TWELVEDATA';
    const key = keyStatus('TWELVEDATA_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://api.twelvedata.com/price?symbol=NVDA&apikey=${key}`);
        if (r.status === 200 && r.body?.price) ok(name, `NVDA price=${r.body.price}`);
        else if (r.body?.code === 401) fail(name, '401 인증 실패');
        else if (r.body?.code === 429) fail(name, '429 rate limit');
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
    } catch(e) { fail(name, e.message); }
}

async function testFMP() {
    const name = 'FMP';
    const key = keyStatus('FMP_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=${key}`);
        if (r.status === 200 && Array.isArray(r.body) && r.body[0]?.price) ok(name, `AAPL price=${r.body[0].price}, mktCap=${r.body[0].marketCap}`);
        else if (r.status === 401 || r.status === 403) fail(name, `${r.status} 인증 실패`);
        else if (r.body?.['Error Message']) fail(name, `키 오류 - ${r.body['Error Message']}`);
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
    } catch(e) { fail(name, e.message); }
}

async function testPolygon() {
    const name = 'POLYGON';
    const key = keyStatus('POLYGON_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://api.polygon.io/v2/aggs/ticker/NVDA/prev?adjusted=true&apiKey=${key}`);
        const res = r.body?.results?.[0];
        if (r.status === 200 && res) ok(name, `NVDA prev close=${res.c}, volume=${res.v}`);
        else if (r.status === 403) fail(name, '403 인증 실패 (구독 플랜 필요)');
        else if (r.status === 429) fail(name, '429 rate limit');
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
    } catch(e) { fail(name, e.message); }
}

async function testNasdaq() {
    const name = 'NASDAQ';
    const key = keyStatus('NASDAQ_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://data.nasdaq.com/api/v3/datasets/WIKI/AAPL.json?rows=1&api_key=${key}`);
        if (r.status === 200 && r.body?.dataset) ok(name, `dataset=${r.body.dataset.name?.slice(0,30)}`);
        else if (r.status === 400 && r.body?.quandl_error) {
            // WIKI dataset deprecated - try another
            const r2 = await request(`https://data.nasdaq.com/api/v3/datasets.json?query=GDP&api_key=${key}&per_page=1`);
            if (r2.status === 200) ok(name, `연결 성공 (WIKI deprecated, 대체 데이터셋 조회 가능)`);
            else fail(name, `HTTP ${r2.status} - WIKI deprecated + 대체 실패`);
        }
        else if (r.status === 400) fail(name, `400 - ${r.body?.quandl_error?.message || JSON.stringify(r.body).slice(0,60)}`);
        else if (r.status === 401) fail(name, '401 인증 실패');
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
    } catch(e) { fail(name, e.message); }
}

async function testRapidAPI() {
    const name = 'RAPIDAPI';
    const key = keyStatus('RAPIDAPI_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request('https://yahoo-finance15.p.rapidapi.com/api/v1/markets/quote?ticker=AAPL&type=STOCKS', {
            headers: {
                'x-rapidapi-host': 'yahoo-finance15.p.rapidapi.com',
                'x-rapidapi-key': key
            }
        });
        if (r.status === 200 && r.body?.body?.primaryData) {
            ok(name, `AAPL price=${r.body.body.primaryData.lastSalePrice}`);
        } else if (r.status === 200 && r.body?.regularMarketPrice) {
            ok(name, `AAPL price=${r.body.regularMarketPrice}`);
        } else if (r.status === 403) {
            fail(name, '403 인증 실패 (키 또는 앱 비활성)');
        } else if (r.status === 429) {
            fail(name, '429 rate limit');
        } else {
            // 다른 Yahoo Finance endpoint 시도
            const r2 = await request('https://apidojo-yahoo-finance-v1.p.rapidapi.com/market/v2/get-quotes?region=US&symbols=AAPL', {
                headers: { 'x-rapidapi-host': 'apidojo-yahoo-finance-v1.p.rapidapi.com', 'x-rapidapi-key': key }
            });
            if (r2.status === 200) ok(name, `Yahoo Finance 연결 성공 (endpoint2)`);
            else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
        }
    } catch(e) { fail(name, e.message); }
}

async function testEODHD() {
    const name = 'EODHD';
    const key = keyStatus('EODHD_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request(`https://eodhd.com/api/real-time/AAPL.US?api_token=${key}&fmt=json`);
        if (r.status === 200 && r.body?.close) ok(name, `AAPL close=${r.body.close}, open=${r.body.open}`);
        else if (r.status === 401 || r.status === 403) fail(name, `${r.status} 인증 실패`);
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
    } catch(e) { fail(name, e.message); }
}

async function testTiingo() {
    const name = 'TIINGO';
    const key = keyStatus('TIINGO_API_KEY');
    if (!key) { fail(name, '키 누락'); return; }
    log(name, 'loaded');
    try {
        const r = await request('https://api.tiingo.com/tiingo/daily/aapl/prices?startDate=2025-01-01&token=' + key);
        if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) ok(name, `AAPL close=${r.body[0].close}, date=${r.body[0].date?.slice(0,10)}`);
        else if (r.status === 401) fail(name, '401 인증 실패');
        else if (r.status === 404) fail(name, '404 - endpoint/ticker 오류');
        else fail(name, `HTTP ${r.status} - ${JSON.stringify(r.body).slice(0, 80)}`);
    } catch(e) { fail(name, e.message); }
}

async function testSECEdgar() {
    const name = 'SEC_EDGAR';
    log(name, '(키 불필요 - 공개 API)');
    try {
        const r = await request('https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', {
            headers: { 'User-Agent': 'yeri-bot test@test.com' }
        });
        if (r.status === 200 && r.body?.entityName) ok(name, `entity=${r.body.entityName}, CIK=${r.body.cik}`);
        else fail(name, `HTTP ${r.status}`);
    } catch(e) { fail(name, e.message); }
}

// ─── 실행 ──────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  yeri-project API HEALTH CHECK');
    console.log('══════════════════════════════════════════════════');
    console.log('');

    const tests = [
        testOpenAI,
        testTelegram,
        testNews,
        testFinnhub,
        testAlphaVantage,
        testFred,
        testTwelveData,
        testFMP,
        testPolygon,
        testNasdaq,
        testRapidAPI,
        testEODHD,
        testTiingo,
        testSECEdgar,
    ];

    for (const test of tests) {
        try { await test(); }
        catch(e) { console.error(`[ERROR] ${test.name}: ${e.message}`); }
        await new Promise(r => setTimeout(r, 300)); // rate limit 방지
    }

    // ─── 최종 요약 ─────────────────────────────────────────
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  [API HEALTH SUMMARY]');
    console.log('══════════════════════════════════════════════════');
    let okCount = 0, failCount = 0;
    for (const [name, status] of Object.entries(results)) {
        const icon = status === 'OK' ? '✅' : '❌';
        console.log(`  ${icon} ${name.padEnd(14)}: ${status}`);
        if (status === 'OK') okCount++;
        else failCount++;
    }
    console.log('──────────────────────────────────────────────────');
    console.log(`  총 ${okCount + failCount}개 | ✅ 성공: ${okCount} | ❌ 실패: ${failCount}`);
    console.log('══════════════════════════════════════════════════');
}

main().catch(console.error);

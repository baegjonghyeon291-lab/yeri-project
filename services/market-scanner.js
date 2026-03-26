/**
 * market-scanner.js
 * "지금 살만한 종목 추천해줘" → 사전 유니버스 자동 스캔 → TOP3~5 반환
 *
 * 스캔 로직:
 *   1. 유니버스 종목 병렬로 가격+기술지표+뉴스 조회
 *   2. AI 점수 계산 (computeScore 활용)
 *   3. RSI < 60, 상승 추세, 뉴스 긍정 우선
 *   4. 점수 상위 TOP5 반환
 */
require('dotenv').config();
const { fetchAllStockData } = require('./data-fetcher');
const { computeScore }      = require('./analyzer');

// ── 스캔 유니버스 (30종목) ────────────────────────────────────
const US_UNIVERSE = [
    { ticker: 'NVDA',  name: 'NVIDIA' },
    { ticker: 'TSLA',  name: 'Tesla' },
    { ticker: 'AAPL',  name: 'Apple' },
    { ticker: 'MSFT',  name: 'Microsoft' },
    { ticker: 'META',  name: 'Meta' },
    { ticker: 'GOOGL', name: 'Alphabet' },
    { ticker: 'AMZN',  name: 'Amazon' },
    { ticker: 'PLTR',  name: 'Palantir' },
    { ticker: 'SOUN',  name: 'SoundHound' },
    { ticker: 'IONQ',  name: 'IonQ' },
    { ticker: 'SMCI',  name: 'Super Micro' },
    { ticker: 'AMD',   name: 'AMD' },
    { ticker: 'INTC',  name: 'Intel' },
    { ticker: 'AVGO',  name: 'Broadcom' },
    { ticker: 'TSM',   name: 'TSMC' },
    { ticker: 'CRWD',  name: 'CrowdStrike' },
    { ticker: 'NET',   name: 'Cloudflare' },
    { ticker: 'SNOW',  name: 'Snowflake' },
    { ticker: 'DDOG',  name: 'Datadog' },
    { ticker: 'UBER',  name: 'Uber' },
    { ticker: 'COIN',  name: 'Coinbase' },
    { ticker: 'MSTR',  name: 'MicroStrategy' },
    { ticker: 'SPY',   name: 'S&P500 ETF' },
    { ticker: 'QQQ',   name: 'Nasdaq ETF' },
    { ticker: 'SOFI',  name: 'SoFi' },
    { ticker: 'RKLB',  name: 'Rocket Lab' },
    { ticker: 'BBAI',  name: 'BigBear.ai' },
    { ticker: 'PATH',  name: 'UiPath' },
    { ticker: 'HOOD',  name: 'Robinhood' },
    { ticker: 'RDDT',  name: 'Reddit' },
];

// ── 캐시 (5분) ───────────────────────────────────────────────
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ── 리스크 레벨 분류 ─────────────────────────────────────────
function getRiskLevel(technical, fundamentals) {
    const rsi = technical?.rsi;
    const beta = fundamentals?.beta ? parseFloat(fundamentals.beta) : null;
    if (!rsi && !beta) return '중간';
    if ((rsi && rsi > 70) || (beta && beta > 1.5)) return '높음';
    if ((rsi && rsi < 40) || (beta && beta < 0.8)) return '낮음';
    return '중간';
}

// ── 단일 종목 스캔 ───────────────────────────────────────────
async function scanOne({ ticker, name }) {
    try {
        const data = await fetchAllStockData(ticker, name);
        const scoreResult = computeScore(data);
        const total = scoreResult.total || 0;

        const currency = ticker.endsWith('.KS') ? '₩' : '$';
        const price = data.price?.current;
        const rsi = data.technical?.rsi;
        const changePct = data.price?.changePct;
        const priceSource = data.price?.source || '-';
        const riskLevel = getRiskLevel(data.technical, data.fundamentals);

        // 기본 필터: 가격 존재 + 점수 18 이상
        if (!price || total < 18) return null;

        // RSI 과매수(>78) 제외 — 이미 너무 달아오른 종목만 제외
        if (rsi && rsi > 78) return null;

        return {
            ticker,
            name,
            score: total,
            verdict: scoreResult.verdict,
            price,
            currency,
            changePct: changePct ? changePct.toFixed(2) : null,
            rsi: rsi ? rsi.toFixed(1) : null,
            priceSource,
            riskLevel,
            suggestedAction: scoreResult.suggestedAction,
            triggerHint: scoreResult.triggerHint,
            fundSource: data.fundamentals?.source || '-',
            sector: data.fundamentals?.sector || '-',
            newsCount: data.news?.length || 0,
        };
    } catch (e) {
        console.warn(`[Scanner] ${ticker} 스킵: ${e.message}`);
        return null;
    }
}

// ── 메인 스캔 함수 ───────────────────────────────────────────
async function scanMarket(universe = US_UNIVERSE) {
    // 캐시 확인
    if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
        console.log('[Scanner] 캐시 사용');
        return _cache;
    }

    console.log(`[Scanner] 유니버스 스캔 시작: ${universe.length}종목`);
    const startTime = Date.now();

    // 병렬 스캔 (한번에 최대 5개씩)
    const results = [];
    const BATCH = 5;
    for (let i = 0; i < universe.length; i += BATCH) {
        const batch = universe.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(scanOne));
        results.push(...batchResults.filter(Boolean));
    }

    // 점수 내림차순 정렬
    results.sort((a, b) => b.score - a.score);

    const top = results.slice(0, 5);
    _cache = top;
    _cacheTs = Date.now();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scanner] 완료: ${elapsed}s | 통과 ${results.length}/${universe.length}종목 | TOP5: ${top.map(r => r.ticker).join(', ')}`);
    return top;
}

// ── 추천 메시지 포맷터 ──────────────────────────────────────
function formatRecommendations(topList, tone = 'normal') {
    if (!topList || topList.length === 0) {
        return tone === 'cute'
            ? '울 귀염둥이 😊\n지금 딱 좋은 종목을 찾기가 어렵네요. 잠시 후 다시 물어봐줘요!'
            : '현재 기준을 충족하는 추천 종목이 없습니다. 잠시 후 다시 시도해 주세요.';
    }

    const opener = tone === 'cute' ? '울 귀염둥이 😊\n지금 눈에 띄는 종목들 골라봤어요!\n\n' : '안녕하세요 🙂\n현재 시장 스캔 기준 추천 종목입니다.\n\n';
    const disclaimer = tone === 'cute'
        ? '\n⚠️ 이건 AI 분석이고 투자 손실은 제가 책임 못 해요. 분할 접근 잊지마세요!\n귀염둥이 예리의 성공적인 투자를 응원합니다♡'
        : '\n⚠️ AI 분석 기반 참고용이며, 투자 판단은 본인 책임입니다. 분할 접근을 권장합니다.\n성공적인 투자를 응원합니다 🙂';

    const cards = topList.map((r, i) => {
        const priceStr = `${r.currency}${r.price?.toLocaleString()}`;
        const changeStr = r.changePct != null
            ? (parseFloat(r.changePct) >= 0 ? `📈 +${r.changePct}%` : `📉 ${r.changePct}%`)
            : '';
        return [
            `**${i + 1}. ${r.name} (${r.ticker})** ${r.verdict}`,
            `• 현재가: **${priceStr}** ${changeStr}`,
            `• RSI: ${r.rsi || 'N/A'} | 리스크: ${r.riskLevel} | AI 점수: ${r.score}/40`,
            `• 섹터: ${r.sector}`,
            `• 추천 행동: ${r.suggestedAction}`,
            `• 진입 힌트: _${r.triggerHint}_`,
            `• 출처: ${r.priceSource}`,
        ].join('\n');
    }).join('\n\n──────────────\n\n');

    return opener + cards + disclaimer;
}

module.exports = { scanMarket, formatRecommendations, US_UNIVERSE };

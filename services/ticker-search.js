/**
 * ticker-search.js — 검색 기반 종목 인식 엔진
 *
 * 하드코딩 없이 종목명/티커 입력 → API 검색 → ticker 반환
 * 우선순위: Finnhub → Polygon → FMP
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const { searchYahooTicker } = require('./yahoo-finance-helper');

const FINNHUB_KEY  = process.env.FINNHUB_API_KEY;
const POLYGON_KEY  = process.env.POLYGON_API_KEY;
const FMP_KEY      = process.env.FMP_API_KEY;

// ─────────────────────────────────────────────
// 한글 → 영문 번역 매핑 (API 검색 전 전처리)
// ─────────────────────────────────────────────
const KR_TO_EN_HINT = {
    '엔비디아': 'NVIDIA',    '테슬라': 'Tesla',       '애플': 'Apple',
    '아마존': 'Amazon',      '구글': 'Google',        '알파벳': 'Alphabet',
    '메타': 'Meta',          '마이크로소프트': 'Microsoft', '마소': 'Microsoft',
    '팔란티어': 'Palantir',  '사운드하운드': 'SoundHound', '아이온큐': 'IonQ',
    '소파이': 'SoFi',        '로빈후드': 'Robinhood',   '코인베이스': 'Coinbase',
    '리비안': 'Rivian',      '루시드': 'Lucid',        '니오': 'NIO',
    '넷플릭스': 'Netflix',   '디즈니': 'Disney',       '스포티파이': 'Spotify',
    '줌': 'Zoom',            '페이팔': 'PayPal',       '스퀘어': 'Block',
    '블록': 'Block',         '우버': 'Uber',           '에어비앤비': 'Airbnb',
    '스냅': 'Snap',          '트위터': 'X Corp',       '레딧': 'Reddit',
    '두오링고': 'Duolingo',   '듀오링고': 'Duolingo',   '로블록스': 'Roblox',
    '슈퍼마이크로': 'Super Micro', '브로드컴': 'Broadcom', '인텔': 'Intel',
    '퀄컴': 'Qualcomm',      '암드': 'AMD',            '에이엠디': 'AMD',
    '마벨': 'Marvell',       '마이크론': 'Micron',     '램리서치': 'Lam Research',
    '화이자': 'Pfizer',      '모더나': 'Moderna',      '일라이릴리': 'Eli Lilly',
    '릴리': 'Eli Lilly',     '노보': 'Novo Nordisk',    '머크': 'Merck',
    '나이키': 'Nike',         '코카콜라': 'Coca Cola',  '맥도날드': 'McDonalds',
    '스타벅스': 'Starbucks',  '월마트': 'Walmart',      '홈디포': 'Home Depot',
    '코스트코': 'Costco',     '타겟': 'Target',
    '보잉': 'Boeing',         '록히드마틴': 'Lockheed Martin', '비야디': 'BYD',
    '알리바바': 'Alibaba',    '텐센트': 'Tencent',       '샤오미': 'Xiaomi',
    '빅베어': 'BigBear',      '심보틱': 'Symbotic',      '유아이패스': 'UiPath',
    '데이터독': 'Datadog',    '몽고디비': 'MongoDB',      '스노우플레이크': 'Snowflake',
    '클라우드플레어': 'Cloudflare', '크라우드스트라이크': 'CrowdStrike',
    '팔로알토': 'Palo Alto',  '포티넷': 'Fortinet',      '지스케일러': 'Zscaler',
};

// ─────────────────────────────────────────────
// 한국 종목 한글 → KS 티커 직접 매핑 (한글 검색 지원용)
// ─────────────────────────────────────────────
const KR_DIRECT_MAP = {
    '삼성전자': { ticker: '005930.KS', name: 'Samsung Electronics' },
    '삼성': { ticker: '005930.KS', name: 'Samsung Electronics' },
    'sk하이닉스': { ticker: '000660.KS', name: 'SK Hynix' },
    'sk하이닉스': { ticker: '000660.KS', name: 'SK Hynix' },
    '하이닉스': { ticker: '000660.KS', name: 'SK Hynix' },
    '카카오': { ticker: '035720.KS', name: 'Kakao Corp' },
    '네이버': { ticker: '035420.KS', name: 'NAVER Corp' },
    '현대차': { ticker: '005380.KS', name: 'Hyundai Motor' },
    '현대자동차': { ticker: '005380.KS', name: 'Hyundai Motor' },
    '기아': { ticker: '000270.KS', name: 'Kia Corp' },
    '기아차': { ticker: '000270.KS', name: 'Kia Corp' },
    '셀트리온': { ticker: '068270.KS', name: 'Celltrion' },
    'lg화학': { ticker: '051910.KS', name: 'LG Chem' },
    'lg에너지솔루션': { ticker: '373220.KS', name: 'LG Energy Solution' },
    '삼성바이오': { ticker: '207940.KS', name: 'Samsung Biologics' },
    '삼성바이오로직스': { ticker: '207940.KS', name: 'Samsung Biologics' },
    '포스코': { ticker: '005490.KS', name: 'POSCO Holdings' },
    '포스코홀딩스': { ticker: '005490.KS', name: 'POSCO Holdings' },
    'kb금융': { ticker: '105560.KS', name: 'KB Financial' },
    '신한지주': { ticker: '055550.KS', name: 'Shinhan Financial' },
    '하나금융': { ticker: '086790.KS', name: 'Hana Financial' },
    '카카오뱅크': { ticker: '323410.KS', name: 'KakaoBank' },
    '카카오페이': { ticker: '377300.KS', name: 'Kakao Pay' },
    '크래프톤': { ticker: '259960.KS', name: 'KRAFTON' },
    '엔씨소프트': { ticker: '036570.KS', name: 'NCSoft' },
    '넥슨': { ticker: '225570.KS', name: 'Nexon Korea' },
    '에코프로비엠': { ticker: '247540.KS', name: 'EcoPro BM' },
    '에코프로': { ticker: '086520.KS', name: 'EcoPro' },
    '두산에너빌리티': { ticker: '034020.KS', name: 'Doosan Enerbility' },
    'lg전자': { ticker: '066570.KS', name: 'LG Electronics' },
    '삼성sds': { ticker: '018260.KS', name: 'Samsung SDS' },
    'kt': { ticker: '030200.KS', name: 'KT Corp' },
    'skt': { ticker: '017670.KS', name: 'SK Telecom' },
    'sk텔레콤': { ticker: '017670.KS', name: 'SK Telecom' },
};


// ─────────────────────────────────────────────
// 검색어 전처리: 한글 → 영문 힌트, 노이즈 제거
// ─────────────────────────────────────────────
function preprocessQuery(raw) {
    const trimmed = (raw || '').trim();
    // 직접 번역 힌트 확인
    for (const [kr, en] of Object.entries(KR_TO_EN_HINT)) {
        if (trimmed.includes(kr)) return en;
    }
    // 이미 영문이면 그대로
    if (/^[A-Za-z]/.test(trimmed)) return trimmed;
    // 한글이지만 매핑 없으면 그대로 (Finnhub이 처리 시도)
    return trimmed;
}

// ─────────────────────────────────────────────
// Finnhub 검색 API
// GET /api/v1/search?q={query}&token={key}
// ─────────────────────────────────────────────
async function searchFinnhub(query) {
    if (!FINNHUB_KEY) return [];
    try {
        const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const data = await res.json();
        const results = (data.result || [])
            .filter(r => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'ETF')
            .slice(0, 5)
            .map(r => ({
                ticker: r.symbol,
                name:   r.description || r.symbol,
                exchange: r.displaySymbol,
                source: 'Finnhub',
                confidence: calcConfidence(query, r.description || '', r.symbol),
            }));
        return results;
    } catch (err) {
        console.warn(`[TickerSearch] Finnhub 실패: ${err.message}`);
        return [];
    }
}

// ─────────────────────────────────────────────
// Polygon 검색 API
// GET /v3/reference/tickers?search={query}&active=true
// ─────────────────────────────────────────────
async function searchPolygon(query) {
    if (!POLYGON_KEY) return [];
    try {
        const url = `https://api.polygon.io/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&locale=us&market=stocks&limit=5&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || []).slice(0, 5).map(r => ({
            ticker: r.ticker,
            name:   r.name || r.ticker,
            exchange: r.primary_exchange,
            source: 'Polygon',
            confidence: calcConfidence(query, r.name || '', r.ticker),
        }));
    } catch (err) {
        console.warn(`[TickerSearch] Polygon 실패: ${err.message}`);
        return [];
    }
}

// ─────────────────────────────────────────────
// FMP 검색 API
// GET /api/v3/search?query={query}&apikey={key}
// ─────────────────────────────────────────────
async function searchFMP(query) {
    if (!FMP_KEY) return [];
    try {
        const url = `https://financialmodelingprep.com/api/v3/search?query=${encodeURIComponent(query)}&limit=5&exchange=NASDAQ,NYSE,AMEX&apikey=${FMP_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const data = await res.json();
        return (data || []).slice(0, 5).map(r => ({
            ticker: r.symbol,
            name:   r.name || r.symbol,
            exchange: r.exchangeShortName,
            source: 'FMP',
            confidence: calcConfidence(query, r.name || '', r.symbol),
        }));
    } catch (err) {
        console.warn(`[TickerSearch] FMP 실패: ${err.message}`);
        return [];
    }
}

// ─────────────────────────────────────────────
// 신뢰도 계산 (0~1)
// ─────────────────────────────────────────────
function calcConfidence(query, name, ticker) {
    const q = query.toLowerCase().replace(/\s/g, '');
    const n = (name || '').toLowerCase().replace(/\s/g, '');
    const t = (ticker || '').toLowerCase();

    // 티커 완전 일치
    if (t === q) return 1.0;
    // 이름 완전 일치
    if (n === q) return 0.95;
    // 이름이 쿼리를 포함
    if (n.startsWith(q) || q.startsWith(n)) return 0.85;
    // 티커가 쿼리를 포함
    if (t.includes(q) || q.includes(t)) return 0.8;
    // 부분 문자열 포함
    if (n.includes(q)) return 0.7;
    if (q.includes(n.substring(0, 4))) return 0.6;
    // 최소 2자 겹침
    for (let len = Math.min(q.length, n.length, 4); len >= 2; len--) {
        for (let i = 0; i <= q.length - len; i++) {
            if (n.includes(q.substring(i, i + len))) return 0.4 + len * 0.05;
        }
    }
    return 0.2;
}

// ─────────────────────────────────────────────
// 중복 제거 및 신뢰도로 정렬
// ─────────────────────────────────────────────
function dedupeAndRank(results) {
    const seen = new Set();
    return results
        .filter(r => {
            if (seen.has(r.ticker)) return false;
            seen.add(r.ticker);
            return true;
        })
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
}

// ─────────────────────────────────────────────
// 메인 검색 함수 — 외부에서 호출
// ─────────────────────────────────────────────
/**
 * @param {string} rawInput  사용자 입력 (한글/영문 종목명 or 티커)
 * @returns {Promise<{
 *   found: boolean,
 *   auto: boolean,       // true: 자동 선택됨 / false: 후보 제시 필요
 *   ticker: string|null,
 *   name: string|null,
 *   candidates: Array,   // auto=false일 때 사용자에게 보여줄 후보 목록
 * }>}
 */
async function searchTicker(rawInput) {
    const query = preprocessQuery(rawInput);
    const queryLower = rawInput.trim().toLowerCase();
    console.log(`[TickerSearch] 검색: "${rawInput}" → 전처리: "${query}"`);

    // 0순위: 한국 종목 직접 매핑 (한글 → KS 티커)
    if (KR_DIRECT_MAP[queryLower] || KR_DIRECT_MAP[rawInput.trim()]) {
        const m = KR_DIRECT_MAP[queryLower] || KR_DIRECT_MAP[rawInput.trim()];
        console.log(`[TickerSearch] KR 직접 매핑: ${rawInput} → ${m.ticker}`);
        return { found: true, auto: true, ticker: m.ticker, name: m.name, candidates: [{ ticker: m.ticker, name: m.name, source: 'KR_MAP', confidence: 1.0 }] };
    }

    // 1순위: Finnhub
    let results = await searchFinnhub(query);

    // 2순위: Polygon (Finnhub 결과 부족 시)
    if (results.length < 2) {
        const polyResults = await searchPolygon(query);
        results = dedupeAndRank([...results, ...polyResults]);
    } else {
        results = dedupeAndRank(results);
    }

    // 3순위: Yahoo Finance (아직 부족 시)
    if (results.length < 1) {
        try {
            const yhResults = await searchYahooTicker(query);
            const withConf  = yhResults.map(r => ({
                ...r,
                confidence: calcConfidence(query, r.name || '', r.ticker),
            }));
            results = dedupeAndRank([...results, ...withConf]);
            if (results.length) console.log(`[TickerSearch] Yahoo 보완: ${results.map(r => r.ticker).join(', ')}`);
        } catch (e) {
            console.warn(`[TickerSearch] Yahoo 검색 실패: ${e.message}`);
        }
    }

    if (!results.length) {
        return { found: false, auto: false, ticker: null, name: null, candidates: [] };
    }

    const top = results[0];

    // 신뢰도 0.75 이상이면 자동 선택
    if (top.confidence >= 0.75) {
        return { found: true, auto: true, ticker: top.ticker, name: top.name, candidates: results };
    }

    // 신뢰도 0.5 이상이지만 불확실하면 후보 제시
    if (top.confidence >= 0.5) {
        return { found: true, auto: false, ticker: null, name: null, candidates: results.slice(0, 3) };
    }

    // 0.5 미만이면 찾지 못함
    return { found: false, auto: false, ticker: null, name: null, candidates: [] };
}

module.exports = { searchTicker, preprocessQuery };

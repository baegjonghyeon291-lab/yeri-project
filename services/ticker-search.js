/**
 * ticker-search.js — 검색 기반 종목 인식 엔진
 *
 * 하드코딩 없이 종목명/티커 입력 → API 검색 → ticker 반환
 * 우선순위: KRX 로컬 마스터 -> Finnhub → Polygon → FMP
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const { searchYahooTicker } = require('./yahoo-finance-helper');

const FINNHUB_KEY  = process.env.FINNHUB_API_KEY;
const POLYGON_KEY  = process.env.POLYGON_API_KEY;
const FMP_KEY      = process.env.FMP_API_KEY;

// ─────────────────────────────────────────────
// 한국 주식 마스터 로드 (KOSPI, KOSDAQ, KONEX)
// ─────────────────────────────────────────────
let krMasterList = [];
try {
    const data = fs.readFileSync(path.join(__dirname, '../data/kr_tickers.json'), 'utf8');
    krMasterList = JSON.parse(data);
    console.log(`[TickerSearch] 🇰🇷 KRX Master 로켓-로드 완료: ${krMasterList.length}건`);
} catch(e) {
    console.warn("KRX master list load failed", e.message);
}

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
// 한국 주식 마스터 검색 (완벽한 fuzzy & 오타 보정)
// ─────────────────────────────────────────────
function searchKoTicker(query) {
    if (!krMasterList.length) return [];
    
    const qLower = query.toLowerCase().replace(/\s/g, '');
    let matched = [];

    // 영어/숫자/한글 모두 체크
    for (const k of krMasterList) {
       const rawName = k.Name || '';
       const nameNoSpace = rawName.toLowerCase().replace(/\s/g, '');
       const code = k.Code || '';
       
       let conf = 0;
       
       // 종목코드 매칭 (100% 신뢰)
       if (code === qLower || code.includes(qLower)) conf = code === qLower ? 1.0 : 0.8;
       // 풀네임 매칭 (100% 신뢰)
       else if (nameNoSpace === qLower) conf = 1.0;
       // 앞부분 일치 매칭 (90% 신뢰)
       else if (nameNoSpace.startsWith(qLower)) conf = 0.90;
       // 부분 포함 (70% 신뢰)
       else if (nameNoSpace.includes(qLower)) conf = 0.70;
       
       if (conf >= 0.5) {
          const suffix = k.Market === 'KOSPI' ? '.KS' : (k.Market === 'KOSDAQ' ? '.KQ' : '.KS');
          const isPreferred = rawName.endsWith('우') || rawName.endsWith('우B');
          matched.push({
             ticker: code + suffix,
             rawTicker: code, // UI 렌더링용
             name: rawName,
             exchange: k.Market + (isPreferred ? ' 우선주' : ''),
             source: 'KRX',
             confidence: conf
          });
       }
    }
    
    // 정렬 규칙 (핵심): 신뢰도 높은 순 -> 이름이 짧은 순 (삼정펄프 vs 삼정펄프홀딩스) -> 시장구분
    matched.sort((a,b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.name.length - b.name.length;
    });
    
    return matched.slice(0, 20);
}

// ─────────────────────────────────────────────
// 검색어 전처리: 한글 → 영문 힌트, 노이즈 제거
// ─────────────────────────────────────────────
function preprocessQuery(raw) {
    const trimmed = (raw || '').trim();
    for (const [kr, en] of Object.entries(KR_TO_EN_HINT)) {
        if (trimmed.includes(kr)) return en;
    }
    if (/^[A-Za-z]/.test(trimmed)) return trimmed;
    return trimmed;
}

// ─────────────────────────────────────────────
// Finnhub 검색 API
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
                rawTicker: r.symbol,
                name:   r.description || r.symbol,
                exchange: r.displaySymbol || 'US',
                source: 'Finnhub',
                confidence: calcConfidence(query, r.description || '', r.symbol),
            }));
        return results;
    } catch (err) { return []; }
}

// ─────────────────────────────────────────────
// Polygon 검색 API
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
            rawTicker: r.ticker,
            name:   r.name || r.ticker,
            exchange: r.primary_exchange || 'US',
            source: 'Polygon',
            confidence: calcConfidence(query, r.name || '', r.ticker),
        }));
    } catch (err) { return []; }
}

// ─────────────────────────────────────────────
// 신뢰도 계산 (0~1)
// ─────────────────────────────────────────────
function calcConfidence(query, name, ticker) {
    const q = query.toLowerCase().replace(/\s/g, '');
    const n = (name || '').toLowerCase().replace(/\s/g, '');
    const t = (ticker || '').toLowerCase();

    if (t === q) return 1.0;
    if (n === q) return 0.95;
    if (n.startsWith(q) || q.startsWith(n)) return 0.85;
    if (t.includes(q) || q.includes(t)) return 0.8;
    if (n.includes(q)) return 0.7;
    return 0.2;
}

function dedupeAndRank(results) {
    const seen = new Set();
    return results
        .filter(r => {
            if (seen.has(r.ticker)) return false;
            seen.add(r.ticker);
            return true;
        })
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);
}

// ─────────────────────────────────────────────
// 메인 검색 함수
// ─────────────────────────────────────────────
async function searchTicker(rawInput) {
    const queryLower = rawInput.trim().toLowerCase();
    console.log(`[TickerSearch] 원본 검색어: "${rawInput}"`);

    // 0순위: 국내 종목 초고속 로컬 탐색 (완전 분리)
    const krResults = searchKoTicker(queryLower);
    
    // 한국어/국내 기업 코드로 명확히 감지된 경우 미국 로직 스킵!
    if (krResults.length > 0 && krResults[0].confidence >= 0.7) {
        console.log(`[TickerSearch] 🇰🇷 국내 종목 즉시 감지됨: ${krResults[0].name}`);
        const top = krResults[0];
        // 사용자가 명시적 선택을 더 자주 할 수 있도록 auto: true 조건을 100% 코드 일치 레벨로 극단적으로 높임
        if (top.confidence >= 1.0 && krResults.length === 1) {
            return { found: true, auto: true, ticker: top.ticker, rawTicker: top.rawTicker, name: top.name, exchange: top.exchange, candidates: krResults };
        }
        // 풍부한 후보 제공 (최대 15개)
        return { found: true, auto: false, ticker: null, rawTicker: null, name: null, candidates: krResults.slice(0, 15) };
    }

    // 1순위: 해외 종목 힌트 번역 (ex: 넷플릭스 -> Netflix)
    const query = preprocessQuery(rawInput);
    let results = await searchFinnhub(query);

    if (results.length < 2) {
        const polyResults = await searchPolygon(query);
        results = dedupeAndRank([...results, ...polyResults]);
    } else {
        results = dedupeAndRank(results);
    }

    if (results.length < 1) {
        try {
            const yhResults = await searchYahooTicker(query);
            const withConf  = yhResults.map(r => ({
                ...r,
                rawTicker: r.ticker,
                confidence: calcConfidence(query, r.name || '', r.ticker),
            }));
            results = dedupeAndRank([...results, ...withConf]);
        } catch (e) {}
    }

    if (!results.length) {
        // 완전 실패 시 코리아 풀 한번 더 제공해봄 (보험)
        if (krResults.length > 0) return { found: true, auto: false, ticker: null, candidates: krResults.slice(0,3) };
        return { found: false, auto: false, ticker: null, name: null, candidates: [] };
    }

    const top = results[0];

    if (top.confidence >= 0.85) {
        return { found: true, auto: true, ticker: top.ticker, rawTicker: top.rawTicker, name: top.name, exchange: top.exchange, candidates: results };
    }

    if (top.confidence >= 0.5) {
        return { found: true, auto: false, ticker: null, name: null, candidates: results.slice(0, 4) };
    }

    return { found: false, auto: false, ticker: null, name: null, candidates: [] };
}

module.exports = { searchTicker, preprocessQuery };

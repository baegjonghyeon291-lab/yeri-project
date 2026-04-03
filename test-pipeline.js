require('dotenv').config();
const df = require('./services/data-fetcher');
const az = require('./services/analyzer');

const TICKERS = ['IREN', 'NVDA', 'TSLA', 'RIVN'];

async function testTicker(ticker) {
    console.log(`\n${'█'.repeat(60)}`);
    console.log(`█  테스트: ${ticker}`);
    console.log(`${'█'.repeat(60)}`);

    const raw = await df.fetchAllStockData(ticker);

    console.log(`\n[1] Raw Data`);
    console.log(`  price: ${raw.price?.current} (source:${raw.price?.source})`);
    console.log(`  PER:${raw.fundamentals?.peRatio} ROE:${raw.fundamentals?.roe} D/E:${raw.fundamentals?.debtToEquity} FCF:${raw.fundamentals?.freeCashFlow} (source:${raw.fundamentals?.source})`);
    console.log(`  RSI:${raw.technical?.rsi?.toFixed?.(1)} (source:${raw.technical?.source})`);
    console.log(`  news: ${raw.news?.length || 0}건`);

    console.log(`\n[2] Normalized Data`);
    const norm = az.normalizeData(raw);
    for (const [k, v] of Object.entries(norm)) {
        const val = v.value != null ? (typeof v.value === 'object' ? 'obj' : v.value) : 'null';
        console.log(`  ${k}: ${val} | src:${v.source} | period:${v.period} | date:${v.asOfDate}`);
    }

    console.log(`\n[3] Validation`);
    const { cleaned, warnings } = az.validateData(norm, raw);
    const removed = Object.entries(cleaned).filter(([,v]) => v._removed).map(([k]) => k);
    console.log(`  제거됨(no source): ${removed.length ? removed.join(',') : '없음'}`);
    warnings.forEach(w => console.log(`  ${w}`));
    if (!warnings.length) console.log(`  경고 없음`);

    console.log(`\n[4] 6대 점수 + 뉴스`);
    const newsAn = { positive: [], negative: [], neutral: [], total: 0 };
    if (raw.news?.length) {
        const pk = ['beat','surge','growth','buy','upgrade','profit','rally'];
        const nk = ['miss','fall','drop','downgrade','sell','loss','cut'];
        for (const n of raw.news.slice(0, 8)) {
            const t = (n.title||'').toLowerCase();
            const p = pk.filter(k => t.includes(k)).length;
            const ng = nk.filter(k => t.includes(k)).length;
            newsAn.total++;
            if (p > ng) newsAn.positive.push(n);
            else if (ng > p) newsAn.negative.push(n);
            else newsAn.neutral.push(n);
        }
    }
    const s6 = az.computeScore6(cleaned, newsAn);
    console.log(`  성장성:${s6.growth??'N/A'} 수익성:${s6.profitability??'N/A'} 재무안정성:${s6.stability??'N/A'} 밸류에이션:${s6.valuation??'N/A'} 모멘텀:${s6.momentum??'N/A'} 뉴스심리:${s6.newsSentiment??'N/A'} 종합:${s6.overall??'N/A'}`);

    const cn = az.classifyNewsItems(raw.news);
    cn.slice(0,3).forEach(c => console.log(`  [${c.type}] ${(c.title||'').slice(0,50)} | 강도:${c.strength} 신뢰:${c.trust} 지속:${c.duration}`));

    console.log(`\n[5] 검증 포인트`);
    const ctx = az.buildVerifiedContext(raw);
    console.log(`  source없는값 제거: ${!ctx.includes('source: null') ? '✅PASS' : '❌FAIL'}`);
    console.log(`  날짜 추론 없음: ${!/\d{4}\.\d{2}\.\d{2}/.test(ctx) ? '✅PASS' : '❌FAIL'}`);
    console.log(`  6점수 계산: ${s6.overall!=null ? '✅PASS('+s6.overall+')' : '⚠️PARTIAL'}`);

    return { ticker, s6, warnings };
}

(async () => {
    const results = [];
    for (const t of TICKERS) {
        try { results.push(await testTicker(t)); } catch(e) { console.error(`❌ ${t}: ${e.message}`); }
    }
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`최종 요약`);
    results.forEach(r => console.log(`  ${r.ticker}: 종합=${r.s6.overall??'N/A'} warnings=${r.warnings.length}`));
    console.log(`테스트 완료!`);
})();

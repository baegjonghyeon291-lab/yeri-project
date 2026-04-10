/**
 * naver-finance-helper.js
 * 네이버 모바일 금융 API 기반 데이터 추출 모듈
 * (한국 주식 전용 펀더멘털 데이터 보완용)
 */
const axios = require('axios');

/**
 * 콤마(,) 등 포함된 문자열을 실수(Float)로 변환
 */
function parseNum(val) {
    if (!val || val === '-' || val === 'N/A') return null;
    const cleaned = String(val).replace(/,/g, '').replace(/[^\d.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

/**
 * 네이버 모바일 금융 API에서 재무제표 값 조회
 * @param {string} ticker 005930.KS 또는 090710 등의 티커 정규어
 */
async function getNaverFundamentals(ticker) {
    // .KS 또는 .KQ 제거
    const code = ticker.replace(/\.KS/i, '').replace(/\.KQ/i, '');
    if (!/^\d{6}$/.test(code)) return null;

    try {
        // 1. Integration API (시총, 기초 정보)
        const intRes = await axios.get(`https://m.stock.naver.com/api/stock/${code}/integration`, { timeout: 8000 });
        const intData = intRes.data?.totalInfos || [];
        
        let mktCapNum = null;
        let per = null;
        let eps = null;
        let pbr = null;
        let bps = null;
        let cnsPer = null;
        let cnsEps = null;
        let dividendYield = null;
        let companyName = intRes.data?.stockName; // fallback if needed

        // Extract key components
        for (const info of intData) {
            if (info.code === 'marketValue' && info.value) {
                // 시가총액은 "1조 3,009억" 포맷 (조, 억 단위)
                const txt = info.value;
                let sum = 0;
                const jo = txt.match(/([\d,.]+)조/);
                const uk = txt.match(/([\d,.]+)억/);
                if (jo) sum += parseNum(jo[1]) * 1000000000000;
                if (uk) sum += parseNum(uk[1]) * 100000000;
                if (sum > 0) mktCapNum = sum;
            }
            if (info.code === 'per') per = parseNum(info.value);
            if (info.code === 'eps') eps = parseNum(info.value);
            if (info.code === 'pbr') pbr = parseNum(info.value);
            if (info.code === 'bps') bps = parseNum(info.value);
            if (info.code === 'cnsPer') cnsPer = parseNum(info.value);
            if (info.code === 'cnsEps') cnsEps = parseNum(info.value);
            if (info.code === 'dividendYieldRatio') dividendYield = parseNum(info.value);
        }

        // 2. Annual Finance API (ROE, 부채비율, 현금흐름, 매출액 등)
        let roe = null;
        let debtToEquity = null;
        let revenue = null;
        let operatingIncome = null;
        let netIncome = null;
        let netMargin = null;

        try {
            const annRes = await axios.get(`https://m.stock.naver.com/api/stock/${code}/finance/annual`, { timeout: 8000 });
            const rows = annRes.data?.financeInfo?.rowList || [];
            const cols = annRes.data?.financeInfo?.trTitleList || [];
            
            // 최신 완료된 회계연도 키 찾기 (isConsensus가 N인 것 중 가장 나중 것)
            let latestKey = null;
            for (let i = cols.length - 1; i >= 0; i--) {
                if (cols[i].isConsensus === 'N') {
                    latestKey = cols[i].key;
                    break;
                }
            }

            if (latestKey && rows.length > 0) {
                for (const r of rows) {
                    const val = r.columns?.[latestKey]?.value;
                    const num = parseNum(val);
                    if (num === null) continue;

                    // 금액 데이터는 기본적으로 "억원" 단위이므로 1억을 곱해줌
                    if (r.title === '매출액') revenue = num * 100000000;
                    else if (r.title === '영업이익') operatingIncome = num * 100000000;
                    else if (r.title === '당기순이익') netIncome = num * 100000000;
                    else if (r.title === '순이익률') netMargin = num;
                    else if (r.title === 'ROE') roe = num;
                    else if (r.title === '부채비율') debtToEquity = num;
                    else if (!per && r.title === 'PER') per = num;
                    else if (!eps && r.title === 'EPS') eps = num;
                    else if (!pbr && r.title === 'PBR') pbr = num;
                }
            }
        } catch (e) {
            console.warn(`[Naver/Fundamentals] ${code} Annual Finance Fetch Error: ${e.message}`);
        }

        return {
            companyName: intRes.data?.stockName || ticker,
            mktCap: mktCapNum,
            peRatio: per || cnsPer,
            forwardPE: cnsPer || null,
            eps: eps || cnsEps,
            pbRatio: pbr,
            bps: bps,
            roe: roe ? `${roe}%` : null,
            netMargin: netMargin ? `${netMargin}%` : null,
            debtToEquity: debtToEquity,
            revenue: revenue,
            operatingIncome: operatingIncome,
            netIncome: netIncome,
            dividendYield: dividendYield ? parseFloat((dividendYield / 100).toFixed(4)) : null, // 3.12% -> 0.0312 통일
            source: 'Naver Finance'
        };

    } catch (e) {
        console.warn(`[Naver/Fundamentals] ${code} Integration Fetch Error: ${e.message}`);
        return null;
    }
}

module.exports = {
    getNaverFundamentals
};

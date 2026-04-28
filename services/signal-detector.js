/**
 * signal-detector.js
 * 기술적 지표 기반 매수/매도/과열 신호 감지
 * 스타일(단타/스윙/장기)별 임계값 차등 적용
 */

// 스타일별 신호 임계값
const THRESHOLDS = {
    단타: {
        buyRsi: 38,       // RSI 이하면 매수 신호
        sellRsi: 68,      // RSI 이상이면 매도 신호
        overheatRsi: 72,  // RSI 이상 + 急등 = 과열
        buyDrop: 6,       // % 낙폭 >= 이 값이면 매수 신호
        sellSurge: 12,    // % 급등 >= 이 값이면 매도 신호
        overheatSurge: 12,
    },
    스윙: {
        buyRsi: 35,
        sellRsi: 70,
        overheatRsi: 75,
        buyDrop: 8,
        sellSurge: 18,
        overheatSurge: 15,
    },
    장기: {
        buyRsi: 30,
        sellRsi: 75,
        overheatRsi: 80,
        buyDrop: 12,
        sellSurge: 25,
        overheatSurge: 20,
    },
};

/**
 * 종목 데이터에서 신호 감지
 * @param {Object} data  fetchAllStockData 결과
 * @param {string} style 단타 | 스윙 | 장기
 * @returns {{ type: 'BUY'|'SELL'|'OVERHEAT'|null, reasons: string[], rsi, price, change1m }}
 */
function detectSignal(data, style = '스윙') {
    const thr = THRESHOLDS[style] || THRESHOLDS['스윙'];

    // 지표 추출 — fetchAllStockData 반환 구조: data.technical.rsi
    const price   = data?.price?.current || data?.currentPrice || null;
    const rsi     = data?.technical?.rsi ?? data?.technicals?.rsi14 ?? data?.rsi ?? null;
    const change1m = data?.price?.change1m ?? data?.change1m ?? null;
    const change1d = data?.price?.changePct ?? data?.price?.changePercent ?? data?.changePercent ?? null;
    const ema20   = data?.technical?.ema20 ?? data?.technicals?.ema20 ?? null;
    const macdSignal = data?.technical?.macd?.signal ?? data?.technicals?.macdSignal ?? null;

    const reasons = [];
    let signalType = null;

    // ── 과열 판단 (가장 먼저: 매도보다 우선) ────────────────────
    if (
        rsi !== null && rsi >= thr.overheatRsi &&
        change1m !== null && change1m >= thr.overheatSurge
    ) {
        signalType = 'OVERHEAT';
        reasons.push(`RSI ${rsi.toFixed(1)} (과열 임계값 >${thr.overheatRsi})`);
        if (change1m) reasons.push(`최근 1개월 +${change1m.toFixed(1)}% 급등`);
    }
    // ── 매도 신호 ──────────────────────────────────────────────
    else if (
        (rsi !== null && rsi >= thr.sellRsi) ||
        (change1m !== null && change1m >= thr.sellSurge)
    ) {
        signalType = 'SELL';
        if (rsi !== null && rsi >= thr.sellRsi) reasons.push(`RSI ${rsi.toFixed(1)} (과매수 >${thr.sellRsi})`);
        if (change1m !== null && change1m >= thr.sellSurge) reasons.push(`1개월 +${change1m.toFixed(1)}% 단기 급등`);
        if (ema20 && price && price > ema20 * 1.15) reasons.push(`EMA20 대비 +15% 이격 과다`);
    }
    // ── 매수 신호 ──────────────────────────────────────────────
    else if (
        (rsi !== null && rsi <= thr.buyRsi) ||
        (change1m !== null && change1m <= -thr.buyDrop)
    ) {
        signalType = 'BUY';
        if (rsi !== null && rsi <= thr.buyRsi) reasons.push(`RSI ${rsi.toFixed(1)} (과매도 <${thr.buyRsi})`);
        if (change1m !== null && change1m <= -thr.buyDrop) reasons.push(`1개월 -${Math.abs(change1m).toFixed(1)}% 낙폭 과대`);
        if (macdSignal === 'golden') reasons.push('MACD 골든크로스 진입 중');
    }

    if (!signalType) return null;

    return {
        type: signalType,
        reasons,
        rsi:      rsi !== null ? rsi.toFixed(1) : 'N/A',
        price:    price ? (typeof price === 'number' ? price.toFixed(2) : price) : 'N/A',
        change1m: change1m !== null ? change1m.toFixed(1) : 'N/A',
        style,
    };
}

/**
 * 신호 타입에 따른 알림 메시지 생성
 */
function buildAlertMessage(ticker, name, signal) {
    const nameStr = name && name !== ticker ? `${name} (${ticker})` : ticker;

    if (signal.type === 'BUY') {
        return [
            `귀염둥이 예리야 지금 매수 기회가 왔어 🟢`,
            ``,
            `👉 종목: ${nameStr}`,
            ``,
            `👉 전략:`,
            `- 1차 매수: 현재가 $${signal.price} 근처 분할 진입`,
            `- 2차 매수: 추가 하락 시 -5~7% 구간`,
            `- 분할 접근 추천 (한 번에 몰지 말 것)`,
            ``,
            `👉 이유:`,
            ...signal.reasons.map(r => `- ${r}`),
            ``,
            `👉 리스크:`,
            `- 반등 실패 시 추가 하락 가능`,
            `- 손절 기준: 현재가 -7~9% 이탈 시 재확인`,
            ``,
            `💬 "${ticker} 분석해줘" 로 상세 분석 가능`,
        ].join('\n');

    } else if (signal.type === 'SELL') {
        return [
            `귀염둥이 예리야 지금 일부 익절 고려 구간이야 🔴`,
            ``,
            `👉 종목: ${nameStr}`,
            ``,
            `👉 전략:`,
            `- 1차 익절: 보유분의 20~30%`,
            `- 나머지: 추세 꺾임 확인 후 추가 대응`,
            ``,
            `👉 이유:`,
            ...signal.reasons.map(r => `- ${r}`),
            ``,
            `👉 리스크:`,
            `- 추가 상승 가능성 존재 (너무 빨리 팔면 기회 놓칠 수 있음)`,
            `- 추세 유지되면 보유 연장 고려`,
            ``,
            `💬 "${ticker} 목표가 얼마야?" 로 상세 분석 가능`,
        ].join('\n');

    } else if (signal.type === 'OVERHEAT') {
        return [
            `귀염둥이 예리야 지금은 추격매수 피하는 게 좋아 🔥`,
            ``,
            `👉 종목: ${nameStr}`,
            ``,
            `👉 전략:`,
            `- 지금 추격 매수 비추천`,
            `- 보유 중이면 일부 익절 고려`,
            `- 눌림 구간에서 재진입 타이밍 확인`,
            ``,
            `👉 이유:`,
            ...signal.reasons.map(r => `- ${r}`),
            ``,
            `👉 리스크:`,
            `- 단기 조정 시 낙폭 클 수 있음`,
            `- RSI 하락 전환 시 1~2주 조정 가능`,
            ``,
            `💬 "${ticker} 지금 과열이야?" 로 상세 분석 가능`,
        ].join('\n');
    }

    return `귀염둥이 예리야 ${nameStr} 신호 감지됐어\n\n👉 RSI: ${signal.rsi} | 현재: $${signal.price} | 1개월: ${signal.change1m}%`;
}


module.exports = { detectSignal, buildAlertMessage };

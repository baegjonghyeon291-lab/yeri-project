const { addNotification } = require('./notification-store');
const { canFireAlert, recordAlertFired } = require('./alert-history-store');

function safeNum(val) {
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
}

/**
 * 포트폴리오 분석 결과(result)와 holding을 받아서 조건 검사
 * @param {string} userId
 * @param {Array} analyzedHoldings (포트폴리오 분석 완료된 종목 리스트)
 */
function evaluatePortfolioAlerts(userId, analyzedHoldings) {
    if (!analyzedHoldings || !Array.isArray(analyzedHoldings)) return;

    analyzedHoldings.forEach(holding => {
        const alerts = holding.alerts; 
        
        if (!alerts || !alerts.enabled) return;

        const ticker = holding.ticker;
        const currentPrice = safeNum(holding.currentPrice);
        const avgPrice = safeNum(holding.avgPrice);
        const badge = holding.status?.badge;
        const weightPct = safeNum(holding.weight);

        if (currentPrice == null || avgPrice == null) return;

        const pnlPct = ((currentPrice / avgPrice) - 1) * 100;
        const pnlAmount = (currentPrice - avgPrice) * holding.quantity;

        // 1. 가격 돌파 알림 (Above)
        const priceAbove = safeNum(alerts.priceAbove);
        if (priceAbove != null && currentPrice >= priceAbove) {
            if (canFireAlert(userId, ticker, 'priceAbove', 24)) {
                addNotification(userId, {
                    type: 'PRICE_ABOVE',
                    message: `📈 ${ticker} 현재가가 설정한 돌파 가격($${priceAbove})을 돌파했습니다! (현재 $${currentPrice.toFixed(2)})`,
                    ticker: ticker
                });
                recordAlertFired(userId, ticker, 'priceAbove');
            }
        }

        // 2. 가격 이탈 알림 (Below)
        const priceBelow = safeNum(alerts.priceBelow);
        if (priceBelow != null && currentPrice <= priceBelow) {
            if (canFireAlert(userId, ticker, 'priceBelow', 24)) {
                addNotification(userId, {
                    type: 'PRICE_BELOW',
                    message: `🚨 ${ticker} 현재가가 설정한 하락 가격($${priceBelow})을 이탈했습니다. (현재 $${currentPrice.toFixed(2)})`,
                    ticker: ticker
                });
                recordAlertFired(userId, ticker, 'priceBelow');
            }
        }

        // 3. 수익률 상승 도달 (Take Profit Pct)
        const takeProfitPct = safeNum(alerts.takeProfitPct);
        if (takeProfitPct != null && pnlPct >= takeProfitPct) {
            if (canFireAlert(userId, ticker, 'takeProfitPct', 24)) {
                addNotification(userId, {
                    type: 'TAKE_PROFIT',
                    message: `🎉 대공개! ${ticker} 수익률이 목표치인 +${takeProfitPct}%를 달성했습니다! (현재 +${pnlPct.toFixed(2)}%)`,
                    ticker: ticker
                });
                recordAlertFired(userId, ticker, 'takeProfitPct');
            }
        }

        // 4. 수익률 하락 도달 (Stop Loss Pct)
        const stopLossPct = safeNum(alerts.stopLossPct);
        if (stopLossPct != null && pnlPct <= stopLossPct) {
            if (canFireAlert(userId, ticker, 'stopLossPct', 24)) {
                addNotification(userId, {
                    type: 'STOP_LOSS',
                    message: `🚨 긴급: ${ticker} 수익률이 설정한 하한선 ${stopLossPct}% 이하로 떨어졌습니다. (현재 ${pnlPct.toFixed(2)}%)`,
                    ticker: ticker
                });
                recordAlertFired(userId, ticker, 'stopLossPct');
            }
        }

        // 4-5. 총 평가금액 목표 도달 (Total Value Above)
        const totalValueAbove = safeNum(alerts.totalValueAbove);
        const currentTotalValue = currentPrice * holding.quantity;
        if (totalValueAbove != null && currentTotalValue >= totalValueAbove) {
            if (canFireAlert(userId, ticker, 'totalValueAbove', 24)) {
                addNotification(userId, {
                    type: 'TOTAL_VALUE',
                    message: `💰 달성! ${ticker} 보유 종목의 총 평가금액이 목표치인 $${totalValueAbove.toLocaleString()}을 돌파했습니다! (현재 $${currentTotalValue.toLocaleString(undefined, {maximumFractionDigits:2})})`,
                    ticker: ticker
                });
                recordAlertFired(userId, ticker, 'totalValueAbove');
            }
        }

        // 5. 비중 초과 알림 (Max Weight)
        const maxWeight = safeNum(alerts.maxWeight);
        if (maxWeight != null && weightPct != null && weightPct >= maxWeight) {
            if (canFireAlert(userId, ticker, 'maxWeight', 24)) {
                addNotification(userId, {
                    type: 'WEIGHT_WARNING',
                    message: `⚠️ ${ticker} 비중이 설정한 한도(${maxWeight}%)를 초과했습니다. 포트폴리오 리스크 관리가 필요할 수 있습니다. (현재 비중: ${weightPct.toFixed(1)}%)`,
                    ticker: ticker
                });
                recordAlertFired(userId, ticker, 'maxWeight');
            }
        }

        // 6. 상태 배지 악화 알림 (Status Change)
        if (alerts.badgeChange) {
            if (badge === '경고' || badge === '리스크 높음') {
                if (canFireAlert(userId, ticker, `badge_${badge}`, 12)) {
                    addNotification(userId, {
                        type: 'STATUS_WARNING',
                        message: `🚨 ${ticker}의 상태 배지가 [${badge}](으)로 악화되었습니다. 예리의 대응 전략을 확인해 보세요!`,
                        ticker: ticker
                    });
                    recordAlertFired(userId, ticker, `badge_${badge}`);
                }
            }
        }

        // ═══════════════════════════════════════════════════════
        // 예측/사전 경고 알림 (도달 전 조기 감지)
        // ═══════════════════════════════════════════════════════
        if (!alerts.predictEnabled) return;

        const overall = safeNum(holding.status?.overall);
        const scores = holding.status?.scores || {};
        const trendScore = safeNum(scores.trend);
        const momentumScore = safeNum(scores.momentum);
        const changePctVal = safeNum(holding.changePct);

        // 7. 목표가 돌파 가능성 감지 (Breakout Proximity)
        //    priceAbove가 설정되어 있고, 현재가가 목표가의 90~99% 도달 + 상승 추세일 때
        if (alerts.predictBreakout && priceAbove != null && currentPrice < priceAbove) {
            const ratio = currentPrice / priceAbove;
            if (ratio >= 0.90 && (changePctVal == null || changePctVal >= 0)) {
                if (canFireAlert(userId, ticker, 'predict_breakout', 12)) {
                    const pct = ((1 - ratio) * 100).toFixed(1);
                    addNotification(userId, {
                        type: 'PREDICT_BREAKOUT',
                        message: `🔮📈 ${ticker} 목표 돌파 가능성! 현재가($${currentPrice.toFixed(2)})가 설정 목표($${priceAbove})까지 ${pct}% 남았습니다. 상승 추세가 유지되고 있어요!`,
                        ticker: ticker
                    });
                    recordAlertFired(userId, ticker, 'predict_breakout');
                }
            }
        }

        // 8. 상승 모멘텀 강화 감지 (Momentum Surge)
        //    종합점수 ≥ 70 + 추세 or 모멘텀 점수 ≥ 65
        if (alerts.predictMomentumUp && overall != null && overall >= 70) {
            const hasMomentum = (trendScore != null && trendScore >= 65) || (momentumScore != null && momentumScore >= 65);
            if (hasMomentum) {
                if (canFireAlert(userId, ticker, 'predict_momentum_up', 12)) {
                    addNotification(userId, {
                        type: 'PREDICT_MOMENTUM_UP',
                        message: `🔮🚀 ${ticker} 상승 모멘텀 강화! 종합점수 ${overall}점, 추세/모멘텀이 강세 구간에 진입했어요. 추가 매수 타이밍일 수 있어요!`,
                        ticker: ticker
                    });
                    recordAlertFired(userId, ticker, 'predict_momentum_up');
                }
            }
        }

        // 9. 하락 위험 확대 감지 (Dump Risk)
        //    종합점수 ≤ 35 + 당일 3% 이상 하락 추세
        if (alerts.predictDump) {
            const isDumping = (overall != null && overall <= 35) || (changePctVal != null && changePctVal <= -3);
            if (isDumping) {
                if (canFireAlert(userId, ticker, 'predict_dump', 12)) {
                    const reason = [];
                    if (overall != null && overall <= 35) reason.push(`종합점수 ${overall}점`);
                    if (changePctVal != null && changePctVal <= -3) reason.push(`당일 ${changePctVal.toFixed(2)}% 하락`);
                    addNotification(userId, {
                        type: 'PREDICT_DUMP',
                        message: `🔮📉 ${ticker} 하락 위험 확대! ${reason.join(', ')}. 손절 기준이나 포지션 축소를 검토해 보세요.`,
                        ticker: ticker
                    });
                    recordAlertFired(userId, ticker, 'predict_dump');
                }
            }
        }

        // 10. 경고 단계 진입 직전 감지 (Badge Downgrade Risk)
        //     종합점수 40~49 (보통→주의 or 주의→경고 경계)
        if (alerts.predictBadgeDown && overall != null) {
            if (overall >= 40 && overall <= 49 && badge !== '경고' && badge !== '리스크 높음') {
                if (canFireAlert(userId, ticker, 'predict_badge_down', 12)) {
                    addNotification(userId, {
                        type: 'PREDICT_BADGE_DOWN',
                        message: `🔮⚠️ ${ticker} 경고 단계 진입 직전! 종합점수 ${overall}점으로 하락 경계구간에 있습니다. 상태 변화를 주의 깊게 지켜보세요.`,
                        ticker: ticker
                    });
                    recordAlertFired(userId, ticker, 'predict_badge_down');
                }
            }
        }

        // 11. 비중 위험 확대 감지 (Weight Risk Approaching)
        //     maxWeight가 설정되어 있고, 현재비중이 maxWeight의 85~99% 도달
        if (alerts.predictWeightRisk && maxWeight != null && weightPct != null && weightPct < maxWeight) {
            const weightRatio = weightPct / maxWeight;
            if (weightRatio >= 0.85) {
                if (canFireAlert(userId, ticker, 'predict_weight_risk', 12)) {
                    addNotification(userId, {
                        type: 'PREDICT_WEIGHT_RISK',
                        message: `🔮⚖️ ${ticker} 비중 위험 확대 중! 현재 비중(${weightPct.toFixed(1)}%)이 설정 한도(${maxWeight}%)에 근접하고 있어요. 리밸런싱을 검토해 보세요.`,
                        ticker: ticker
                    });
                    recordAlertFired(userId, ticker, 'predict_weight_risk');
                }
            }
        }
    });
}

module.exports = {
    evaluatePortfolioAlerts
};

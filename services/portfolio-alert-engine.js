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

    analyzedHoldings.forEach(result => {
        const holding = result.holding; // 원본 종목 정보
        const alerts = holding.alerts; 
        
        if (!alerts || !alerts.enabled) return;

        const ticker = holding.ticker;
        const currentPrice = safeNum(result.price?.current);
        const avgPrice = safeNum(holding.avgPrice);
        const badge = result.status?.badge;
        const weightPct = safeNum(result.portfolioWeightPct);

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
    });
}

module.exports = {
    evaluatePortfolioAlerts
};

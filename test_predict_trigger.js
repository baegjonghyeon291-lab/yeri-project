const axios = require('axios');

async function run() {
    try {
        const userId = 'test-predict';

        // 0. Clean
        await axios.post(`http://localhost:3001/api/portfolio/${userId}/remove`, { ticker: "IREN" }).catch(() => {});

        // 1. IREN 현재가 ~$35 기준으로 예측 알림 트리거되도록 설정
        //    - priceAbove: $38 → 35/38 = 92% ≥ 90% → predictBreakout 트리거!
        //    - maxWeight: 100% → 단일 종목이라 100% → predictWeightRisk는 85%+ 이므로 해당 없음 (이미 초과)
        //    - maxWeight: 120 → 100/120 = 83% < 85% → 안됨
        //    - maxWeight: 115 → 100/115 = 87% ≥ 85% → predictWeightRisk 트리거!
        console.log("1. Adding IREN with predict-triggerable alerts...");
        await axios.post(`http://localhost:3001/api/portfolio/${userId}/add`, {
            ticker: "IREN",
            name: "Iris Energy",
            quantity: 100,
            avgPrice: 8,
            alerts: {
                enabled: true,
                priceAbove: 38,      // 현재가 $35 → 92% 접근 → predictBreakout O
                priceBelow: 5,
                takeProfitPct: 500,  // 아직 안 도달 (현재 339%)
                stopLossPct: -50,
                maxWeight: 115,      // 100% / 115 = 87% → predictWeightRisk O
                totalValueAbove: 50000,
                badgeChange: true,
                predictEnabled: true,
                predictBreakout: true,
                predictMomentumUp: true,
                predictDump: true,
                predictBadgeDown: true,
                predictWeightRisk: true
            }
        });
        console.log("   Added!");

        // 2. Trigger evaluation
        console.log("\n2. Fetching portfolio (triggers alert evaluation)...");
        const portRes = await axios.get(`http://localhost:3001/api/portfolio/${userId}`);
        const iren = portRes.data.holdings.find(h => h.ticker === 'IREN');
        if (iren) {
            console.log(`   badge=${iren.status?.badge}, overall=${iren.status?.overall}`);
            console.log(`   price=$${iren.currentPrice}, change=${iren.changePct}%`);
            console.log(`   weight=${iren.weight}%, scores=${JSON.stringify(iren.status?.scores)}`);
        }

        // 3. Check notifications
        console.log("\n3. Checking notifications...");
        const notifRes = await axios.get(`http://localhost:3001/api/notifications/${userId}`);
        const notifs = notifRes.data.notifications || [];
        console.log(`   Total: ${notifs.length}`);

        const conditionAlerts = notifs.filter(n => !n.type.startsWith('PREDICT_'));
        const predictAlerts = notifs.filter(n => n.type.startsWith('PREDICT_'));

        console.log(`\n   ── 조건 도달 알림 (${conditionAlerts.length}개) ──`);
        conditionAlerts.forEach((n, i) => console.log(`   ${i+1}. [${n.type}] ${n.message}`));

        console.log(`\n   ── 예측/사전 경고 알림 (${predictAlerts.length}개) ──`);
        predictAlerts.forEach((n, i) => console.log(`   ${i+1}. [${n.type}] ${n.message}`));

        // Cleanup
        await axios.post(`http://localhost:3001/api/portfolio/${userId}/remove`, { ticker: "IREN" });
        console.log("\n✅ Test complete! Cleaned up.");
    } catch (e) {
        console.error("❌ Error:", e.response?.data || e.message);
    }
}

run();

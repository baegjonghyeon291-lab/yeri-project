const axios = require('axios');

async function run() {
    try {
        const userId = 'webapp'; // Assuming 'webapp'

        console.log("1. Adding IREN with totalValueAbove=3000 to trigger alert...");
        await axios.post(`http://localhost:3001/api/portfolio/${userId}/add`, {
            ticker: "IREN",
            name: "IREN",
            quantity: 100, // 100 shares
            avgPrice: 8,   // average price 8
            alerts: {
                enabled: true,
                takeProfitPct: null,
                priceAbove: null,
                priceBelow: null,
                stopLossPct: null,
                maxWeight: null,
                totalValueAbove: 3000, // Current price is 35, so 35 * 100 = 3500, which is > 3000. It will definitely trigger!
                badgeChange: false,
                predictEnabled: true,
                predictBreakout: true
            }
        });

        console.log("2. Fetching portfolio to trigger the background alert evaluation...");
        await axios.get(`http://localhost:3001/api/portfolio/${userId}`);

        console.log("3. Fetching notifications from the store...");
        const res = await axios.get(`http://localhost:3001/api/notifications/${userId}`);
        
        console.log("✅ Success! Notifications:", JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("❌ Error:", e.message);
    }
}

run();

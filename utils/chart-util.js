/**
 * chart-util.js
 * Generates price chart URLs using QuickChart.io
 */

function generatePriceChartUrl(ticker, name, history) {
    if (!history || !history.closes || history.closes.length === 0) return null;

    const closes = history.closes;
    const labels = closes.map((_, i) => i + 1);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const padding = (max - min) * 0.1;

    const chartConfig = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${name || ticker} Price (Last 10-30 Days)`,
                data: closes,
                fill: false,
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 3,
                pointRadius: 0,
                lineTension: 0.2
            }]
        },
        options: {
            title: {
                display: true,
                text: `${name || ticker} [${ticker}]`,
                fontSize: 18,
                fontColor: '#333'
            },
            legend: {
                display: false
            },
            scales: {
                xAxes: [{
                    display: false
                }],
                yAxes: [{
                    ticks: {
                        min: Math.floor(min - padding),
                        max: Math.ceil(max + padding)
                    }
                }]
            }
        }
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encodedConfig}&width=600&height=300&backgroundColor=white`;
}

module.exports = { generatePriceChartUrl };

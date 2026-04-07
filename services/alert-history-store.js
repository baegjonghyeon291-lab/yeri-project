const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'alert-history.json');

// Memory cache: { userId: { ticker_conditionKey: timestampISO } }
let history = {};

function init() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        } catch (e) {
            console.error('Error reading alert history file:', e);
            history = {};
        }
    } else {
        history = {};
    }
}

function save() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('Error writing alert history file:', e);
    }
}

function canFireAlert(userId, ticker, conditionKey, cooldownHours = 24) {
    if (!history[userId]) return true;
    
    const key = `${ticker}_${conditionKey}`;
    const lastFired = history[userId][key];
    
    if (!lastFired) return true;
    
    const elapsedMs = new Date() - new Date(lastFired);
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    
    return elapsedMs >= cooldownMs;
}

function recordAlertFired(userId, ticker, conditionKey) {
    if (!history[userId]) history[userId] = {};
    const key = `${ticker}_${conditionKey}`;
    history[userId][key] = new Date().toISOString();
    save();
}

// Clear state when user intentionally clears alerts or changes settings
function resetAlertCondition(userId, ticker, conditionKey) {
    if (!history[userId]) return;
    const key = `${ticker}_${conditionKey}`;
    if (history[userId][key]) {
        delete history[userId][key];
        save();
    }
}

init();

module.exports = {
    canFireAlert,
    recordAlertFired,
    resetAlertCondition
};

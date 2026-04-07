const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const NOTIFICATION_FILE = path.join(DATA_DIR, 'notifications.json');

// Memory cache
let all = {};

function init() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(NOTIFICATION_FILE)) {
        try {
            all = JSON.parse(fs.readFileSync(NOTIFICATION_FILE, 'utf-8'));
        } catch (e) {
            console.error('Error reading notifications file:', e);
            all = {};
        }
    } else {
        all = {};
    }
}

function save() {
    try {
        fs.writeFileSync(NOTIFICATION_FILE, JSON.stringify(all, null, 2));
    } catch (e) {
        console.error('Error writing notifications file:', e);
    }
}

// { id, message, type, isRead, createdAt }
function addNotification(userId, notification) {
    if (!all[userId]) all[userId] = [];
    all[userId].unshift({
        id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
        ...notification,
        isRead: false,
        createdAt: new Date().toISOString()
    });

    // Keep max 100 notifications per user
    if (all[userId].length > 100) {
        all[userId] = all[userId].slice(0, 100);
    }
    save();
}

function getNotifications(userId) {
    return all[userId] || [];
}

function markAsRead(userId, notificationId) {
    if (!all[userId]) return false;
    let found = false;
    for (const n of all[userId]) {
        if (n.id === notificationId) {
            n.isRead = true;
            found = true;
        }
    }
    if (found) save();
    return found;
}

function markAllAsRead(userId) {
    if (!all[userId]) return false;
    let updated = false;
    for (const n of all[userId]) {
        if (!n.isRead) {
            n.isRead = true;
            updated = true;
        }
    }
    if (updated) save();
    return updated;
}

init();

module.exports = {
    addNotification,
    getNotifications,
    markAsRead,
    markAllAsRead
};

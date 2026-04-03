/**
 * session.js — chatId 기준 대화 상태 관리자
 *  - 개인채팅: chatId === userId → 기존과 동일
 *  - 단톡방:   chatId 음수값 → 방별 독립 세션
 */

const SESSION_TTL         = 30 * 60 * 1000;
const TICKER_CONTEXT_TTL  = 20 * 60 * 1000;
const SUGGESTED_LIST_TTL  = 20 * 60 * 1000;

class SessionManager {
    constructor() {
        this.sessions = new Map();
        setInterval(() => this._gc(), 10 * 60 * 1000);
    }

    get(chatId) {
        const s = this.sessions.get(chatId);
        if (s && Date.now() - s.lastActivity > SESSION_TTL) {
            this.sessions.delete(chatId);
            return null;
        }
        return s || null;
    }

    create(chatId, data = {}) {
        const session = {
            chatId,
            state: 'idle',
            pendingTicker:    null,
            pendingName:      null,
            pendingMarket:    'US',
            pendingCorpCode:  null,
            pendingType:      'stock',
            pendingSectorKey: null,
            pendingTone:      'normal',
            pendingIntent:    null,
            useDeep:          false,
            lastAnalyzedTicker:   null,
            lastAnalyzedName:     null,
            lastAnalyzedMarket:   'US',
            lastAnalyzedCorpCode: null,
            lastAnalyzedSector:   null,
            lastIntent:      null,
            lastTickerTime:  null,
            lastSuggestedList:     null,
            lastSuggestedListTime: null,
            context: {
                horizon: null, targetReturn: null,
                holding: null, riskProfile: null,
            },
            history:      [],
            lastActivity: Date.now(),
            ...data
        };
        this.sessions.set(chatId, session);
        return session;
    }

    update(chatId, patch) {
        const s = this.get(chatId);
        if (!s) return;
        Object.assign(s, patch);
        s.lastActivity = Date.now();
        this.sessions.set(chatId, s);
        return s;
    }

    isTickerContextValid(chatId) {
        const s = this.get(chatId);
        if (!s || !s.lastTickerTime) return false;
        // 단일 종목이거나 비교 상태이면 유효
        if (!s.lastAnalyzedTicker && !s.isComparison) return false;
        return (Date.now() - s.lastTickerTime) < TICKER_CONTEXT_TTL;
    }

    updateContext(chatId, contextPatch) {
        const s = this.get(chatId);
        if (!s) return;
        Object.assign(s.context, contextPatch);
        s.lastActivity = Date.now();
        this.sessions.set(chatId, s);
        return s;
    }

    addHistory(chatId, role, content) {
        const s = this.get(chatId);
        if (!s) return;
        s.history.push({ role, content });
        if (s.history.length > 40) s.history = s.history.slice(-40);
        s.lastActivity = Date.now();
        this.sessions.set(chatId, s);
    }

    reset(chatId) {
        const s = this.get(chatId);
        if (!s) return;
        s.state          = 'idle';
        s.pendingTicker  = null;
        s.pendingName    = null;
        s.pendingSectorKey = null;
        s.pendingType    = 'stock';
        s.pendingIntent  = null;
        s.useDeep        = false;
        s.lastActivity   = Date.now();
        this.sessions.set(chatId, s);
    }

    setSuggestedList(chatId, list) {
        const s = this.get(chatId) || this.create(chatId);
        s.lastSuggestedList     = list;
        s.lastSuggestedListTime = Date.now();
        s.lastActivity          = Date.now();
        this.sessions.set(chatId, s);
    }

    getSuggestedList(chatId) {
        const s = this.get(chatId);
        if (!s || !s.lastSuggestedList || !s.lastSuggestedListTime) return null;
        if (Date.now() - s.lastSuggestedListTime > SUGGESTED_LIST_TTL) return null;
        return s.lastSuggestedList;
    }

    clearSuggestedList(chatId) {
        const s = this.get(chatId);
        if (s) { s.lastSuggestedList = null; s.lastSuggestedListTime = null; }
    }

    _gc() {
        const now = Date.now();
        for (const [id, s] of this.sessions) {
            if (now - s.lastActivity > SESSION_TTL) this.sessions.delete(id);
        }
    }
}

module.exports = new SessionManager();

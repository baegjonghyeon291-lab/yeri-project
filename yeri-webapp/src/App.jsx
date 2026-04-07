import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = '/api'

// Vite 빌드 시점에 주입되는 버전 정보 (vite.config.js define)
const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

// ── 유틸 ──────────────────────────────────────────────────────
function fmtChange(v) {
  if (v == null) return null
  return v > 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`
}
function rsiClass(rsi) {
  if (!rsi) return 'rsi-normal'
  if (rsi < 30) return 'rsi-oversold'
  if (rsi > 70) return 'rsi-overbought'
  return 'rsi-normal'
}
function verdictClass(verdict = '') {
  if (verdict.includes('긍정')) return 'positive'
  if (verdict.includes('위험') || verdict.includes('주의')) return 'negative'
  return 'neutral'
}
function timeAgo(ts) {
  if (!ts) return '-'
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return '방금'
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  return `${Math.floor(sec / 3600)}시간 전`
}

// ── 상단 알림 배지 ─────────────────────────────────────────────
function AlertBadge({ count, onClick }) {
  return (
    <button className="alert-badge-btn" onClick={onClick}>
      🔔 알림
      {count > 0 && <span className="badge">{count}</span>}
    </button>
  )
}

// ── 알림 카드 ─────────────────────────────────────────────────
function AlertCard({ alert }) {
  return (
    <div className={`alert-card ${alert.level}`}>
      <div className="alert-emoji">{alert.emoji}</div>
      <div className="alert-body">
        <div className="alert-title">
          <span className="alert-ticker-tag">{alert.ticker}</span>
          {alert.title.replace(alert.ticker, '').trim()}
        </div>
        <div className="alert-desc">{alert.desc}</div>
      </div>
    </div>
  )
}

// ── 종목 카드 ─────────────────────────────────────────────────
function StockCard({ stock, hasAlert }) {
  const changePct = stock.changePct
  const changeStr = fmtChange(changePct)
  const changeClass = changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat'

  return (
    <div className="stock-card">
      <div className="stock-card-header">
        <div>
          <div className="stock-ticker">{stock.ticker}</div>
          <div className="stock-name">{stock.name !== stock.ticker ? stock.name : ''}</div>
        </div>
        {hasAlert && <div className="new-alert-dot" title="새 알림 있음" />}
      </div>

      <div className="stock-price-row">
        <span className="stock-price">
          {stock.priceStr || (stock.price ? `$${stock.price.toLocaleString()}` : 'N/A')}
        </span>
        {changeStr && (
          <span className={`stock-change ${changeClass}`}>{changeStr}</span>
        )}
      </div>

      <div className="stock-metrics">
        <span className={`metric-pill ${rsiClass(stock.rsi)}`}>
          RSI {stock.rsi?.toFixed(1) || 'N/A'}
          {stock.rsi < 30 ? ' 과매도' : stock.rsi > 70 ? ' 과매수' : ''}
        </span>
        <span className="metric-pill">AI {stock.score}/40</span>
      </div>

      <div className={`verdict-badge ${verdictClass(stock.verdict)}`}>
        {stock.verdict} &nbsp;·&nbsp; {stock.suggestedAction}
      </div>

      <div className="stock-source">출처: {stock.priceSource || '-'}</div>
    </div>
  )
}

// ── 빠른 질문 버튼 ─────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: '📈 오늘 추천 종목', text: '오늘 추천 종목', cat: 'rec' },
  { label: '🌍 시장 브리핑', text: '오늘 시장 브리핑', cat: 'rec' },
  { label: '📊 지금 살만한 종목', text: '지금 사도 되는 종목 추천', cat: 'rec' },
  { label: 'NVDA 분석', text: 'NVDA 분석해줘', cat: 'stock' },
  { label: 'TSLA 분석', text: 'TSLA 분석해줘', cat: 'stock' },
  { label: '삼성전자', text: '삼성전자 분석해줘', cat: 'stock' },
  { label: '애플 분석', text: '애플 분석해줘', cat: 'stock' },
  { label: '⚔️ 엔비디아 vs 테슬라', text: '엔비디아 vs 테슬라 비교', cat: 'compare' },
  { label: '⚔️ 애플 vs 마소', text: '애플 vs 마이크로소프트 비교', cat: 'compare' },
]

// ── 추천 카드 컴포넌트 ───────────────────────────────────────
function RecCard({ item, grade, onAnalyze }) {
  const gradeClass = grade === 'STRONG_PICK' ? 'grade-strong' : 'grade-watch'
  const gradeLabel = grade === 'STRONG_PICK' ? '🟢 STRONG PICK' : '🟡 WATCHLIST'
  return (
    <div className={`rec-card ${gradeClass}`}>
      <div className="rec-card-header">
        <span className="rec-grade-badge">{gradeLabel}</span>
        <span className="rec-score">{item.totalScore}/20</span>
      </div>
      <div className="rec-card-ticker">{item.ticker}</div>
      <div className="rec-card-name">{item.name}{item.desc ? ` — ${item.desc}` : ''}</div>
      {item.price && (
        <div className="rec-card-price">
          ${item.price.toLocaleString()}
          {item.changePct != null && (
            <span className={item.changePct >= 0 ? 'up' : 'down'}>
              {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <div className="rec-card-reason">{item.reason}</div>
      <button className="rec-analyze-btn" onClick={() => onAnalyze(item.ticker)}>분석하기</button>
    </div>
  )
}

// ── 채팅 페이지 ───────────────────────────────────────────────
function ChatPage({ chatId }) {
  const [messages, setMessages] = useState([
    { role: 'bot', type: 'text', text: '안녕하세요 🙂\n예리입니다! 어떤 종목이 궁금하세요?\n\n아래 버튼을 눌러보세요 👇' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const sendMessage = useCallback(async (text) => {
    if (!text || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', type: 'text', text }])
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, chatId: chatId || 'webapp', tone: 'normal' })
      })
      const data = await res.json()

      // API returns { messages: [{type, content, candidates?, data?, ...}] }
      if (data.messages && data.messages.length > 0) {
        const newMsgs = data.messages.map(m => {
          if (m.type === 'candidates') {
            return { role: 'bot', type: 'candidates', text: m.content, candidates: m.candidates }
          }
          if (m.type === 'recommendation') {
            return { role: 'bot', type: 'recommendation', text: m.content, recData: m.data }
          }
          return { role: 'bot', type: m.type || 'text', text: m.content || '', expectedQuestions: m.expectedQuestions }
        })
        setMessages(prev => [...prev, ...newMsgs])
      } else if (data.reply) {
        setMessages(prev => [...prev, { role: 'bot', type: 'text', text: data.reply }])
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'bot', type: 'text', text: `❌ ${data.error}` }])
      } else {
        setMessages(prev => [...prev, { role: 'bot', type: 'text', text: '응답 없음' }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'bot', type: 'text', text: `❌ 오류: ${e.message}` }])
    } finally {
      setLoading(false)
      setSelectedCandidate(null)
    }
  }, [chatId, loading])

  function handleCandidateClick(ticker) {
    setSelectedCandidate(ticker)
    setTimeout(() => sendMessage(`${ticker} 분석해줘`), 200)
  }

  function truncDesc(desc, max = 30) {
    if (!desc) return ''
    return desc.length > max ? desc.slice(0, max) + '…' : desc
  }

  return (
    <div className="chat-page">
      {/* 스크롤 메시지 영역 */}
      <div className="chat-messages">
        <div className="chat-messages-inner">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble-row ${m.role === 'user' ? 'user' : 'bot'}`}>
            <div className={`chat-bubble ${m.role === 'user' ? 'user' : 'bot'}`}>
              {m.text}
              {m.type === 'candidates' && m.candidates && (() => {
                const cands = m.candidates.slice(0, 3)
                const bestConf = Math.max(...cands.map(c => c.confidence))
                const bestIdx = cands.findIndex(c => c.confidence === bestConf)
                return (
                  <div className="candidate-buttons">
                    {cands.map((c, j) => (
                      <button
                        key={j}
                        className={`candidate-btn${j === bestIdx ? ' top-pick' : ''}${selectedCandidate === c.ticker ? ' selected' : ''}`}
                        onClick={() => handleCandidateClick(c.ticker)}
                        disabled={loading || selectedCandidate != null}
                      >
                        {j === bestIdx && <span className="candidate-badge">👉 가장 유력</span>}
                        <div className="candidate-main">
                          <span className="candidate-ticker">{c.ticker}</span>
                          <span className="candidate-name">
                            - {c.name}{c.desc ? ` (${truncDesc(c.desc)})` : ''}
                            {c.price != null ? ` / ${c.ticker.endsWith('.KS') || c.ticker.endsWith('.KQ') ? '₩' : '$'}${c.price.toLocaleString()} / ${c.changePct > 0 ? '+' : ''}${c.changePct?.toFixed(2)}%` : ' / 가격 정보 없음'}
                          </span>
                        </div>
                        <span className="candidate-conf">{Math.round(c.confidence * 100)}% 유사</span>
                      </button>
                    ))}
                  </div>
                )
              })()}
              {m.type === 'recommendation' && m.recData && (
                <div className="rec-cards-wrap">
                  {m.recData.strongPicks?.length > 0 && (
                    <>
                      <div className="rec-section-label">🟢 STRONG PICK</div>
                      {m.recData.strongPicks.map((item, j) => (
                        <RecCard key={`sp-${j}`} item={item} grade="STRONG_PICK" onAnalyze={(t) => sendMessage(`${t} 분석해줘`)} />
                      ))}
                    </>
                  )}
                  {m.recData.strongPicks?.length === 0 && (
                    <div className="rec-empty">엄격한 필터 기준을 통과한 추천 종목이 없습니다.</div>
                  )}
                  {m.recData.excluded?.length > 0 && (
                    <details className="rec-excluded">
                      <summary>추천 제외 종목 ({m.recData.excluded.length}개)</summary>
                      <ul>
                        {m.recData.excluded.map((ex, j) => (
                          <li key={j}><strong>{ex.ticker}</strong> — {ex.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {m.recData.meta && (
                    <div className="rec-meta">스캔: {m.recData.meta.scannedCount}종목 | {(m.recData.meta.elapsedMs / 1000).toFixed(1)}초</div>
                  )}
                </div>
              )}
              {m.expectedQuestions && m.expectedQuestions.length > 0 && (
                <div className="expected-questions-wrap">
                  <div className="expected-questions-title">💡 더 궁금한 점이 있으신가요?</div>
                  <div className="expected-questions-list">
                    {m.expectedQuestions.map((q, j) => (
                      <button key={j} className="expected-q-btn" onClick={() => sendMessage(q)} disabled={loading}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-bubble-row bot">
            <div className="chat-bubble bot">⏳ 분석 중...</div>
          </div>
        )}
        <div ref={bottomRef} />
        </div>{/* .chat-messages-inner */}
      </div>

      {/* 하단 고정 영역: 빠른 질문 + 입력창 */}
      <div className="chat-bottom">
        <div className="quick-actions">
          {QUICK_ACTIONS.map((qa, i) => (
            <button
              key={i}
              className={`quick-chip chip-${qa.cat}`}
              onClick={() => sendMessage(qa.text)}
              disabled={loading}
            >{qa.label}</button>
          ))}
        </div>

        <div className="chat-input-bar">
          <textarea
            className="chat-input"
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input.trim()) } }}
            placeholder="종목명, 티커, 또는 질문을 입력하세요..."
          />
          <button className="chat-send-btn" onClick={() => sendMessage(input.trim())} disabled={loading || !input.trim()}>전송</button>
        </div>
      </div>{/* .chat-bottom */}
    </div>
  )
}

// ── 관심종목/알림 페이지 ──────────────────────────────────────
function WatchlistPage({ chatId, onBadgeCountChange, onGoPortfolio }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  // 포트폴리오 요약 위젯용 상태
  const [pfSnap, setPfSnap] = useState(null)

  const fetchAlerts = useCallback(async (refresh = false) => {
    if (!chatId) return
    setLoading(true)
    setError(null)
    try {
      const url = `${API_BASE}/alerts/${chatId}${refresh ? '?refresh=true' : ''}`
      const res = await fetch(url)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setData(json)
      setLastUpdated(Date.now())
      onBadgeCountChange?.(json.alertCount || 0)

      // 포트폴리오 요약 위젯을 위한 백그라운드 갱신
      fetch(`${API_BASE}/portfolio/${chatId}`).then(r => r.json()).then(snap => {
        if (snap && snap.summary && snap.summary.holdingCount > 0) setPfSnap(snap)
      }).catch(()=>{})
      
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [chatId, onBadgeCountChange])

  // 첫 로드 + chatId 변경 시
  useEffect(() => { fetchAlerts() }, [fetchAlerts])

  // 5분마다 자동 갱신
  useEffect(() => {
    const timer = setInterval(() => fetchAlerts(), 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [fetchAlerts])

  const alertTickerSet = new Set((data?.alerts || []).map(a => a.ticker))

  return (
    <div className="main">
      {/* 섹션: 내 포트폴리오 위젯 */}
      {pfSnap && (
        <div className="pf-widget-card" onClick={onGoPortfolio}>
          <div className="pf-widget-header">
            <span>내 포트폴리오 요약: {pfSnap.healthScore.label}</span>
            <span className={pfSnap.summary.totalProfitLossPct >= 0 ? 'up' : 'down'}>
              {pfSnap.summary.totalProfitLossPct >= 0 ? '+' : ''}{pfSnap.summary.totalProfitLossPct.toFixed(1)}%
            </span>
          </div>
          <div className="pf-widget-body">
            <div>🔥 강세: {pfSnap.portfolioStatus.strongTop3.map(s => s.ticker).join(', ') || '-'}</div>
            <div>⚠️ 위험: {pfSnap.portfolioStatus.riskTop3.map(s => s.ticker).join(', ') || '-'}</div>
          </div>
          <div className="pf-widget-footer">포트폴리오 자세히 보기 ➔</div>
        </div>
      )}

      {/* 섹션: 알림 */}
      <div className="section-header">
        <span className="section-title">🔔 알림</span>
        <span className="section-sub">
          {lastUpdated ? `마지막 업데이트: ${timeAgo(lastUpdated)}` : ''}
        </span>
        <button className="refresh-btn" onClick={() => fetchAlerts(true)} disabled={loading}>
          {loading ? '스캔 중...' : '새로고침'}
        </button>
      </div>

      {error && <div className="error-bar">⚠️ {error}</div>}

      {loading && !data && (
        <div className="loading-wrap">
          <div className="spinner" />
          <span>관심종목 스캔 중...</span>
        </div>
      )}

      {data && (
        <>
          {data.alerts.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px', marginBottom: '24px' }}>
              <span className="big-emoji" style={{ fontSize: '2rem' }}>✅</span>
              <p style={{ fontSize: '.85rem', color: 'var(--text-sub)' }}>
                현재 특별한 알림이 없습니다.<br />관심종목이 정상 범위 내에 있습니다.
              </p>
            </div>
          ) : (
            <div className="alerts-grid">
              {data.alerts.map((a, i) => <AlertCard key={i} alert={a} />)}
            </div>
          )}

          {/* 섹션: 관심종목 상태 */}
          <div className="section-header">
            <span className="section-title">📊 관심종목 현황</span>
            <span className="section-sub">{data.stocks.length}종목</span>
          </div>
          {data.stocks.length === 0 ? (
            <div className="empty-state">
              <span className="big-emoji">📋</span>
              <p>관심종목이 없습니다.<br />채팅 분석 후 우측 상단의 <b>Watchlist</b> 버튼으로 추가해보세요.</p>
            </div>
          ) : (
            <div className="stocks-grid">
              {data.stocks.map(s => (
                <StockCard key={s.ticker} stock={s} hasAlert={alertTickerSet.has(s.ticker)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 포트폴리오 페이지 ─────────────────────────────────────────────
function PortfolioPage({ userId }) {
  const [holdings, setHoldings] = useState([])
  const [summary, setSummary] = useState(null)
  const [portfolioStatus, setPortfolioStatus] = useState(null)
  
  // 신규 메타데이터
  const [allocations, setAllocations] = useState(null)
  const [healthScore, setHealthScore] = useState(null)
  const [rebalancing, setRebalancing] = useState(null)
  const [dailyBriefing, setDailyBriefing] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  // 모달
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingHolding, setEditingHolding] = useState(null) // null = 추가 모드, { ticker,... } = 수정 모드
  const [menuOpen, setMenuOpen] = useState(null) // ticker of open menu

  // 브리핑
  const [briefingReport, setBriefingReport] = useState(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [showBriefing, setShowBriefing] = useState(false)

  // 탭 상태 (요약 vs 리스트 vs 캘린더 vs 히스토리)
  const [activeTab, setActiveTab] = useState('summary') // 'summary', 'list'

  // 시나리오 상태 { ticker: { targetPrice: '', addQty: '', addPrice: '' } }
  const [scenarios, setScenarios] = useState({})

  // 폼 state
  const [formTicker, setFormTicker] = useState('')
  const [formName, setFormName] = useState('')
  const [formQty, setFormQty] = useState('')
  const [formPrice, setFormPrice] = useState('')
  const [formMemo, setFormMemo] = useState('')
  
  // 매매일지 추가 폼
  const [formTradeReason, setFormTradeReason] = useState('')
  const [formTargetPrice, setFormTargetPrice] = useState('')
  const [formLossPrice, setFormLossPrice] = useState('')
  const [formViewTerm, setFormViewTerm] = useState('단기')

  const fetchPortfolio = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/portfolio/${userId}?t=${Date.now()}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setHoldings(data.holdings || [])
      setSummary(data.summary || null)
      setPortfolioStatus(data.portfolioStatus || null)
      setAllocations(data.allocations || null)
      setHealthScore(data.healthScore || null)
      setRebalancing(data.rebalancing || null)
      setDailyBriefing(data.dailyBriefing || null)
      setLastUpdated(Date.now())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { fetchPortfolio() }, [fetchPortfolio])

  // 종목 추가
  async function handleAdd() {
    if (!formTicker || !formQty || !formPrice) return
    try {
      await fetch(`${API_BASE}/portfolio/${userId}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: formTicker.toUpperCase(),
          name: formName || formTicker.toUpperCase(),
          quantity: Number(formQty),
          avgPrice: Number(formPrice),
          memo: formMemo || null,
          tradeReason: formTradeReason || null,
          targetPrice: formTargetPrice,
          lossPrice: formLossPrice,
          viewTerm: formViewTerm
        })
      })
      closeModal()
      fetchPortfolio()
      alert('✅ 종목 등록이 성공적으로 완료되었습니다.')
    } catch (e) { setError(e.message) }
  }

  // 종목 수정
  async function handleUpdate() {
    if (!editingHolding) return
    try {
      await fetch(`${API_BASE}/portfolio/${userId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: editingHolding.ticker,
          name: formName || undefined,
          quantity: formQty ? Number(formQty) : undefined,
          avgPrice: formPrice ? Number(formPrice) : undefined,
          memo: formMemo || null,
          tradeReason: formTradeReason || null,
          targetPrice: formTargetPrice,
          lossPrice: formLossPrice,
          viewTerm: formViewTerm
        })
      })
      closeModal()
      fetchPortfolio()
      alert('✅ 포트폴리오 종목 업데이트(수정)가 반영되었습니다.')
    } catch (e) { setError(e.message) }
  }

  // 종목 삭제
  async function handleRemove(ticker) {
    if (!confirm(`${ticker} 종목을 삭제하시겠습니까?`)) return
    try {
      await fetch(`${API_BASE}/portfolio/${userId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker })
      })
      setMenuOpen(null)
      fetchPortfolio()
      alert('✅ 해당 종목이 포트폴리오에서 삭제되었습니다.')
    } catch (e) { setError(e.message) }
  }

  // 브리핑 요청
  async function fetchBriefing() {
    setBriefingLoading(true)
    try {
      const res = await fetch(`${API_BASE}/portfolio/${userId}/briefing?t=${Date.now()}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBriefingReport(data.report || '브리핑 데이터가 없습니다.')
      setShowBriefing(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBriefingLoading(false)
    }
  }

  function openAddModal() {
    setEditingHolding(null)
    setFormTicker(''); setFormName(''); setFormQty(''); setFormPrice(''); setFormMemo('')
    setFormTradeReason(''); setFormTargetPrice(''); setFormLossPrice(''); setFormViewTerm('단기')
    setShowAddModal(true)
  }

  function openEditModal(h) {
    setEditingHolding(h)
    setFormTicker(h.ticker); setFormName(h.name); setFormQty(String(h.quantity)); setFormPrice(String(h.avgPrice)); setFormMemo(h.memo || '')
    setFormTradeReason(h.tradeReason || ''); setFormTargetPrice(h.targetPrice || ''); setFormLossPrice(h.lossPrice || ''); setFormViewTerm(h.viewTerm || '단기')
    setShowAddModal(true)
    setMenuOpen(null)
  }

  function closeModal() {
    setShowAddModal(false)
    setEditingHolding(null)
  }

  // 시나리오 상태 제어
  function toggleScenario(ticker) {
    setScenarios(prev => ({
      ...prev,
      [ticker]: prev[ticker] ? undefined : { targetPrice: '', addQty: '', addPrice: '' }
    }))
  }

  function updateScenario(ticker, field, value) {
    setScenarios(prev => ({
      ...prev,
      [ticker]: { ...prev[ticker], [field]: value }
    }))
  }

  // 외부 클릭으로 메뉴 닫기
  useEffect(() => {
    if (!menuOpen) return
    const handler = () => setMenuOpen(null)
    setTimeout(() => document.addEventListener('click', handler), 0)
    return () => document.removeEventListener('click', handler)
  }, [menuOpen])

  if (!userId) {
    return (
      <div className="main">
        <div className="empty-state">
          <span className="big-emoji">💼</span>
          <p>상단에 Chat ID를 입력하면<br />포트폴리오가 표시됩니다.</p>
        </div>
      </div>
    )
  }

  const plClass = summary?.totalProfitLoss >= 0 ? 'up' : 'down'
  const plSign = summary?.totalProfitLoss >= 0 ? '+' : ''

  return (
    <div className="main pf-page-wrapper">
      {/* 한줄 요약 위젯 */}
      {dailyBriefing && dailyBriefing.widget && (
        <div className="pf-oneliner-widget">
          📌 {dailyBriefing.widget}
        </div>
      )}

      {/* 섹션 헤더 & 탭 */}
      <div className="section-header">
        <span className="section-title">💼 내 포트폴리오</span>
        <button className="refresh-btn" onClick={fetchPortfolio} disabled={loading}>
          {loading ? '로딩 중...' : '새로고침'}
        </button>
      </div>

      <div className="pf-tabs">
        <button className={activeTab === 'summary' ? 'active' : ''} onClick={() => setActiveTab('summary')}>요약/분석</button>
        <button className={activeTab === 'list' ? 'active' : ''} onClick={() => setActiveTab('list')}>보유 종목</button>
      </div>

      {error && <div className="error-bar">⚠️ {error}</div>}

      {loading && !holdings.length && (
        <div className="loading-wrap">
          <div className="spinner" />
          <span>포트폴리오 분석 중...</span>
        </div>
      )}

      {/* =======================================================
                            요약/분석 탭 
      ======================================================= */}
      {activeTab === 'summary' && summary && summary.holdingCount > 0 && (
        <div className="pf-tab-content">
          {/* 건강도 점수 카드 */}
          {healthScore && (
            <div className="pf-health-card">
              <div className="pf-health-header">
                <div>
                  <div className="pf-health-title">포트폴리오 건강도</div>
                  <div className={`pf-health-label pf-health-${healthScore.label}`}>{healthScore.label} ({healthScore.score}점)</div>
                </div>
                <div className="pf-health-circle">
                  <svg viewBox="0 0 36 36" className="circular-chart">
                    <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path className={`circle stroke-${healthScore.label}`} strokeDasharray={`${healthScore.score}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <text x="18" y="20.35" className="percentage">{healthScore.score}</text>
                  </svg>
                </div>
              </div>
              <div className="pf-health-details">
                {healthScore.strengths?.length > 0 && (
                  <div className="pf-health-good">
                    <strong>강점:</strong> {healthScore.strengths.join(', ')}
                  </div>
                )}
                {healthScore.weaknesses?.length > 0 && (
                  <div className="pf-health-bad">
                    <strong>약점:</strong> {healthScore.weaknesses.join(', ')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 기존 요약 그리드 */}
          <div className="pf-summary-grid">
            <div className="pf-summary-item">
              <div className="pf-summary-label">총 투자금</div>
              <div className="pf-summary-value">${summary.totalInvested?.toLocaleString()}</div>
            </div>
            <div className="pf-summary-item">
              <div className="pf-summary-label">총 평가액</div>
              <div className="pf-summary-value">${summary.totalValue?.toLocaleString()}</div>
            </div>
            <div className="pf-summary-item pf-summary-pl">
              <div className="pf-summary-label">총 평가손익</div>
              <div className={`pf-summary-value pf-${plClass}`}>
                {plSign}${Math.abs(summary.totalProfitLoss || 0).toLocaleString()}
                <span className="pf-pct">({plSign}{summary.totalProfitLossPct || 0}%)</span>
              </div>
            </div>
          </div>

          {/* 일일 브리핑 텍스트 뷰 */}
          {dailyBriefing && (
            <div className="pf-daily-briefing">
              <pre>{dailyBriefing.text}</pre>
              <button className="pf-briefing-btn" onClick={fetchBriefing} disabled={briefingLoading}>
                {briefingLoading ? '⏳ GPT 심층 브리핑 생성 중...' : '📋 GPT 심층 브리핑 보기'}
              </button>
            </div>
          )}

          {/* GPT 브리핑 화면 */}
          {showBriefing && briefingReport && (
            <div className="pf-briefing-card">
              <div className="pf-briefing-header">
                <span className="pf-briefing-title">📋 GPT 심층 브리핑</span>
                <button className="pf-briefing-close" onClick={() => setShowBriefing(false)}>✕</button>
              </div>
              <div className="pf-briefing-body">{briefingReport}</div>
            </div>
          )}

          {/* 비중 분석 & 리밸런싱 */}
          {allocations && (
            <div className="pf-allocation-card">
              <div className="pf-alloc-title">📊 종목 비중 분석</div>
              <div className="pf-alloc-bars">
                {allocations.details?.slice(0, 5).map(a => (
                  <div key={a.ticker} className="pf-alloc-row">
                    <span className="pf-alloc-label">{a.ticker}</span>
                    <div className="pf-alloc-bar-bg">
                      <div className="pf-alloc-bar-fill" style={{ width: `${a.weight}%`, background: a.weight >= 30 ? 'var(--red)' : 'var(--gold)' }} />
                    </div>
                    <span className="pf-alloc-val">{a.weight}%</span>
                  </div>
                ))}
              </div>
              {rebalancing && rebalancing.length > 0 && (
                <div className="pf-rebalance-box">
                  <div className="pf-rebalance-title">💡 리밸런싱 제안</div>
                  <ul>{rebalancing.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {/* TOP 3 기회/위험 종목 */}
          {portfolioStatus && (
            <div className="pf-top3-wrap">
              {portfolioStatus.strongTop3?.length > 0 && (
                <div className="pf-top3-section">
                  <div className="pf-top3-label">🎯 강세 종목 TOP</div>
                  {portfolioStatus.strongTop3.map(s => (
                    <div key={s.ticker} className="pf-top3-item pf-top3-strong">
                      <span className="pf-top3-ticker">{s.ticker}</span>
                      <span className="pf-top3-name">{s.name}</span>
                      <span className="pf-top3-badge">{s.badge}</span>
                    </div>
                  ))}
                </div>
              )}
              {portfolioStatus.riskTop3?.length > 0 && (
                <div className="pf-top3-section">
                  <div className="pf-top3-label">⚠️ 리스크 종목 TOP</div>
                  {portfolioStatus.riskTop3.map(s => (
                    <div key={s.ticker} className="pf-top3-item pf-top3-risk">
                      <span className="pf-top3-ticker">{s.ticker}</span>
                      <span className="pf-top3-name">{s.name}</span>
                      <span className="pf-top3-badge">{s.badge}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =======================================================
                            보유 종목 리스트 탭
      ======================================================= */}
      {activeTab === 'list' && holdings.length > 0 && (
        <div className="pf-holdings-grid pf-mt-4">
          {holdings.map(h => {
            const hPlClass = (h.profitLossPct || 0) >= 0 ? 'up' : 'down'
            const hPlSign = (h.profitLossPct || 0) >= 0 ? '+' : ''
            const badge = h.status?.badge || '보통'
            const emoji = h.status?.emoji || '➡️'
            const badgeClass = badge === '상승우세' ? 'bullish' : badge === '주의' ? 'caution' : badge === '경고' ? 'warning' : 'normal'
            
            // 시나리오 시뮬
            const scen = scenarios[h.ticker]
            let simMsg = null
            if (scen) {
                const addQty = Number(scen.addQty)||0;
                const addPrice = Number(scen.addPrice)||0;
                const tgt = Number(scen.targetPrice)||0;
                let newQty = h.quantity + addQty;
                let newAvg = newQty > 0 ? ((h.quantity * h.avgPrice) + (addQty * addPrice)) / newQty : h.avgPrice;
                if (tgt > 0 && newAvg > 0) {
                    const simProfit = (tgt - newAvg) * newQty;
                    const simPct = ((tgt / newAvg) - 1) * 100;
                    simMsg = `목표가 $${tgt} 도달 시: 예상 수익 $${simProfit.toFixed(0)} (${simPct > 0?'+':''}${simPct.toFixed(1)}%) / 새 평단 $${newAvg.toFixed(2)}`;
                } else if (addQty > 0 && addPrice > 0) {
                    simMsg = `추가 매수 후 새 평단: $${newAvg.toFixed(2)}`;
                }
            }

            return (
              <div key={h.ticker} className={`pf-holding-card pf-border-${badgeClass}`}>
                {/* 카드 헤더 */}
                <div className="pf-holding-header">
                  <div>
                    <div className="pf-holding-ticker">{h.ticker}</div>
                    <div className="pf-holding-name">{h.name !== h.ticker ? h.name : ''}</div>
                  </div>
                  <div className="pf-holding-actions">
                    <span className={`pf-holding-badge pf-badge-${badgeClass}`}>{emoji} {badge}</span>
                    <button className="pf-menu-btn" onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === h.ticker ? null : h.ticker) }}>⋯</button>
                    {menuOpen === h.ticker && (
                      <div className="pf-dropdown">
                        <button onClick={() => openEditModal(h)}>✏️ 수정/일지</button>
                        <button onClick={() => toggleScenario(h.ticker)}>🧮 시나리오</button>
                        <button onClick={() => handleRemove(h.ticker)}>🗑️ 삭제</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 가격 및 손익 */}
                <div className="pf-holding-price-row">
                  <span className="pf-holding-price">
                    {h.currentPrice != null ? `$${Number(h.currentPrice).toLocaleString()}` : 'N/A'}
                  </span>
                  {h.changePct != null && (
                    <span className={`stock-change ${h.changePct >= 0 ? 'up' : 'down'}`}>
                      {h.changePct >= 0 ? '+' : ''}{Number(h.changePct).toFixed(2)}%
                    </span>
                  )}
                </div>

                <div className="pf-holding-details">
                  <div className="pf-detail-row">
                    <span className="pf-detail-label">평단가</span>
                    <span className="pf-detail-value">${Number(h.avgPrice).toLocaleString()}</span>
                  </div>
                  <div className="pf-detail-row">
                    <span className="pf-detail-label">수량 / 투자금</span>
                    <span className="pf-detail-value">{h.quantity}주 / ${Number(h.investedAmount || 0).toLocaleString()}</span>
                  </div>
                  <div className="pf-detail-row pf-detail-pl">
                    <span className="pf-detail-label">평가손익</span>
                    <span className={`pf-detail-value pf-${hPlClass}`}>
                      {hPlSign}${Math.abs(h.profitLoss || 0).toLocaleString()} ({hPlSign}{h.profitLossPct || 0}%)
                    </span>
                  </div>
                  {h.weight != null && (
                    <div className="pf-detail-row">
                      <span className="pf-detail-label">비중</span>
                      <span className="pf-detail-value">{h.weight}%</span>
                    </div>
                  )}
                </div>

                {/* 7팩터 스코어 미니바 */}
                {h.status?.scores && (
                  <div className="pf-scores-mini">
                    {Object.entries(h.status.scores).map(([key, val]) => {
                      if (val == null) return null
                      const labelMap = { trend: '추세', momentum: '모멘텀', financial: '재무', valuation: '밸류', sentiment: '심리', volatility: '변동성', reliability: '신뢰도' }
                      const barClass = val >= 60 ? 'high' : val >= 40 ? 'mid' : 'low'
                      return (
                        <div key={key} className="pf-score-bar-row">
                          <span className="pf-score-label">{labelMap[key] || key}</span>
                          <div className="pf-score-bar-bg">
                            <div className={`pf-score-bar-fill pf-bar-${barClass}`} style={{ width: `${val}%` }} />
                          </div>
                          <span className="pf-score-val">{val}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 전략 문구 */}
                {h.status?.strategy && (
                  <div className="pf-strategy">{h.status.strategy}</div>
                )}

                {/* 매매일지 영역 (있을 때만) */}
                {(h.memo || h.tradeReason || h.targetPrice || h.lossPrice) && (
                  <div className="pf-journal">
                    {h.viewTerm && <span className="pf-journal-term">[{h.viewTerm}]</span>}
                    {h.targetPrice && <span className="pf-journal-tgt">목표 ${h.targetPrice}</span>}
                    {h.lossPrice && <span className="pf-journal-loss">손절 ${h.lossPrice}</span>}
                    {h.tradeReason && <div className="pf-journal-reason">이유: {h.tradeReason}</div>}
                    {h.memo && <div className="pf-journal-memo">📝 {h.memo}</div>}
                  </div>
                )}

                {/* 이유 태그 */}
                {h.status?.reasons?.length > 0 && (
                  <div className="pf-reasons">
                    {h.status.reasons.map((r, i) => (
                      <span key={i} className="pf-reason-tag">{r}</span>
                    ))}
                  </div>
                )}

                {/* 시나리오 계산기 패널 */}
                {scen && (
                  <div className="pf-scenario-panel">
                    <div className="pf-scen-title">🧮 시나리오 시뮬레이터</div>
                    <div className="pf-scen-inputs">
                      <input placeholder="추가 매수량(주)" type="number" value={scen.addQty} onChange={e=>updateScenario(h.ticker, 'addQty', e.target.value)} />
                      <input placeholder="추가 단가($)" type="number" step="0.01" value={scen.addPrice} onChange={e=>updateScenario(h.ticker, 'addPrice', e.target.value)} />
                      <input placeholder="도달 목표가($)" type="number" step="0.01" value={scen.targetPrice} onChange={e=>updateScenario(h.ticker, 'targetPrice', e.target.value)} />
                    </div>
                    {simMsg && <div className="pf-scen-result">{simMsg}</div>}
                    <button className="pf-scen-close" onClick={()=>toggleScenario(h.ticker)}>닫기</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && holdings.length === 0 && !error && (
        <div className="empty-state">
          <span className="big-emoji">💼</span>
          <p>보유종목이 없습니다.<br />아래 버튼을 눌러 종목을 추가하세요.</p>
        </div>
      )}

      {/* FAB 종목 추가 버튼 */}
      <button className="pf-fab" onClick={openAddModal}>＋ 종목 편입</button>

      {/* ── 종목 추가/수정 모달 ── */}
      {showAddModal && (
        <div className="pf-modal-overlay" onClick={closeModal}>
          <div className="pf-modal pf-modal-large" onClick={e => e.stopPropagation()}>
            <div className="pf-modal-header">
              <span>{editingHolding ? '종목 편입 및 매매일지' : '종목 편입'}</span>
              <button className="pf-modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="pf-modal-body">
              <div className="pf-form-section-title">기본 투자 정보</div>
              <label className="pf-form-label">
                티커 *
                <input
                  className="pf-form-input"
                  placeholder="예: AAPL, NVDA"
                  value={formTicker}
                  onChange={e => setFormTicker(e.target.value)}
                  disabled={!!editingHolding}
                />
              </label>
              <label className="pf-form-label">
                종목명
                <input
                  className="pf-form-input"
                  placeholder="예: Apple Inc."
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                />
              </label>
              <div className="pf-form-row">
                <label className="pf-form-label pf-form-half">
                  수량 *
                  <input
                    className="pf-form-input"
                    type="number"
                    placeholder="10"
                    value={formQty}
                    onChange={e => setFormQty(e.target.value)}
                  />
                </label>
                <label className="pf-form-label pf-form-half">
                  평균단가($) *
                  <input
                    className="pf-form-input"
                    type="number"
                    step="0.01"
                    placeholder="150.00"
                    value={formPrice}
                    onChange={e => setFormPrice(e.target.value)}
                  />
                </label>
              </div>

              <div className="pf-form-section-title pf-mt-4">매매 일지 및 알림 (선택)</div>
              <label className="pf-form-label">
                투자 관점
                <select className="pf-form-input pf-select" value={formViewTerm} onChange={e=>setFormViewTerm(e.target.value)}>
                  <option value="단기">단기 (스윙/모멘텀)</option>
                  <option value="중기">중기 (실적/트렌드)</option>
                  <option value="장기">장기 (배당/가치)</option>
                </select>
              </label>
              <label className="pf-form-label">
                매수 이유
                <input className="pf-form-input" placeholder="이 종목을 매수한 핵심 이유는?" value={formTradeReason} onChange={e => setFormTradeReason(e.target.value)} />
              </label>
              <div className="pf-form-row">
                <label className="pf-form-label pf-form-half">
                  목표가($)
                  <input className="pf-form-input" type="number" placeholder="익절 타겟" value={formTargetPrice} onChange={e => setFormTargetPrice(e.target.value)} />
                </label>
                <label className="pf-form-label pf-form-half">
                  손절가($)
                  <input className="pf-form-input" type="number" placeholder="리스크 컷" value={formLossPrice} onChange={e => setFormLossPrice(e.target.value)} />
                </label>
              </div>
              <label className="pf-form-label">
                기타 메모
                <input className="pf-form-input" placeholder="추가 기록사항" value={formMemo} onChange={e => setFormMemo(e.target.value)} />
              </label>
            </div>
            <div className="pf-modal-footer">
              <button className="pf-modal-cancel" onClick={closeModal}>취소</button>
              <button
                className="pf-modal-submit"
                onClick={editingHolding ? handleUpdate : handleAdd}
                disabled={!editingHolding && (!formTicker || !formQty || !formPrice)}
              >
                {editingHolding ? '수정 사항 저장' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 루트 App ─────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('watchlist') // 'watchlist' | 'chat' | 'portfolio'
  const [chatId, setChatId] = useState(() => localStorage.getItem('yeri_chatId') || '')
  const [alertCount, setAlertCount] = useState(0)
  
  // 앱 (원격) 업데이트 수동 확인 기능
  async function handleCheckUpdate() {
    try {
      const res = await fetch(`${API_BASE}/version`)
      const data = await res.json()
      if (data.commitHash && data.commitHash !== 'unknown' && data.commitHash !== BUILD_HASH) {
        alert('🚀 새로운 업데이트 버전이 발견되었습니다!\n확인을 누르시면 최신 버전으로 새로고침됩니다.')
        window.location.reload(true)
      } else {
        alert('✅ 이미 최신 버전이 성공적으로 반영되어 있습니다!\n(정상적으로 업데이트가 완료된 상태입니다)')
      }
    } catch (e) {
      alert('⚠️ 서버와 연결을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.')
    }
  }

  function handleChatIdChange(v) {
    setChatId(v)
    localStorage.setItem('yeri_chatId', v)
  }

  const effectiveId = chatId.trim() || 'webapp'

  return (
    <div className="app">
      {/* 탑바 */}
      <header className="topbar">
        <span className="topbar-logo" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          예리 v3 💛 
          <span className="build-tag">build:{BUILD_HASH}</span>
          <button className="manual-update-btn" onClick={handleCheckUpdate} style={{ padding: '2px 6px', fontSize: '0.7rem', background: 'var(--blue)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            🔄 업데이트 확인
          </button>
        </span>
        <nav className="topbar-nav">
          <button className={page === 'watchlist' ? 'active' : ''} onClick={() => setPage('watchlist')}>
            관심종목
          </button>
          <button className={page === 'portfolio' ? 'active' : ''} onClick={() => setPage('portfolio')}>
            포트폴리오
          </button>
          <button className={page === 'chat' ? 'active' : ''} onClick={() => setPage('chat')}>
            채팅 분석
          </button>
        </nav>
        <div className="topbar-right">
          <AlertBadge count={alertCount} onClick={() => setPage('watchlist')} />
          <input
            className="chatid-input"
            placeholder="내 고유 닉네임"
            value={chatId}
            onChange={e => handleChatIdChange(e.target.value)}
            title="원하는 닉네임(ID)을 입력하시면 나만의 포트폴리오 관리가 가능합니다"
          />
        </div>
      </header>

      {/* 페이지 */}
      {page === 'watchlist' && (
        <WatchlistPage chatId={effectiveId} onBadgeCountChange={setAlertCount} onGoPortfolio={() => setPage('portfolio')} />
      )}
      {page === 'portfolio' && <PortfolioPage userId={effectiveId} />}
      {page === 'chat' && <ChatPage chatId={effectiveId} />}
    </div>
  )
}

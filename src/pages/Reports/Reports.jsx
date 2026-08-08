import { useState, useEffect, Fragment } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  getReportKpis, getTopProduct, getRevenueByPeriod,
  getPaymentBreakdown, getPaymentMethodDetail, getTableRevenue, getTopProducts, getProductSalesDetail,
  getTableProductBreakdown, getProductTableBreakdown,
  getCategoryRevenue, getIngredientConsumption,
  getOrdersList, getOrderItems,
  getStaffPerformance, getStaffItemBreakdown,
} from '../../lib/localDb.js'
import './Reports.css'

const TABS = [
  { id: 'today', label: 'Bugün',    revenueLabel: 'Günlük Ciro',   orderLabel: 'Bugünkü Sipariş',  chartTitle: 'Saatlik Ciro' },
  { id: 'week',  label: 'Bu Hafta', revenueLabel: 'Haftalık Ciro', orderLabel: 'Haftalık Sipariş', chartTitle: 'Günlük Ciro' },
  { id: 'month', label: 'Bu Ay',    revenueLabel: 'Aylık Ciro',    orderLabel: 'Aylık Sipariş',    chartTitle: 'Günlük Ciro' },
  { id: 'total', label: 'Toplam',   revenueLabel: 'Toplam Ciro',   orderLabel: 'Toplam Sipariş',   chartTitle: 'Aylık Ciro' },
]

const PIE_COLORS = ['#e8975a', '#6366f1', '#0d9488']

function getDateRange(tabId) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

  if (tabId === 'today') {
    const today = fmt(now)
    return [today, today]
  }
  if (tabId === 'week') {
    const day = now.getDay()
    const diffToMon = day === 0 ? -6 : 1 - day
    const mon = new Date(now); mon.setDate(now.getDate() + diffToMon)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return [fmt(mon), fmt(sun)]
  }
  if (tabId === 'month') {
    const y = now.getFullYear(), m = now.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    return [`${y}-${pad(m+1)}-01`, `${y}-${pad(m+1)}-${pad(daysInMonth)}`]
  }
  return [null, null]
}

function fmtCurrency(n) {
  return '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function CustomBarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rpt-tooltip">
      <span className="rpt-tooltip__label">{label}</span>
      <span className="rpt-tooltip__val">{fmtCurrency(payload[0].value)}</span>
    </div>
  )
}

function Reports() {
  const { dbReady } = useApp()
  const [activeTab,    setActiveTab]    = useState('today')
  const [kpis,         setKpis]         = useState({ revenue: 0, orderCount: 0, avgOrder: 0 })
  const [topProduct,   setTopProduct]   = useState({ name: '—', qty: 0 })
  const [periodData,   setPeriodData]   = useState([])
  const [paymentData,  setPaymentData]  = useState([{ name: 'Nakit', value: 0 }, { name: 'Kart', value: 0 }, { name: 'IBAN', value: 0 }])
  const [paymentDetail, setPaymentDetail] = useState({ discount: 0, points: 0, netRevenue: 0, grossRevenue: 0 })
  const [tableRevData, setTableRevData] = useState([])
  const [topProducts,  setTopProducts]  = useState([])
  const [detailData,   setDetailData]   = useState([])
  const [tableModal,   setTableModal]   = useState(null)
  const [productModal, setProductModal] = useState(null)
  const [categoryData,    setCategoryData]    = useState([])
  const [staffData,       setStaffData]       = useState([])
  const [staffModal,      setStaffModal]      = useState(null)
  const [ingredientData,  setIngredientData]  = useState([])
  const [ordersList,      setOrdersList]      = useState([])
  const [expandedOrderId, setExpandedOrderId] = useState(null)
  const [expandedItems,   setExpandedItems]   = useState([])

  /* eslint-disable react-hooks/set-state-in-effect -- reads the external sql.js store into state */
  useEffect(() => {
    if (!dbReady) return
    const [start, end] = getDateRange(activeTab)
    setKpis(getReportKpis(start, end))
    setTopProduct(getTopProduct(start, end))
    setPeriodData(getRevenueByPeriod(activeTab))
    setPaymentData(getPaymentBreakdown(start, end))
    setPaymentDetail(getPaymentMethodDetail(start, end))
    setTableRevData(getTableRevenue(start, end))
    setTopProducts(getTopProducts(start, end))
    setDetailData(getProductSalesDetail(start, end))
    setCategoryData(getCategoryRevenue(start, end))
    setStaffData(getStaffPerformance(start, end))
    setIngredientData(getIngredientConsumption(start, end))
    setOrdersList(getOrdersList(start, end))
    setExpandedOrderId(null)
  }, [activeTab, dbReady])
  /* eslint-enable react-hooks/set-state-in-effect */

  const tab = TABS.find(t => t.id === activeTab)
  const totalPayment = paymentData.reduce((s, d) => s + d.value, 0)
  const maxTableRev  = tableRevData.reduce((m, r) => Math.max(m, r.value), 0) || 1

  function openTableModal(row) {
    const [start, end] = getDateRange(activeTab)
    const items = getTableProductBreakdown(row.name, start, end)
    setTableModal({ name: row.name, items, total: row.value })
  }

  function openProductModal(p) {
    const [start, end] = getDateRange(activeTab)
    const rows = getProductTableBreakdown(p.name, start, end)
    setProductModal({ name: p.name, qty: p.qty, revenue: p.revenue, rows })
  }

  function toggleOrder(id) {
    if (expandedOrderId === id) {
      setExpandedOrderId(null)
      setExpandedItems([])
    } else {
      setExpandedOrderId(id)
      setExpandedItems(getOrderItems(id))
    }
  }

  function openStaffModal(row) {
    const [start, end] = getDateRange(activeTab)
    const items = getStaffItemBreakdown(row.name, start, end)
    setStaffModal({ name: row.name, orderCount: row.orderCount, revenue: row.revenue, items })
  }

  function stockStatus(row) {
    if (row.currentStock <= 0) return 'critical'
    if (row.minStockAlert > 0 && row.currentStock <= row.minStockAlert) return 'low'
    return 'ok'
  }

  // 24 hourly bars / 31 daily bars would crowd the axis — skip labels
  const xAxisInterval = activeTab === 'month' ? 4 : activeTab === 'today' ? 1 : 0

  return (
    <div className="page reports-page">

      {/* ── Header ── */}
      <div className="rpt-header">
        <h1 className="rpt-title">Performans Analizi</h1>
        <div className="rpt-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`rpt-tab${activeTab === t.id ? ' rpt-tab--active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="rpt-kpis">
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">{tab.revenueLabel}</span>
          <span className="rpt-kpi__value">{fmtCurrency(kpis.revenue)}</span>
        </div>
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">{tab.orderLabel}</span>
          <span className="rpt-kpi__value">{kpis.orderCount} <small>adet</small></span>
        </div>
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">Ortalama Sepet</span>
          <span className="rpt-kpi__value">{fmtCurrency(kpis.avgOrder)}</span>
        </div>
        <div className="rpt-kpi">
          <span className="rpt-kpi__label">En Çok Satan</span>
          <span className="rpt-kpi__value rpt-kpi__value--sm">{topProduct.name}</span>
          {topProduct.qty > 0 && (
            <span className="rpt-kpi__sub">{topProduct.qty} adet satıldı</span>
          )}
        </div>
      </div>

      {/* ── Charts row ── */}
      <div className="rpt-row">

        {/* Left: bar chart + table revenue */}
        <div className="rpt-col-left">

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">{tab.chartTitle}</span>
              {activeTab === 'today' && periodData.length > 0 && (
                <span className="rpt-card__sub">
                  {periodData[0].label} – {periodData[periodData.length - 1].label}
                </span>
              )}
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={periodData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={xAxisInterval}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => v === 0 ? '' : `₺${v.toLocaleString('tr-TR')}`}
                    width={60}
                  />
                  <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'var(--color-accent-light)' }} />
                  <Bar dataKey="value" fill="#e8975a" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">Masa Bazlı Ciro</span>
            </div>
            {tableRevData.length === 0 ? (
              <p className="rpt-empty">Bu dönemde veri yok.</p>
            ) : (
              <div className="rpt-table-bars">
                {tableRevData.map(row => (
                  <div key={row.name} className="rpt-bar-row" onClick={() => openTableModal(row)}>
                    <span className="rpt-bar-row__name">{row.name}</span>
                    <div className="rpt-bar-row__track">
                      <div
                        className="rpt-bar-row__fill"
                        style={{ width: `${(row.value / maxTableRev) * 100}%` }}
                      />
                    </div>
                    <span className="rpt-bar-row__val">{fmtCurrency(row.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right: donut + top products */}
        <div className="rpt-col-right">

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">Ödeme Dağılımı</span>
            </div>
            <div className="rpt-donut-wrap">
              <div className="rpt-donut-chart">
                <PieChart width={180} height={180}>
                  <Pie
                    data={paymentData}
                    cx={90} cy={90}
                    innerRadius={54}
                    outerRadius={80}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={totalPayment > 0 ? 2 : 0}
                  >
                    {paymentData.map((_, i) => (
                      <Cell key={i} fill={totalPayment > 0 ? PIE_COLORS[i] : '#e5e7eb'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={v => [fmtCurrency(v), '']} />
                </PieChart>
                <div className="rpt-donut-center">
                  {totalPayment > 0 ? (
                    <>
                      <span className="rpt-donut-pct">
                        {Math.round((paymentData[0].value / totalPayment) * 100)}%
                      </span>
                      <span className="rpt-donut-sub">Nakit</span>
                    </>
                  ) : (
                    <span className="rpt-donut-sub">Veri yok</span>
                  )}
                </div>
              </div>
              <div className="rpt-donut-legend">
                {paymentData.map((d, i) => (
                  <div key={d.name} className="rpt-legend-item">
                    <span className="rpt-legend-dot" style={{ background: PIE_COLORS[i] }} />
                    <span className="rpt-legend-name">{d.name}</span>
                    <span className="rpt-legend-val">
                      {totalPayment > 0
                        ? Math.round((d.value / totalPayment) * 100) + '%'
                        : '0%'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">Ödeme Dağılımı (₺)</span>
            </div>
            <div className="rpt-pay-detail">
              <div className="rpt-pay-detail__row">
                <span>Nakit toplamı</span>
                <span>{fmtCurrency(paymentData[0]?.value ?? 0)}</span>
              </div>
              <div className="rpt-pay-detail__row">
                <span>Kart toplamı</span>
                <span>{fmtCurrency(paymentData[1]?.value ?? 0)}</span>
              </div>
              <div className="rpt-pay-detail__row">
                <span>İBAN toplamı</span>
                <span>{fmtCurrency(paymentData[2]?.value ?? 0)}</span>
              </div>
              {paymentDetail.points > 0 && (
                <div className="rpt-pay-detail__row">
                  <span>Puan ile ödenen</span>
                  <span>{fmtCurrency(paymentDetail.points)}</span>
                </div>
              )}
              <div className="rpt-pay-detail__row rpt-pay-detail__row--discount">
                <span>Toplam İndirim</span>
                <span>– {fmtCurrency(paymentDetail.discount)}</span>
              </div>
              <div className="rpt-pay-detail__divider" />
              <div className="rpt-pay-detail__row">
                <span>Ciro (indirimsiz / brüt)</span>
                <span>{fmtCurrency(paymentDetail.grossRevenue)}</span>
              </div>
              <div className="rpt-pay-detail__row rpt-pay-detail__row--net">
                <span>Ciro (indirimli / net)</span>
                <span>{fmtCurrency(paymentDetail.netRevenue)}</span>
              </div>
            </div>
          </div>

          <div className="rpt-card">
            <div className="rpt-card__header">
              <span className="rpt-card__title">En Çok Satan Ürünler</span>
            </div>
            {topProducts.length === 0 ? (
              <p className="rpt-empty">Bu dönemde veri yok.</p>
            ) : (
              <ol className="rpt-top-list">
                {topProducts.map((p, i) => (
                  <li key={p.name} className="rpt-top-item" onClick={() => openProductModal(p)}>
                    <span className="rpt-top-num">{i + 1}</span>
                    <span className="rpt-top-name">{p.name}</span>
                    <span className="rpt-top-qty">{p.qty} adet</span>
                    <span className="rpt-top-rev">{fmtCurrency(p.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

        </div>
      </div>

      {/* ── Product detail table ── */}
      <div className="rpt-card">
        <div className="rpt-card__header">
          <span className="rpt-card__title">Ürün Satış Detayı</span>
        </div>
        {detailData.length === 0 ? (
          <p className="rpt-empty">Bu dönemde satış verisi yok.</p>
        ) : (
          <table className="rpt-table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Kategori</th>
                <th>Satış Adedi</th>
                <th>Toplam Gelir</th>
                <th>Günlük Ort.</th>
              </tr>
            </thead>
            <tbody>
              {detailData.map(row => (
                <tr key={row.name}>
                  <td className="rpt-table__name">{row.name}</td>
                  <td>{row.category}</td>
                  <td>{row.qty} adet</td>
                  <td>{fmtCurrency(row.revenue)}</td>
                  <td>{fmtCurrency(row.dailyAvg)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="rpt-table__foot-label">Toplam</td>
                <td>{detailData.reduce((s, r) => s + r.qty, 0)} adet</td>
                <td>{fmtCurrency(detailData.reduce((s, r) => s + r.revenue, 0))}</td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── Category + Staff row ── */}
      <div className="rpt-two-col">
        {/* Category revenue */}
        <div className="rpt-card">
          <div className="rpt-card__header">
            <span className="rpt-card__title">Kategori Bazlı Satış</span>
          </div>
          {categoryData.length === 0 ? (
            <p className="rpt-empty">Bu dönemde satış verisi yok.</p>
          ) : (
            <table className="rpt-table">
              <thead><tr><th>Kategori</th><th>Adet</th><th>Ciro</th><th>Pay</th></tr></thead>
              <tbody>
                {categoryData.map(r => (
                  <tr key={r.category}>
                    <td className="rpt-table__name">{r.category}</td>
                    <td>{r.qty}</td>
                    <td>{fmtCurrency(r.revenue)}</td>
                    <td>
                      <div className="rpt-pct-bar">
                        <div className="rpt-pct-bar__fill" style={{ width: `${r.pct}%` }} />
                        <span>{r.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Staff performance */}
        <div className="rpt-card">
          <div className="rpt-card__header">
            <span className="rpt-card__title">Personel Performansı</span>
          </div>
          {staffData.length === 0 ? (
            <p className="rpt-empty">Bu dönemde personel verisi yok.</p>
          ) : (
            <table className="rpt-table rpt-table--clickable">
              <thead><tr><th>Garson</th><th>Sipariş</th><th>Ciro</th></tr></thead>
              <tbody>
                {staffData.map(r => (
                  <tr key={r.name} onClick={() => openStaffModal(r)} className="rpt-row--hover">
                    <td className="rpt-table__name">{r.name}</td>
                    <td>{r.orderCount}</td>
                    <td>{fmtCurrency(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Ingredient tracking ── */}
      <div className="rpt-card">
        <div className="rpt-card__header">
          <span className="rpt-card__title">Malzeme Takibi</span>
          <span className="rpt-card__sub">Dönem tüketimi & mevcut stok</span>
        </div>
        {ingredientData.length === 0 ? (
          <p className="rpt-empty">Malzeme verisi yok.</p>
        ) : (
          <table className="rpt-table">
            <thead>
              <tr>
                <th>Malzeme</th>
                <th>Birim</th>
                <th>Mevcut Stok</th>
                <th>Dönem Tüketimi</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {ingredientData.map(r => {
                const status = stockStatus(r)
                return (
                  <tr key={r.id}>
                    <td className="rpt-table__name">{r.name}</td>
                    <td>{r.unit}</td>
                    <td>{Number(r.currentStock).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td>
                    <td>{r.consumed > 0 ? Number(r.consumed).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '—'}</td>
                    <td>
                      <span className={`rpt-stock-badge rpt-stock-badge--${status}`}>
                        {status === 'ok' ? 'Yeterli' : status === 'low' ? 'Az' : 'Tükendi'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Order history ── */}
      <div className="rpt-card">
        <div className="rpt-card__header">
          <span className="rpt-card__title">Sipariş Geçmişi</span>
          <span className="rpt-card__sub">{ordersList.length} sipariş — tıkla detay gör</span>
        </div>
        {ordersList.length === 0 ? (
          <p className="rpt-empty">Bu dönemde sipariş yok.</p>
        ) : (
          <table className="rpt-table rpt-table--clickable">
            <thead>
              <tr>
                <th>Saat</th>
                <th>Masa</th>
                <th>Ürünler</th>
                <th>Ödeme</th>
                <th>Garson</th>
                <th>Toplam</th>
              </tr>
            </thead>
            <tbody>
              {ordersList.map(order => (
                <Fragment key={order.id}>
                  <tr
                    className={`rpt-row--hover${expandedOrderId === order.id ? ' rpt-row--active' : ''}`}
                    onClick={() => toggleOrder(order.id)}
                  >
                    <td className="rpt-order-time">
                      {new Date(order.closedAt).toLocaleString('tr-TR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>{order.tableName}</td>
                    <td className="rpt-order-summary">{order.itemsSummary}</td>
                    <td>
                      <span className={`rpt-pay-badge rpt-pay-badge--${order.paymentMethod}`}>
                        {order.paymentMethod === 'cash' ? 'Nakit' : order.paymentMethod === 'card' ? 'Kart' : order.paymentMethod === 'iban' ? 'IBAN' : 'Karma'}
                      </span>
                    </td>
                    <td>{order.waiterName || '—'}</td>
                    <td className="rpt-order-total">{fmtCurrency(order.total)}</td>
                  </tr>
                  {expandedOrderId === order.id && (
                    <tr className="rpt-order-expanded">
                      <td colSpan={6}>
                        <div className="rpt-order-items">
                          {expandedItems.map((item, i) => (
                            <div key={i} className="rpt-order-item">
                              <span className="rpt-order-item__name">{item.name}</span>
                              <span className="rpt-order-item__qty">×{item.quantity}</span>
                              <span className="rpt-order-item__price">{fmtCurrency(item.unitPrice)}</span>
                              <span className="rpt-order-item__sub">{fmtCurrency(item.unitPrice * item.quantity)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Table detail modal ── */}
      {tableModal && (
        <div className="rpt-modal-overlay" onClick={() => setTableModal(null)}>
          <div className="rpt-modal" onClick={e => e.stopPropagation()}>
            <div className="rpt-modal-header">
              <h3>{tableModal.name}</h3>
              <button onClick={() => setTableModal(null)}>✕</button>
            </div>
            <div className="rpt-modal-body">
              {tableModal.items.length === 0 ? (
                <p className="rpt-empty">Veri yok.</p>
              ) : (
                <table className="rpt-modal-table">
                  <thead>
                    <tr><th>Ürün</th><th>Adet</th><th>Ciro</th></tr>
                  </thead>
                  <tbody>
                    {tableModal.items.map(r => (
                      <tr key={r.name}>
                        <td>{r.name}</td>
                        <td>{r.qty}</td>
                        <td>{fmtCurrency(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Toplam</td>
                      <td></td>
                      <td>{fmtCurrency(tableModal.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Product detail modal ── */}
      {productModal && (
        <div className="rpt-modal-overlay" onClick={() => setProductModal(null)}>
          <div className="rpt-modal" onClick={e => e.stopPropagation()}>
            <div className="rpt-modal-header">
              <div>
                <h3>{productModal.name}</h3>
                <span>{productModal.qty} adet · {fmtCurrency(productModal.revenue)}</span>
              </div>
              <button onClick={() => setProductModal(null)}>✕</button>
            </div>
            <div className="rpt-modal-body">
              {productModal.rows.length === 0 ? (
                <p className="rpt-empty">Veri yok.</p>
              ) : (
                <table className="rpt-modal-table">
                  <thead>
                    <tr><th>Masa</th><th>Adet</th><th>Ciro</th></tr>
                  </thead>
                  <tbody>
                    {productModal.rows.map(r => (
                      <tr key={r.table}>
                        <td>{r.table}</td>
                        <td>{r.qty}</td>
                        <td>{fmtCurrency(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Staff detail modal ── */}
      {staffModal && (
        <div className="rpt-modal-overlay" onClick={() => setStaffModal(null)}>
          <div className="rpt-modal" onClick={e => e.stopPropagation()}>
            <div className="rpt-modal-header">
              <div>
                <h3>{staffModal.name}</h3>
                <span>{staffModal.orderCount} sipariş · {fmtCurrency(staffModal.revenue)}</span>
              </div>
              <button onClick={() => setStaffModal(null)}>✕</button>
            </div>
            <div className="rpt-modal-body">
              {staffModal.items.length === 0 ? (
                <p className="rpt-empty">Veri yok.</p>
              ) : (
                <table className="rpt-modal-table">
                  <thead><tr><th>Ürün</th><th>Adet</th><th>Ciro</th></tr></thead>
                  <tbody>
                    {staffModal.items.map(r => (
                      <tr key={r.name}>
                        <td>{r.name}</td>
                        <td>{r.qty}</td>
                        <td>{fmtCurrency(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default Reports

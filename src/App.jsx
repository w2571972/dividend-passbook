import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";

/* ---------- tokens ---------- */

const C = {
  paper: "#E6EEE8",
  sheet: "#F8FBF7",
  ink: "#1F3A5F",
  muted: "#5E6E72",
  rule: "#C5D3CB",
  seal: "#B8322A",
  sealSoft: "#F4E1DD",
};
const UP = "#C0392B"; // 台股慣例：漲紅
const DOWN = "#2E7D4F"; // 跌綠
const serif = '"Noto Serif TC","Songti TC","PMingLiU","MingLiU",serif';
const sans = '-apple-system,"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif';
const STORE_KEY = "dividend-passbook-v2";
const DEFAULT_LOCAL = {
  entries: [],
  sim: { monthly: 10000, years: 20, yieldPct: 5, growthPct: 2, reinvest: true },
};

const fmt = (n, d = 0) =>
  n == null || isNaN(n) ? "—" : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (v, d = 0) => (v == null || isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${fmt(v, d)}`);
const pnlColor = (v) => (v > 0 ? UP : v < 0 ? DOWN : C.ink);
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD，本地時區
const shortDate = (s) => (s ? s.slice(2).replaceAll("-", "/") : "—");

/** 依網址推算 GitHub 上 watchlist.json 的編輯連結（放在 GitHub Pages 時才有效） */
function watchlistEditUrl() {
  const { hostname, pathname } = window.location;
  if (!hostname.endsWith("github.io")) return null;
  const user = hostname.split(".")[0];
  const repo = pathname.split("/").filter(Boolean)[0] || hostname;
  return `https://github.com/${user}/${repo}/edit/main/watchlist.json`;
}

function latestFullYearDividend(s) {
  if (!s?.dividendsByYear?.length) return null;
  const thisYear = new Date().getFullYear();
  const full = s.dividendsByYear.filter((d) => d.year < thisYear && d.amount > 0);
  return full.length ? full[full.length - 1].amount : s.ttmDividend || null;
}

function stockNotes(s) {
  const notes = [];
  const thisYear = new Date().getFullYear();
  const full = s.dividendsByYear.filter((d) => d.year < thisYear);
  const firstPaidIdx = full.findIndex((d) => d.amount > 0);
  const since = firstPaidIdx >= 0 ? full.slice(firstPaidIdx) : [];
  const paid = since.filter((d) => d.amount > 0);
  if (since.length) {
    notes.push(
      paid.length === since.length
        ? `${since[0].year} 年起每個完整年度都有配息。`
        : `${since[0].year} 年起的 ${since.length} 個完整年度中，有 ${paid.length} 年有配息。`
    );
  }
  if (paid.length >= 3) {
    const a = paid[paid.length - 3], b = paid[paid.length - 1];
    const ch = (b.amount / a.amount - 1) * 100;
    if (ch <= -20) notes.push(`每股股利從 ${a.year} 年的 ${fmt(a.amount, 2)} 元降到 ${b.year} 年的 ${fmt(b.amount, 2)} 元，可以留意下滑原因。`);
    else if (ch >= 20) notes.push(`每股股利從 ${a.year} 年的 ${fmt(a.amount, 2)} 元增加到 ${b.year} 年的 ${fmt(b.amount, 2)} 元。`);
  }
  const last = s.events?.[0];
  if (last?.fillStatus === "open") notes.push(`最近一次除息（${last.exDate}）還沒填息。`);
  if (s.avgFillDays != null) notes.push(`近幾次平均約 ${fmt(s.avgFillDays, 0)} 個交易日填息。`);
  (s.upcoming || []).forEach((u) =>
    notes.push(u.cash != null ? `已公告 ${u.exDate} 除息，每股 ${fmt(u.cash, 3)} 元。` : `已公告 ${u.exDate} 除息，每股金額尚未公告。`)
  );
  if (s.stale) notes.push("這檔最近一次更新失敗，顯示的是上次成功抓到的資料。");
  return notes;
}

function simulate({ monthly, years, yieldPct, growthPct, reinvest }) {
  let shares = 0, price = 100, cash = 0, principal = 0, yearDiv = 0;
  const g = Math.pow(1 + growthPct / 100, 1 / 12);
  const dy = yieldPct / 100 / 12;
  const rows = [{ year: 0, principal: 0, value: 0, dividend: 0 }];
  for (let m = 1; m <= years * 12; m++) {
    principal += monthly;
    shares += monthly / price;
    const div = shares * price * dy;
    if (reinvest) shares += div / price;
    else cash += div;
    yearDiv += div;
    price *= g;
    if (m % 12 === 0) {
      rows.push({ year: m / 12, principal, value: shares * price + cash, dividend: yearDiv });
      yearDiv = 0;
    }
  }
  return rows;
}

/* ---------- building blocks ---------- */

const inputStyle = {
  width: "100%",
  padding: "9px 10px",
  border: `1px solid ${C.rule}`,
  borderRadius: 6,
  background: "#fff",
  color: C.ink,
  fontSize: 16,
  fontVariantNumeric: "tabular-nums",
  boxSizing: "border-box",
  fontFamily: sans,
};

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 13, color: C.muted, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function Btn({ children, onClick, kind = "primary", disabled, style }) {
  const kinds = {
    primary: { background: C.ink, color: "#fff", border: `1px solid ${C.ink}` },
    ghost: { background: "transparent", color: C.ink, border: `1px solid ${C.ink}` },
    quiet: { background: "transparent", color: C.muted, border: "1px solid transparent", padding: "6px 8px" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "9px 14px",
        borderRadius: 6,
        fontSize: 15,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontFamily: sans,
        ...kinds[kind],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Sheet({ children, style }) {
  return (
    <section style={{ background: C.sheet, border: `1px solid ${C.rule}`, borderRadius: 4, padding: 16, marginBottom: 14, ...style }}>
      {children}
    </section>
  );
}

function H2({ children }) {
  return <h2 style={{ fontFamily: serif, fontSize: 19, margin: "0 0 12px", color: C.ink, fontWeight: 700 }}>{children}</h2>;
}

function Row({ cells, head, cols }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: cols || `repeat(${cells.length}, minmax(0,1fr))`,
        gap: 6,
        padding: "8px 0",
        borderBottom: `1px solid ${C.rule}`,
        fontSize: head ? 12 : 14,
        color: head ? C.muted : C.ink,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {cells.map((c, i) => (
        <div key={i} style={{ textAlign: i === 0 ? "left" : "right", overflow: "hidden", textOverflow: "ellipsis" }}>
          {c}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, color, big }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
      <div
        style={{
          fontFamily: big ? serif : sans,
          fontSize: big ? 20 : 16,
          fontWeight: big ? 700 : 400,
          color: color || C.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Muted({ children, style }) {
  return <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: "10px 0 0", ...style }}>{children}</p>;
}

function AddTickerHint({ tickers }) {
  const url = watchlistEditUrl();
  return (
    <Muted>
      {tickers ? `${tickers.join("、")} 還不在追蹤清單裡。` : "想追蹤其他股票？"}
      {url ? (
        <>
          到{" "}
          <a href={url} target="_blank" rel="noreferrer" style={{ color: C.ink }}>
            GitHub 編輯 watchlist.json
          </a>{" "}
          加入代號，存檔後幾分鐘內會自動更新。
        </>
      ) : (
        "請在專案的 watchlist.json 加入代號，推上 GitHub 後會自動更新。"
      )}
    </Muted>
  );
}

/* ---------- tab: simulator ---------- */

function SimTab({ sim, setSim }) {
  const rows = simulate(sim);
  const last = rows[rows.length - 1];
  const set = (k) => (e) => setSim({ ...sim, [k]: Number(e.target.value) || 0 });
  const milestones = rows.filter((r) => r.year > 0 && (r.year % 5 === 0 || r.year === sim.years));

  return (
    <>
      <Sheet>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            aria-hidden
            style={{
              flex: "0 0 auto",
              width: 84,
              height: 84,
              borderRadius: "50%",
              border: `3px solid ${C.seal}`,
              color: C.seal,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(-8deg)",
              fontFamily: serif,
              lineHeight: 1.15,
              boxShadow: `inset 0 0 0 3px ${C.sheet}, inset 0 0 0 4px ${C.seal}`,
            }}
          >
            <span style={{ fontSize: 12 }}>每月存入</span>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{fmt(sim.monthly)}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: C.muted }}>第 {sim.years} 年，每月約可領股利</div>
            <div style={{ fontFamily: serif, fontSize: 34, fontWeight: 700, color: C.seal, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
              {fmt(last.dividend / 12)} 元
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
              累積投入 {fmt(last.principal)}，資產約 {fmt(last.value)}
            </div>
          </div>
        </div>
      </Sheet>

      <Sheet>
        <H2>試算條件</H2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="每月投入（元）">
            <input type="number" inputMode="numeric" style={inputStyle} value={sim.monthly} onChange={set("monthly")} />
          </Field>
          <Field label="持有年數">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              style={inputStyle}
              value={sim.years}
              onChange={(e) => setSim({ ...sim, years: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </Field>
          <Field label="假設殖利率（%）">
            <input type="number" inputMode="decimal" step="0.1" style={inputStyle} value={sim.yieldPct} onChange={set("yieldPct")} />
          </Field>
          <Field label="假設股價年成長（%）">
            <input type="number" inputMode="decimal" step="0.1" style={inputStyle} value={sim.growthPct} onChange={set("growthPct")} />
          </Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 15 }}>
          <input type="checkbox" checked={sim.reinvest} onChange={(e) => setSim({ ...sim, reinvest: e.target.checked })} style={{ width: 18, height: 18 }} />
          股利再投入
        </label>
      </Sheet>

      <Sheet>
        <H2>資產成長</H2>
        <div style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 5, right: 4, left: -8, bottom: 0 }}>
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.muted }} tickFormatter={(v) => `${v}年`} stroke={C.rule} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} tickFormatter={(v) => `${Math.round(v / 10000)}萬`} stroke={C.rule} width={48} />
              <Tooltip formatter={(v, n) => [`${fmt(v)} 元`, n === "value" ? "資產" : "投入本金"]} labelFormatter={(l) => `第 ${l} 年`} />
              <Area type="monotone" dataKey="value" stroke={C.seal} fill={C.sealSoft} strokeWidth={2} />
              <Area type="monotone" dataKey="principal" stroke={C.ink} fill="transparent" strokeDasharray="4 3" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <Muted style={{ marginTop: 6 }}>紅線是資產，虛線是投入本金。</Muted>
        <div style={{ marginTop: 14 }}>
          <Row head cells={["年度", "投入本金", "資產", "年股利"]} />
          {milestones.map((r) => (
            <Row key={r.year} cells={[`第 ${r.year} 年`, fmt(r.principal), fmt(r.value), fmt(r.dividend)]} />
          ))}
        </div>
        <Muted>簡化試算：假設殖利率與股價成長率每年固定，股利按月平均計入，未計手續費、所得稅與二代健保補充保費。</Muted>
      </Sheet>
    </>
  );
}

/* ---------- tab: watchlist ---------- */

function StockCard({ s }) {
  const notes = stockNotes(s);
  return (
    <Sheet>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontFamily: serif, fontSize: 22, fontWeight: 700 }}>{s.ticker}</span>
          <span style={{ marginLeft: 8, color: C.muted, fontSize: 15 }}>{s.name}</span>
        </div>
        <span style={{ fontSize: 12, color: C.muted }}>{shortDate(s.priceDate)} 收盤</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 8px", margin: "12px 0" }}>
        <Stat label="股價" value={fmt(s.price, 2)} />
        <Stat label="近一年漲跌" value={s.change1y != null ? `${signed(s.change1y, 1)}%` : "—"} color={pnlColor(s.change1y)} />
        <Stat label="近一年殖利率" value={s.yield != null ? `${fmt(s.yield, 2)}%` : "—"} />
        <Stat label="近一年股利" value={`${fmt(s.ttmDividend, 3)} 元`} />
        <Stat label="配息頻率" value={s.frequency} />
        <Stat label="平均填息" value={s.avgFillDays != null ? `${fmt(s.avgFillDays)} 天` : "—"} />
        {s.pe != null && <Stat label="本益比" value={fmt(s.pe, 2)} />}
        {s.pb != null && <Stat label="股價淨值比" value={fmt(s.pb, 2)} />}
      </div>

      {s.prices?.length > 1 && (
        <>
          <div style={{ fontSize: 12, color: C.muted }}>近一年股價</div>
          <div style={{ height: 90 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={s.prices} margin={{ top: 6, right: 2, left: 2, bottom: 0 }}>
                <YAxis domain={["dataMin", "dataMax"]} hide />
                <XAxis dataKey="d" hide />
                <Tooltip formatter={(v) => [`${fmt(v, 2)} 元`, "收盤"]} labelFormatter={(l) => l} />
                <Line type="monotone" dataKey="c" stroke={C.ink} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>各年度每股現金股利（元，依除息日歸年）</div>
      <div style={{ height: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={s.dividendsByYear} margin={{ top: 14, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.muted }} stroke={C.rule} />
            <Tooltip formatter={(v) => [`${fmt(v, 3)} 元`, "現金股利"]} />
            <Bar dataKey="amount" fill={C.ink} radius={[2, 2, 0, 0]} label={{ position: "top", fontSize: 10, fill: C.muted, formatter: (v) => (v ? fmt(v, 2) : "") }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {s.events?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Row head cols="1fr 0.8fr 1fr 1fr" cells={["除息日", "每股", "填息", "發放日"]} />
          {s.events.slice(0, 4).map((e) => (
            <Row
              key={e.exDate}
              cols="1fr 0.8fr 1fr 1fr"
              cells={[
                shortDate(e.exDate),
                fmt(e.cash, 3),
                e.fillStatus === "filled" ? `${e.fillDays} 天` : e.fillStatus === "open" ? "尚未填息" : "—",
                `${shortDate(e.payDate)}${e.payEstimated ? "（估）" : ""}`,
              ]}
            />
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </Sheet>
  );
}

function WatchTab({ data }) {
  const stocks = data.tickers.map((t) => data.stocks[t]).filter(Boolean);
  const errors = Object.entries(data.errors || {});

  return (
    <>
      <Sheet>
        <H2>追蹤清單</H2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          資料每個交易日傍晚自動更新，最近一次是 {data.updatedAt ? data.updatedAt.replace("T", " ").slice(0, 16) : "尚未更新"}。
        </p>
        {errors.length > 0 && (
          <p style={{ color: C.seal, fontSize: 13, margin: "8px 0 0", lineHeight: 1.6 }}>
            {errors.map(([t, msg]) => `${t}：${msg}`).join("；")}
          </p>
        )}
        <AddTickerHint />
      </Sheet>

      {stocks.length >= 2 && (
        <Sheet>
          <H2>快速比較</H2>
          <Row head cols="0.9fr 1fr 1fr 0.9fr" cells={["代號", "殖利率", "配息", "平均填息"]} />
          {[...stocks]
            .sort((a, b) => (b.yield ?? 0) - (a.yield ?? 0))
            .map((s) => (
              <Row
                key={s.ticker}
                cols="0.9fr 1fr 1fr 0.9fr"
                cells={[s.ticker, s.yield != null ? `${fmt(s.yield, 2)}%` : "—", s.frequency, s.avgFillDays != null ? `${fmt(s.avgFillDays)} 天` : "—"]}
              />
            ))}
          <Muted>殖利率＝近一年現金股利 ÷ 最新收盤價。</Muted>
        </Sheet>
      )}

      {stocks.map((s) => <StockCard key={s.ticker} s={s} />)}
    </>
  );
}

/* ---------- tab: ledger ---------- */

function LedgerTab({ data, local, updateLocal }) {
  const { entries } = local;
  const stocks = data.stocks;
  const [form, setForm] = useState({ type: "hold", ticker: "", date: today(), shares: "", price: "", amount: "" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, setMsg] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const fileRef = useRef(null);

  const addEntry = () => {
    const t = form.ticker.trim().toUpperCase();
    if (!t) return setMsg("請填寫代號。");
    if (form.type !== "div" && (!(Number(form.shares) > 0) || !(Number(form.price) > 0)))
      return setMsg(form.type === "hold" ? "既有持股需要填股數和平均成本。" : "買進需要填股數和成交價。");
    if (form.type === "div" && !(Number(form.amount) > 0)) return setMsg("股利需要填入帳金額。");
    const e = {
      id: Date.now(),
      type: form.type,
      ticker: t,
      date: form.type === "hold" ? "" : form.date,
      shares: Number(form.shares) || 0,
      price: Number(form.price) || 0,
      amount: Number(form.amount) || 0,
    };
    updateLocal((s) => ({ entries: [...s.entries, e] }));
    setForm({ ...form, ticker: form.type === "div" ? form.ticker : "", shares: "", price: "", amount: "" });
    setMsg(stocks[t] ? "已記上一筆。" : `已記上一筆。${t} 還沒有行情資料，請把它加入追蹤清單。`);
  };

  /* holdings */
  const holdings = {};
  let received = 0;
  entries.forEach((e) => {
    if (e.type === "div") return (received += e.amount);
    const h = (holdings[e.ticker] ||= { shares: 0, cost: 0 });
    h.shares += e.shares;
    h.cost += e.shares * e.price;
  });

  let costTotal = 0, valueTotal = 0, valueKnownCost = 0, estAnnual = 0;
  const list = Object.entries(holdings).map(([t, h]) => {
    const d = stocks[t];
    const avg = h.cost / h.shares;
    const value = d?.price != null ? d.price * h.shares : null;
    const dps = latestFullYearDividend(d);
    const annual = dps != null ? dps * h.shares : null;
    costTotal += h.cost;
    if (value != null) {
      valueTotal += value;
      valueKnownCost += h.cost;
    }
    if (annual != null) estAnnual += annual;
    return {
      t, d, ...h, avg, value, annual,
      pnl: value != null ? value - h.cost : null,
      pnlPct: value != null ? ((value - h.cost) / h.cost) * 100 : null,
      yoc: dps != null ? (dps / avg) * 100 : null,
    };
  });
  const weightBase = list.reduce((a, x) => a + (x.value ?? x.cost), 0);
  list.forEach((x) => (x.weight = weightBase ? ((x.value ?? x.cost) / weightBase) * 100 : 0));
  list.sort((a, b) => b.weight - a.weight);
  const pnlTotal = valueKnownCost ? valueTotal - valueKnownCost : null;
  const missing = list.filter((x) => !x.d).map((x) => x.t);

  /* monthly cash flow & upcoming */
  const months = Array.from({ length: 12 }, (_, i) => ({ m: `${i + 1}月`, amount: 0 }));
  list.forEach((x) => (x.d?.ttmPayments || []).forEach((p) => (months[p.month - 1].amount += p.cash * x.shares)));
  const emptyMonths = months.filter((m) => m.amount === 0).map((m) => m.m);
  const upcoming = list
    .flatMap((x) => (x.d?.upcoming || []).map((u) => ({ ...u, t: x.t, total: u.cash != null ? u.cash * x.shares : null })))
    .sort((a, b) => a.exDate.localeCompare(b.exDate));

  /* observations */
  const notes = [];
  const withData = list.filter((x) => x.d);
  if (list.length > 1 && list[0].weight > 50)
    notes.push(`${list[0].t} 約占整體 ${fmt(list[0].weight)}%，資產集中在單一標的，它的漲跌會大幅影響整體表現。`);
  if (withData.length && emptyMonths.length && emptyMonths.length < 12) notes.push(`依近一年的配息紀錄，${emptyMonths.join("、")} 沒有股利入帳。`);
  withData.forEach((x) => {
    if (x.d.events?.[0]?.fillStatus === "open") notes.push(`${x.t} 最近一次除息還沒填息。`);
    if (x.pnlPct != null && x.pnlPct < -15) notes.push(`${x.t} 目前帳面虧損約 ${fmt(Math.abs(x.pnlPct), 1)}%。`);
  });

  /* backup */
  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(local, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `存股存摺備份-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setBackupMsg("已下載備份檔。");
  };
  const importBackup = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.entries)) throw new Error();
      updateLocal({ ...DEFAULT_LOCAL, ...parsed });
      setBackupMsg(`已還原 ${parsed.entries.length} 筆紀錄。`);
    } catch {
      setBackupMsg("這個檔案不是存股存摺的備份檔，沒有變更任何資料。");
    }
    ev.target.value = "";
  };

  const sorted = [...entries].sort((a, b) => ((b.date || "0000") + b.id).localeCompare((a.date || "0000") + a.id));
  const typeLabel = { hold: "既有持股", buy: "買進", div: "領股利" };

  return (
    <>
      <Sheet>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 8px" }}>
          <Stat big label="投入成本" value={fmt(costTotal)} />
          <Stat big label="目前市值" value={valueKnownCost ? fmt(valueTotal) : "—"} />
          <Stat big label="未實現損益" value={signed(pnlTotal)} color={pnlColor(pnlTotal)} />
          <Stat big label="已領股利" value={fmt(received)} />
          <Stat big label="預估年股利" value={fmt(estAnnual)} color={C.seal} />
          <Stat big label="平均每月" value={fmt(estAnnual / 12)} color={C.seal} />
        </div>
        {missing.length > 0 && <AddTickerHint tickers={missing} />}
      </Sheet>

      <Sheet>
        <H2>記一筆</H2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {Object.entries(typeLabel).map(([v, l]) => (
            <Btn key={v} kind={form.type === v ? "primary" : "ghost"} onClick={() => { setForm({ ...form, type: v }); setMsg(""); }}>
              {l}
            </Btn>
          ))}
        </div>
        {form.type === "hold" && (
          <p style={{ fontSize: 13, color: C.muted, margin: "0 0 12px", lineHeight: 1.6 }}>
            把已經持有的股票登錄進來。股數和平均成本可以在券商 App 的庫存頁面查到。
          </p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="代號">
            <input list="tickers" style={inputStyle} placeholder="例如 0056" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} />
            <datalist id="tickers">
              {data.tickers.map((t) => <option key={t} value={t}>{stocks[t]?.name}</option>)}
            </datalist>
          </Field>
          {form.type !== "hold" && (
            <Field label="日期">
              <input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
          )}
          {form.type !== "div" ? (
            <>
              <Field label="股數（零股照實填）">
                <input type="number" inputMode="numeric" style={inputStyle} value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} />
              </Field>
              <Field label={form.type === "hold" ? "平均成本（元）" : "成交價（元）"}>
                <input type="number" inputMode="decimal" step="0.01" style={inputStyle} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </Field>
            </>
          ) : (
            <Field label="入帳金額（元）">
              <input type="number" inputMode="numeric" style={inputStyle} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <Btn onClick={addEntry}>記上一筆</Btn>
          {msg && <span style={{ fontSize: 13, color: C.muted }}>{msg}</span>}
        </div>
      </Sheet>

      {upcoming.length > 0 && (
        <Sheet>
          <H2>即將入帳</H2>
          <Row head cols="0.8fr 1fr 1fr 1fr" cells={["代號", "除息日", "發放日", "預估金額"]} />
          {upcoming.map((u) => (
            <Row key={u.t + u.exDate} cols="0.8fr 1fr 1fr 1fr" cells={[u.t, shortDate(u.exDate), shortDate(u.payDate), u.total != null ? fmt(u.total) : "待公告"]} />
          ))}
          <Muted>依已公告的每股股利 × 目前股數估算，須在除息日前一天仍持有才領得到。</Muted>
        </Sheet>
      )}

      {list.map((x) => (
        <Sheet key={x.t}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontFamily: serif, fontSize: 22, fontWeight: 700 }}>{x.t}</span>
              {x.d?.name && <span style={{ marginLeft: 8, color: C.muted, fontSize: 15 }}>{x.d.name}</span>}
            </div>
            <span style={{ fontSize: 13, color: C.muted, fontVariantNumeric: "tabular-nums" }}>占比 {fmt(x.weight, 1)}%</span>
          </div>
          <div style={{ height: 4, background: C.rule, borderRadius: 2, margin: "8px 0 12px" }}>
            <div style={{ width: `${x.weight}%`, height: "100%", background: C.ink, borderRadius: 2 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 8px" }}>
            <Stat label="股數" value={fmt(x.shares)} />
            <Stat label="平均成本" value={fmt(x.avg, 2)} />
            <Stat label="現價" value={x.d ? fmt(x.d.price, 2) : "—"} />
            <Stat label="市值" value={fmt(x.value)} />
            <Stat label="損益" value={signed(x.pnl)} color={pnlColor(x.pnl)} />
            <Stat label="報酬率" value={x.pnlPct != null ? `${signed(x.pnlPct, 1)}%` : "—"} color={pnlColor(x.pnlPct)} />
            <Stat label="成本殖利率" value={x.yoc != null ? `${fmt(x.yoc, 2)}%` : "—"} />
            <Stat label="現價殖利率" value={x.d?.yield != null ? `${fmt(x.d.yield, 2)}%` : "—"} />
            <Stat label="預估年股利" value={fmt(x.annual)} color={C.seal} />
          </div>
        </Sheet>
      ))}

      {withData.length > 0 && (
        <Sheet>
          <H2>整體分析</H2>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 2 }}>每月股利入帳預估（元）</div>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 8, right: 0, left: -12, bottom: 0 }}>
                <XAxis dataKey="m" tick={{ fontSize: 10, fill: C.muted }} stroke={C.rule} interval={0} />
                <YAxis tick={{ fontSize: 10, fill: C.muted }} stroke={C.rule} width={44} />
                <Tooltip formatter={(v) => [`${fmt(v)} 元`, "預估股利"]} />
                <Bar dataKey="amount" fill={C.seal} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 13, color: C.muted, margin: "16px 0 6px" }}>值得留意的地方</div>
          {notes.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
              {notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: 14 }}>依目前資料，沒有明顯的集中、空窗月或未填息情況。</p>
          )}
          <Muted>預估值依近一年實際配息紀錄與目前股數計算，未來配息可能不同，不構成投資建議。</Muted>
        </Sheet>
      )}

      <Sheet>
        <H2>存摺明細</H2>
        {sorted.length === 0 ? (
          <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>還沒有紀錄。已經有股票的話，先用「既有持股」登錄。</p>
        ) : (
          <>
            <Row head cols="1fr 1.2fr 1fr 32px" cells={["日期", "摘要", "金額", ""]} />
            {sorted.map((e) => (
              <div
                key={e.id}
                style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr 32px", gap: 6, padding: "8px 0", borderBottom: `1px solid ${C.rule}`, fontSize: 14, fontVariantNumeric: "tabular-nums", alignItems: "center" }}
              >
                <div style={{ color: C.muted }}>{e.date ? shortDate(e.date) : "既有"}</div>
                <div>{e.type === "div" ? `${e.ticker} 股利` : `${e.type === "hold" ? "持有" : "買"} ${e.ticker} ${fmt(e.shares)} 股`}</div>
                <div style={{ textAlign: "right", color: e.type === "div" ? C.seal : C.ink }}>
                  {e.type === "div" ? `+${fmt(e.amount)}` : `-${fmt(e.shares * e.price)}`}
                </div>
                <button
                  aria-label="刪除這筆"
                  onClick={() => updateLocal((s) => ({ entries: s.entries.filter((x) => x.id !== e.id) }))}
                  style={{ border: "none", background: "none", color: C.muted, fontSize: 18, cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </Sheet>

      <Sheet>
        <H2>備份與換裝置</H2>
        <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.6 }}>
          持股紀錄只存在這台裝置的瀏覽器裡。定期下載備份，換手機或電腦時再還原。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn kind="ghost" onClick={exportBackup}>下載備份</Btn>
          <Btn kind="ghost" onClick={() => fileRef.current?.click()}>從備份還原</Btn>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importBackup} style={{ display: "none" }} />
        </div>
        {backupMsg && <Muted>{backupMsg}</Muted>}
      </Sheet>

      <div style={{ textAlign: "center", margin: "8px 0 20px" }}>
        {confirmReset ? (
          <span style={{ fontSize: 14 }}>
            確定清除這台裝置上的所有紀錄？
            <Btn kind="quiet" style={{ color: C.seal }} onClick={() => { updateLocal(DEFAULT_LOCAL); setConfirmReset(false); }}>清除</Btn>
            <Btn kind="quiet" onClick={() => setConfirmReset(false)}>取消</Btn>
          </span>
        ) : (
          <Btn kind="quiet" onClick={() => setConfirmReset(true)}>清除所有紀錄</Btn>
        )}
      </div>
    </>
  );
}

/* ---------- app ---------- */

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...DEFAULT_LOCAL, ...JSON.parse(raw) } : DEFAULT_LOCAL;
  } catch {
    return DEFAULT_LOCAL;
  }
}

export default function App() {
  const [local, setLocal] = useState(loadLocal);
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [tab, setTab] = useState(() => (loadLocal().entries.length ? "ledger" : "watch"));

  useEffect(() => {
    fetch(`./data/stocks.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setLoadErr(true));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(local));
    } catch {
      /* 私密瀏覽模式可能無法寫入 */
    }
  }, [local]);

  const updateLocal = (patch) => setLocal((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
  const tabs = [["watch", "追蹤清單"], ["ledger", "我的存摺"], ["sim", "定期定額試算"]];
  const empty = data && !data.updatedAt;

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: sans, color: C.ink }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 14px 12px" }}>
        <header style={{ marginBottom: 14 }}>
          <h1 style={{ fontFamily: serif, fontSize: 26, margin: 0, fontWeight: 700, letterSpacing: "0.04em" }}>存股存摺</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: C.muted }}>試算、比較、記帳，專心長期領股利。</p>
        </header>

        <nav style={{ display: "flex", borderBottom: `2px solid ${C.ink}`, marginBottom: 16 }}>
          {tabs.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              style={{
                flex: 1,
                padding: "10px 4px",
                border: "none",
                background: tab === k ? C.ink : "transparent",
                color: tab === k ? "#fff" : C.ink,
                fontSize: 15,
                fontFamily: sans,
                cursor: "pointer",
                borderRadius: "4px 4px 0 0",
              }}
            >
              {l}
            </button>
          ))}
        </nav>

        {tab === "sim" && <SimTab sim={local.sim} setSim={(sim) => updateLocal({ sim })} />}
        {tab !== "sim" && loadErr && (
          <Sheet><p style={{ margin: 0 }}>讀不到行情資料檔（data/stocks.json）。請確認 GitHub Actions 已經成功執行過一次。</p></Sheet>
        )}
        {tab !== "sim" && !data && !loadErr && <p style={{ color: C.muted }}>讀取資料中…</p>}
        {tab !== "sim" && empty && (
          <Sheet>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              行情資料還沒產生。到 GitHub 專案的 Actions 頁面，手動執行一次「更新資料並部署」，約 3 分鐘後重新整理這頁。
            </p>
          </Sheet>
        )}
        {tab === "watch" && data && !empty && <WatchTab data={data} />}
        {tab === "ledger" && data && <LedgerTab data={data} local={local} updateLocal={updateLocal} />}

        <p style={{ fontSize: 11, color: C.muted, textAlign: "center", lineHeight: 1.6, margin: "4px 0 24px" }}>
          資料來源：臺灣證券交易所，依
          <a href="https://data.gov.tw/license" target="_blank" rel="noreferrer" style={{ color: C.muted }}>
            政府資料開放授權條款－第 1 版
          </a>
          利用，經 FinMind 與證交所 OpenAPI 取得。殖利率、填息天數等為本站依原始資料計算的結果。本工具僅供整理與學習，不構成投資建議。
        </p>
      </div>
    </div>
  );
}

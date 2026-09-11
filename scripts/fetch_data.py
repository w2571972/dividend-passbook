#!/usr/bin/env python3
"""
抓取 watchlist.json 內每個標的的股價與股利資料，計算存股常用指標，
輸出到 public/data/stocks.json 給網頁讀取。

資料來源：
  - FinMind（股價、除權除息結果、股利政策、股票分割）
  - 證交所 OpenAPI（上市個股本益比、股價淨值比，抓不到就略過）

在 GitHub Actions 上每天自動執行；本機測試可在專案根目錄的 .env 寫入
  FINMIND_TOKEN=你的token
再執行 python scripts/fetch_data.py
"""
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

ROOT = Path(__file__).resolve().parent.parent
WATCHLIST = ROOT / "watchlist.json"
OUT = ROOT / "public" / "data" / "stocks.json"
FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
TWSE_VALUATION_URL = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"
try:
    TZ = ZoneInfo("Asia/Taipei")
except ZoneInfoNotFoundError:  # Windows 沒裝 tzdata 時；台灣無日光節約時間，固定 UTC+8 即可
    TZ = timezone(timedelta(hours=8))
TODAY = datetime.now(TZ).date()


def load_dotenv(path=ROOT / ".env"):
    """讀取專案根目錄的 .env（本機用）；已存在的環境變數優先，不會被覆蓋。"""
    if not path.exists():
        return
    for line in path.read_text("utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip('"').strip("'")
        if key and not os.environ.get(key):
            os.environ[key] = value


load_dotenv()
session = requests.Session()
_token = os.environ.get("FINMIND_TOKEN", "").strip()
if _token:
    session.headers["Authorization"] = f"Bearer {_token}"


# ---------- helpers ----------

def num(v):
    """把字串或數字轉成 float，空值或無法轉換時回傳 None。"""
    if v is None:
        return None
    try:
        s = str(v).replace(",", "").strip()
        return float(s) if s not in ("", "-", "--") else None
    except ValueError:
        return None


def to_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def r2(v, digits=2):
    return None if v is None else round(v, digits)


def split_ratio(before, after):
    """分割換算比例 after/before；接近簡單分數時取整（0050 的 188.65→47.16 取 1/4）。"""
    raw = after / before
    simple = float(Fraction(raw).limit_denominator(10))
    return simple if abs(simple / raw - 1) < 0.01 else raw


def finmind(dataset, **params):
    last_err = ""
    for attempt in range(3):
        try:
            resp = session.get(FINMIND_URL, params={"dataset": dataset, **params}, timeout=40)
            body = resp.json()
            if resp.status_code == 200 and body.get("status") == 200:
                return body.get("data", [])
            last_err = body.get("msg") or f"HTTP {resp.status_code}"
        except Exception as e:  # 網路錯誤、JSON 解析錯誤
            last_err = str(e)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{dataset} {params.get('data_id', '')} 失敗：{last_err}")


def twse_valuation():
    try:
        rows = requests.get(TWSE_VALUATION_URL, timeout=30).json()
        return {
            row.get("Code"): {"pe": num(row.get("PEratio")), "pb": num(row.get("PBratio"))}
            for row in rows
            if row.get("Code")
        }
    except Exception as e:
        print(f"  略過證交所本益比資料：{e}")
        return {}


# ---------- core calculation (pure function, easy to test) ----------

def build_stock(ticker, name, prices, results, policies, splits, valuation=None, today=TODAY):
    # 股票分割：分割日之前的價格與股利乘上 after/before 比例，才能和現在比較
    split_events = [
        (to_date(s["date"]), split_ratio(num(s["before_price"]), num(s["after_price"])))
        for s in splits
        if num(s.get("before_price")) and num(s.get("after_price")) and to_date(s.get("date"))
    ]

    def factor(day):
        f = 1.0
        for split_day, ratio in split_events:
            if day < split_day:
                f *= ratio
        return f

    closes = sorted(
        (to_date(p["date"]), num(p["close"]) * factor(to_date(p["date"])))
        for p in prices
        if num(p.get("close")) and to_date(p.get("date"))
    )
    if not closes:
        raise ValueError("查無股價資料，請確認代號是否正確")
    price_date, price = closes[-1]

    # 股利政策表：以除息日對應，取得現金股利與發放日。
    # 同一除息日可能有多筆（先公告日期、後補金額），依公告順序以較新的非空值為準；
    # 金額為 0 代表尚未公告（或資料源缺漏），此時仍保留發放日。
    policy_by_ex = {}
    for p in sorted(policies, key=lambda x: x.get("date", "")):
        ex = to_date(p.get("CashExDividendTradingDate"))
        if not ex:
            continue
        cash = (num(p.get("CashEarningsDistribution")) or 0) + (num(p.get("CashStatutorySurplus")) or 0)
        pay = to_date(p.get("CashDividendPaymentDate"))
        entry = policy_by_ex.setdefault(ex, {"cash": None, "pay": None})
        if cash > 0:
            entry["cash"] = cash
        if pay:
            entry["pay"] = pay

    def fill_status(ex, before):
        if closes[0][0] > ex:
            return None, "unknown"
        after = [c for d, c in closes if d >= ex]
        for i, c in enumerate(after):
            if c >= before - 1e-9:
                return i + 1, "filled"
        return None, "open"

    events, seen = [], set()
    for r in sorted(results, key=lambda x: x.get("date", "")):
        ex = to_date(r.get("date"))
        if not ex or ex in seen:
            continue
        kind = str(r.get("stock_or_cache_dividend", ""))
        pol = policy_by_ex.get(ex)
        if pol and pol["cash"]:
            cash = pol["cash"]
        elif "息" in kind and "權" not in kind:
            cash = num(r.get("stock_and_cache_dividend"))
        else:
            cash = None  # 純除權或無法判斷現金部分
        before = num(r.get("before_price"))
        if not cash or not before:
            continue
        seen.add(ex)
        f = factor(ex)
        pay = pol["pay"] if pol and pol["pay"] else None
        days, status = fill_status(ex, before * f)
        events.append({
            "exDate": ex.isoformat(),
            "cash": r2(cash * f, 4),
            "beforePrice": r2(before * f),
            "payDate": (pay or ex + timedelta(days=28)).isoformat(),
            "payEstimated": pay is None,
            "fillDays": days,
            "fillStatus": status,
        })

    # 已公告、尚未除息（cash 為 None 代表除息日已公告、金額尚未公告）
    upcoming = [
        {
            "exDate": ex.isoformat(),
            "cash": r2(v["cash"], 4) if v["cash"] else None,
            "payDate": v["pay"].isoformat() if v["pay"] else None,
        }
        for ex, v in sorted(policy_by_ex.items())
        if ex > today and ex.isoformat() not in {e["exDate"] for e in events}
    ]

    by_year = defaultdict(float)
    for e in events:
        by_year[int(e["exDate"][:4])] += e["cash"]
    years = list(range(today.year - 5, today.year + 1))
    dividends_by_year = [{"year": y, "amount": r2(by_year.get(y, 0), 4)} for y in years]

    one_year_ago = today - timedelta(days=365)
    ttm = [e for e in events if to_date(e["exDate"]) > one_year_ago]
    ttm_total = sum(e["cash"] for e in ttm)
    n = len(ttm)
    frequency = (
        "月配" if n >= 10 else "季配" if n >= 3 else "半年配" if n == 2 else "年配" if n == 1 else "近一年未配息"
    )

    past = [c for d, c in closes if d <= one_year_ago]
    change_1y = (price / past[-1] - 1) * 100 if past else None

    filled = [e["fillDays"] for e in events[-6:] if e["fillStatus"] == "filled"]
    recent = [(d, c) for d, c in closes if d > one_year_ago]
    sampled = recent[::5] + ([recent[-1]] if recent and (len(recent) - 1) % 5 else [])

    val = (valuation or {}).get(ticker, {})
    return {
        "ticker": ticker,
        "name": name or ticker,
        "price": r2(price),
        "priceDate": price_date.isoformat(),
        "change1y": r2(change_1y, 1),
        "ttmDividend": r2(ttm_total, 4),
        "yield": r2(ttm_total / price * 100) if price else None,
        "frequency": frequency,
        "dividendsByYear": dividends_by_year,
        "events": events[-8:][::-1],
        "upcoming": upcoming,
        "ttmPayments": [{"month": int(e["payDate"][5:7]), "cash": e["cash"]} for e in ttm],
        "avgFillDays": r2(sum(filled) / len(filled), 1) if filled else None,
        "prices": [{"d": d.isoformat(), "c": r2(c)} for d, c in sampled],
        "pe": val.get("pe"),
        "pb": val.get("pb"),
    }


# ---------- main ----------

def main():
    tickers = [str(t).strip().upper() for t in json.loads(WATCHLIST.read_text("utf-8")).get("tickers", []) if str(t).strip()]
    if not tickers:
        sys.exit("watchlist.json 裡沒有任何代號")
    if not _token:
        print("提醒：沒有設定 FINMIND_TOKEN，會用較低的免費額度，可能被限制。")

    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text("utf-8")).get("stocks", {})
        except json.JSONDecodeError:
            pass

    # 股價要和股利涵蓋同一段期間，較早的除息事件才算得出填息天數
    div_start = (TODAY - timedelta(days=365 * 7)).isoformat()
    price_start = div_start

    try:
        names = {row["stock_id"]: row["stock_name"] for row in finmind("TaiwanStockInfo")}
    except RuntimeError as e:
        print(f"  略過名稱資料：{e}")
        names = {}
    try:
        all_splits = finmind("TaiwanStockSplitPrice")
    except RuntimeError as e:
        print(f"  略過分割資料：{e}")
        all_splits = []
    valuation = twse_valuation()

    stocks, errors = {}, {}
    for t in tickers:
        print(f"處理 {t} …")
        try:
            prices = finmind("TaiwanStockPrice", data_id=t, start_date=price_start)
            results = finmind("TaiwanStockDividendResult", data_id=t, start_date=div_start)
            try:
                policies = finmind("TaiwanStockDividend", data_id=t, start_date=div_start)
            except RuntimeError:
                policies = []
            splits = [s for s in all_splits if s.get("stock_id") == t]
            stocks[t] = build_stock(t, names.get(t), prices, results, policies, splits, valuation)
            s = stocks[t]
            print(f"  {s['name']} 股價 {s['price']}，近一年股利 {s['ttmDividend']}，殖利率 {s['yield']}%")
        except Exception as e:
            errors[t] = str(e)
            print(f"  失敗：{e}")
            if t in old:
                stocks[t] = {**old[t], "stale": True}
        time.sleep(0.5)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "updatedAt": datetime.now(TZ).isoformat(timespec="minutes"),
                "tickers": tickers,
                "stocks": stocks,
                "errors": errors,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "utf-8",
    )
    print(f"完成：{len(stocks) - len(errors)} 檔成功，{len(errors)} 檔失敗 → {OUT.relative_to(ROOT)}")
    if len(errors) == len(tickers):
        sys.exit(1)


if __name__ == "__main__":
    main()

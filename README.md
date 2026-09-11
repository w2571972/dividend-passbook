# 存股存摺

每個交易日傍晚自動抓取股價與股利資料、計算殖利率與填息天數，並提供持股記帳與定期定額試算的個人網頁。全部使用免費服務，不需要自己的伺服器，也不會用到 AI token。

## 運作方式

1. GitHub Actions 每個交易日台灣時間 18:30 執行 `scripts/fetch_data.py`。
2. 程式從 FinMind 與證交所 OpenAPI 抓資料，算好指標後存成 `public/data/stocks.json`。
3. 接著建置網頁並發布到 GitHub Pages。
4. 你的持股紀錄只存在自己的瀏覽器裡，不會上傳到 GitHub。

## 第一次設定（約 15 分鐘）

### 1. 申請 FinMind token

到 [FinMind](https://finmindtrade.com/) 註冊帳號並完成信箱驗證，登入後在會員頁面複製你的 API token。沒有 token 也能執行，但免費額度較低，容易被限制。

### 2. 建立 GitHub 儲存庫

1. 登入 GitHub，右上角「+」選「New repository」。
2. 名稱可取 `dividend-passbook`，選 **Public**（免費帳號的 GitHub Pages 需要公開儲存庫；公開的只有程式和行情資料，你的持股不會出現在上面）。
3. 按「Create repository」。

### 3. 上傳檔案

1. 解壓縮下載的 zip。
2. 在剛建立的儲存庫頁面點「uploading an existing file」。
3. 把資料夾**裡面的所有內容**拖進去，按「Commit changes」。

> **注意 `.github` 資料夾**：它是隱藏資料夾，Mac 的 Finder 預設看不到。請在 Finder 按 `Command + Shift + .` 顯示隱藏檔後再拖曳。
> 上傳後確認儲存庫裡有 `.github/workflows/update-and-deploy.yml`。如果沒有，點「Add file → Create new file」，檔名輸入 `.github/workflows/update-and-deploy.yml`，再把檔案內容貼上。

### 4. 設定 token

1. 儲存庫的「Settings → Secrets and variables → Actions」。
2. 按「New repository secret」。
3. Name 填 `FINMIND_TOKEN`，Secret 貼上步驟 1 的 token，按「Add secret」。

### 5. 開啟 GitHub Pages

「Settings → Pages」，Source 選「**GitHub Actions**」。

### 6. 第一次執行

1. 到「Actions」分頁。如果看到提示，按綠色按鈕啟用 workflows。
2. 左側選「更新資料並部署」，右邊按「Run workflow」。
3. 大約 3 到 5 分鐘後出現綠色勾勾，就完成了。

你的網址是：`https://你的帳號.github.io/儲存庫名稱/`

手機用瀏覽器打開後，選「加入主畫面」，用起來就像 App。

## 日常使用

**追蹤新股票**：在 GitHub 上打開 `watchlist.json`，按鉛筆圖示編輯，加入代號後按「Commit changes」。幾分鐘後網站會自動更新。

```json
{
  "tickers": ["0056", "00878", "00919", "0050", "2412"]
}
```

**換手機或電腦**：在「我的存摺」最下方按「下載備份」，到新裝置打開網站後按「從備份還原」。瀏覽器清除網站資料時紀錄也會消失，建議定期備份。

## 常見問題

**Actions 出現紅色叉叉**：點進去看紅色的步驟，錯誤訊息會寫在裡面。常見原因包括 token 沒設定或打錯、FinMind 額度用完（隔一段時間再試）、代號打錯。

**「把新資料存回儲存庫」步驟失敗**：到「Settings → Actions → General」，最下方的 Workflow permissions 選「Read and write permissions」後存檔，再重新執行。

**網站打開是 404**：第一次部署後可能要等幾分鐘，也請確認步驟 5 的 Source 是「GitHub Actions」。

**收到排程被停用的通知**：GitHub 會停用長時間沒有活動的儲存庫排程，到 Actions 頁面重新啟用即可。

## 在自己電腦上修改

需要先安裝 [Node.js](https://nodejs.org/)（20 版以上）與 Python 3。

```bash
npm install
npm run dev                     # 開發模式，瀏覽器打開顯示的網址
python scripts/fetch_data.py    # 手動更新資料
```

手動更新資料前，先在專案根目錄建立 `.env`，內容寫一行 `FINMIND_TOKEN=你的token`。`.env` 已列在 `.gitignore`，不會被推上 GitHub。

## 資料與計算說明

- **殖利率**：近 365 天除息的現金股利合計 ÷ 最新收盤價。
- **填息天數**：從除息日起算，收盤價第一次回到除息前收盤價的交易日數；除息當天就填息記為 1 天。
- **發放月份**：優先使用公告的發放日；查不到時以除息日後約 4 週估算，網頁上標示「（估）」。
- **股票分割**：分割前的股價與股利會依比例換算（例如 0050 在 2025 年 6 月的 1 拆 4），前後才能比較。
- **本益比、股價淨值比**：只有上市個股有，ETF 不適用。

資料來源：FinMind、臺灣證券交易所 OpenAPI。本工具僅供整理與學習，不構成投資建議。資料可能延遲或有誤，交易前請以證交所及發行公司公告為準。

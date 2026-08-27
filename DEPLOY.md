[DEPLOY_1.md](https://github.com/user-attachments/files/31519157/DEPLOY_1.md)
# 部署說明

這次更新了三個檔案：

- `index.html` — 儀表板本體，換掉即可（部署到 GitHub Pages 的那個檔案）
- `worker.js` — Cloudflare Worker 股價代理，要另外部署到 Cloudflare（不是丟進 GitHub repo 就好，但建議也一起 commit 進 repo 方便版本控管）
- `DEPLOY.md` — 這份說明

三個步驟都要做，網站才會是完整可動的狀態：**改密碼 → 部署 Worker → 更新 WORKER_BASE**。

---

## 1. 設定你的密碼（部署前一定要做）

`index.html` 裡目前的密碼是暫時的 `change-me-now`，只是讓你測試登入流程用，**上線前務必更換**。

密碼在程式碼裡是用 SHA-256 雜湊值存的，不是明文，所以雜湊值本身可以放心 commit 到 public repo；但你要自己算出新密碼的雜湊值：

1. 用瀏覽器打開你目前的 `index.html`（本機開啟或先部署上去都可以）
2. 按 `F12` 打開開發者工具，切到 **Console**
3. 貼上並執行（把 `你的新密碼` 換成你要的密碼）：
   ```js
   await __hashPassword('你的新密碼')
   ```
4. 主控台會印出一串 64 碼的雜湊值，複製它
5. 打開 `index.html`，找到這一行（在 `<script>` 區塊開頭附近）：
   ```js
   const PASSWORD_HASH = 'ccc0b903bce51fb554262d742d0a282e1f8a87d064f1cf44f8ff5148ca4beb42';
   ```
   把單引號裡的內容換成你剛剛複製的雜湊值
6. 存檔、commit、push

**這個密碼保護的真實強度**：這是「檔案沒有被拿掉 → 就不會直接顯示資料」等級的保護，適合擋掉不小心點到連結的人，或防止搜尋引擎收錄到你的實際數字。它擋不住真的想拿到你資料的人 —— 因為 repo 是 public 的，`PASSWORD_HASH` 本身也是公開的，理論上可以被離線暴力破解（尤其密碼太短/太常見的話）。這次同時把所有原本寫死在網頁原始碼裡的真實金額（資產、貸款本金、里程碑數字）都改成從 `localStorage` 讀取，預設值全部歸零 —— 所以就算密碼被繞過，光看網頁原始碼或直接抓 GitHub 上的檔案，也不會看到任何一筆真實數字，只有在你自己瀏覽器輸入密碼、資料存進 localStorage 之後才看得到。如果想要更高強度的保護，長期最乾淨的做法是把這個 repo 設為 **private**（GitHub Pro 或 Team 才能對 private repo 開 Pages；或改用 Cloudflare Pages + Access 這類有身份驗證的方案）。

---

## 2. 部署 Cloudflare Worker（解決股價抓取被擋的問題）

原本用 allorigins 代理會被擋，根本原因是 GitHub Pages 是純靜態網站，瀏覽器沒辦法直接呼叫 Yahoo Finance（跨網域限制），只能透過一個「代理伺服器」轉一手，而公開代理本身不穩定、常被限流或直接掛掉。

解法是自己架一個輕量代理，免費、穩定、只服務你自己的網站：

1. 前往 https://dash.cloudflare.com/ 註冊 / 登入（免費帳號即可）
2. 左側選單找到 **Workers & Pages** → 按 **Create** → **Create Worker**
3. 幫 Worker 取個名字（例如 `josh-dashboard-quote`），建立後會進到線上編輯器
4. 把編輯器裡預設的程式碼**整個刪掉**，貼上這次附的 `worker.js` 全部內容
5. 確認檔案裡這一行是你自己的 GitHub Pages 網址：
   ```js
   const ALLOWED_ORIGIN = 'https://joshyen0716.github.io';
   ```
6. 按右上角 **Deploy**
7. 部署完成後，Cloudflare 會給你一個網址，格式類似：
   ```
   https://josh-dashboard-quote.你的帳號.workers.dev
   ```
   複製這個網址（不要複製到結尾的斜線）

### 測試 Worker 是否正常

部署完可以直接在瀏覽器打開這個網址測試（把 `<你的worker網址>` 換掉）：

```
https://<你的worker網址>/quote?symbol=QQQ
```

應該會看到類似這樣的 JSON：

```json
{"symbol":"QQQ","price":512.34,"prevClose":508.1,"currency":"USD","time":1735432800}
```

如果看到 `{"error":"symbol not allowed"}`，代表白名單擋到了，檢查一下網址帶的 `symbol` 有沒有跟 `worker.js` 裡 `ALLOWED_SYMBOLS` 白名單的四個代碼一致（`0050.TW`、`^GSPC`、`QQQ`、`TWD=X`，注意大小寫跟符號）。

---

## 3. 把 Worker 網址接回儀表板

打開 `index.html`，找到這一行：

```js
const WORKER_BASE = 'https://YOUR-WORKER-SUBDOMAIN.workers.dev';
```

換成你在步驟 2 拿到的網址，例如：

```js
const WORKER_BASE = 'https://josh-dashboard-quote.你的帳號.workers.dev';
```

存檔、commit、push 到 `joshyen0716/Dashboard`，GitHub Pages 會在幾十秒到幾分鐘內自動更新。

### 沒有馬上設定 Worker 也不會壞掉

如果你想先上線密碼保護跟資產功能、Worker 晚點再弄，也沒關係：`WORKER_BASE` 保持預設值時，程式會自動略過 Worker，改走備援的公開代理（corsproxy.io → allorigins），跟你原本的行為一樣不穩，但至少不會噴錯。畫面上的狀態文字會顯示「即時數據（尚未設定 Worker，走備援代理）」提醒你還沒接上。

---

## 這次同時做的其他修正

- **股價抓取更耐用**：改成 Worker → corsproxy.io → allorigins 三層備援，任何一層失敗會自動換下一個；四支報價（0050、S&P500、QQQ、匯率）各自獨立抓取，其中一支失敗不會拖累其他三支；全部失敗時會顯示 localStorage 裡最後一次成功抓到的報價，並標示「X 分鐘前的快取」，不會整排直接消失變成 `—`。
- **資產持股改成可自訂清單**：不再只有「美股/台股/現金」三個死欄位，可以自己新增/刪除每一筆帳戶或個股，選分類、填金額，畫面即時算出佔總資產的百分比，存檔後圖表（資產配置圓餅圖、持股佔比長條圖）會一併更新。舊資料（原本 localStorage 裡的三欄位格式）第一次打開會自動搬遷成新格式，不會遺失。
- **負債、里程碑、個人設定也都改成可編輯**：貸款本金/月付金/期數/利率、資產里程碑（幾年幾月達成多少錢）、目標金額、出生年、目標退休年齡，全部從網頁上直接編輯、存在 localStorage，原始碼裡不再寫死任何一筆真實金額。
- **圖表不會拖垮整頁**：如果 Chart.js 的 CDN 一時載入失敗，現在只有圖表區塊會跳過，其餘資料編輯、KPI、里程碑都還是能正常顯示跟操作，不會整頁空白。

## 已知限制（沒有動，但你應該知道）

- 資料只存在你目前這台裝置、這個瀏覽器的 localStorage，換裝置或換瀏覽器不會同步，清瀏覽器資料也會一併清掉這些數字。如果之後想要多裝置同步，會需要一個真正的後端（例如 Cloudflare Worker + KV/D1，或是一個小資料庫），這是比較大的架構改動，之後有需要再說。
- 密碼保護是前端等級的保護，細節跟強度說明見上面第 1 節。
- 年度報酬率（2021–2025 那幾條長條）目前還是寫在程式碼裡的固定數字，這次沒有把它改成可編輯 —— 如果你也想要這塊變成可以自己輸入，之後可以再加。

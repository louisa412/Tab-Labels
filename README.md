# Tab Labels

Tab Labels 是一個小型 Chrome Extension，讓你替目前作用中的 Chrome 分頁設定工作用自訂名稱，例如 `Kizamu｜Codex`、`Luisa Inbox｜Claude` 或 `Life Lab 官網｜Vercel`。

名稱以 `tabId` 綁定，只存在於目前的分頁工作階段，不會因為網址相同而套用到其他分頁，也不會在 Chrome 重啟後要求還原上一個工作階段的名稱。

## 功能

- 查看目前分頁的網站原始標題。
- 設定、修改或清除目前分頁的自訂名稱。
- 儲存後立即更新分頁標題。
- 網站重新整理或動態修改 `<title>` 時，盡量維持自訂名稱。
- 恢復原名時停止維持機制，優先使用最近觀察到的網站標題；沒有時回退至第一次命名時保存的標題。
- Enter 可直接儲存，並提供「清除」輸入操作。
- `Command+Shift+L`（macOS）或 `Ctrl+Shift+L`（Windows/Linux）可開啟 popup。
- 支援淺色與深色系統模式、鍵盤操作、focus 狀態與受保護頁面的清楚錯誤提示。

## 安裝方式

1. 打開 `chrome://extensions`。
2. 開啟右上角的「開發人員模式」。
3. 點擊「載入未封裝項目」。
4. 選取本專案資料夾。

載入後可將 Tab Labels 固定在 Chrome 工具列，方便每天使用。

## 使用方式

1. 打開一般的 `http://` 或 `https://` 網站。
2. 點擊工具列上的 Tab Labels，或使用快捷鍵。
3. 輸入自訂名稱，例如 `HTMLnotes｜Xcode Cloud`。
4. 點擊「儲存名稱」，或在輸入框按 Enter。
5. 要取消時，點擊「恢復原名」。

名稱只套用於目前這個分頁；兩個相同網站的分頁可以各自使用不同名稱。

## 權限說明

Manifest 實際使用的 permissions 只有：

- `activeTab`：只有在使用者開啟 Extension popup 或使用快捷鍵時，取得目前分頁的暫時存取權，以便讀取標題並對目前分頁注入標題維持程式。
- `scripting`：執行只處理 `document.title` 的小型注入函式，包含設定、觀察與恢復標題。
- `storage`：使用 `chrome.storage.session` 保存 `tabId` 對應的名稱與原始標題。

沒有使用 `tabs`、`host_permissions` 或 `optional_host_permissions`。`tabs` API 仍可查詢目前分頁的基本資訊；`activeTab` 會在使用者明確操作 Extension 時提供目前分頁所需的暫時存取權。

因此，安裝時不會因為本 Extension 申請 `<all_urls>` 而顯示「讀取及變更你在所有網站上的資料」的全站權限警告。Chrome 的 Extension 管理頁仍可能顯示一般的 Extension 資訊，實際文案以 Chrome 版本為準。

## 隱私說明

- Extension 只讀取目前分頁的 `document.title`、分頁 URL 與 Chrome 提供的分頁標題欄位。
- 不讀取、不保存也不傳送網頁正文、表單內容、密碼、Cookie 或其他頁面資料。
- 不使用 analytics、telemetry、帳號、雲端同步或遠端後端。
- 不發出任何網路請求。
- 不載入遠端 script、第三方 CDN 或外部套件。
- `chrome.storage.session` 只保存目前 Extension/瀏覽器工作階段中的 `tabId`、自訂名稱與原始標題；關閉分頁時會移除該筆資料，瀏覽器或 Extension 重啟時 session storage 會清空。

## 已知限制

- Chrome 不允許注入 script 的頁面（例如 `chrome://`、Chrome Web Store、Extension 內部頁面）無法修改；popup 會顯示「Chrome 不允許 Extension 修改此頁面的分頁名稱。」。
- `activeTab` 的權限是暫時的。若同一個分頁跨到另一個不同網站來源，Chrome 可能撤銷原本來源的暫時權限；此時重新開啟 Tab Labels popup，讓使用者再次明確操作後即可重試。相同網站的重新整理不需要重新設定名稱。
- 這是分頁工作階段模型，不是永久設定：Chrome/Extension 重啟後名稱不要求還原。
- 網站如果在非常特殊的時機反覆替換整個 `<head>`，恢復原名時可能只能回退到第一次命名時保存的標題。

## 測試重新整理、動態標題與恢復原名

可用下列簡單 HTML 測試頁，存成暫存檔後以一般網站方式開啟；若 Chrome 未允許檔案 URL，請改用本機簡易 HTTP server。

```html
<!doctype html>
<title>網站原名</title>
<button onclick="document.title = '網站動態新標題'">修改網站標題</button>
```

驗收步驟：

1. 載入 Extension 後開啟一般網站，設定 `Kizamu｜Codex`，確認分頁立即改名。
2. 重新整理，確認名稱自動回來。
3. 讓網站用 JavaScript 修改 `<title>`，確認自訂名稱仍維持。
4. 點擊「恢復原名」，確認不會再次被改回自訂名稱，並優先恢復最近的網站標題。
5. 開兩個相同網域的分頁，分別設定兩個名稱，確認互不干擾。
6. 關閉其中一個分頁後，可在 DevTools 的 Extension storage 確認不會持續累積該 `tabId`。

## 變更快捷鍵

快捷鍵由 Chrome 管理。若預設組合與其他快捷鍵衝突，請打開：

`chrome://extensions/shortcuts`

在 Tab Labels 旁自行設定新的按鍵組合。

## 驗證狀態

本專案可做 JSON、JavaScript syntax、manifest 引用檔案與原始碼隱私檢查。若目前環境沒有可自動啟動的 Chrome/Chromium，請依照上面的人工驗收步驟載入 unpacked extension；不要把靜態檢查視為瀏覽器 smoke test。

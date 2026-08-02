# Tab Labels

Tab Labels 是一個本機載入的 Manifest V3 Chrome Extension，讓你替目前作用中的 Chrome 分頁設定自訂顯示名稱。

它適合在同時處理多個 App 專案時使用，例如同時開啟多個 ChatGPT、GitHub、Vercel、App Store Connect 或其他工作分頁，快速辨識每個分頁的用途。

## 功能摘要

- 查看目前分頁的網站原始標題。
- 設定、修改或清除目前分頁的自訂名稱。
- 儲存後立即更新分頁標題。
- 網站重新整理或動態修改 `<title>` 時，盡量維持自訂名稱。
- 恢復原名時停止維持機制，優先使用最近觀察到的網站標題。
- 名稱以 `tabId` 綁定；相同網站的不同分頁可以使用不同名稱。
- Enter 可直接儲存，並提供清除輸入操作。
- macOS 預設快捷鍵：`Command+Shift+L`。
- Windows/Linux 預設快捷鍵：`Ctrl+Shift+L`。
- 支援淺色與深色系統模式、鍵盤操作、focus 狀態與受保護頁面的錯誤提示。

## Icon

正式 icon 位於 `icons/`：

- `icons/icon16.png`
- `icons/icon32.png`
- `icons/icon48.png`
- `icons/icon128.png`

16px、32px 與 48px 版本使用簡化的 TL 筆畫以維持小尺寸辨識度；128px 版本保留完整標誌比例。所有檔案都是透明背景 PNG，Manifest 的 `icons` 與 `action.default_icon` 都已正確引用。

若要替換 icon，請替換上述四個同名檔案並保持對應像素尺寸，接著在 `chrome://extensions` 點擊「重新載入」。Chrome Extension icon 使用 PNG；不要改成 SVG。

## 安裝方式：本機 unpacked Extension

你可以直接從 GitHub Release 取得本機載入用 ZIP：

1. 到 [GitHub Releases](https://github.com/louisa412/Tab-Labels/releases) 下載 `tab-labels-0.1.0.zip`。
2. 解壓縮 ZIP。
3. 打開 `chrome://extensions`。
4. 開啟右上角的「開發人員模式」。
5. 點擊「載入未封裝項目」／「Load unpacked」。
6. 選擇解壓縮後、第一層直接包含 `manifest.json` 的資料夾。

Chrome 不會直接安裝 ZIP；請務必先解壓縮，再載入包含 `manifest.json` 的資料夾。

如果使用本機專案資料夾測試，也可直接在 `chrome://extensions` 選取本專案根目錄。

## 使用方式

1. 打開一般的 `http://` 或 `https://` 網站。
2. 點擊工具列上的 Tab Labels，或使用快捷鍵。
3. 輸入自訂名稱，例如 `Kizamu｜Codex`、`Luisa Inbox｜Claude` 或 `Life Lab 官網｜Vercel`。
4. 點擊「儲存名稱」，或在輸入框按 Enter。
5. 要取消時，點擊「恢復原名」。

名稱只套用於目前這個分頁，不會因為網址相同而自動套用到其他新分頁。

## 權限說明

Manifest 實際使用的 permissions 只有：

- `activeTab`：使用者開啟 Extension popup 或使用快捷鍵時，取得目前分頁的暫時存取權。
- `scripting`：注入只處理 `document.title` 的設定、觀察與恢復程式。
- `storage`：使用 `chrome.storage.session` 保存 `tabId` 對應的名稱與原始標題。

沒有使用 `tabs`、`host_permissions`、`optional_host_permissions` 或 `<all_urls>`。因此安裝時不會因為申請全站 host permission 而顯示「讀取及變更你在所有網站上的資料」的全站權限警告。

## 隱私設計

- Extension 只讀取目前分頁的 `document.title`、分頁 URL 與 Chrome 提供的分頁標題欄位。
- 不讀取、不保存也不傳送網頁正文、表單內容、密碼、Cookie 或其他頁面資料。
- 不使用 analytics、telemetry、帳號、雲端同步或遠端後端。
- 不發出任何網路請求。
- 不載入遠端 script、第三方 CDN 或外部套件。
- `chrome.storage.session` 只保存目前 Extension/瀏覽器工作階段中的 `tabId`、自訂名稱與原始標題；關閉分頁時會移除資料，瀏覽器或 Extension 重啟時 session storage 會清空。

## 支援與不支援的頁面

支援一般 `http://` 與 `https://` 網站。

Chrome 不允許注入 script 的頁面無法修改，例如：

- `chrome://` 頁面
- Chrome Web Store
- Extension 內部頁面
- 其他 Chrome 受保護頁面

Popup 會顯示清楚的錯誤訊息，不會卡住或把 Extension 自己改回錯誤名稱。

## 快捷鍵設定

如果預設快捷鍵與其他快捷鍵衝突，請打開：

`chrome://extensions/shortcuts`

在 Tab Labels 旁自行設定新的按鍵組合。

## 已知限制

- 這是分頁工作階段模型，不是永久設定；Chrome 或 Extension 重啟後不要求還原上一個工作階段的名稱。
- `activeTab` 是暫時權限。若同一個分頁跨到不同網站來源，Chrome 可能撤銷原來源的暫時權限；重新開啟 popup 後即可重試新來源。
- 網站如果在非常特殊的時機反覆替換整個 `<head>`，恢復原名時可能只能回退到第一次命名時保存的標題。

## 測試重新整理、動態標題與恢復原名

可用下列簡單 HTML 測試頁；若 Chrome 未允許檔案 URL，請改用任何本機 HTTP 伺服器提供此檔案。

```html
<!doctype html>
<title>網站原名</title>
<button onclick="document.title = '網站動態新標題'">修改網站標題</button>
```

建議驗收：

1. 設定 `Kizamu｜Codex`，確認分頁立即改名。
2. 重新整理，確認名稱自動回來。
3. 修改 `<title>`，確認自訂名稱仍維持。
4. 點擊「恢復原名」，確認不會再次被改回自訂名稱。
5. 開兩個相同網域的分頁，分別設定不同名稱，確認互不干擾。
6. 關閉其中一個分頁，確認該 `tabId` 不會持續累積。

## Release

目前公開版本為 `0.1.0`。

- Release page: [Tab Labels 0.1.0](https://github.com/louisa412/Tab-Labels/releases/tag/v0.1.0)
- Extension ZIP: [tab-labels-0.1.0.zip](https://github.com/louisa412/Tab-Labels/releases/download/v0.1.0/tab-labels-0.1.0.zip)

Release ZIP 是本機載入用 unpacked Extension，不是 Chrome Web Store 安裝包；請依照上方安裝方式解壓縮後載入。

## 驗證

Release 前會檢查：Manifest V3、所有引用檔案、JavaScript syntax、icon 像素尺寸與透明度、無秘密資料、無本機絕對路徑、無外部網路請求，以及 ZIP 解壓縮後第一層直接包含 `manifest.json`。

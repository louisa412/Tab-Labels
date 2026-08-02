# Tab Labels

Tab Labels 是一個本機載入的 Manifest V3 Chrome Extension，讓你快速替分頁命名、搜尋已命名分頁，並以使用者明確授權的網址規則自動套用設定。自訂 favicon 目前暫時停用，避免網站相容性問題。

Phase 2 開發版版本號是 `0.2.0`。本輪不建立正式 `v0.2.0` tag、Release 或 Chrome Web Store 發布；目前 GitHub 最新正式 Release 仍是 [`v0.1.0`](https://github.com/louisa412/Tab-Labels/releases/tag/v0.1.0)。

## Phase 2 功能

- 最近使用名稱最多 15 筆：去重、新名稱移到最前方、逐筆點擊填入、popup 一鍵清除。
- 收藏名稱：在 Options 頁改名、儲存、刪除與上移／下移。既有 favicon 欄位會保留以維持資料相容性，但目前不會套用。
- 自動補字：收藏優先於最近使用，支援開頭與包含匹配；`↑`、`↓`、`Enter`、`Escape` 可用鍵盤操作。
- 名稱安全整理：去除頭尾空白、連續空白縮成一個、`  ｜  ` 正規化成 `｜`，保留使用者大小寫與語言。
- 自訂 favicon：暫時停用，正在改善相容性；安全版本不修改頁面 favicon，也不觀察整個 `<head>`。
- 已命名分頁管理頁：搜尋自訂名稱與 hostname，顯示目前分頁、視窗、favicon；點擊切換、直接恢復原名、確認後關閉分頁。
- 自動命名規則：exact 完整網址與 prefix 網址前綴。exact 優先；prefix 同時匹配時較長者優先；同等精確度以較晚更新者優先。
- 單一分頁可暫停自動命名，關閉分頁後隨 session data 消失；也可重新套用規則。
- JSON 設定匯出與匯入：merge 或 replace。預設不匯出最近名稱，匯入規則不會自動取得網站權限。
- 隱私控制：排除 origin、不記錄最近名稱、分項清除與清除全部長期設定、檢視及逐項撤銷 optional origins。

本輪明確不包含 Project、Workspace、Tab Group、自動保存／重開整組分頁、regex 規則、圖片上傳、雲端同步、帳號、後端、AI 或 Chrome Web Store 發布。

## 安裝開發版

1. 在 GitHub 取得 branch `feature/phase-2-convenience` 的程式碼，或下載 Draft PR 的 branch。
2. 打開 `chrome://extensions`。
3. 開啟右上角「開發人員模式」。
4. 點擊「載入未封裝項目」。
5. 選擇第一層直接包含 `manifest.json` 的專案資料夾。
6. 若 Extension 更新檔案，回到 `chrome://extensions` 點擊 Tab Labels 的「重新載入」。

Chrome 不會直接安裝 ZIP；若使用 ZIP，必須先解壓縮，再選取包含 `manifest.json` 的資料夾。

## Popup 使用方式

1. 打開一般 `http://` 或 `https://` 網站，點擊工具列上的 Tab Labels，或按 popup command。
2. 輸入名稱後按「儲存名稱」或 Enter。名稱只套用於目前 tabId。
3. 點擊「加入收藏」保存常用名稱；點擊收藏或最近名稱只會填入輸入框，仍需按儲存確認。
4. 自訂 favicon 區會顯示「自訂 favicon 暫時停用，正在改善相容性。」；此版本不提供套用或恢復 favicon 的操作。
5. 儲存名稱後，popup 會顯示 exact 與安全 prefix pattern。按下建立規則後才會進入 origin 授權流程。
6. 若網站在排除清單，popup 會明確提示；要只在本次手動操作，需勾選「本次仍允許手動套用」。
7. 使用「已命名分頁」開啟搜尋與切換頁；使用「設定與匯入匯出」開啟 Options。

網站動態改寫 `<title>` 時，Tab Labels 只重新套用自訂名稱。標題 controller 只觀察 `<title>` 節點，不觀察整個 `<head>`，也不讀取網頁正文、表單、密碼、Cookie 或可編輯內容。本安全版本完全不修改頁面 favicon。

### P0 favicon 事故處理

先前開發版的 favicon 維持策略會在觀察 `<head>` 後反覆修改 favicon link；網站自身的 favicon manager 也可能同時修改相同節點，形成 mutation feedback loop，導致頁面無回應。此版本已移除 favicon runtime、favicon observer、favicon reload 維持與 favicon restore；不要繼續驗收舊版 favicon 功能。

若使用者套用舊版 favicon 後頁面卡死：

1. 關閉該分頁。
2. 到 `chrome://extensions`。
3. 關閉或重新載入 Tab Labels。
4. 更新至安全版本。
5. 再重新開啟網站。

安全版本啟動時只會在 `chrome.storage.session` 讀取舊 record，清除或忽略 favicon runtime 欄位，不會進入每個頁面清理 DOM，也不會再次注入舊 controller。

## 已命名分頁與快捷鍵

已命名分頁管理頁可搜尋自訂名稱與 hostname，不預設顯示完整 URL。點擊項目或「切換」會先聚焦對應視窗，再啟用對應 tab；關閉分頁需要二次確認。

目前建議快捷鍵：

- popup：macOS `Command+Shift+L`，Windows/Linux `Ctrl+Shift+L`。
- 已命名分頁管理頁：macOS `Command+Shift+K`，Windows/Linux `Ctrl+Shift+K`。

Chrome 可能因系統或其他 Extension 衝突而不接受預設快捷鍵。請到 `chrome://extensions/shortcuts` 在 Tab Labels 旁自行設定。

## 自動規則與 optional permissions

規則只支援：

- `exact`：完整匹配目前 URL。
- `prefix`：從目前 URL 的 path 建立安全前綴，例如目前頁面是 `https://github.com/louisa412/Tab-Labels`，預設範圍是 `https://github.com/louisa412/Tab-Labels/`，不會默認整個 `github.com`。

建立規則前 popup 會顯示 exact 與 prefix pattern。Extension 只會為該網址的 origin 請求必要的 optional host permission，例如 `https://github.com/*`；不會直接要求 `<all_urls>`。

已授權的規則會在：

- 新頁面完成載入；
- tab 導覽或重新整理完成；
- Chrome 啟動後目前已存在的分頁被檢查。

頁面完成載入時會先檢查目前 tabId 的 session record，再決定是否評估自動規則：

- 手動 record 只要仍有 custom title，就先重新注入既有標題；沒有 matching auto rule 也不會清除或跳過手動狀態。
- paused auto record 只保留暫停狀態，不會注入 favicon。
- auto record 才會依目前 URL、排除設定與 permission 重新評估。
- 沒有 session record 才會從零開始匹配 auto rule。

同一 URL 重新整理一定保留手動名稱。tabId 工作階段模型也會保留手動名稱跨站內或跨 origin 導覽；若跨 origin 後 activeTab 或 host access 已被撤銷，Extension 會保留 session record，不會因一次注入失敗刪除設定，使用者下次主動開啟 popup 後可重新注入或恢復原名。

Chrome service worker 可能在事件之間重新啟動，因此規則狀態保存在 `chrome.storage.local`，而每次需要注入時仍會重新確認 permission。Chrome 不保證 Extension 能注入所有頁面：`chrome://`、Chrome Web Store、Extension 內部頁面與其他受保護頁面會被跳過。

匯入規則只保存規則，不等於取得權限。Options 會列出需要授權的 origins，使用者可逐項授權或按「授權列出的 origins」主動批次授權。撤銷 permission 後規則不刪除，只標示為需要授權；手動 `activeTab` 改名仍可使用。

## JSON 匯出與匯入

匯出檔名格式：

`tab-labels-settings-YYYY-MM-DD.json`

包含：

- schema version、Extension version、exportedAt；
- 收藏名稱與相容性保留的 favicon 欄位；目前不會套用 favicon；
- 自動命名規則；
- 排除 origins；
- 隱私設定與 UI 偏好；
- 使用者勾選後才包含最近使用名稱。

預設不包含目前 tabId、原始標題、原始 favicon、目前 session、已關閉分頁紀錄或瀏覽歷史。匯入會 parse JSON、驗證欄位型別與長度、拒絕 `__proto__`／`prototype`／`constructor` 等危險 key，並跳過損壞項目。

merge 策略：

- 相同收藏名稱合併，匯入的收藏資料覆蓋舊項目；favicon 欄位會保留在 schema 中但不會套用；
- 自動規則以 `matchType + pattern` 識別，匯入項目覆蓋衝突規則；
- 排除 origins 取聯集；
- 匯入的隱私與 UI 設定覆蓋目前設定；
- 最近名稱只有在匯出檔含有它時才合併。

replace 模式需要明確確認，會取代收藏、規則、排除、隱私與 UI 設定，但不會修改目前的 `chrome.storage.session` 分頁名稱，也不會自動撤銷 Chrome 已授予的網站權限。

## 資料保存範圍與 schema

工作階段資料使用 `chrome.storage.session`，key 為 `labelsByTab`，以 tabId 保存：

- `tabId`
- `customTitle`／相容的舊 `label`
- `originalTitle`
- `originalFavicon`
- `customFavicon`
- `source`、`autoRuleId`
- `pageUrl`
- `autoRulePaused`
- 注入的 title 狀態；favicon runtime 欄位只為相容性保留且安全版本會停用

舊版本的 `originalFavicon` 與 `customFavicon` 可能存在於 session，但安全版本會在讀取時將它們清為 `null`，並將 `injected.favicon` 設為 `false`；不會讀取或修改頁面 favicon link。

關閉 tab 時會清理該筆 session。Chrome 或 Extension 重啟後，session storage 可能清空；它不是跨電腦或永久保存格式。

長期設定使用 `chrome.storage.local`，key 為 `tabLabelsSettings`，目前 `schemaVersion: 2`，保存：

- `recentNames`
- `favorites`
- `rules`
- `excludedOrigins`
- `privacy.recordRecentNames`
- `ui.defaultFavicon`

Phase 1 的舊 `labelsByTab` { `label, originalTitle` } 會在讀取時安全補成 Phase 2 record；未知欄位會保留。長期設定 migration 是可重複執行的純函式，遇到不完整資料會使用安全預設值，遇到損壞項目會跳過，不會無限 migration 或因 parse error 讓 popup 崩潰。

## 權限表

| permission | 用途 | 安裝時／使用時 | 拒絕後仍可用 | 是否造成全站資料警告 |
| --- | --- | --- | --- | --- |
| `activeTab` | 使用者開啟 popup 後，手動處理目前分頁 | 安裝時宣告；使用者手勢取得暫時存取 | 手動操作可在支援頁面重試；受保護頁面仍不可用 | 不要求永久全站存取 |
| `scripting` | 注入只處理 `<title>` 的本機函式 | 安裝時宣告 | 不能注入頁面，但設定頁、收藏、匯入匯出仍可用 | 本身不等於全站 host permission |
| `storage` | 保存 `chrome.storage.session` 與 `chrome.storage.local` | 安裝時宣告 | Extension 核心無法保存設定 | 不讀取網站資料 |
| `tabs` | 列出已命名 tab、hostname、favicon、windowId，並完成切換 | 安裝時宣告 | 手動目前分頁改名仍可用，但已命名分頁全域搜尋與切換不可完整運作 | Chrome 可能顯示「讀取瀏覽記錄」類警告 |
| optional `http://*/*`／`https://*/*` | 讓使用者逐一授權自動規則要注入的 origin | 不在安裝時授予；建立規則或 Options 主動授權時才請求實際 origin | 規則保留但標示需要授權；手動 `activeTab` 仍可用 | 不直接授予全站；Chrome 會針對實際 origin 顯示讀取及變更該網站資料的提示 |

本 Extension 沒有 `host_permissions`、沒有 `<all_urls>`、沒有 `chrome.storage.sync`，也沒有網路請求、analytics、telemetry、帳號、後端或遠端程式碼。

## 隱私設定

Options 的「不記錄最近名稱」只停止新增最近使用名稱，不是無痕模式，也不代表完全不留資料。收藏、規則與目前工作階段資料仍可存在。

排除網站以 origin 保存，例如 `https://example.com`。排除後自動名稱不執行；自訂 favicon 目前本來就不會執行。手動操作會顯示排除提示，只有使用者明確勾選本次操作才會暫時套用。移除排除 origin 後，自動規則可恢復。

「清除全部長期設定」不會移除 Extension、不會自動撤銷 Chrome 已授予的 optional origins，也不會自動恢復目前已命名分頁。若要恢復目前分頁，請從 popup 或已命名分頁頁面逐一恢復。

## 開發版手動驗收清單

### 快速命名

- [ ] 設定三個不同名稱，確認最近使用依順序顯示。
- [ ] 重複使用同一名稱，確認沒有重複項目。
- [ ] 將目前名稱加入收藏；點擊收藏只填入輸入框，按儲存後才改名。
- [ ] 關閉並重新打開 Chrome，確認收藏仍存在。
- [ ] 啟用「不記錄最近名稱」後設定新名稱，確認不進入歷史。
- [ ] 在 Options 將收藏改名、上移／下移、刪除，確認順序穩定。

### favicon（目前停用）

- [ ] Popup 顯示「自訂 favicon 暫時停用，正在改善相容性。」。
- [ ] 確認 popup 沒有可用的 favicon 套用或恢復按鈕。
- [ ] 確認設定收藏或自動規則不會觸發頁面 favicon 修改。
- [ ] 舊版曾使用 favicon 的 session 在安全版本不會再次注入 favicon。

### 分頁搜尋

- [ ] 命名至少五個分頁。
- [ ] 在管理頁搜尋名稱與 hostname。
- [ ] 點擊項目後確認切換到正確視窗與分頁。
- [ ] 關閉分頁後重新整理清單，確認已移除。
- [ ] 使用「恢復原名」確認項目從已命名清單消失。

### 自動規則

- [ ] 建立 exact 規則，確認 popup 先顯示完整 URL pattern。
- [ ] 建立 prefix 規則，確認只涵蓋目前 path 下的安全前綴，不是整個網域。
- [ ] 拒絕網站權限，確認規則未建立或保留為需要授權，手動命名仍可用。
- [ ] 授予網站權限，確認重新整理與重開匹配頁面後自動套用。
- [ ] exact 與 prefix 同時符合時，確認 exact 勝出。
- [ ] 在 Options 停用／啟用規則、編輯名稱、刪除規則；確認 favicon 設定明確顯示暫時停用。
- [ ] 暫停目前分頁規則，再按「重新套用規則」。
- [ ] 在 Options 撤銷網站權限，確認規則保留但顯示需要授權。

### 匯入匯出

- [ ] 匯出設定，檢查 JSON 不含 tabId、原始標題或瀏覽歷史。
- [ ] 清除收藏與規則，再用 merge 模式匯入。
- [ ] 用 replace 模式匯入，確認有明確二次確認。
- [ ] 匯入損壞 JSON、錯誤型別、超長項目與危險 key，確認 Extension 不崩潰。
- [ ] 確認匯入規則不會自動取得網站權限；需從 Options 主動授權。

### 排除網站

- [ ] 加入一個 origin，確認匹配的自動規則不執行；自訂 favicon 仍維持停用。
- [ ] popup 手動操作時確認顯示排除提示。
- [ ] 明確勾選本次手動操作後確認只暫時套用。
- [ ] 移除排除 origin，確認自動規則恢復。

## 測試與開發檢查

本機不需要 npm 或 bundler。純邏輯測試：

```sh
node --test tests/core.test.js
node --test tests/reload-regression.test.js tests/favicon-regression.test.js
```

測試涵蓋名稱正規化、最近名稱上限與去重、收藏 CRUD 與排序、autocomplete、exact／prefix 規則、規則優先順序、disabled、排除與 tab pause、JSON export/import、merge/replace 模型、惡意 key、schema migration、清除資料，以及手動／自動分頁 reload、title-only controller 與 P0 favicon 停用 regression cases。核心保留的 favicon data helper 只作為舊設定 schema 的純資料相容性測試，不會注入頁面。

靜態檢查可使用：

```sh
node --check core.js
node --check popup.js
node --check service-worker.js
node --check options.js
node --check tab-manager.js
python3 -m json.tool manifest.json >/dev/null
node tests/static-check.js
```

另請確認所有 manifest 引用檔案存在、沒有 remote script、沒有 `<all_urls>`、沒有 analytics／telemetry、沒有本機絕對路徑、沒有 secrets、沒有 `.DS_Store`，並執行 `git diff --check`。

若環境沒有可控的 Chrome GUI，請依上面的開發版手動驗收清單在 Luisa 的家用 Chrome 實機完成 smoke test；不要把沒有實際載入 unpacked Extension 的情況標記成已完成瀏覽器驗收。

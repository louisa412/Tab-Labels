const core = globalThis.TabLabelsCore;
const elements = {
  status: document.querySelector("#status"),
  version: document.querySelector("#version"),
  summary: document.querySelector("#summary"),
  favorites: document.querySelector("#favorites-list"),
  rules: document.querySelector("#rules-list"),
  excludedOrigin: document.querySelector("#excluded-origin"),
  addExcluded: document.querySelector("#add-excluded"),
  excluded: document.querySelector("#excluded-list"),
  recordRecent: document.querySelector("#record-recent"),
  permissions: document.querySelector("#permissions-list"),
  grantAll: document.querySelector("#grant-all"),
  includeRecent: document.querySelector("#include-recent"),
  exportSettings: document.querySelector("#export-settings"),
  importFile: document.querySelector("#import-file"),
  importPreview: document.querySelector("#import-preview"),
  importMerge: document.querySelector("#import-merge"),
  importReplace: document.querySelector("#import-replace"),
  clearAll: document.querySelector("#clear-all")
};

let settings = null;
let extensionVersion = "";
let permissionOrigins = [];
let pendingImport = null;

async function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function showStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = ("status " + kind).trim();
  elements.status.setAttribute("role", kind === "error" ? "alert" : "status");
}

function makeButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "button button-secondary";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function createFaviconEditor(config) {
  const normalized = core.normalizeFaviconConfig(config) || {
    text: "",
    background: "#4359d8",
    foreground: "auto",
    shape: "rounded"
  };
  const wrapper = document.createElement("div");
  wrapper.className = "favicon-editor";
  const text = document.createElement("input");
  text.type = "text";
  text.maxLength = 2;
  text.value = normalized.text;
  text.setAttribute("aria-label", "favicon 文字");
  const background = document.createElement("input");
  background.type = "color";
  background.value = normalized.background;
  background.setAttribute("aria-label", "favicon 背景色");
  const foreground = document.createElement("input");
  foreground.type = "color";
  foreground.value = normalized.foreground === "auto" ? "#ffffff" : normalized.foreground;
  foreground.setAttribute("aria-label", "favicon 文字色");
  const auto = document.createElement("input");
  auto.type = "checkbox";
  auto.checked = normalized.foreground === "auto";
  auto.setAttribute("aria-label", "favicon 自動高對比文字色");
  const autoLabel = document.createElement("label");
  autoLabel.append(auto, document.createTextNode("自動文字色"));
  const shape = document.createElement("select");
  shape.setAttribute("aria-label", "favicon 形狀");
  [["rounded", "圓角"], ["circle", "圓形"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    shape.append(option);
  });
  shape.value = normalized.shape;
  [
    document.createTextNode("文字"), text,
    document.createTextNode("背景"), background,
    document.createTextNode("文字色"), foreground,
    autoLabel,
    document.createTextNode("形狀"), shape
  ].forEach((child) => wrapper.append(child));
  return {
    element: wrapper,
    getConfig() {
      if (!text.value.trim()) {
        return null;
      }
      return core.normalizeFaviconConfig({
        text: text.value,
        background: background.value,
        foreground: auto.checked ? "auto" : foreground.value,
        shape: shape.value
      });
    }
  };
}

function renderSummary() {
  const values = [
    ["收藏名稱", settings.favorites.length],
    ["最近名稱", settings.recentNames.length],
    ["自動規則", settings.rules.length],
    ["已授權網站", permissionOrigins.length],
    ["排除網站", settings.excludedOrigins.length],
    ["最近名稱紀錄", settings.privacy.recordRecentNames !== false ? "開啟" : "關閉"]
  ];
  elements.summary.replaceChildren();
  values.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "summary-item";
    const number = document.createElement("span");
    number.className = "summary-value";
    number.textContent = String(value);
    const caption = document.createElement("span");
    caption.className = "summary-label";
    caption.textContent = label;
    item.append(number, caption);
    elements.summary.append(item);
  });
  elements.recordRecent.checked = settings.privacy.recordRecentNames !== false;
  elements.version.textContent = "schema " + settings.schemaVersion + " · v" + extensionVersion;
}

function saveSettings(nextSettings, successMessage) {
  return sendMessage("save-settings", { settings: nextSettings }).then((result) => {
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "設定儲存失敗。");
    }
    settings = result.settings;
    renderAll();
    if (successMessage) {
      showStatus(successMessage, "success");
    }
    return result;
  });
}

function renderFavorites() {
  elements.favorites.replaceChildren();
  if (!settings.favorites.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "尚未收藏名稱。可在 popup 的目前名稱旁加入收藏。";
    elements.favorites.append(empty);
    return;
  }
  settings.favorites.forEach((favorite, index) => {
    const card = document.createElement("article");
    card.className = "setting-card";
    const header = document.createElement("div");
    header.className = "setting-card-header";
    const title = document.createElement("div");
    title.className = "setting-card-title";
    const label = document.createElement("label");
    label.textContent = "收藏名稱";
    const input = document.createElement("input");
    input.type = "text";
    input.value = favorite.label;
    input.setAttribute("aria-label", "收藏名稱");
    label.append(input);
    title.append(label);
    const actions = document.createElement("div");
    actions.className = "icon-actions";
    actions.append(
      makeButton("上移", "button button-secondary", () => void moveFavorite(favorite.id, "up")),
      makeButton("下移", "button button-secondary", () => void moveFavorite(favorite.id, "down"))
    );
    header.append(title, actions);
    const editor = createFaviconEditor(favorite.favicon);
    const footer = document.createElement("div");
    footer.className = "rule-footer";
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = "favicon 可與收藏名稱一起填入 popup。";
    const footerActions = document.createElement("div");
    footerActions.className = "button-row";
    footerActions.append(
      makeButton("儲存", "button button-primary", () => {
        void saveSettingsForFavorite(favorite.id, input.value, editor.getConfig());
      }),
      makeButton("刪除", "button button-danger", () => {
        if (window.confirm("確定刪除這個收藏名稱嗎？")) {
          void deleteFavorite(favorite.id);
        }
      })
    );
    footer.append(note, footerActions);
    card.append(header, editor.element, footer);
    elements.favorites.append(card);
    if (index === 0) {
      actions.querySelector("button").disabled = true;
    }
    if (index === settings.favorites.length - 1) {
      actions.querySelectorAll("button")[1].disabled = true;
    }
  });
}

async function saveSettingsForFavorite(id, label, favicon) {
  try {
    const result = await sendMessage("update-favorite", { id, changes: { label, favicon } });
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "收藏儲存失敗。");
    }
    settings = result.settings;
    renderAll();
    showStatus("收藏已更新。", "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
}

async function moveFavorite(id, direction) {
  const result = await sendMessage("move-favorite", { id, direction });
  if (result && result.ok) {
    settings = result.settings;
    renderAll();
    showStatus("收藏順序已更新。", "success");
  }
}

async function deleteFavorite(id) {
  const result = await sendMessage("delete-favorite", { id });
  if (result && result.ok) {
    settings = result.settings;
    renderAll();
    showStatus("收藏已刪除。", "success");
  }
}

async function rulePermission(rule) {
  const pattern = core.originPermissionPattern(rule.pattern);
  return {
    pattern,
    granted: pattern ? permissionOrigins.includes(pattern) : false
  };
}

function ruleConflictText(rule) {
  const conflicts = settings.rules.filter((other) => {
    if (other.id === rule.id || other.enabled === false || rule.enabled === false) {
      return false;
    }
    if (rule.matchType === "exact") {
      return other.matchType === "prefix" && rule.pattern.startsWith(other.pattern);
    }
    if (other.matchType === "exact") {
      return other.pattern.startsWith(rule.pattern);
    }
    return rule.pattern.startsWith(other.pattern) || other.pattern.startsWith(rule.pattern);
  });
  if (!conflicts.length) {
    return "目前沒有偵測到與其他啟用規則重疊的 pattern。優先順序：exact > 較長 prefix > 較晚更新。";
  }
  const winsOver = conflicts.filter((other) => {
    if (rule.matchType === "exact") {
      return other.matchType === "prefix";
    }
    if (other.matchType === "exact") {
      return false;
    }
    return rule.pattern.length > other.pattern.length
      || (rule.pattern.length === other.pattern.length && String(rule.updatedAt).localeCompare(String(other.updatedAt)) > 0);
  });
  if (winsOver.length) {
    return "已知重疊：這條規則優先於「" + winsOver.map((item) => item.label).join("、") + "」。優先順序：exact > 較長 prefix > 較晚更新。";
  }
  return "已知重疊：其他更精確規則會優先於這條。優先順序：exact > 較長 prefix > 較晚更新。";
}

function renderRules() {
  elements.rules.replaceChildren();
  if (!settings.rules.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "尚未建立自動規則。可在 popup 儲存名稱後建立。";
    elements.rules.append(empty);
    return;
  }
  settings.rules.forEach((rule) => {
    const card = document.createElement("article");
    card.className = "setting-card";
    const header = document.createElement("div");
    header.className = "setting-card-header";
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "check-row";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = rule.enabled !== false;
    enabledLabel.append(enabled, document.createTextNode("啟用"));
    const deleteButton = makeButton("刪除", "button button-danger", () => {
      if (window.confirm("確定刪除這條自動規則嗎？")) {
        void deleteRule(rule.id);
      }
    });
    header.append(enabledLabel, deleteButton);
    const fields = document.createElement("div");
    fields.className = "rule-fields";
    const labelWrap = document.createElement("label");
    labelWrap.textContent = "名稱";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = rule.label;
    labelWrap.append(labelInput);
    const typeWrap = document.createElement("label");
    typeWrap.textContent = "匹配方式";
    const type = document.createElement("select");
    [["exact", "exact 完整網址"], ["prefix", "prefix 網址前綴"]].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      type.append(option);
    });
    type.value = rule.matchType;
    typeWrap.append(type);
    const patternWrap = document.createElement("label");
    patternWrap.textContent = "匹配範圍";
    const pattern = document.createElement("input");
    pattern.type = "url";
    pattern.className = "rule-pattern";
    pattern.value = rule.pattern;
    patternWrap.append(pattern);
    fields.append(labelWrap, typeWrap, patternWrap);
    const editor = createFaviconEditor(rule.favicon);
    const conflict = document.createElement("p");
    conflict.className = "rule-conflict";
    conflict.textContent = ruleConflictText(rule);
    const footer = document.createElement("div");
    footer.className = "rule-footer";
    const permissionText = document.createElement("span");
    const permissionButton = document.createElement("button");
    permissionButton.type = "button";
    permissionButton.className = "text-button";
    permissionButton.textContent = "檢查權限";
    permissionButton.addEventListener("click", () => void requestRulePermission(rule.pattern));
    footer.append(permissionText, permissionButton);
    const saveButton = makeButton("儲存規則", "button button-primary", () => {
      void saveRule(rule.id, {
        label: labelInput.value,
        matchType: type.value,
        pattern: pattern.value,
        enabled: enabled.checked,
        favicon: editor.getConfig()
      });
    });
    footer.append(saveButton);
    card.append(header, fields, editor.element, conflict, footer);
    elements.rules.append(card);
    void rulePermission(rule).then((permission) => {
      permissionText.className = permission.granted ? "permission-ok" : "permission-needed";
      permissionText.textContent = permission.granted
        ? "已授權：" + permission.pattern
        : "需要授權：" + permission.pattern;
      permissionButton.textContent = permission.granted ? "撤銷/管理" : "授權此 origin";
    });
  });
}

async function requestRulePermission(pattern) {
  const origin = core.originPermissionPattern(pattern);
  if (!origin) {
    showStatus("找不到有效的網站 origin。", "error");
    return;
  }
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (granted) {
    await loadPermissions();
    showStatus("已授權 " + origin + "。", "success");
  } else {
    showStatus("未授權 " + origin + "；規則仍保留。", "error");
  }
}

async function saveRule(id, changes) {
  const result = await sendMessage("update-rule", { id, changes });
  if (!result || !result.ok) {
    showStatus(result && result.message ? result.message : "規則儲存失敗。", "error");
    return;
  }
  settings = result.settings;
  renderAll();
  showStatus("自動規則已更新。", "success");
}

async function deleteRule(id) {
  const result = await sendMessage("delete-rule", { id });
  if (result && result.ok) {
    settings = result.settings;
    renderAll();
    showStatus("自動規則已刪除。", "success");
  }
}

async function loadPermissions() {
  const result = await sendMessage("get-permissions");
  permissionOrigins = result && result.ok ? result.origins : [];
  renderPermissions();
  renderSummary();
  renderRules();
}

function renderPermissions() {
  elements.permissions.replaceChildren();
  if (!permissionOrigins.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "尚未授權任何自動規則網站。";
    elements.permissions.append(empty);
    return;
  }
  permissionOrigins.forEach((origin) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    const text = document.createElement("span");
    text.textContent = origin;
    const revoke = makeButton("撤銷", "text-button", async () => {
      const result = await sendMessage("remove-permission", { origin });
      if (result && result.ok) {
        permissionOrigins = result.origins;
        renderAll();
        showStatus("已撤銷 " + origin + "。相關規則仍會保留。", "success");
      }
    });
    tag.append(text, revoke);
    elements.permissions.append(tag);
  });
}

function renderExcluded() {
  elements.excluded.replaceChildren();
  if (!settings.excludedOrigins.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "尚未排除任何網站。";
    elements.excluded.append(empty);
    return;
  }
  settings.excludedOrigins.forEach((origin) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    const text = document.createElement("span");
    text.textContent = origin;
    const remove = makeButton("移除", "text-button", () => {
      void saveSettings({
        ...settings,
        excludedOrigins: settings.excludedOrigins.filter((item) => item !== origin)
      }, "已移除排除網站。");
    });
    tag.append(text, remove);
    elements.excluded.append(tag);
  });
}

function renderAll() {
  if (!settings) {
    return;
  }
  renderSummary();
  renderFavorites();
  renderRules();
  renderExcluded();
  renderPermissions();
}

async function load() {
  try {
    const result = await sendMessage("get-settings");
    if (!result || !result.ok) {
      throw new Error("無法載入設定。");
    }
    settings = result.settings;
    extensionVersion = result.extensionVersion || "";
    await loadPermissions();
    renderAll();
  } catch (error) {
    showStatus(error.message || "無法載入設定。", "error");
  }
}

elements.recordRecent.addEventListener("change", () => {
  void saveSettings({
    ...settings,
    privacy: { ...settings.privacy, recordRecentNames: elements.recordRecent.checked }
  }, elements.recordRecent.checked ? "已開啟最近名稱紀錄。" : "已關閉最近名稱紀錄；既有歷史仍保留。");
});
elements.addExcluded.addEventListener("click", () => {
  const origin = core.normalizeOrigin(elements.excludedOrigin.value);
  if (!origin) {
    showStatus("請輸入有效的 http 或 https origin，例如 https://example.com。", "error");
    return;
  }
  if (settings.excludedOrigins.includes(origin)) {
    showStatus("這個 origin 已在排除清單。", "error");
    return;
  }
  void saveSettings({
    ...settings,
    excludedOrigins: [...settings.excludedOrigins, origin]
  }, "已加入排除網站。").then(() => {
    elements.excludedOrigin.value = "";
  });
});
document.querySelectorAll("[data-clear]").forEach((button) => {
  button.addEventListener("click", async () => {
    const result = await sendMessage("clear-data", { kind: button.dataset.clear });
    if (result && result.ok) {
      settings = result.settings;
      renderAll();
      showStatus("已清除指定資料。", "success");
    }
  });
});
elements.clearAll.addEventListener("click", async () => {
  const confirmed = window.confirm("確定清除全部長期設定嗎？目前已命名分頁不會自動恢復，Chrome 已授予的網站權限也不會自動撤銷。");
  if (!confirmed) {
    return;
  }
  const result = await sendMessage("clear-data", { kind: "all" });
  if (result && result.ok) {
    settings = result.settings;
    renderAll();
    showStatus("已清除全部長期設定。", "success");
  }
});
elements.grantAll.addEventListener("click", async () => {
  const missing = [];
  for (const rule of settings.rules) {
    const origin = core.originPermissionPattern(rule.pattern);
    if (origin && !permissionOrigins.includes(origin) && !missing.includes(origin)) {
      missing.push(origin);
    }
  }
  if (!missing.length) {
    showStatus("列出的規則都已取得必要 origin 權限。", "success");
    return;
  }
  const granted = await chrome.permissions.request({ origins: missing });
  await loadPermissions();
  showStatus(granted ? "已完成列出的 origins 授權。" : "部分或全部 origin 未獲授權；規則仍保留。", granted ? "success" : "error");
});
elements.exportSettings.addEventListener("click", async () => {
  const result = await sendMessage("get-settings");
  if (!result || !result.ok) {
    showStatus("無法準備匯出檔。", "error");
    return;
  }
  const payload = core.exportSettings(result.settings, result.extensionVersion, elements.includeRecent.checked);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tab-labels-settings-" + new Date().toISOString().slice(0, 10) + ".json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus("設定 JSON 已匯出。", "success");
});
elements.importFile.addEventListener("change", async () => {
  pendingImport = null;
  elements.importMerge.disabled = true;
  elements.importReplace.disabled = true;
  const file = elements.importFile.files && elements.importFile.files[0];
  if (!file) {
    elements.importPreview.textContent = "尚未選擇檔案。";
    return;
  }
  try {
    const payload = JSON.parse(await file.text());
    const validation = core.validateImportPayload(payload);
    if (!validation.ok) {
      throw new Error(validation.message);
    }
    pendingImport = payload;
    elements.importPreview.textContent = "檔案有效：收藏 " + validation.settings.favorites.length + " 筆、規則 " + validation.settings.rules.length + " 條，可能跳過 " + validation.skipped + " 筆無效項目。";
    elements.importMerge.disabled = false;
    elements.importReplace.disabled = false;
  } catch (error) {
    elements.importPreview.textContent = "無法匯入：" + (error.message || "JSON 格式錯誤。");
    showStatus(error.message || "JSON 格式錯誤。", "error");
  }
});
async function importPending(mode) {
  if (!pendingImport) {
    return;
  }
  if (mode === "replace" && !window.confirm("取代模式會以匯入設定取代收藏、規則、排除與隱私設定，確定繼續嗎？")) {
    return;
  }
  const result = await sendMessage("import-settings", { payload: pendingImport, mode });
  if (!result || !result.ok) {
    showStatus(result && result.message ? result.message : "匯入失敗。", "error");
    return;
  }
  settings = result.settings;
  pendingImport = null;
  elements.importMerge.disabled = true;
  elements.importReplace.disabled = true;
  elements.importPreview.textContent = "匯入完成：收藏 " + result.importedFavorites + " 筆、規則 " + result.importedRules + " 條、跳過 " + result.skipped + " 筆；需要授權 " + result.needsAuthorization.length + " 個 origins。";
  await loadPermissions();
  renderAll();
  showStatus("設定已匯入；規則權限仍需逐一或主動批次授權。", "success");
}
elements.importMerge.addEventListener("click", () => void importPending("merge"));
elements.importReplace.addEventListener("click", () => void importPending("replace"));

void load();

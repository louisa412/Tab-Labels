const core = globalThis.TabLabelsCore;
const elements = {
  form: document.querySelector("#label-form"),
  input: document.querySelector("#label-input"),
  clear: document.querySelector("#clear-input"),
  save: document.querySelector("#save-button"),
  restore: document.querySelector("#restore-button"),
  title: document.querySelector("#original-title"),
  host: document.querySelector("#host-preview"),
  currentLabel: document.querySelector("#current-label span"),
  status: document.querySelector("#status"),
  suggestions: document.querySelector("#suggestions"),
  favorites: document.querySelector("#favorites-list"),
  recent: document.querySelector("#recent-list"),
  clearRecent: document.querySelector("#clear-recent"),
  saveFavorite: document.querySelector("#save-favorite"),
  excludedChoice: document.querySelector("#excluded-choice"),
  allowExcluded: document.querySelector("#allow-excluded"),
  ruleStatus: document.querySelector("#rule-status"),
  rulePreview: document.querySelector("#rule-preview"),
  createExact: document.querySelector("#create-exact"),
  createPrefix: document.querySelector("#create-prefix"),
  pauseRule: document.querySelector("#pause-rule"),
  resumeRule: document.querySelector("#resume-rule"),
  openManager: document.querySelector("#open-manager"),
  openOptions: document.querySelector("#open-options")
};

let state = null;
let busy = false;
let suggestions = [];
let activeSuggestion = -1;

async function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function showStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = ("status " + kind).trim();
  elements.status.setAttribute("role", kind === "error" ? "alert" : "status");
}

function setBusy(nextBusy) {
  busy = nextBusy;
  const disabled = busy || !state || !state.editable;
  [
    elements.input,
    elements.clear,
    elements.save,
    elements.saveFavorite,
    elements.createExact,
    elements.createPrefix,
    elements.pauseRule,
    elements.resumeRule
  ].forEach((element) => {
    element.disabled = disabled;
  });
  elements.restore.disabled = disabled || !state.record || !state.record.customTitle;
  elements.save.textContent = busy ? "處理中…" : "儲存名稱";
}

function setTitlePreview(title) {
  const preview = title || "（無標題）";
  elements.title.textContent = preview;
  elements.title.title = preview;
}

function renderCollectionButtons(container, values, source) {
  container.replaceChildren();
  if (!values.length) {
    const empty = document.createElement("span");
    empty.className = "empty-note";
    empty.textContent = source === "favorite" ? "尚未收藏名稱" : "尚未使用名稱";
    container.append(empty);
    return;
  }
  values.forEach((item) => {
    const entry = document.createElement("span");
    entry.className = "chip-entry";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip-button";
    button.textContent = typeof item === "string" ? item : item.label;
    button.title = "填入「" + button.textContent + "」";
    button.addEventListener("click", () => {
      elements.input.value = button.textContent;
      elements.input.focus();
      showStatus("");
    });
    entry.append(button);
    if (source === "recent") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "移除最近名稱 " + button.textContent);
      remove.addEventListener("click", async () => {
        const result = await sendMessage("remove-recent", { label: button.textContent });
        if (result && result.ok) {
          state.settings = result.settings;
          renderCollections();
        }
      });
      entry.append(remove);
    }
    container.append(entry);
  });
}

function renderCollections() {
  const settings = state && state.settings ? state.settings : { favorites: [], recentNames: [] };
  renderCollectionButtons(elements.favorites, settings.favorites || [], "favorite");
  renderCollectionButtons(elements.recent, settings.recentNames || [], "recent");
}

function renderSuggestions() {
  suggestions = core.autocompleteSuggestions(
    elements.input.value,
    state && state.settings ? state.settings.favorites : [],
    state && state.settings ? state.settings.recentNames : []
  );
  elements.suggestions.replaceChildren();
  activeSuggestion = -1;
  if (!suggestions.length || !elements.input.value.trim()) {
    elements.suggestions.hidden = true;
    return;
  }
  suggestions.forEach((suggestion, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.textContent = suggestion.label;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      elements.input.value = suggestion.label;
      closeSuggestions();
      elements.input.focus();
      void handleSave();
    });
    item.append(button);
    elements.suggestions.append(item);
  });
  elements.suggestions.hidden = false;
}

function closeSuggestions() {
  elements.suggestions.hidden = true;
  activeSuggestion = -1;
}

function moveSuggestion(direction) {
  if (!suggestions.length) {
    return;
  }
  activeSuggestion = (activeSuggestion + direction + suggestions.length) % suggestions.length;
  Array.from(elements.suggestions.querySelectorAll("button")).forEach((button, index) => {
    button.setAttribute("aria-selected", String(index === activeSuggestion));
  });
}

function renderRuleState() {
  if (!state || !state.tab) {
    return;
  }
  const patternExact = state.tab.url || "";
  let patternPrefix = patternExact;
  try {
    const url = new URL(patternExact);
    patternPrefix = url.origin + (url.pathname.endsWith("/") ? url.pathname : url.pathname + "/");
  } catch {
    // Protected pages are handled by the main state.
  }
  elements.rulePreview.textContent = state.record && state.record.customTitle
    ? "完整：" + patternExact + "｜範圍：" + patternPrefix
    : "先儲存目前名稱，再建立 exact 或安全的網址前綴規則。";
  if (state.matchingRule) {
    elements.ruleStatus.textContent = state.autoRulePaused
      ? "目前已暫停"
      : "目前匹配：" + state.matchingRule.label;
  } else {
    elements.ruleStatus.textContent = "";
  }
  elements.pauseRule.disabled = Boolean(state.autoRulePaused) || !state.record;
  elements.resumeRule.disabled = !state.autoRulePaused;
}

function render(nextState) {
  state = nextState;
  const record = state.record;
  const customLabel = record && record.customTitle ? record.customTitle : "未設定";
  setTitlePreview(state.websiteTitle || (state.tab && state.tab.title));
  elements.host.textContent = state.tab && state.tab.hostname ? state.tab.hostname : "";
  elements.currentLabel.textContent = customLabel;
  elements.input.value = record && record.customTitle ? record.customTitle : "";
  elements.excludedChoice.hidden = !state.excluded;
  elements.allowExcluded.checked = false;
  elements.allowExcluded.disabled = !state.excluded;
  if (!state.editable) {
    showStatus(state.message || "Chrome 不允許 Extension 修改此頁面。", "error");
  } else if (state.excluded) {
    showStatus(state.message, "error");
  } else {
    showStatus("");
  }
  renderCollections();
  renderRuleState();
  setBusy(false);
}

async function loadState() {
  try {
    const result = await sendMessage("get-active-state");
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "無法取得目前分頁。");
    }
    render(result);
  } catch (error) {
    state = { editable: false, record: null, settings: { favorites: [], recentNames: [] }, tab: {} };
    setTitlePreview("");
    elements.currentLabel.textContent = "未設定";
    showStatus(error.message || "無法取得目前分頁。", "error");
    setBusy(false);
  }
}

async function handleSave(event) {
  if (event) {
    event.preventDefault();
  }
  if (busy || !state || !state.editable) {
    return;
  }
  closeSuggestions();
  const label = elements.input.value;
  if (!core.normalizeLabel(label)) {
    elements.input.setAttribute("aria-invalid", "true");
    showStatus("請先輸入分頁名稱，不能儲存空白名稱。", "error");
    elements.input.focus();
    return;
  }
  setBusy(true);
  try {
    const result = await sendMessage("save-label", {
      label,
      allowExcluded: elements.allowExcluded.checked
    });
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "儲存失敗，請再試一次。");
    }
    state.record = result.record;
    state.websiteTitle = result.websiteTitle || state.websiteTitle;
    state.settings = result.settings || state.settings;
    elements.input.value = result.record.customTitle;
    elements.currentLabel.textContent = result.record.customTitle;
    elements.input.setAttribute("aria-invalid", "false");
    showStatus("已儲存，這個名稱只套用於目前分頁。", "success");
    renderCollections();
    renderRuleState();
  } catch (error) {
    showStatus(error.message || "儲存失敗，請再試一次。", "error");
  } finally {
    setBusy(false);
  }
}

async function handleRestore() {
  if (busy || !state || !state.editable || !state.record || !state.record.customTitle) {
    return;
  }
  setBusy(true);
  try {
    const result = await sendMessage("restore-label");
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "恢復失敗，請再試一次。");
    }
    state.record.customTitle = "";
    state.record.label = "";
    state.websiteTitle = result.websiteTitle || state.websiteTitle;
    elements.input.value = "";
    elements.currentLabel.textContent = "未設定";
    setTitlePreview(state.websiteTitle);
    showStatus("已恢復原始分頁名稱。", "success");
    renderRuleState();
  } catch (error) {
    showStatus(error.message || "恢復失敗，請再試一次。", "error");
  } finally {
    setBusy(false);
  }
}

async function handleSaveFavorite() {
  const label = core.normalizeLabel(elements.input.value || (state && state.record && state.record.customTitle));
  if (!label) {
    showStatus("請先輸入或儲存名稱，再加入收藏。", "error");
    elements.input.focus();
    return;
  }
  const result = await sendMessage("save-favorite", { label });
  if (!result || !result.ok) {
    showStatus(result && result.message ? result.message : "加入收藏失敗。", "error");
    return;
  }
  state.settings = result.settings;
  showStatus("已加入收藏；收藏會保留在本機設定。", "success");
  renderCollections();
}

async function handleCreateRule(matchType) {
  if (!state || !state.record || !state.record.customTitle) {
    showStatus("請先儲存目前分頁名稱，再建立規則。", "error");
    return;
  }
  setBusy(true);
  try {
    let result = await sendMessage("create-rule", {
      tabUrl: state.tab.url,
      matchType,
      label: state.record.customTitle
    });
    if (result && result.needsPermission && result.originPattern) {
      const granted = await chrome.permissions.request({ origins: [result.originPattern] });
      if (!granted) {
        throw new Error("你拒絕了 " + result.originPattern + " 的網站權限；規則尚未建立。");
      }
      result = await sendMessage("create-rule", {
        tabUrl: state.tab.url,
        matchType,
        label: state.record.customTitle
      });
    }
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "建立規則失敗。");
    }
    showStatus("已建立 " + (matchType === "exact" ? "完整網址" : "網址範圍") + " 規則。", "success");
    state.matchingRule = result.rule;
    renderRuleState();
  } catch (error) {
    showStatus(error.message || "建立規則失敗。", "error");
  } finally {
    setBusy(false);
  }
}

async function handlePause(paused) {
  setBusy(true);
  try {
    const result = await sendMessage("set-auto-pause", { paused });
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "更新規則暫停狀態失敗。");
    }
    state.autoRulePaused = paused;
    showStatus(paused ? "已暫停此分頁的自動命名。" : "已重新允許此分頁套用自動規則。", "success");
    renderRuleState();
  } catch (error) {
    showStatus(error.message || "更新規則暫停狀態失敗。", "error");
  } finally {
    setBusy(false);
  }
}

elements.form.addEventListener("submit", handleSave);
elements.restore.addEventListener("click", handleRestore);
elements.saveFavorite.addEventListener("click", handleSaveFavorite);
elements.createExact.addEventListener("click", () => void handleCreateRule("exact"));
elements.createPrefix.addEventListener("click", () => void handleCreateRule("prefix"));
elements.pauseRule.addEventListener("click", () => void handlePause(true));
elements.resumeRule.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await sendMessage("reapply-auto-rule");
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "重新套用規則失敗。");
    }
    await loadState();
    showStatus("已重新套用符合的自動規則。", "success");
  } catch (error) {
    showStatus(error.message || "重新套用規則失敗。", "error");
    setBusy(false);
  }
});
elements.clear.addEventListener("click", () => {
  elements.input.value = "";
  closeSuggestions();
  elements.input.setAttribute("aria-invalid", "false");
  showStatus("");
  elements.input.focus();
});
elements.clearRecent.addEventListener("click", async () => {
  const result = await sendMessage("clear-data", { kind: "recent" });
  if (result && result.ok) {
    state.settings = result.settings;
    renderCollections();
    showStatus("已清除最近使用名稱。", "success");
  }
});
elements.input.addEventListener("input", () => {
  elements.input.setAttribute("aria-invalid", "false");
  renderSuggestions();
});
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSuggestion(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSuggestion(-1);
  } else if (event.key === "Escape") {
    closeSuggestions();
  } else if (event.key === "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
    event.preventDefault();
    elements.input.value = suggestions[activeSuggestion].label;
    closeSuggestions();
    void handleSave();
  }
});
elements.openManager.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("tab-manager.html") });
});
elements.openOptions.addEventListener("click", () => void chrome.runtime.openOptionsPage());
document.addEventListener("click", (event) => {
  if (!elements.form.contains(event.target)) {
    closeSuggestions();
  }
});

void loadState();

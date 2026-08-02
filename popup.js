const elements = {
  form: document.querySelector("#label-form"),
  input: document.querySelector("#label-input"),
  clear: document.querySelector("#clear-input"),
  save: document.querySelector("#save-button"),
  restore: document.querySelector("#restore-button"),
  title: document.querySelector("#original-title"),
  currentLabel: document.querySelector("#current-label span"),
  status: document.querySelector("#status")
};

let state = null;
let busy = false;

async function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function showStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`.trim();
  elements.status.setAttribute("role", kind === "error" ? "alert" : "status");
}

function setBusy(nextBusy) {
  busy = nextBusy;
  const disabled = busy || !state || !state.editable;
  elements.input.disabled = disabled;
  elements.clear.disabled = disabled;
  elements.save.disabled = disabled;
  elements.restore.disabled = disabled || !state.record;
  elements.save.textContent = busy ? "處理中…" : "儲存名稱";
}

function setTitlePreview(title) {
  const preview = title || "（無標題）";
  elements.title.textContent = preview;
  elements.title.title = preview;
}

function render(nextState) {
  state = nextState;
  const record = state.record;
  const customLabel = record ? record.label : "未設定";

  setTitlePreview(state.websiteTitle || (state.tab && state.tab.title));
  elements.currentLabel.textContent = customLabel;
  elements.input.value = record ? record.label : "";
  elements.input.setAttribute("aria-invalid", "false");

  if (!state.editable) {
    showStatus(state.message || "Chrome 不允許 Extension 修改此頁面的分頁名稱。", "error");
  } else {
    showStatus("");
  }

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
    state = { editable: false, record: null };
    setTitlePreview("");
    elements.currentLabel.textContent = "未設定";
    showStatus(error.message || "無法取得目前分頁。", "error");
    setBusy(false);
  }
}

async function handleSave(event) {
  event.preventDefault();

  if (busy || !state || !state.editable) {
    return;
  }

  const label = elements.input.value.trim();
  if (!label) {
    elements.input.setAttribute("aria-invalid", "true");
    showStatus("請先輸入分頁名稱，不能儲存空白名稱。", "error");
    elements.input.focus();
    return;
  }

  setBusy(true);
  try {
    const result = await sendMessage("save-label", { label });
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "儲存失敗，請再試一次。");
    }

    state.record = result.record;
    state.websiteTitle = result.websiteTitle || state.websiteTitle;
    elements.input.setAttribute("aria-invalid", "false");
    elements.currentLabel.textContent = result.record.label;
    showStatus("已儲存，這個名稱只套用於目前分頁。", "success");
  } catch (error) {
    showStatus(error.message || "儲存失敗，請再試一次。", "error");
  } finally {
    setBusy(false);
  }
}

async function handleRestore() {
  if (busy || !state || !state.editable || !state.record) {
    return;
  }

  setBusy(true);
  try {
    const result = await sendMessage("restore-label");
    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : "恢復失敗，請再試一次。");
    }

    state.record = null;
    state.websiteTitle = result.websiteTitle || state.websiteTitle;
    elements.input.value = "";
    elements.currentLabel.textContent = "未設定";
    setTitlePreview(state.websiteTitle);
    showStatus("已恢復網站原本的分頁名稱。", "success");
  } catch (error) {
    showStatus(error.message || "恢復失敗，請再試一次。", "error");
  } finally {
    setBusy(false);
  }
}

elements.form.addEventListener("submit", handleSave);
elements.restore.addEventListener("click", handleRestore);
elements.clear.addEventListener("click", () => {
  if (busy || !state || !state.editable) {
    return;
  }
  elements.input.value = "";
  elements.input.setAttribute("aria-invalid", "false");
  showStatus("");
  elements.input.focus();
});

void loadState();

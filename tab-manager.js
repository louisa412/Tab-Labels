const elements = {
  search: document.querySelector("#search"),
  list: document.querySelector("#tabs-list"),
  status: document.querySelector("#status"),
  refresh: document.querySelector("#refresh")
};
let items = [];

async function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function showStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = ("status " + kind).trim();
}

function filteredItems() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  if (!query) {
    return items;
  }
  return items.filter((item) => (
    item.title.toLocaleLowerCase().includes(query)
    || item.hostname.toLocaleLowerCase().includes(query)
  ));
}

function makeButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function render() {
  elements.list.replaceChildren();
  const visible = filteredItems();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = items.length ? "找不到符合搜尋字詞的已命名分頁。" : "目前沒有由 Tab Labels 命名的分頁。";
    elements.list.append(empty);
    return;
  }
  visible.forEach((item) => {
    const card = document.createElement("article");
    card.className = "tab-card" + (item.active ? " current" : "");
    const icon = document.createElement("img");
    icon.className = "tab-icon";
    icon.alt = "";
    if (item.faviconUrl) {
      icon.src = item.faviconUrl;
    } else {
      icon.classList.add("tab-icon-fallback");
      icon.alt = "網站 favicon";
    }
    const main = document.createElement("div");
    main.className = "tab-main";
    main.tabIndex = 0;
    main.setAttribute("role", "button");
    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = item.title;
    if (item.active) {
      const badge = document.createElement("span");
      badge.className = "tab-badge";
      badge.textContent = "目前分頁";
      title.append(badge);
    }
    const meta = document.createElement("div");
    meta.className = "tab-meta";
    meta.textContent = item.hostname + " · 視窗 " + item.windowId;
    if (item.paused) {
      meta.append(document.createTextNode(" · 自動規則已暫停"));
    }
    main.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "tab-actions";
    actions.append(
      makeButton("切換", "", () => void focusItem(item)),
      makeButton("恢復原名", "", () => void restoreItem(item)),
      makeButton("關閉", "danger", () => void closeItem(item))
    );
    main.addEventListener("click", () => void focusItem(item));
    main.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void focusItem(item);
      }
    });
    card.append(icon, main, actions);
    elements.list.append(card);
  });
}

async function load() {
  const result = await sendMessage("get-named-tabs");
  if (!result || !result.ok) {
    showStatus("無法取得已命名分頁。", "error");
    return;
  }
  items = result.items || [];
  render();
  showStatus(items.length ? "共 " + items.length + " 個已命名分頁。" : "");
}

async function focusItem(item) {
  const result = await sendMessage("focus-tab", { tabId: item.tabId, windowId: item.windowId });
  if (!result || !result.ok) {
    showStatus(result && result.message ? result.message : "無法切換分頁。", "error");
    await load();
  }
}

async function restoreItem(item) {
  let result = await sendMessage("restore-label", { tabId: item.tabId });
  if (result && result.needsPermission && result.originPattern) {
    const granted = await chrome.permissions.request({ origins: [result.originPattern] });
    if (granted) {
      result = await sendMessage("restore-label", { tabId: item.tabId });
    } else {
      showStatus("未授權 " + result.originPattern + "；分頁名稱未變更。", "error");
      return;
    }
  }
  if (!result || !result.ok) {
    showStatus(result && result.message ? result.message : "無法恢復原名。", "error");
    return;
  }
  showStatus("已恢復「" + item.title + "」的原始名稱。", "success");
  await load();
}

async function closeItem(item) {
  if (!window.confirm("確定關閉「" + item.title + "」這個 Chrome 分頁嗎？")) {
    return;
  }
  const result = await sendMessage("close-tab", { tabId: item.tabId });
  if (!result || !result.ok) {
    showStatus(result && result.message ? result.message : "無法關閉分頁。", "error");
    return;
  }
  showStatus("已關閉分頁。", "success");
  await load();
}

elements.search.addEventListener("input", render);
elements.refresh.addEventListener("click", () => void load());
void load();

const STORAGE_KEY = "labelsByTab";

function isScriptableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function unsupportedMessage() {
  return "Chrome 不允許 Extension 修改此頁面的分頁名稱。";
}

async function getRecords() {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function saveRecord(tabId, record) {
  const records = await getRecords();
  records[String(tabId)] = record;
  await chrome.storage.session.set({ [STORAGE_KEY]: records });
}

async function removeRecord(tabId) {
  const records = await getRecords();
  const key = String(tabId);

  if (!(key in records)) {
    return;
  }

  delete records[key];
  await chrome.storage.session.set({ [STORAGE_KEY]: records });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function executeInTab(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
}

function readTitleState(expectedLabel) {
  const controller = globalThis.__tabLabelsController__;
  const currentTitle = document.title || "";
  const controllerIsForLabel = controller && controller.active && controller.label === expectedLabel;
  const websiteTitle = controllerIsForLabel
    ? controller.lastWebsiteTitle
    : currentTitle;

  return {
    currentTitle,
    websiteTitle: websiteTitle || currentTitle
  };
}

function installTitleController(label, originalTitle) {
  const previous = globalThis.__tabLabelsController__;
  const previousWebsiteTitle = previous && previous.active
    ? previous.lastWebsiteTitle
    : "";

  if (previous && typeof previous.stop === "function") {
    previous.stop();
  }

  const currentTitle = document.title || "";
  const controller = {
    active: true,
    label,
    originalTitle,
    lastWebsiteTitle: previousWebsiteTitle || (currentTitle === label ? originalTitle : currentTitle),
    observer: null,
    stop() {
      this.active = false;
      if (this.observer) {
        this.observer.disconnect();
      }
    }
  };

  const applyLabel = () => {
    if (!controller.active) {
      return;
    }

    const pageTitle = document.title || "";
    if (pageTitle && pageTitle !== label) {
      controller.lastWebsiteTitle = pageTitle;
    }

    if (document.title !== label) {
      document.title = label;
    }
  };

  const observer = new MutationObserver(() => {
    if (!controller.active) {
      return;
    }

    const pageTitle = document.title || "";
    if (pageTitle && pageTitle !== label) {
      controller.lastWebsiteTitle = pageTitle;
      queueMicrotask(applyLabel);
    }
  });

  controller.observer = observer;
  globalThis.__tabLabelsController__ = controller;

  if (document.head) {
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  applyLabel();
  return { currentTitle: document.title };
}

function stopTitleControllerAndRestore(label, fallbackTitle) {
  const controller = globalThis.__tabLabelsController__;
  const currentTitle = document.title || "";
  const latestWebsiteTitle = controller && controller.active
    ? controller.lastWebsiteTitle
    : "";

  if (controller && typeof controller.stop === "function") {
    controller.stop();
  }

  const restoredTitle = latestWebsiteTitle && latestWebsiteTitle !== label
    ? latestWebsiteTitle
    : (currentTitle !== label ? currentTitle : fallbackTitle);

  if (restoredTitle) {
    document.title = restoredTitle;
  }

  delete globalThis.__tabLabelsController__;
  return { currentTitle: document.title || "" };
}

async function getActiveState() {
  const tab = await getActiveTab();

  if (!tab || typeof tab.id !== "number") {
    return { ok: false, message: "無法取得目前分頁。" };
  }

  const editable = isScriptableUrl(tab.url);
  const records = await getRecords();
  const record = records[String(tab.id)] || null;
  let websiteTitle = tab.title || "";

  if (!editable) {
    return {
      ok: true,
      editable: false,
      message: unsupportedMessage(tab.url),
      tab: { id: tab.id, title: tab.title || "", url: tab.url || "" },
      record,
      websiteTitle
    };
  }

  if (record) {
    try {
      const [result] = await executeInTab(tab.id, readTitleState, [record.label]);
      websiteTitle = result && result.result && result.result.websiteTitle
        ? result.result.websiteTitle
        : websiteTitle;
      await executeInTab(tab.id, installTitleController, [record.label, record.originalTitle]);
    } catch {
      // The popup can still show the saved state; a later user gesture can retry injection.
    }
  }

  return {
    ok: true,
    editable: true,
    tab: { id: tab.id, title: tab.title || "", url: tab.url || "" },
    record,
    websiteTitle
  };
}

async function saveLabel(label) {
  const tab = await getActiveTab();

  if (!tab || typeof tab.id !== "number") {
    return { ok: false, message: "無法取得目前分頁。" };
  }

  if (!isScriptableUrl(tab.url)) {
    return { ok: false, message: unsupportedMessage(tab.url) };
  }

  const records = await getRecords();
  const key = String(tab.id);
  const previous = records[key] || null;
  let titleState;

  try {
    [titleState] = await executeInTab(tab.id, readTitleState, [previous ? previous.label : ""]);
  } catch {
    return { ok: false, message: unsupportedMessage(tab.url) };
  }

  const originalTitle = previous && previous.originalTitle
    ? previous.originalTitle
    : ((titleState && titleState.result && titleState.result.websiteTitle) || tab.title || "");
  const record = { label, originalTitle };

  try {
    await saveRecord(tab.id, record);
    await executeInTab(tab.id, installTitleController, [label, originalTitle]);
  } catch {
    if (!previous) {
      await removeRecord(tab.id);
    }
    return { ok: false, message: unsupportedMessage(tab.url) };
  }

  return { ok: true, record, websiteTitle: originalTitle };
}

async function restoreLabel() {
  const tab = await getActiveTab();

  if (!tab || typeof tab.id !== "number") {
    return { ok: false, message: "無法取得目前分頁。" };
  }

  if (!isScriptableUrl(tab.url)) {
    return { ok: false, message: unsupportedMessage(tab.url) };
  }

  const records = await getRecords();
  const key = String(tab.id);
  const record = records[key];

  if (!record) {
    return { ok: false, message: "目前沒有自訂名稱可恢復。" };
  }

  // Remove the record before restoring the DOM title so an update event cannot reinstall it.
  delete records[key];
  await chrome.storage.session.set({ [STORAGE_KEY]: records });

  try {
    const [result] = await executeInTab(tab.id, stopTitleControllerAndRestore, [record.label, record.originalTitle]);
    return {
      ok: true,
      websiteTitle: result && result.result ? result.result.currentTitle : record.originalTitle
    };
  } catch {
    return { ok: false, message: unsupportedMessage(tab.url) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation;

  if (message && message.type === "get-active-state") {
    operation = getActiveState();
  } else if (message && message.type === "save-label") {
    operation = saveLabel(typeof message.label === "string" ? message.label.trim() : "");
  } else if (message && message.type === "restore-label") {
    operation = restoreLabel();
  } else {
    return false;
  }

  operation
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, message: error && error.message ? error.message : "操作失敗，請再試一次。" });
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  void (async () => {
    const records = await getRecords();
    const record = records[String(tabId)];

    if (!record) {
      return;
    }

    try {
      const tabs = await chrome.tabs.get(tabId);
      if (isScriptableUrl(tabs.url)) {
        await executeInTab(tabId, installTitleController, [record.label, record.originalTitle]);
      }
    } catch {
      // Protected pages and pages without activeTab access are intentionally ignored.
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeRecord(tabId);
});

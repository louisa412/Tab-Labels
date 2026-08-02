importScripts("core.js");

const {
  SCHEMA_VERSION,
  addRecentName,
  applyImportMode,
  chooseMatchingRule,
  createDefaultSettings,
  createRuleKey,
  faviconDataUrl,
  getTabLoadAction,
  isExcludedUrl,
  isNamedRecord,
  isProtectedUrl,
  mergeSettings,
  migrateSettings,
  normalizeFaviconConfig,
  normalizeLabel,
  normalizeOrigin,
  normalizeRule,
  originPermissionPattern,
  sanitizeSettings,
  validateImportPayload
} = TabLabelsCore;

const SESSION_KEY = "labelsByTab";
const SETTINGS_KEY = "tabLabelsSettings";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

function isScriptableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) && !isProtectedUrl(url);
}

function unsupportedMessage() {
  return "Chrome 不允許 Extension 修改此頁面的分頁名稱或 favicon。";
}

function excludedMessage(origin) {
  return "此網站已加入排除清單：" + origin + "。若要只在本次手動操作，請先勾選允許。";
}

async function getSessionRecords() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  const raw = result[SESSION_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const records = {};
  Object.keys(raw).forEach((key) => {
    const source = raw[key];
    if (!source || typeof source !== "object") {
      return;
    }

    const customTitle = normalizeLabel(
      typeof source.customTitle === "string" ? source.customTitle : source.label
    );
    records[key] = {
      ...source,
      tabId: Number.isFinite(Number(source.tabId)) ? Number(source.tabId) : Number(key),
      customTitle,
      label: customTitle,
      originalTitle: typeof source.originalTitle === "string" ? source.originalTitle : "",
      originalFavicon: source.originalFavicon && typeof source.originalFavicon === "object"
        ? source.originalFavicon
        : null,
      customFavicon: normalizeFaviconConfig(source.customFavicon),
      autoRulePaused: source.autoRulePaused === true,
      source: source.source === "auto" ? "auto" : "manual",
      pageUrl: typeof source.pageUrl === "string" ? source.pageUrl : ""
    };
  });
  return records;
}

async function saveSessionRecords(records) {
  await chrome.storage.session.set({ [SESSION_KEY]: records });
}

async function saveSessionRecord(tabId, record) {
  const records = await getSessionRecords();
  records[String(tabId)] = { ...record, tabId };
  await saveSessionRecords(records);
}

async function removeSessionRecord(tabId) {
  const records = await getSessionRecords();
  const key = String(tabId);
  if (!Object.prototype.hasOwnProperty.call(records, key)) {
    return;
  }
  delete records[key];
  await saveSessionRecords(records);
}

function recordHasCustomState(record) {
  return Boolean(record && (
    record.customTitle
    || record.customFavicon
    || record.autoRulePaused
  ));
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = result[SETTINGS_KEY];
  const settings = migrateSettings(raw || createDefaultSettings());
  if (!raw || raw.schemaVersion !== SCHEMA_VERSION || JSON.stringify(raw) !== JSON.stringify(settings)) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }
  return settings;
}

async function saveSettings(settings) {
  const migrated = migrateSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
  return migrated;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getTab(tabId) {
  if (typeof tabId !== "number") {
    return getActiveTab();
  }
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function executeInTab(tabId, func, args) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: Array.isArray(args) ? args : []
  });
}

function readPageState(expectedTitle, expectedFaviconUrl) {
  function findIcon() {
    if (!document.head) {
      return null;
    }
    return Array.from(document.head.querySelectorAll("link[rel]"))
      .find((link) => /\bicon\b/i.test(link.rel || "")) || null;
  }

  function serializeIcon(link) {
    if (!link) {
      return null;
    }
    return {
      href: link.href || link.getAttribute("href") || "",
      rel: link.getAttribute("rel") || "icon",
      type: link.getAttribute("type") || "",
      sizes: link.getAttribute("sizes") || ""
    };
  }

  const controller = globalThis.__tabLabelsController__;
  const currentTitle = document.title || "";
  const icon = findIcon();
  const currentFavicon = serializeIcon(icon);
  const isCurrentTitleManaged = controller && controller.active && controller.label === expectedTitle;
  const isCurrentFaviconManaged = controller
    && controller.active
    && controller.customFaviconUrl
    && controller.customFaviconUrl === expectedFaviconUrl;

  return {
    currentTitle,
    websiteTitle: isCurrentTitleManaged
      ? (controller.lastWebsiteTitle || controller.originalTitle || currentTitle)
      : currentTitle,
    originalFavicon: controller && controller.active && controller.originalFavicon
      ? controller.originalFavicon
      : currentFavicon,
    currentFavicon,
    faviconManaged: Boolean(isCurrentFaviconManaged)
  };
}

function installTabController(label, originalTitle, originalFavicon, customFaviconUrl) {
  function findIcon() {
    if (!document.head) {
      return null;
    }
    return Array.from(document.head.querySelectorAll("link[rel]"))
      .find((link) => /\bicon\b/i.test(link.rel || "")) || null;
  }

  function serializeIcon(link) {
    if (!link) {
      return null;
    }
    return {
      href: link.href || link.getAttribute("href") || "",
      rel: link.getAttribute("rel") || "icon",
      type: link.getAttribute("type") || "",
      sizes: link.getAttribute("sizes") || ""
    };
  }

  function applyIconState(link, state) {
    if (!link || !state) {
      return;
    }
    if (state.rel) {
      link.setAttribute("rel", state.rel);
    }
    if (state.type) {
      link.setAttribute("type", state.type);
    } else {
      link.removeAttribute("type");
    }
    if (state.sizes) {
      link.setAttribute("sizes", state.sizes);
    } else {
      link.removeAttribute("sizes");
    }
    if (state.href) {
      link.setAttribute("href", state.href);
    } else {
      link.removeAttribute("href");
    }
  }

  const previous = globalThis.__tabLabelsController__;
  if (previous && typeof previous.stop === "function") {
    previous.stop();
  }

  const currentTitle = document.title || "";
  const currentIcon = serializeIcon(findIcon());
  const previousTitle = previous && previous.active ? previous.lastWebsiteTitle : "";
  const previousFavicon = previous && previous.active ? previous.lastWebsiteFavicon : null;
  const controller = {
    active: true,
    label: label || "",
    originalTitle: originalTitle || currentTitle,
    originalFavicon: originalFavicon || previousFavicon || currentIcon,
    customFaviconUrl: customFaviconUrl || "",
    lastWebsiteTitle: previousTitle || (currentTitle !== label ? currentTitle : (originalTitle || "")),
    lastWebsiteFavicon: previousFavicon || originalFavicon || currentIcon,
    observer: null,
    applying: false,
    stop() {
      this.active = false;
      if (this.observer) {
        this.observer.disconnect();
      }
    },
    restoreTitle(fallbackTitle) {
      const restoredTitle = this.lastWebsiteTitle && this.lastWebsiteTitle !== this.label
        ? this.lastWebsiteTitle
        : (fallbackTitle || this.originalTitle);
      if (restoredTitle) {
        document.title = restoredTitle;
      }
      this.label = "";
    },
    restoreFavicon() {
      const managedLink = document.querySelector("link[data-tab-labels-managed=\"true\"]");
      const latestWebsiteFavicon = this.lastWebsiteFavicon || this.originalFavicon;
      if (managedLink && managedLink.getAttribute("data-tab-labels-injected") === "true") {
        if (!latestWebsiteFavicon) {
          managedLink.remove();
        } else {
          applyIconState(managedLink, latestWebsiteFavicon);
          managedLink.removeAttribute("data-tab-labels-managed");
          managedLink.removeAttribute("data-tab-labels-injected");
        }
      } else if (managedLink && latestWebsiteFavicon) {
        applyIconState(managedLink, latestWebsiteFavicon);
        managedLink.removeAttribute("data-tab-labels-managed");
      }
      this.customFaviconUrl = "";
    }
  };

  function applyTitle() {
    if (!controller.active || !controller.label) {
      return;
    }
    const pageTitle = document.title || "";
    if (pageTitle && pageTitle !== controller.label) {
      controller.lastWebsiteTitle = pageTitle;
    }
    if (document.title !== controller.label) {
      document.title = controller.label;
    }
  }

  function applyFavicon() {
    if (!controller.active || !controller.customFaviconUrl || !document.head) {
      return;
    }
    let icon = findIcon();
    if (!icon) {
      icon = document.createElement("link");
      icon.setAttribute("rel", "icon");
      icon.setAttribute("data-tab-labels-injected", "true");
      document.head.appendChild(icon);
    } else {
      const current = serializeIcon(icon);
      if (current && current.href && current.href !== controller.customFaviconUrl) {
        controller.lastWebsiteFavicon = current;
      }
    }
    icon.setAttribute("data-tab-labels-managed", "true");
    if (icon.getAttribute("href") !== controller.customFaviconUrl) {
      controller.applying = true;
      icon.setAttribute("href", controller.customFaviconUrl);
      controller.applying = false;
    }
  }

  function applyAll() {
    applyTitle();
    applyFavicon();
  }

  const observer = new MutationObserver(() => {
    if (!controller.active) {
      return;
    }

    const pageTitle = document.title || "";
    if (controller.label && pageTitle && pageTitle !== controller.label) {
      controller.lastWebsiteTitle = pageTitle;
    }

    if (controller.customFaviconUrl) {
      const icon = findIcon();
      const current = serializeIcon(icon);
      if (current && current.href && current.href !== controller.customFaviconUrl && !controller.applying) {
        controller.lastWebsiteFavicon = current;
      }
    }

    queueMicrotask(applyAll);
  });
  controller.observer = observer;
  globalThis.__tabLabelsController__ = controller;

  if (document.head) {
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel", "type", "sizes"]
    });
  }
  applyAll();
  return {
    currentTitle: document.title || "",
    currentFavicon: serializeIcon(findIcon())
  };
}

function disableTitleInController(fallbackTitle) {
  const controller = globalThis.__tabLabelsController__;
  if (!controller || !controller.active) {
    if (fallbackTitle) {
      document.title = fallbackTitle;
    }
    return { currentTitle: document.title || "" };
  }
  controller.restoreTitle(fallbackTitle);
  if (!controller.customFaviconUrl) {
    controller.stop();
    delete globalThis.__tabLabelsController__;
  }
  return { currentTitle: document.title || "" };
}

function disableFaviconInController() {
  const controller = globalThis.__tabLabelsController__;
  if (!controller || !controller.active) {
    return { currentFavicon: null };
  }
  controller.restoreFavicon();
  if (!controller.label) {
    controller.stop();
    delete globalThis.__tabLabelsController__;
  }
  const icon = document.head
    ? Array.from(document.head.querySelectorAll("link[rel]")).find((link) => /\bicon\b/i.test(link.rel || ""))
    : null;
  return {
    currentFavicon: icon
      ? {
        href: icon.href || icon.getAttribute("href") || "",
        rel: icon.getAttribute("rel") || "icon"
      }
      : null
  };
}

function restoreEverythingInController(label, fallbackTitle) {
  const controller = globalThis.__tabLabelsController__;
  if (controller && controller.active) {
    if (controller.label) {
      controller.restoreTitle(fallbackTitle);
    }
    if (controller.customFaviconUrl) {
      controller.restoreFavicon();
    }
    controller.stop();
    delete globalThis.__tabLabelsController__;
  } else if (fallbackTitle && document.title === label) {
    document.title = fallbackTitle;
  }
  return { currentTitle: document.title || "" };
}

async function readTabPageState(tab, previous) {
  const faviconUrl = previous && previous.customFavicon
    ? faviconDataUrl(previous.customFavicon)
    : "";
  try {
    const results = await executeInTab(tab.id, readPageState, [
      previous ? previous.customTitle : "",
      faviconUrl
    ]);
    return results[0] && results[0].result
      ? results[0].result
      : { websiteTitle: tab.title || "", originalFavicon: null };
  } catch {
    throw new Error(unsupportedMessage());
  }
}

function makeRecord(tab, previous, pageState, values) {
  const samePage = previous && (!previous.pageUrl || previous.pageUrl === tab.url);
  const customTitle = normalizeLabel(values.customTitle !== undefined
    ? values.customTitle
    : (previous ? previous.customTitle : ""));
  const customFavicon = values.customFavicon !== undefined
    ? normalizeFaviconConfig(values.customFavicon)
    : (previous ? previous.customFavicon : null);

  return {
    ...(previous || {}),
    tabId: tab.id,
    customTitle,
    label: customTitle,
    originalTitle: samePage && previous && previous.originalTitle
      ? previous.originalTitle
      : (pageState.websiteTitle || tab.title || ""),
    originalFavicon: samePage && previous && previous.originalFavicon
      ? previous.originalFavicon
      : (pageState.originalFavicon || null),
    customFavicon,
    autoRulePaused: previous ? previous.autoRulePaused === true : false,
    source: values.source || (previous ? previous.source : "manual"),
    autoRuleId: values.autoRuleId !== undefined ? values.autoRuleId : (previous ? previous.autoRuleId || "" : ""),
    pageUrl: tab.url || "",
    injected: {
      title: Boolean(customTitle),
      favicon: Boolean(customFavicon)
    }
  };
}

async function installRecord(tab, record) {
  await executeInTab(tab.id, installTabController, [
    record.customTitle || "",
    record.originalTitle || "",
    record.originalFavicon || null,
    record.customFavicon ? faviconDataUrl(record.customFavicon) : ""
  ]);
}

async function removeOrSaveRecord(tabId, record) {
  if (recordHasCustomState(record)) {
    await saveSessionRecord(tabId, record);
  } else {
    await removeSessionRecord(tabId);
  }
}

async function getPermissionStateForUrl(url) {
  const pattern = originPermissionPattern(url);
  if (!pattern || !chrome.permissions || typeof chrome.permissions.contains !== "function") {
    return { pattern, granted: false };
  }
  try {
    return {
      pattern,
      granted: await chrome.permissions.contains({ origins: [pattern] })
    };
  } catch {
    return { pattern, granted: false };
  }
}

async function getActiveState() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, message: "無法取得目前分頁。" };
  }

  const records = await getSessionRecords();
  const record = records[String(tab.id)] || null;
  const settings = await getSettings();
  const editable = isScriptableUrl(tab.url);
  const origin = normalizeOrigin(tab.url);
  const excluded = isExcludedUrl(tab.url, settings.excludedOrigins);
  const matchingRule = chooseMatchingRule(settings.rules, tab.url || "");
  const permission = await getPermissionStateForUrl(tab.url);
  let websiteTitle = tab.title || "";

  if (!editable) {
    return {
      ok: true,
      editable: false,
      excluded: false,
      message: unsupportedMessage(),
      tab: { id: tab.id, title: tab.title || "", url: tab.url || "", hostname: "" },
      record,
      websiteTitle,
      matchingRule: null,
      permission
    };
  }

  if (record && (record.customTitle || record.customFavicon)) {
    try {
      const pageState = await readTabPageState(tab, record);
      websiteTitle = pageState.websiteTitle || websiteTitle;
      await installRecord(tab, record);
    } catch {
      // Keep the saved state visible; a later user gesture can retry injection.
    }
  }

  return {
    ok: true,
    editable: true,
    excluded,
    origin,
    message: excluded ? excludedMessage(origin) : "",
    tab: {
      id: tab.id,
      title: tab.title || "",
      url: tab.url || "",
      hostname: (() => {
        try {
          return new URL(tab.url).hostname;
        } catch {
          return "";
        }
      })()
    },
    record,
    websiteTitle,
    matchingRule,
    rulePermission: permission,
    autoRulePaused: Boolean(record && record.autoRulePaused),
    settings: {
      recentNames: settings.recentNames,
      favorites: settings.favorites
    }
  };
}

async function saveLabel(label, allowExcluded) {
  const tab = await getActiveTab();
  const normalized = normalizeLabel(label);
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, message: "無法取得目前分頁。" };
  }
  if (!normalized) {
    return { ok: false, message: "請先輸入分頁名稱，不能儲存空白名稱。" };
  }
  if (!isScriptableUrl(tab.url)) {
    return { ok: false, message: unsupportedMessage() };
  }

  const settings = await getSettings();
  const excluded = isExcludedUrl(tab.url, settings.excludedOrigins);
  if (excluded && !allowExcluded) {
    return { ok: false, excluded: true, message: excludedMessage(normalizeOrigin(tab.url)) };
  }

  const records = await getSessionRecords();
  const previous = records[String(tab.id)] || null;
  const pageState = await readTabPageState(tab, previous);
  const record = makeRecord(tab, previous, pageState, {
    customTitle: normalized,
    source: "manual",
    autoRuleId: ""
  });

  try {
    await saveSessionRecord(tab.id, record);
    await installRecord(tab, record);
  } catch {
    if (previous) {
      await saveSessionRecord(tab.id, previous);
    } else {
      await removeSessionRecord(tab.id);
    }
    return { ok: false, message: unsupportedMessage() };
  }

  if (settings.privacy.recordRecentNames !== false) {
    settings.recentNames = addRecentName(settings.recentNames, normalized);
    await saveSettings(settings);
  }

  return {
    ok: true,
    record,
    websiteTitle: record.originalTitle,
    settings: {
      recentNames: settings.recentNames,
      favorites: settings.favorites
    }
  };
}

async function applyFavicon(config, allowExcluded) {
  const favicon = normalizeFaviconConfig(config);
  if (!favicon) {
    return { ok: false, message: "請輸入 1–2 個字元後再產生 favicon。" };
  }

  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, message: "無法取得目前分頁。" };
  }
  if (!isScriptableUrl(tab.url)) {
    return { ok: false, message: unsupportedMessage() };
  }

  const settings = await getSettings();
  const excluded = isExcludedUrl(tab.url, settings.excludedOrigins);
  if (excluded && !allowExcluded) {
    return { ok: false, excluded: true, message: excludedMessage(normalizeOrigin(tab.url)) };
  }

  const records = await getSessionRecords();
  const previous = records[String(tab.id)] || null;
  const pageState = await readTabPageState(tab, previous);
  const record = makeRecord(tab, previous, pageState, {
    customFavicon: favicon,
    source: previous && previous.source === "auto" ? "auto" : "manual"
  });

  try {
    await saveSessionRecord(tab.id, record);
    await installRecord(tab, record);
  } catch {
    return { ok: false, message: unsupportedMessage() };
  }

  return { ok: true, record, faviconUrl: faviconDataUrl(favicon) };
}

async function restoreTitle(tabId) {
  const tab = await getTab(tabId);
  if (!tab || !isScriptableUrl(tab.url)) {
    return { ok: false, message: unsupportedMessage() };
  }
  const records = await getSessionRecords();
  const key = String(tab.id);
  const previous = records[key];
  if (!previous || !previous.customTitle) {
    return { ok: false, message: "目前沒有自訂名稱可恢復。" };
  }

  const next = { ...previous, customTitle: "", label: "", injected: { ...previous.injected, title: false } };
  delete next.autoRuleId;
  if (next.customFavicon || next.autoRulePaused) {
    await saveSessionRecord(tab.id, next);
  } else {
    delete records[key];
    await saveSessionRecords(records);
  }

  try {
    const result = await executeInTab(tab.id, disableTitleInController, [previous.originalTitle || ""]);
    return {
      ok: true,
      websiteTitle: result[0] && result[0].result ? result[0].result.currentTitle : previous.originalTitle
    };
  } catch {
    const permission = await getPermissionStateForUrl(tab.url);
    return {
      ok: false,
      needsPermission: !permission.granted,
      originPattern: permission.pattern,
      message: permission.granted ? unsupportedMessage() : "恢復其他分頁前需要授權此網站 origin。"
    };
  }
}

async function restoreFavicon(tabId) {
  const tab = await getTab(tabId);
  if (!tab || !isScriptableUrl(tab.url)) {
    return { ok: false, message: unsupportedMessage() };
  }
  const records = await getSessionRecords();
  const key = String(tab.id);
  const previous = records[key];
  if (!previous || !previous.customFavicon) {
    return { ok: false, message: "目前沒有自訂 favicon 可恢復。" };
  }

  const next = { ...previous, customFavicon: null, injected: { ...previous.injected, favicon: false } };
  if (next.customTitle || next.autoRulePaused) {
    await saveSessionRecord(tab.id, next);
  } else {
    delete records[key];
    await saveSessionRecords(records);
  }

  try {
    await executeInTab(tab.id, disableFaviconInController, []);
    return { ok: true };
  } catch {
    return { ok: false, message: unsupportedMessage() };
  }
}

async function restoreEverything(tabId) {
  const tab = await getTab(tabId);
  if (!tab || !isScriptableUrl(tab.url)) {
    return { ok: false, message: unsupportedMessage() };
  }
  const records = await getSessionRecords();
  const key = String(tab.id);
  const previous = records[key];
  if (!previous || (!previous.customTitle && !previous.customFavicon)) {
    return { ok: false, message: "目前沒有自訂名稱或 favicon 可恢復。" };
  }

  if (previous.autoRulePaused) {
    records[key] = { ...previous, customTitle: "", label: "", customFavicon: null, injected: { title: false, favicon: false } };
    await saveSessionRecords(records);
  } else {
    delete records[key];
    await saveSessionRecords(records);
  }

  try {
    const result = await executeInTab(tab.id, restoreEverythingInController, [
      previous.customTitle || "",
      previous.originalTitle || ""
    ]);
    return {
      ok: true,
      websiteTitle: result[0] && result[0].result ? result[0].result.currentTitle : previous.originalTitle
    };
  } catch {
    return { ok: false, message: unsupportedMessage() };
  }
}

async function saveFavorite(label, favicon) {
  const normalized = normalizeLabel(label);
  if (!normalized) {
    return { ok: false, message: "請先設定名稱，再加入收藏。" };
  }
  const settings = await getSettings();
  const existingIndex = settings.favorites.findIndex((favorite) => favorite.label === normalized);
  const now = new Date().toISOString();
  const favorite = {
    id: existingIndex >= 0 ? settings.favorites[existingIndex].id : "favorite-" + Date.now(),
    label: normalized,
    favicon: normalizeFaviconConfig(favicon),
    createdAt: existingIndex >= 0 ? settings.favorites[existingIndex].createdAt : now,
    updatedAt: now
  };
  if (existingIndex >= 0) {
    settings.favorites[existingIndex] = favorite;
  } else {
    settings.favorites.push(favorite);
  }
  await saveSettings(settings);
  return { ok: true, favorite, settings };
}

async function updateFavorite(id, changes) {
  const settings = await getSettings();
  const index = settings.favorites.findIndex((favorite) => favorite.id === id);
  if (index < 0) {
    return { ok: false, message: "找不到這筆收藏名稱。" };
  }
  const nextLabel = changes && changes.label !== undefined
    ? normalizeLabel(changes.label)
    : settings.favorites[index].label;
  if (!nextLabel) {
    return { ok: false, message: "收藏名稱不能是空白。" };
  }
  const duplicate = settings.favorites.some((favorite, favoriteIndex) => (
    favoriteIndex !== index && favorite.label === nextLabel
  ));
  if (duplicate) {
    return { ok: false, message: "收藏名稱已存在。" };
  }
  settings.favorites[index] = {
    ...settings.favorites[index],
    label: nextLabel,
    favicon: changes && changes.favicon !== undefined
      ? normalizeFaviconConfig(changes.favicon)
      : settings.favorites[index].favicon,
    updatedAt: new Date().toISOString()
  };
  await saveSettings(settings);
  return { ok: true, settings };
}

async function moveFavorite(id, direction) {
  const settings = await getSettings();
  const index = settings.favorites.findIndex((favorite) => favorite.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= settings.favorites.length) {
    return { ok: true, settings };
  }
  const [favorite] = settings.favorites.splice(index, 1);
  settings.favorites.splice(target, 0, favorite);
  await saveSettings(settings);
  return { ok: true, settings };
}

async function deleteFavorite(id) {
  const settings = await getSettings();
  settings.favorites = settings.favorites.filter((favorite) => favorite.id !== id);
  await saveSettings(settings);
  return { ok: true, settings };
}

function rulePatternForTab(url, matchType) {
  if (matchType === "exact") {
    return url;
  }
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : parsed.pathname + "/";
    return parsed.origin + pathname;
  } catch {
    return "";
  }
}

async function createRule(tabUrl, matchType, label, favicon) {
  const tab = await getActiveTab();
  const url = tabUrl || (tab && tab.url);
  const normalizedLabel = normalizeLabel(label);
  const pattern = rulePatternForTab(url, matchType);
  if (!tab || !isScriptableUrl(url) || !pattern || !normalizedLabel) {
    return { ok: false, message: "目前分頁無法建立自動規則。" };
  }
  if (matchType !== "exact" && matchType !== "prefix") {
    return { ok: false, message: "不支援的網址匹配方式。" };
  }

  const originPattern = originPermissionPattern(url);
  const permission = await getPermissionStateForUrl(url);
  if (!permission.granted) {
    return {
      ok: false,
      needsPermission: true,
      originPattern,
      pattern,
      message: "建立規則前需要授權此 origin。"
    };
  }

  const settings = await getSettings();
  const now = new Date().toISOString();
  const rule = {
    id: "rule-" + Date.now(),
    pattern,
    matchType,
    label: normalizedLabel,
    favicon: normalizeFaviconConfig(favicon),
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
  const key = createRuleKey(rule);
  const existingIndex = settings.rules.findIndex((item) => createRuleKey(item) === key);
  if (existingIndex >= 0) {
    rule.id = settings.rules[existingIndex].id;
    rule.createdAt = settings.rules[existingIndex].createdAt || now;
    settings.rules[existingIndex] = rule;
  } else {
    settings.rules.push(rule);
  }
  await saveSettings(settings);
  return { ok: true, rule, settings };
}

async function updateRule(id, changes) {
  const settings = await getSettings();
  const index = settings.rules.findIndex((rule) => rule.id === id);
  if (index < 0) {
    return { ok: false, message: "找不到這條規則。" };
  }
  const current = settings.rules[index];
  const matchType = changes && (changes.matchType === "exact" || changes.matchType === "prefix")
    ? changes.matchType
    : current.matchType;
  const pattern = changes && changes.pattern !== undefined ? String(changes.pattern).trim() : current.pattern;
  const next = {
    ...current,
    ...changes,
    matchType,
    pattern,
    label: normalizeLabel(changes && changes.label !== undefined ? changes.label : current.label),
    favicon: changes && changes.favicon !== undefined ? normalizeFaviconConfig(changes.favicon) : current.favicon,
    enabled: changes && changes.enabled !== undefined ? changes.enabled !== false : current.enabled,
    updatedAt: new Date().toISOString()
  };
  const normalizedRule = normalizeRule(next);
  if (!normalizedRule || !next.label || !originPermissionPattern(pattern)) {
    return { ok: false, message: "規則名稱或網址格式不正確。" };
  }
  const duplicate = settings.rules.some((rule, ruleIndex) => (
    ruleIndex !== index && createRuleKey(rule) === createRuleKey(normalizedRule)
  ));
  if (duplicate) {
    return { ok: false, message: "相同匹配方式與網址的規則已存在。" };
  }
  settings.rules[index] = normalizedRule;
  await saveSettings(settings);
  return { ok: true, settings };
}

async function deleteRule(id) {
  const settings = await getSettings();
  settings.rules = settings.rules.filter((rule) => rule.id !== id);
  await saveSettings(settings);
  return { ok: true, settings };
}

async function cleanupMissingTabs(records, tabs) {
  const existingIds = new Set(tabs.map((tab) => String(tab.id)));
  let changed = false;
  Object.keys(records).forEach((key) => {
    if (!existingIds.has(key)) {
      delete records[key];
      changed = true;
    }
  });
  if (changed) {
    await saveSessionRecords(records);
  }
  return records;
}

async function getNamedTabs() {
  const tabs = await chrome.tabs.query({});
  const records = await cleanupMissingTabs(await getSessionRecords(), tabs);
  const items = [];
  tabs.forEach((tab) => {
    const record = records[String(tab.id)];
    if (!record || !isNamedRecord(record)) {
      return;
    }
    let hostname = "";
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      hostname = "受保護頁面";
    }
    items.push({
      tabId: tab.id,
      windowId: tab.windowId,
      active: Boolean(tab.active),
      title: record.customTitle || "（僅自訂 favicon）",
      hostname,
      faviconUrl: record.customFavicon
        ? faviconDataUrl(record.customFavicon)
        : (tab.favIconUrl || ""),
      customFavicon: record.customFavicon,
      canEdit: isScriptableUrl(tab.url),
      paused: record.autoRulePaused === true
    });
  });
  return { ok: true, items };
}

async function focusTab(tabId, windowId) {
  try {
    if (typeof windowId === "number") {
      await chrome.windows.update(windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    return { ok: true };
  } catch {
    await removeSessionRecord(tabId);
    return { ok: false, missing: true, message: "這個分頁已不存在，已從清單移除。" };
  }
}

async function setAutoPause(tabId, paused) {
  const tab = await getTab(tabId);
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, message: "找不到目前分頁。" };
  }
  const records = await getSessionRecords();
  const previous = records[String(tab.id)] || {
    tabId: tab.id,
    customTitle: "",
    label: "",
    originalTitle: "",
    originalFavicon: null,
    customFavicon: null,
    source: "manual",
    pageUrl: tab.url || ""
  };
  const next = { ...previous, autoRulePaused: Boolean(paused) };
  await removeOrSaveRecord(tab.id, next);
  return { ok: true, paused: Boolean(paused) };
}

async function applyAutomaticRuleToTab(tabId, force = false) {
  const tab = await getTab(tabId);
  if (!tab || !isScriptableUrl(tab.url)) {
    return { ok: false, skipped: true };
  }

  const settings = await getSettings();
  const records = await getSessionRecords();
  const key = String(tab.id);
  const previous = records[key] || null;
  const rule = chooseMatchingRule(settings.rules, tab.url);
  const excluded = isExcludedUrl(tab.url, settings.excludedOrigins);
  const permission = await getPermissionStateForUrl(tab.url);

  if (previous && previous.autoRulePaused) {
    return { ok: true, skipped: true, paused: true };
  }

  if (!rule || excluded || !permission.granted) {
    if (previous && previous.source === "auto") {
      await restoreEverything(tab.id);
    }
    return { ok: true, skipped: true, reason: !rule ? "no-rule" : "not-authorized-or-excluded" };
  }

  if (!force && previous && previous.source === "manual" && previous.pageUrl === tab.url && previous.customTitle) {
    return { ok: true, skipped: true, reason: "manual-override" };
  }

  const pageState = await readTabPageState(tab, previous);
  const sameRulePage = previous && previous.source === "auto" && previous.pageUrl === tab.url;
  const record = makeRecord(tab, sameRulePage ? previous : null, pageState, {
    customTitle: rule.label,
    customFavicon: rule.favicon,
    source: "auto",
    autoRuleId: rule.id
  });
  await saveSessionRecord(tab.id, record);
  try {
    await installRecord(tab, record);
    return { ok: true, rule, record };
  } catch {
    await removeSessionRecord(tab.id);
    return { ok: false, message: unsupportedMessage() };
  }
}

async function restoreSessionRecordAfterLoad(tab, record) {
  let next = record;
  const navigated = Boolean(record.pageUrl && record.pageUrl !== tab.url);

  if (navigated) {
    try {
      const pageState = await readTabPageState(tab, record);
      next = makeRecord(tab, record, pageState, {
        customTitle: record.customTitle,
        customFavicon: record.customFavicon,
        source: record.source,
        autoRuleId: record.autoRuleId || ""
      });
    } catch {
      // Keep the session record even when activeTab/host access was revoked.
      next = { ...record, pageUrl: tab.url || "" };
    }
  }

  // Save before injection so a page-level failure never deletes a valid manual state.
  await saveSessionRecord(tab.id, next);
  try {
    await installRecord(tab, next);
    return {
      ok: true,
      action: "restore-session",
      record: next
    };
  } catch {
    return {
      ok: false,
      action: "restore-session",
      preserved: true,
      message: unsupportedMessage()
    };
  }
}

async function handleTabLoadComplete(tabId) {
  const tab = await getTab(tabId);
  if (!tab || !isScriptableUrl(tab.url)) {
    return { ok: false, skipped: true };
  }

  const records = await getSessionRecords();
  const record = records[String(tab.id)] || null;
  const action = getTabLoadAction(record);

  if (action === "restore-session") {
    return restoreSessionRecordAfterLoad(tab, record);
  }
  if (action === "paused") {
    return { ok: true, skipped: true, paused: true };
  }
  return applyAutomaticRuleToTab(tabId);
}

async function restoreAutoRule(tabId) {
  const records = await getSessionRecords();
  const record = records[String(tabId)];
  if (!record || record.source !== "auto") {
    return { ok: true };
  }
  const tab = await getTab(tabId);
  if (tab && isScriptableUrl(tab.url)) {
    await executeInTab(tab.id, restoreEverythingInController, [
      record.customTitle || "",
      record.originalTitle || ""
    ]).catch(() => {});
  }
  delete records[String(tabId)];
  await saveSessionRecords(records);
  return { ok: true };
}

async function importSettingsFromPayload(payload, mode) {
  const validation = validateImportPayload(payload);
  if (!validation.ok) {
    return validation;
  }
  const current = await getSettings();
  const next = applyImportMode(current, validation.settings, mode);
  await saveSettings(next);
  const importedRules = validation.settings.rules || [];
  const needsAuthorization = [];
  for (const rule of importedRules) {
    const permission = await getPermissionStateForUrl(rule.pattern);
    if (!permission.granted && permission.pattern && !needsAuthorization.includes(permission.pattern)) {
      needsAuthorization.push(permission.pattern);
    }
  }
  return {
    ok: true,
    settings: next,
    importedFavorites: validation.settings.favorites.length,
    importedRules: importedRules.length,
    skipped: validation.skipped || 0,
    needsAuthorization
  };
}

async function clearData(kind) {
  const settings = await getSettings();
  if (kind === "recent") {
    settings.recentNames = [];
  } else if (kind === "favorites") {
    settings.favorites = [];
  } else if (kind === "rules") {
    settings.rules = [];
  } else if (kind === "all") {
    await saveSettings(createDefaultSettings());
    return { ok: true, settings: createDefaultSettings() };
  } else {
    return { ok: false, message: "不支援的清除項目。" };
  }
  await saveSettings(settings);
  return { ok: true, settings };
}

async function getPermissionOverview() {
  const all = chrome.permissions && typeof chrome.permissions.getAll === "function"
    ? await chrome.permissions.getAll()
    : { origins: [] };
  return {
    ok: true,
    origins: (all.origins || []).filter((origin) => /^https?:\/\//i.test(origin))
  };
}

async function removePermission(origin) {
  if (!chrome.permissions || typeof chrome.permissions.remove !== "function") {
    return { ok: false, message: "目前 Chrome 不提供權限撤銷 API。" };
  }
  const removed = await chrome.permissions.remove({ origins: [origin] });
  return { ok: Boolean(removed), origins: (await getPermissionOverview()).origins };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation;
  const type = message && message.type;

  if (type === "get-active-state") {
    operation = getActiveState();
  } else if (type === "save-label") {
    operation = saveLabel(message.label, message.allowExcluded === true);
  } else if (type === "apply-favicon") {
    operation = applyFavicon(message.config, message.allowExcluded === true);
  } else if (type === "restore-label") {
    operation = restoreTitle(typeof message.tabId === "number" ? message.tabId : undefined);
  } else if (type === "restore-favicon") {
    operation = restoreFavicon(typeof message.tabId === "number" ? message.tabId : undefined);
  } else if (type === "restore-everything") {
    operation = restoreEverything(typeof message.tabId === "number" ? message.tabId : undefined);
  } else if (type === "save-favorite") {
    operation = saveFavorite(message.label, message.favicon);
  } else if (type === "update-favorite") {
    operation = updateFavorite(message.id, message.changes);
  } else if (type === "move-favorite") {
    operation = moveFavorite(message.id, message.direction);
  } else if (type === "delete-favorite") {
    operation = deleteFavorite(message.id);
  } else if (type === "get-settings") {
    operation = getSettings().then((settings) => ({ ok: true, settings, extensionVersion: EXTENSION_VERSION }));
  } else if (type === "save-settings") {
    operation = saveSettings(message.settings).then((settings) => ({ ok: true, settings }));
  } else if (type === "create-rule") {
    operation = createRule(message.tabUrl, message.matchType, message.label, message.favicon);
  } else if (type === "update-rule") {
    operation = updateRule(message.id, message.changes);
  } else if (type === "delete-rule") {
    operation = deleteRule(message.id);
  } else if (type === "get-named-tabs") {
    operation = getNamedTabs();
  } else if (type === "focus-tab") {
    operation = focusTab(message.tabId, message.windowId);
  } else if (type === "close-tab") {
    operation = chrome.tabs.remove(message.tabId)
      .then(() => ({ ok: true }))
      .catch(() => ({ ok: false, message: "這個分頁已不存在。" }));
  } else if (type === "set-auto-pause") {
    operation = setAutoPause(message.tabId, message.paused === true);
  } else if (type === "reapply-auto-rule") {
    operation = setAutoPause(message.tabId, false)
      .then(() => applyAutomaticRuleToTab(message.tabId, true));
  } else if (type === "import-settings") {
    operation = importSettingsFromPayload(message.payload, message.mode === "replace" ? "replace" : "merge");
  } else if (type === "clear-data") {
    operation = clearData(message.kind);
  } else if (type === "remove-recent") {
    operation = getSettings().then((settings) => {
      settings.recentNames = settings.recentNames.filter((label) => label !== normalizeLabel(message.label));
      return saveSettings(settings).then((next) => ({ ok: true, settings: next }));
    });
  } else if (type === "get-permissions") {
    operation = getPermissionOverview();
  } else if (type === "remove-permission") {
    operation = removePermission(message.origin);
  } else if (type === "export-settings") {
    operation = getSettings().then((settings) => ({
      ok: true,
      settings,
      extensionVersion: EXTENSION_VERSION
    }));
  } else if (type === "get-rule-pattern") {
    operation = Promise.resolve({
      ok: true,
      pattern: rulePatternForTab(message.tabUrl, message.matchType),
      originPattern: originPermissionPattern(message.tabUrl)
    });
  } else {
    return false;
  }

  operation
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        message: error && error.message ? error.message : "操作失敗，請再試一次。"
      });
    });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }
  void handleTabLoadComplete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeSessionRecord(tabId);
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.tabs.query({}).then((tabs) => Promise.all(
    tabs.map((tab) => handleTabLoadComplete(tab.id))
  ));
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-named-tabs") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("tab-manager.html") });
  }
});

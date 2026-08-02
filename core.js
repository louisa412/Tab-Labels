(function attachTabLabelsCore(root) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const MAX_RECENT_NAMES = 15;
  const MAX_LABEL_LENGTH = 500;
  const MAX_PATTERN_LENGTH = 2048;
  const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

  function isPlainObject(value) {
    if (!value || typeof value !== "object") {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasUnsafeKeys(value, seen = new Set()) {
    if (!value || typeof value !== "object") {
      return false;
    }

    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.some((item) => hasUnsafeKeys(item, seen));
    }

    return Object.keys(value).some((key) => UNSAFE_KEYS.has(key) || hasUnsafeKeys(value[key], seen));
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeLabel(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*｜\s*/g, "｜");
  }

  function addRecentName(recentNames, value, limit = MAX_RECENT_NAMES) {
    const label = normalizeLabel(value);
    if (!label) {
      return Array.isArray(recentNames) ? recentNames.slice(0, limit) : [];
    }

    const previous = Array.isArray(recentNames) ? recentNames : [];
    return [label, ...previous.filter((item) => item !== label && typeof item === "string")]
      .slice(0, limit);
  }

  function removeRecentName(recentNames, value) {
    const label = normalizeLabel(value);
    return (Array.isArray(recentNames) ? recentNames : []).filter((item) => item !== label);
  }

  function stableFavoriteId(index, label) {
    const compact = normalizeLabel(label).toLowerCase().replace(/[^a-z0-9\u00a0-\uffff]+/gi, "-").slice(0, 48);
    return `favorite-${index}-${compact || "name"}`;
  }

  function normalizeHexColor(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }

    const color = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      return color.toLowerCase();
    }
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      return `#${color.slice(1).split("").map((part) => part + part).join("").toLowerCase()}`;
    }
    return fallback;
  }

  function contrastForeground(background) {
    const color = normalizeHexColor(background, "#4359d8").slice(1);
    const channels = [0, 2, 4].map((index) => parseInt(color.slice(index, index + 2), 16) / 255);
    const luminance = channels.map((channel) => (
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    )).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return luminance > 0.42 ? "#172033" : "#ffffff";
  }

  function normalizeFaviconConfig(value) {
    if (!isPlainObject(value)) {
      return null;
    }

    const text = Array.from(typeof value.text === "string" ? value.text.trim() : "")
      .slice(0, 2)
      .join("");
    if (!text) {
      return null;
    }

    const background = normalizeHexColor(value.background, "#4359d8");
    const foreground = value.foreground === "auto"
      ? "auto"
      : normalizeHexColor(value.foreground, "auto");
    const shape = value.shape === "circle" ? "circle" : "rounded";

    return { text, background, foreground, shape };
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function faviconSvg(value) {
    const config = normalizeFaviconConfig(value);
    if (!config) {
      return "";
    }

    const foreground = config.foreground === "auto"
      ? contrastForeground(config.background)
      : config.foreground;
    const shape = config.shape === "circle"
      ? '<circle cx="16" cy="16" r="16" />'
      : '<rect x="1" y="1" width="30" height="30" rx="7" />';
    const fontSize = Array.from(config.text).length === 1 ? 18 : 13;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><${config.shape === "circle" ? "circle" : "rect"} fill="${escapeXml(config.background)}" ${config.shape === "circle" ? 'cx="16" cy="16" r="16"' : 'x="1" y="1" width="30" height="30" rx="7"'} /><text x="16" y="17" fill="${escapeXml(foreground)}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(config.text)}</text></svg>`;
  }

  function faviconDataUrl(value) {
    const svg = faviconSvg(value);
    return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
  }

  function createDefaultSettings() {
    return {
      schemaVersion: SCHEMA_VERSION,
      recentNames: [],
      favorites: [],
      rules: [],
      excludedOrigins: [],
      privacy: {
        recordRecentNames: true
      },
      ui: {
        defaultFavicon: null
      }
    };
  }

  function normalizeOrigin(value) {
    if (typeof value !== "string") {
      return "";
    }

    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }
      return url.origin;
    } catch {
      return "";
    }
  }

  function originPermissionPattern(value) {
    const origin = normalizeOrigin(value);
    return origin ? `${origin}/*` : "";
  }

  function isProtectedUrl(value) {
    if (typeof value !== "string") {
      return true;
    }

    if (!/^https?:\/\//i.test(value)) {
      return true;
    }

    try {
      const url = new URL(value);
      return (
        (url.hostname === "chrome.google.com" && url.pathname.toLowerCase().startsWith("/webstore"))
        || url.hostname === "chromewebstore.google.com"
      );
    } catch {
      return true;
    }
  }

  function isExcludedUrl(value, excludedOrigins) {
    const origin = normalizeOrigin(value);
    if (!origin) {
      return false;
    }
    return (Array.isArray(excludedOrigins) ? excludedOrigins : []).includes(origin);
  }

  function normalizeFavorite(value, index = 0) {
    const source = typeof value === "string" ? { label: value } : value;
    if (!isPlainObject(source)) {
      return null;
    }

    const label = normalizeLabel(source.label);
    if (!label || label.length > MAX_LABEL_LENGTH) {
      return null;
    }

    return {
      id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 120) : stableFavoriteId(index, label),
      label,
      favicon: normalizeFaviconConfig(source.favicon),
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : ""
    };
  }

  function normalizeRule(value, index = 0) {
    if (!isPlainObject(value)) {
      return null;
    }

    const pattern = typeof value.pattern === "string" ? value.pattern.trim() : "";
    const matchType = value.matchType === "exact" || value.matchType === "prefix" ? value.matchType : "";
    const label = normalizeLabel(value.label);
    if (!pattern || pattern.length > MAX_PATTERN_LENGTH || !matchType || !label || label.length > MAX_LABEL_LENGTH) {
      return null;
    }
    if (matchType === "prefix" && !pattern.endsWith("/")) {
      return null;
    }

    try {
      const url = new URL(pattern);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
    } catch {
      return null;
    }

    return {
      id: typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 120) : `rule-${index}`,
      pattern,
      matchType,
      label,
      favicon: normalizeFaviconConfig(value.favicon),
      enabled: value.enabled !== false,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
    };
  }

  function addFavorite(favorites, label, favicon, now = new Date().toISOString()) {
    const normalizedLabel = normalizeLabel(label);
    if (!normalizedLabel || normalizedLabel.length > MAX_LABEL_LENGTH) {
      return Array.isArray(favorites) ? favorites.slice() : [];
    }
    const list = Array.isArray(favorites) ? favorites.slice() : [];
    const index = list.findIndex((favorite) => favorite && favorite.label === normalizedLabel);
    const existing = index >= 0 ? list[index] : null;
    const next = {
      id: existing && existing.id ? existing.id : "favorite-" + now,
      label: normalizedLabel,
      favicon: normalizeFaviconConfig(favicon),
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };
    if (index >= 0) {
      list[index] = next;
    } else {
      list.push(next);
    }
    return list;
  }

  function updateFavorite(favorites, id, changes, now = new Date().toISOString()) {
    const list = Array.isArray(favorites) ? favorites.slice() : [];
    const index = list.findIndex((favorite) => favorite && favorite.id === id);
    if (index < 0) {
      return list;
    }
    const label = changes && changes.label !== undefined
      ? normalizeLabel(changes.label)
      : list[index].label;
    if (!label || list.some((favorite, favoriteIndex) => favoriteIndex !== index && favorite.label === label)) {
      return list;
    }
    list[index] = {
      ...list[index],
      label,
      favicon: changes && changes.favicon !== undefined
        ? normalizeFaviconConfig(changes.favicon)
        : list[index].favicon,
      updatedAt: now
    };
    return list;
  }

  function moveFavorite(favorites, id, direction) {
    const list = Array.isArray(favorites) ? favorites.slice() : [];
    const index = list.findIndex((favorite) => favorite && favorite.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= list.length) {
      return list;
    }
    const item = list.splice(index, 1)[0];
    list.splice(target, 0, item);
    return list;
  }

  function removeFavorite(favorites, id) {
    return (Array.isArray(favorites) ? favorites : []).filter((favorite) => favorite && favorite.id !== id);
  }

  function sanitizeSettings(raw, options = {}) {
    const source = isPlainObject(raw) && !hasUnsafeKeys(raw) ? raw : {};
    const defaults = createDefaultSettings();
    let skipped = 0;
    const favorites = [];
    const recentNames = [];
    const rules = [];

    if (Object.prototype.hasOwnProperty.call(source, "favorites")) {
      if (!Array.isArray(source.favorites)) {
        skipped += 1;
      } else {
        source.favorites.forEach((item, index) => {
          const favorite = normalizeFavorite(item, index);
          if (favorite) {
            favorites.push(favorite);
          } else {
            skipped += 1;
          }
        });
      }
    }

    if (options.includeRecent !== false && Object.prototype.hasOwnProperty.call(source, "recentNames")) {
      if (!Array.isArray(source.recentNames)) {
        skipped += 1;
      } else {
        source.recentNames.forEach((item) => {
          const label = normalizeLabel(item);
          if (label && label.length <= MAX_LABEL_LENGTH) {
            recentNames.push(label);
          } else if (item !== "") {
            skipped += 1;
          }
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(source, "rules")) {
      if (!Array.isArray(source.rules)) {
        skipped += 1;
      } else {
        source.rules.forEach((item, index) => {
          const rule = normalizeRule(item, index);
          if (rule) {
            rules.push(rule);
          } else {
            skipped += 1;
          }
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(source, "excludedOrigins")) {
      if (!Array.isArray(source.excludedOrigins)) {
        skipped += 1;
      } else {
        source.excludedOrigins.forEach((item) => {
          const origin = normalizeOrigin(item);
          if (origin) {
            defaults.excludedOrigins.push(origin);
          } else {
            skipped += 1;
          }
        });
      }
    }

    const result = {
      ...source,
      schemaVersion: SCHEMA_VERSION,
      recentNames: Array.from(new Set(recentNames)).slice(0, MAX_RECENT_NAMES),
      favorites,
      rules,
      excludedOrigins: Array.from(new Set(defaults.excludedOrigins)),
      privacy: {
        ...defaults.privacy,
        ...(isPlainObject(source.privacy) ? source.privacy : {})
      },
      ui: {
        ...defaults.ui,
        ...(isPlainObject(source.ui) ? source.ui : {})
      }
    };

    result.privacy.recordRecentNames = result.privacy.recordRecentNames !== false;
    result.ui.defaultFavicon = normalizeFaviconConfig(result.ui.defaultFavicon);
    return { settings: result, skipped };
  }

  function migrateSettings(raw) {
    const source = isPlainObject(raw) && isPlainObject(raw.settings) ? raw.settings : raw;
    return sanitizeSettings(source, { includeRecent: true }).settings;
  }

  function autocompleteSuggestions(query, favorites, recentNames) {
    const normalizedQuery = typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
    const result = [];
    const seen = new Set();

    function add(values, source) {
      (Array.isArray(values) ? values : []).forEach((item, index) => {
        const label = typeof item === "string" ? normalizeLabel(item) : normalizeLabel(item && item.label);
        if (!label || seen.has(label)) {
          return;
        }

        const lower = label.toLocaleLowerCase();
        if (normalizedQuery && !lower.includes(normalizedQuery)) {
          return;
        }
        seen.add(label);
        result.push({
          label,
          source,
          favoriteId: source === "favorite" && item && typeof item === "object" ? item.id : "",
          startsWithQuery: !normalizedQuery || lower.startsWith(normalizedQuery),
          order: index
        });
      });
    }

    add(favorites, "favorite");
    add(recentNames, "recent");

    return result.sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "favorite" ? -1 : 1;
      }
      if (left.startsWithQuery !== right.startsWithQuery) {
        return left.startsWithQuery ? -1 : 1;
      }
      return left.order - right.order;
    });
  }

  function rulePriority(rule) {
    return rule.matchType === "exact" ? 2 : 1;
  }

  function chooseMatchingRule(rules, url) {
    if (typeof url !== "string") {
      return null;
    }

    return (Array.isArray(rules) ? rules : [])
      .filter((rule) => rule && rule.enabled !== false && (
        (rule.matchType === "exact" && rule.pattern === url)
        || (rule.matchType === "prefix" && rule.pattern.endsWith("/") && url.startsWith(rule.pattern))
      ))
      .sort((left, right) => {
        const priorityDifference = rulePriority(right) - rulePriority(left);
        if (priorityDifference) {
          return priorityDifference;
        }
        if (right.matchType === "prefix" && left.matchType === "prefix") {
          const lengthDifference = right.pattern.length - left.pattern.length;
          if (lengthDifference) {
            return lengthDifference;
          }
        }
        return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
      })[0] || null;
  }

  function shouldApplyRule(rule, url, context = {}) {
    if (!rule || rule.enabled === false || context.excluded || context.paused || context.permissionGranted === false) {
      return false;
    }
    return Boolean(
      (rule.matchType === "exact" && rule.pattern === url)
      || (rule.matchType === "prefix" && rule.pattern.endsWith("/") && typeof url === "string" && url.startsWith(rule.pattern))
    );
  }

  function getTabLoadAction(record) {
    if (!record) {
      return "evaluate-auto";
    }

    const hasPresentation = Boolean(record.customTitle || record.customFavicon);
    if (record.autoRulePaused) {
      return hasPresentation ? "restore-session" : "paused";
    }
    if (record.source === "manual" && hasPresentation) {
      return "restore-session";
    }
    return "evaluate-auto";
  }

  function createRuleKey(rule) {
    return `${rule.matchType}:${rule.pattern}`;
  }

  function mergeSettings(existing, incoming) {
    const current = migrateSettings(existing);
    const imported = migrateSettings(incoming);
    const favoritesByLabel = new Map(current.favorites.map((favorite) => [favorite.label, favorite]));
    imported.favorites.forEach((favorite) => favoritesByLabel.set(favorite.label, favorite));

    const rulesByKey = new Map(current.rules.map((rule) => [createRuleKey(rule), rule]));
    imported.rules.forEach((rule) => rulesByKey.set(createRuleKey(rule), rule));

    return {
      ...current,
      ...imported,
      schemaVersion: SCHEMA_VERSION,
      favorites: Array.from(favoritesByLabel.values()),
      rules: Array.from(rulesByKey.values()),
      excludedOrigins: Array.from(new Set([...current.excludedOrigins, ...imported.excludedOrigins])),
      recentNames: addRecentNamesForMerge(current.recentNames, imported.recentNames)
    };
  }

  function applyImportMode(existing, incoming, mode) {
    return mode === "replace"
      ? migrateSettings(incoming)
      : mergeSettings(existing, incoming);
  }

  function addRecentNamesForMerge(current, incoming) {
    return (Array.isArray(incoming) ? incoming : [])
      .slice()
      .reverse()
      .reduce((result, label) => addRecentName(result, label), Array.isArray(current) ? current.slice() : [])
      .slice(0, MAX_RECENT_NAMES);
  }

  function validateImportPayload(payload) {
    if (!isPlainObject(payload)) {
      return { ok: false, message: "匯入內容必須是 JSON 物件。" };
    }
    if (hasUnsafeKeys(payload)) {
      return { ok: false, message: "匯入內容包含不安全欄位。" };
    }
    if (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion < 1 || payload.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, message: `不支援的 schema version：${String(payload.schemaVersion)}。` };
    }

    const allowedArrayFields = ["favorites", "rules", "excludedOrigins", "recentNames"];
    for (const field of allowedArrayFields) {
      if (Object.prototype.hasOwnProperty.call(payload, field) && !Array.isArray(payload[field])) {
        return { ok: false, message: `匯入欄位 ${field} 型別錯誤。` };
      }
    }

    const { settings, skipped } = sanitizeSettings(payload, { includeRecent: true });
    return { ok: true, settings, skipped };
  }

  function exportSettings(settings, extensionVersion, includeRecent = false, exportedAt = new Date().toISOString()) {
    const source = migrateSettings(settings);
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      extensionVersion: typeof extensionVersion === "string" ? extensionVersion : "",
      exportedAt,
      favorites: cloneJson(source.favorites),
      rules: cloneJson(source.rules),
      excludedOrigins: source.excludedOrigins.slice(),
      privacy: cloneJson(source.privacy),
      ui: cloneJson(source.ui)
    };
    if (includeRecent) {
      payload.recentNames = source.recentNames.slice();
    }
    return payload;
  }

  function clearLongTermSettings() {
    return createDefaultSettings();
  }

  function isNamedRecord(record) {
    return Boolean(record && (record.customTitle || record.label || record.customFavicon));
  }

  const api = {
    SCHEMA_VERSION,
    MAX_RECENT_NAMES,
    MAX_LABEL_LENGTH,
    MAX_PATTERN_LENGTH,
    addRecentName,
    addFavorite,
    autocompleteSuggestions,
    applyImportMode,
    chooseMatchingRule,
    clearLongTermSettings,
    cloneJson,
    contrastForeground,
    createDefaultSettings,
    createRuleKey,
    exportSettings,
    faviconDataUrl,
    faviconSvg,
    hasUnsafeKeys,
    isExcludedUrl,
    isNamedRecord,
    isPlainObject,
    isProtectedUrl,
    mergeSettings,
    migrateSettings,
    normalizeFaviconConfig,
    normalizeLabel,
    normalizeOrigin,
    normalizeRule,
    originPermissionPattern,
    removeRecentName,
    removeFavorite,
    moveFavorite,
    updateFavorite,
    sanitizeSettings,
    shouldApplyRule,
    getTabLoadAction,
    validateImportPayload
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.TabLabelsCore = api;
})(globalThis);

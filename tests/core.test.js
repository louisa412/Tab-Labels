const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

test("normalizes labels without changing user casing", () => {
  assert.equal(core.normalizeLabel("  KIzamu   ｜   Codex  "), "KIzamu｜Codex");
  assert.equal(core.normalizeLabel("   "), "");
});

test("recent names deduplicate, move to front, and keep 15 entries", () => {
  let recent = [];
  for (let index = 0; index < 17; index += 1) {
    recent = core.addRecentName(recent, "Name " + index);
  }
  recent = core.addRecentName(recent, "Name 5");
  assert.equal(recent.length, 15);
  assert.equal(recent[0], "Name 5");
  assert.equal(new Set(recent).size, 15);
  assert.deepEqual(core.addRecentName(recent, "   "), recent);
});

test("favorite CRUD and ordering are stable", () => {
  let favorites = core.addFavorite([], "One", null, "2026-01-01");
  favorites = core.addFavorite(favorites, "Two", { text: "T" }, "2026-01-02");
  assert.equal(favorites.length, 2);
  const twoId = favorites[1].id;
  favorites = core.updateFavorite(favorites, twoId, { label: "Renamed" }, "2026-01-03");
  assert.equal(favorites[1].label, "Renamed");
  favorites = core.moveFavorite(favorites, twoId, "up");
  assert.equal(favorites[0].label, "Renamed");
  favorites = core.removeFavorite(favorites, twoId);
  assert.deepEqual(favorites.map((favorite) => favorite.label), ["One"]);
});

test("autocomplete prioritizes favorites, then prefix matches, then contains matches", () => {
  const favorites = [{ id: "f1", label: "Project｜GitHub" }, { id: "f2", label: "Daily" }];
  const recent = ["GitHub Issue", "Other"];
  const result = core.autocompleteSuggestions("github", favorites, recent);
  assert.deepEqual(result.map((item) => item.label), ["Project｜GitHub", "GitHub Issue"]);
  assert.equal(result[0].source, "favorite");
});

test("exact and prefix rule priority is deterministic", () => {
  const url = "https://github.com/louisa412/Tab-Labels/issues";
  const rules = [
    { id: "short", pattern: "https://github.com/louisa412/", matchType: "prefix", label: "Repo", updatedAt: "2026-01-03", enabled: true },
    { id: "long", pattern: "https://github.com/louisa412/Tab-Labels/", matchType: "prefix", label: "Tab Labels", updatedAt: "2026-01-01", enabled: true },
    { id: "exact", pattern: url, matchType: "exact", label: "Issues", updatedAt: "2025-01-01", enabled: true }
  ];
  assert.equal(core.chooseMatchingRule(rules, url).id, "exact");
  assert.equal(core.chooseMatchingRule(rules.slice(0, 2), url).id, "long");
  assert.equal(core.chooseMatchingRule([{ ...rules[1], enabled: false }], url), null);
  assert.equal(core.normalizeRule({ pattern: "https://github.com/louisa412", matchType: "prefix", label: "Unsafe" }), null);
});

test("rule application respects disabled, excluded, permission, and tab pause context", () => {
  const rule = { pattern: "https://example.com/app/", matchType: "prefix", enabled: true };
  const url = "https://example.com/app/issues";
  assert.equal(core.shouldApplyRule(rule, url, { permissionGranted: true }), true);
  assert.equal(core.shouldApplyRule(rule, url, { permissionGranted: false }), false);
  assert.equal(core.shouldApplyRule(rule, url, { permissionGranted: true, paused: true }), false);
  assert.equal(core.shouldApplyRule(rule, url, { permissionGranted: true, excluded: true }), false);
});

test("origin exclusions and protected URL detection are safe", () => {
  assert.equal(core.normalizeOrigin("https://example.com/path?q=1"), "https://example.com");
  assert.equal(core.isExcludedUrl("https://example.com/path", ["https://example.com"]), true);
  assert.equal(core.isProtectedUrl("chrome://settings"), true);
  assert.equal(core.isProtectedUrl("https://chrome.google.com/webstore/detail/example"), true);
  assert.equal(core.isProtectedUrl("https://example.com"), false);
});

test("export schema excludes session data and recent names by default", () => {
  const settings = core.migrateSettings({
    schemaVersion: 1,
    favorites: [{ label: "Saved" }],
    recentNames: ["Recent"],
    rules: [],
    excludedOrigins: []
  });
  const payload = core.exportSettings(settings, "0.2.0", false, "2026-08-02T00:00:00.000Z");
  assert.equal(payload.schemaVersion, 2);
  assert.equal("recentNames" in payload, false);
  assert.equal(JSON.stringify(payload).includes("tabId"), false);
  assert.equal(JSON.stringify(payload).includes("originalTitle"), false);
  assert.equal(JSON.stringify(payload).includes("history"), false);
  const withRecent = core.exportSettings(settings, "0.2.0", true);
  assert.deepEqual(withRecent.recentNames, ["Recent"]);
});

test("import validation rejects dangerous keys and skips damaged items", () => {
  const invalidItemPayload = {
    schemaVersion: 2,
    favorites: [{ label: "Good" }, { label: 4 }, null],
    rules: [{ pattern: "https://example.com/", matchType: "prefix", label: "Good", enabled: true }, { label: "bad" }],
    excludedOrigins: ["https://example.com", "not-an-origin"]
  };
  const result = core.validateImportPayload(invalidItemPayload);
  assert.equal(result.ok, true);
  assert.equal(result.settings.favorites.length, 1);
  assert.equal(result.settings.rules.length, 1);
  assert.ok(result.skipped >= 3);
  assert.equal(core.validateImportPayload({ schemaVersion: 2, __proto__: { polluted: true } }).ok, false);
  const dangerous = JSON.parse('{"schemaVersion":2,"__proto__":{"polluted":true}}');
  assert.equal(core.validateImportPayload(dangerous).ok, false);
  assert.equal(core.validateImportPayload({ schemaVersion: 2, favorites: {} }).ok, false);
});

test("merge combines favorites and replaces conflicting rules by match key", () => {
  const current = {
    schemaVersion: 2,
    favorites: [{ id: "old", label: "Keep", favicon: null }],
    rules: [{ id: "rule", pattern: "https://example.com/", matchType: "prefix", label: "Old", enabled: true }],
    excludedOrigins: ["https://one.example"]
  };
  const incoming = {
    schemaVersion: 2,
    favorites: [{ id: "new", label: "Keep", favicon: { text: "K" } }, { label: "New" }],
    rules: [{ id: "new-rule", pattern: "https://example.com/", matchType: "prefix", label: "New", enabled: false }],
    excludedOrigins: ["https://two.example"]
  };
  const merged = core.mergeSettings(current, incoming);
  assert.equal(merged.favorites.length, 2);
  assert.equal(merged.favorites.find((item) => item.label === "Keep").favicon.text, "K");
  assert.equal(merged.rules.length, 1);
  assert.equal(merged.rules[0].label, "New");
  assert.deepEqual(merged.excludedOrigins.sort(), ["https://one.example", "https://two.example"]);
  const replaced = core.applyImportMode(current, incoming, "replace");
  assert.deepEqual(replaced.favorites.map((item) => item.label), ["Keep", "New"]);
  assert.deepEqual(replaced.excludedOrigins, ["https://two.example"]);
});

test("schema migration is idempotent and preserves unknown top-level fields", () => {
  const first = core.migrateSettings({
    schemaVersion: 1,
    futureField: { enabled: true },
    favorites: ["Legacy"],
    rules: [],
    excludedOrigins: []
  });
  const second = core.migrateSettings(first);
  assert.equal(first.schemaVersion, 2);
  assert.deepEqual(second, first);
  assert.deepEqual(first.futureField, { enabled: true });
  assert.equal(first.favorites[0].label, "Legacy");
});

test("favicon data generation is local, bounded, and valid for both shapes", () => {
  const config = core.normalizeFaviconConfig({ text: "TOO", background: "#fff", foreground: "auto", shape: "circle" });
  assert.equal(config.text, "TO");
  assert.equal(config.background, "#ffffff");
  assert.equal(config.shape, "circle");
  const svg = core.faviconSvg(config);
  const dataUrl = core.faviconDataUrl(config);
  assert.match(svg, /<svg/);
  assert.match(svg, /<circle/);
  assert.match(dataUrl, /^data:image\/png;base64,/);
  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(core.faviconPngDataUrl(config), dataUrl);
  assert.equal(core.faviconDataUrl({ text: " " }), "");
});

test("clear settings returns an empty schema v2 model", () => {
  const cleared = core.clearLongTermSettings();
  assert.equal(cleared.schemaVersion, 2);
  assert.deepEqual(cleared.favorites, []);
  assert.deepEqual(cleared.rules, []);
  assert.equal(cleared.privacy.recordRecentNames, true);
});

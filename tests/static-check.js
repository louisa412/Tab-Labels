const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const sourceFiles = [
  "manifest.json",
  "core.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "service-worker.js",
  "options.html",
  "options.css",
  "options.js",
  "tab-manager.html",
  "tab-manager.css",
  "tab-manager.js"
];
const errors = [];

function exists(relativePath) {
  if (relativePath && !fs.existsSync(path.join(root, relativePath))) {
    errors.push("missing referenced file: " + relativePath);
  }
}

["default_popup", "default_icon", "icons"].forEach(() => {});
exists(manifest.background && manifest.background.service_worker);
exists(manifest.action && manifest.action.default_popup);
Object.values(manifest.icons || {}).forEach(exists);
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(exists);
exists(manifest.options_ui && manifest.options_ui.page);

const allSource = sourceFiles
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");

if (manifest.permissions && manifest.permissions.includes("<all_urls>")) {
  errors.push("manifest contains <all_urls>");
}
if (allSource.includes("<all_urls>")) {
  errors.push("source contains <all_urls>");
}
if (/<script[^>]+src=["']https?:\/\//i.test(allSource)) {
  errors.push("source contains a remote script");
}
if (/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(allSource)) {
  errors.push("source contains a network API call");
}
if (/\b(analytics|telemetry)\b/i.test(allSource)) {
  errors.push("source contains tracking terminology");
}
if (/\/Users\/|\/home\/|file:\/\//.test(allSource)) {
  errors.push("source contains a local absolute path");
}
if (fs.existsSync(path.join(root, ".DS_Store"))) {
  errors.push("root contains .DS_Store");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("static checks passed: manifest refs, no all_urls, no remote scripts/network APIs, no tracking code, no local paths, no .DS_Store");

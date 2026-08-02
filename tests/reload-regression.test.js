const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../core.js");

const workerSource = fs.readFileSync(
  require("node:path").join(__dirname, "..", "service-worker.js"),
  "utf8"
);

function makeSettings(rules = []) {
  return {
    ...core.createDefaultSettings(),
    rules
  };
}

function createWorker({
  record = null,
  rules = [],
  permissionGranted = false,
  url = "https://example.com/app",
  executeScriptFails = false
} = {}) {
  const session = {
    labelsByTab: record ? { "7": { tabId: 7, ...record } } : {}
  };
  const local = {
    tabLabelsSettings: makeSettings(rules)
  };
  const calls = [];
  const listeners = {
    updated: null,
    message: null
  };
  const tab = {
    id: 7,
    windowId: 1,
    active: true,
    url,
    title: "網站原始標題",
    favIconUrl: "https://example.com/favicon.ico"
  };

  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.2.0" }),
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
      onStartup: { addListener: () => {} }
    },
    commands: { onCommand: { addListener: () => {} } },
    tabs: {
      get: async (tabId) => (tabId === tab.id ? tab : Promise.reject(new Error("missing tab"))),
      query: async () => [tab],
      onUpdated: { addListener: (listener) => { listeners.updated = listener; } },
      onRemoved: { addListener: () => {} },
      update: async () => tab,
      create: async () => tab,
      remove: async () => {}
    },
    windows: {
      update: async () => {}
    },
    storage: {
      session: {
        get: async (key) => ({ [key]: session[key] }),
        set: async (value) => Object.assign(session, value)
      },
      local: {
        get: async (key) => ({ [key]: local[key] }),
        set: async (value) => Object.assign(local, value)
      }
    },
    permissions: {
      contains: async () => permissionGranted,
      getAll: async () => ({ origins: permissionGranted ? ["https://example.com/*"] : [] }),
      request: async () => permissionGranted,
      remove: async () => true
    },
    scripting: {
      executeScript: async ({ func }) => {
        calls.push(func.name);
        if (executeScriptFails) {
          throw new Error("injection denied");
        }
        if (func.name === "readPageState") {
          return [{ result: { websiteTitle: "網站原始標題", originalFavicon: null } }];
        }
        return [{ result: { currentTitle: "網站原始標題" } }];
      }
    }
  };

  vm.runInNewContext(workerSource, {
    chrome,
    TabLabelsCore: core,
    importScripts: () => {},
    console,
    URL
  });

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }

  async function reload() {
    listeners.updated(7, { status: "complete" });
    await flush();
  }

  async function sendMessage(message) {
    let response;
    const pending = listeners.message(message, {}, (value) => {
      response = value;
    });
    assert.equal(pending, true);
    await flush();
    return response;
  }

  return {
    calls,
    session,
    reload,
    sendMessage,
    setUrl: (nextUrl) => { tab.url = nextUrl; },
    getLoadAction: () => core.getTabLoadAction(record)
  };
}

test("manual title record reload reinstalls title without evaluating auto rules", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "手動名稱",
      originalTitle: "網站原始標題",
      pageUrl: "https://example.com/app"
    },
    rules: [{
      id: "auto",
      pattern: "https://example.com/",
      matchType: "prefix",
      label: "自動名稱",
      enabled: true
    }],
    permissionGranted: true
  });
  assert.equal(worker.getLoadAction(), "restore-session");
  await worker.reload();
  assert.deepEqual(worker.calls, ["installTabController"]);
});

test("manual favicon record reload reinstalls favicon", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "",
      customFavicon: { text: "F", background: "#123456", foreground: "auto", shape: "circle" },
      originalTitle: "網站原始標題",
      pageUrl: "https://example.com/app"
    }
  });
  await worker.reload();
  assert.deepEqual(worker.calls, ["installTabController"]);
});

test("manual title and favicon reload together", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "手動名稱",
      customFavicon: { text: "F", background: "#123456", foreground: "auto", shape: "rounded" },
      originalTitle: "網站原始標題",
      pageUrl: "https://example.com/app"
    }
  });
  await worker.reload();
  assert.deepEqual(worker.calls, ["installTabController"]);
});

test("manual record wins with no matching rule", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "手動名稱",
      originalTitle: "網站原始標題",
      pageUrl: "https://example.com/app"
    },
    rules: [{
      id: "other",
      pattern: "https://other.example/",
      matchType: "prefix",
      label: "其他",
      enabled: true
    }],
    permissionGranted: true
  });
  await worker.reload();
  assert.deepEqual(worker.calls, ["installTabController"]);
});

test("manual override wins over matching auto rule", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "手動名稱",
      originalTitle: "網站原始標題",
      pageUrl: "https://example.com/app"
    },
    rules: [{
      id: "auto",
      pattern: "https://example.com/",
      matchType: "prefix",
      label: "自動名稱",
      enabled: true
    }],
    permissionGranted: true
  });
  await worker.reload();
  assert.deepEqual(worker.calls, ["installTabController"]);
});

test("auto record reload evaluates and reapplies matching rule", async () => {
  const worker = createWorker({
    record: {
      source: "auto",
      customTitle: "自動名稱",
      originalTitle: "網站原始標題",
      autoRuleId: "auto",
      pageUrl: "https://example.com/app"
    },
    rules: [{
      id: "auto",
      pattern: "https://example.com/",
      matchType: "prefix",
      label: "自動名稱",
      enabled: true,
      updatedAt: "2026-08-02T00:00:00.000Z"
    }],
    permissionGranted: true
  });
  assert.equal(worker.getLoadAction(), "evaluate-auto");
  await worker.reload();
  assert.deepEqual(worker.calls, ["readPageState", "installTabController"]);
});

test("no record with matching rule applies auto rule", async () => {
  const worker = createWorker({
    rules: [{
      id: "auto",
      pattern: "https://example.com/",
      matchType: "prefix",
      label: "自動名稱",
      enabled: true,
      updatedAt: "2026-08-02T00:00:00.000Z"
    }],
    permissionGranted: true
  });
  await worker.reload();
  assert.deepEqual(worker.calls, ["readPageState", "installTabController"]);
});

test("no record with no matching rule does not inject", async () => {
  const worker = createWorker();
  assert.equal(worker.getLoadAction(), "evaluate-auto");
  await worker.reload();
  assert.deepEqual(worker.calls, []);
});

test("paused auto record reload keeps its current presentation and pause state", async () => {
  const worker = createWorker({
    record: {
      source: "auto",
      customTitle: "暫停時名稱",
      originalTitle: "網站原始標題",
      autoRulePaused: true,
      pageUrl: "https://example.com/app"
    },
    rules: [{
      id: "auto",
      pattern: "https://example.com/",
      matchType: "prefix",
      label: "新自動名稱",
      enabled: true
    }],
    permissionGranted: true
  });
  assert.equal(worker.getLoadAction(), "restore-session");
  await worker.reload();
  assert.deepEqual(worker.calls, ["installTabController"]);
  assert.equal(worker.session.labelsByTab["7"].autoRulePaused, true);
});

test("restoring the original title removes manual state before a later reload", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "手動名稱",
      originalTitle: "網站原始標題",
      pageUrl: "https://example.com/app"
    }
  });
  const restore = await worker.sendMessage({ type: "restore-label", tabId: 7 });
  assert.equal(restore.ok, true);
  assert.deepEqual(worker.calls, ["disableTitleInController"]);
  await worker.reload();
  assert.deepEqual(worker.calls, ["disableTitleInController"]);
});

test("manual presentation survives same-origin navigation and refresh", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "手動名稱",
      originalTitle: "原頁標題",
      pageUrl: "https://example.com/app"
    }
  });
  worker.setUrl("https://example.com/next");
  await worker.reload();
  assert.deepEqual(worker.calls, ["readPageState", "installTabController"]);
  assert.equal(worker.session.labelsByTab["7"].customTitle, "手動名稱");
  assert.equal(worker.session.labelsByTab["7"].pageUrl, "https://example.com/next");
});

test("cross-origin injection failure preserves manual record for later popup action", async () => {
  const worker = createWorker({
    record: {
      source: "manual",
      customTitle: "手動名稱",
      originalTitle: "原頁標題",
      pageUrl: "https://example.com/app"
    },
    url: "https://other.example/page",
    executeScriptFails: true
  });
  await worker.reload();
  assert.equal(worker.session.labelsByTab["7"].customTitle, "手動名稱");
  assert.equal(worker.session.labelsByTab["7"].pageUrl, "https://other.example/page");
});

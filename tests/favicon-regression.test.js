const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../core.js");

const workerSource = fs.readFileSync(
  path.join(__dirname, "..", "service-worker.js"),
  "utf8"
);

class FakeTitleElement {
  constructor() {
    this.textContent = "網站原始標題";
  }
}

class FakeMutationObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.target = null;
    this.options = null;
    this.disconnected = false;
    this.callbackCount = 0;
    FakeMutationObserver.instances.push(this);
  }

  observe(target, options) {
    this.target = target;
    this.options = options;
    this.disconnected = false;
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    if (!this.disconnected) {
      this.callbackCount += 1;
      this.callback([]);
    }
  }
}

function makeChrome() {
  const listener = () => {};
  return {
    runtime: {
      getManifest: () => ({ version: "0.2.0" }),
      onMessage: { addListener: listener },
      onStartup: { addListener: listener }
    },
    commands: { onCommand: { addListener: listener } },
    tabs: {
      onUpdated: { addListener: listener },
      onRemoved: { addListener: listener },
      query: async () => [],
      get: async () => null,
      update: async () => null,
      create: async () => null
    },
    windows: { update: async () => {} },
    storage: {
      session: { get: async () => ({}), set: async () => {} },
      local: { get: async () => ({}), set: async () => {} }
    },
    permissions: {
      contains: async () => false,
      getAll: async () => ({ origins: [] }),
      remove: async () => true
    },
    scripting: { executeScript: async () => [] }
  };
}

function createFixture() {
  FakeMutationObserver.instances = [];
  const titleElement = new FakeTitleElement();
  const document = {
    title: titleElement.textContent,
    querySelector(selector) {
      return selector === "title" ? titleElement : null;
    }
  };
  const context = {
    chrome: makeChrome(),
    TabLabelsCore: core,
    importScripts: () => {},
    console,
    URL,
    document,
    MutationObserver: FakeMutationObserver
  };
  vm.runInNewContext(
    workerSource + "\nglobalThis.__p0TestFunctions = { installTitleController, disableTitleInController, readPageState };",
    context
  );
  return { context, document, titleElement };
}

test("title controller observes only the title element, never the head", () => {
  const fixture = createFixture();
  fixture.context.__p0TestFunctions.installTitleController("自訂名稱", "網站原始標題");
  const observer = FakeMutationObserver.instances[0];
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(observer.target, fixture.titleElement);
  assert.equal(JSON.stringify(observer.options), JSON.stringify({ childList: true, characterData: true, subtree: true }));
  assert.equal(fixture.document.title, "自訂名稱");
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.document, "head"), false);
});

test("title changes are repaired without queueing a mutation loop", () => {
  const fixture = createFixture();
  fixture.context.__p0TestFunctions.installTitleController("自訂名稱", "網站原始標題");
  const observer = FakeMutationObserver.instances[0];
  fixture.document.title = "網站動態標題";
  observer.trigger();
  assert.equal(fixture.document.title, "自訂名稱");
  assert.equal(observer.callbackCount, 1);
  observer.trigger();
  assert.equal(fixture.document.title, "自訂名稱");
  assert.equal(observer.callbackCount, 2);
  assert.equal(workerSource.includes("queueMicrotask"), false);
});

test("restore title stops the observer and does not touch favicon DOM", () => {
  const fixture = createFixture();
  fixture.context.__p0TestFunctions.installTitleController("自訂名稱", "網站原始標題");
  const observer = FakeMutationObserver.instances[0];
  const result = fixture.context.__p0TestFunctions.disableTitleInController("網站原始標題");
  assert.equal(result.currentTitle, "網站原始標題");
  assert.equal(observer.disconnected, true);
  assert.equal(fixture.context.__tabLabelsTitleController__, undefined);
  observer.trigger();
  assert.equal(fixture.document.title, "網站原始標題");
});

test("page head stress has no Tab Labels observer or favicon runtime", () => {
  const faviconRuntimeMarkers = [
    "__tabLabelsController__",
    "data-tab-labels-managed",
    "apply-favicon",
    "restore-favicon",
    "observer.observe(document.head",
    "setInterval(",
    "setTimeout("
  ];
  faviconRuntimeMarkers.forEach((marker) => {
    assert.equal(workerSource.includes(marker), false, "unsafe favicon marker remains: " + marker);
  });
});

test("readPageState is title-only and does not inspect favicon links", () => {
  const fixture = createFixture();
  const state = fixture.context.__p0TestFunctions.readPageState();
  assert.equal(state.currentTitle, "網站原始標題");
  assert.equal(state.websiteTitle, "網站原始標題");
});

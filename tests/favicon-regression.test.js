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

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  get nextElementSibling() {
    if (!this.parentElement) {
      return null;
    }
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  get href() {
    return this.getAttribute("href") || "";
  }

  querySelectorAll(selector) {
    const matches = (element) => {
      if (element.tagName !== "LINK") {
        return false;
      }
      if (selector === "link") {
        return true;
      }
      if (selector === "link[rel]") {
        return element.getAttribute("rel") !== null;
      }
      return false;
    };
    const result = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        if (matches(child)) {
          result.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return result;
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement("head");
    this.title = "網站原始標題";
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    this.triggerCount = 0;
  }

  observe() {
    this.disconnected = false;
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    if (!this.disconnected) {
      this.triggerCount += 1;
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

function createFixture(icons = []) {
  const document = new FakeDocument();
  icons.forEach((icon) => {
    const link = document.createElement("link");
    Object.entries(icon).forEach(([name, value]) => link.setAttribute(name, value));
    document.head.appendChild(link);
  });

  const context = {
    chrome: makeChrome(),
    TabLabelsCore: core,
    importScripts: () => {},
    console,
    URL,
    document,
    MutationObserver: FakeMutationObserver,
    queueMicrotask,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(
    workerSource + "\nglobalThis.__faviconTestFunctions = { installTabController, readPageState };",
    context
  );

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }

  function install(customFaviconUrl = "data:image/png;base64,custom", originalFavicon = null, label = "測試名稱") {
    const result = context.__faviconTestFunctions.installTabController(
      label,
      "網站原始標題",
      originalFavicon,
      customFaviconUrl
    );
    return { result, controller: context.__tabLabelsController__ };
  }

  return { context, document, flush, install };
}

function isTabFavicon(link) {
  return (link.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("icon");
}

function allLinks(document) {
  return document.head.querySelectorAll("link");
}

function activeFavicons(document) {
  return allLinks(document).filter(isTabFavicon);
}

function managedFavicons(document) {
  return allLinks(document).filter((link) => link.getAttribute("data-tab-labels-managed") === "true");
}

function createIcon(document, attributes) {
  const link = document.createElement("link");
  Object.entries(attributes).forEach(([name, value]) => link.setAttribute(name, value));
  document.head.appendChild(link);
  return link;
}

test("no favicon creates the only active managed PNG favicon", () => {
  const fixture = createFixture();
  fixture.install();
  assert.equal(managedFavicons(fixture.document).length, 1);
  assert.equal(managedFavicons(fixture.document)[0].getAttribute("rel"), "icon");
  assert.equal(managedFavicons(fixture.document)[0].getAttribute("type"), "image/png");
  assert.deepEqual(activeFavicons(fixture.document).map((link) => link.getAttribute("href")), [
    "data:image/png;base64,custom"
  ]);
});

test("single favicon is disabled while custom icon is active and restores", () => {
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  const { controller } = fixture.install();
  assert.equal(activeFavicons(fixture.document).length, 1);
  assert.equal(activeFavicons(fixture.document)[0].getAttribute("href"), "data:image/png;base64,custom");
  controller.restoreFavicon();
  assert.deepEqual(activeFavicons(fixture.document).map((link) => link.getAttribute("href")), [
    "https://example.com/original.ico"
  ]);
});

test("multiple tab favicon links are managed together while apple-touch-icon stays untouched", () => {
  const fixture = createFixture([
    { rel: "apple-touch-icon", href: "https://example.com/apple.png" },
    { rel: "icon", href: "https://example.com/16.png", type: "image/png", sizes: "16x16" },
    { rel: "shortcut icon", href: "https://example.com/favicon.ico" }
  ]);
  const { controller } = fixture.install();
  assert.equal(managedFavicons(fixture.document).length, 1);
  assert.deepEqual(activeFavicons(fixture.document).map((link) => link.getAttribute("href")), [
    "data:image/png;base64,custom"
  ]);
  assert.equal(allLinks(fixture.document)[0].getAttribute("rel"), "apple-touch-icon");
  controller.restoreFavicon();
  assert.deepEqual(activeFavicons(fixture.document).map((link) => link.getAttribute("href")), [
    "https://example.com/16.png",
    "https://example.com/favicon.ico"
  ]);
  assert.equal(allLinks(fixture.document)[0].getAttribute("rel"), "apple-touch-icon");
});

test("website-added favicon is disabled and managed favicon remains last", async () => {
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  const { controller } = fixture.install();
  createIcon(fixture.document, { rel: "icon", href: "https://example.com/new.ico" });
  controller.observer.trigger();
  await fixture.flush();
  assert.equal(fixture.document.head.lastElementChild.getAttribute("data-tab-labels-managed"), "true");
  assert.deepEqual(activeFavicons(fixture.document).map((link) => link.getAttribute("href")), [
    "data:image/png;base64,custom"
  ]);
});

test("website changes a disabled favicon href without replacing the custom icon", async () => {
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  const { controller } = fixture.install();
  const disabled = allLinks(fixture.document).find((link) => link.getAttribute("data-tab-labels-disabled") === "true");
  disabled.setAttribute("href", "https://example.com/updated.ico");
  disabled.setAttribute("rel", "icon");
  controller.observer.trigger();
  await fixture.flush();
  assert.equal(activeFavicons(fixture.document)[0].getAttribute("href"), "data:image/png;base64,custom");
  controller.restoreFavicon();
  assert.equal(activeFavicons(fixture.document)[0].getAttribute("href"), "https://example.com/updated.ico");
});

test("reload installation with saved favicon states recreates managed PNG favicon", () => {
  const original = [{ href: "https://example.com/original.ico", rel: "icon", type: "", sizes: "" }];
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  fixture.install();
  const reloaded = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  reloaded.install("data:image/png;base64,reloaded", original);
  assert.equal(activeFavicons(reloaded.document).length, 1);
  assert.equal(activeFavicons(reloaded.document)[0].getAttribute("href"), "data:image/png;base64,reloaded");
});

test("restoring favicon removes managed link and later observer work does not revive it", async () => {
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  const { controller } = fixture.install();
  controller.restoreFavicon();
  controller.observer.trigger();
  await fixture.flush();
  assert.equal(managedFavicons(fixture.document).length, 0);
  assert.equal(activeFavicons(fixture.document)[0].getAttribute("href"), "https://example.com/original.ico");
});

test("title-only record does not modify favicon links", () => {
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  fixture.install("");
  assert.equal(managedFavicons(fixture.document).length, 0);
  assert.equal(activeFavicons(fixture.document)[0].getAttribute("href"), "https://example.com/original.ico");
});

test("favicon-only record installs custom favicon without requiring a title", () => {
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  fixture.install("data:image/png;base64,custom", null, "");
  assert.equal(fixture.document.title, "網站原始標題");
  assert.equal(activeFavicons(fixture.document)[0].getAttribute("href"), "data:image/png;base64,custom");
});

test("extension-owned changes are idempotent and do not create duplicate managed links", async () => {
  const fixture = createFixture([{ rel: "icon", href: "https://example.com/original.ico" }]);
  const { controller } = fixture.install();
  for (let index = 0; index < 10; index += 1) {
    controller.observer.trigger();
  }
  await fixture.flush();
  assert.equal(managedFavicons(fixture.document).length, 1);
  assert.equal(activeFavicons(fixture.document).length, 1);
  assert.ok(controller.observer.triggerCount >= 10);
});

test("readPageState captures all tab favicon links but ignores apple-touch-icon", () => {
  const fixture = createFixture([
    { rel: "apple-touch-icon", href: "https://example.com/apple.png" },
    { rel: "icon", href: "https://example.com/16.png" },
    { rel: "shortcut icon", href: "https://example.com/favicon.ico" }
  ]);
  const state = fixture.context.__faviconTestFunctions.readPageState("", "");
  assert.deepEqual(Array.from(state.originalFavicon, (icon) => icon.href), [
    "https://example.com/16.png",
    "https://example.com/favicon.ico"
  ]);
});

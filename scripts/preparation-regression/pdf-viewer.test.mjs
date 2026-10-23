import assert from "node:assert/strict";
import test from "node:test";
import { preparationUiRequestAllowed } from "./observe-ui.mjs";
import { preparationUiPdfResourceAllowed, preparationUiResourceKey } from "./pdf-viewer.mjs";

const extension = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";
const config = {
  webUrl: "http://127.0.0.1:14100",
  apiUrl: "http://127.0.0.1:14101",
  companionUrl: "http://127.0.0.1:14102",
};

test("allows only the exact observed Chromium PDF modules, styles and font as GET", () => {
  const resources = [
    ...[
      "pdf_embedder.css",
      "index.css",
      "main.js",
      "pdf_viewer_wrapper.js",
      "browser_api.js",
      "shared.rollup.js",
      "pdf_scripting_api.js",
    ].map((path) => `${extension}/${path}`),
    ...[
      "css/text_defaults_md.css",
      "css/roboto.css",
      "roboto/roboto-regular.woff2",
      "roboto/roboto-medium.woff2",
      "lit/v3_0/lit.rollup.js",
      "js/load_time_data.js",
      "js/assert.js",
      "mojo/mojo/public/js/bindings.js",
    ].map((path) => `chrome://resources/${path}`),
  ];
  for (const address of resources) {
    assert.equal(preparationUiPdfResourceAllowed("GET", address), true, address);
    assert.equal(preparationUiRequestAllowed("GET", address, null, config), true, address);
    for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"])
      assert.equal(
        preparationUiRequestAllowed(method, address, null, config),
        false,
        `${method} ${address}`,
      );
    assert.equal(preparationUiPdfResourceAllowed("GET", `${address}?token=secret`), false);
    assert.equal(preparationUiPdfResourceAllowed("GET", `${address}#fragment`), false);
  }
});

test("does not permit other opaque origins, extensions, internal pages, or unknown resources", () => {
  for (const address of [
    "file:///main.js",
    "data:text/javascript,alert(1)",
    "blob:http://127.0.0.1:14100/opaque",
    "chrome://settings/main.js",
    "chrome://resources/private.js",
    "chrome://resources@external.test/js/assert.js",
    "https://resources/js/assert.js",
    "chrome-extension://other/main.js",
    `${extension}/unknown.js`,
    `${extension}/../options.html`,
    "chrome-extension://user:secret@mhjfbmdgcfjbbpaeojofohoefgiehjai/main.js",
    "chrome://resources:1234/js/assert.js",
    "not a URL",
  ])
    assert.equal(preparationUiRequestAllowed("GET", address, null, config), false, address);
});

test("diagnostics retain internal scheme and host while omitting credentials and query payloads", () => {
  assert.equal(preparationUiResourceKey(`${extension}/main.js`), `${extension}/main.js`);
  assert.equal(
    preparationUiResourceKey("chrome://resources/js/assert.js"),
    "chrome://resources/js/assert.js",
  );
  assert.equal(
    preparationUiResourceKey("http://user:secret@127.0.0.1:14101/pdf?token=secret#secret"),
    "http://127.0.0.1:14101/pdf",
  );
  assert.equal(preparationUiResourceKey("data:text/plain,secret"), "data:");
  assert.equal(preparationUiResourceKey("blob:http://127.0.0.1:14100/secret"), "blob:");
});

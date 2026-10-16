// Observed with the isolated synthetic PDF probe on Chromium 152.0.7977.82.
export function preparationUiPdfResourceAllowed(method, address) {
  if (method !== "GET") return false;
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.username || url.password || url.port || url.search || url.hash) return false;
  if (url.protocol === "chrome-extension:" && url.hostname === "mhjfbmdgcfjbbpaeojofohoefgiehjai")
    return [
      "/pdf_embedder.css",
      "/index.css",
      "/main.js",
      "/pdf_viewer_wrapper.js",
      "/browser_api.js",
      "/shared.rollup.js",
      "/pdf_scripting_api.js",
    ].includes(url.pathname);
  if (url.protocol === "chrome:" && url.hostname === "resources")
    return [
      "/css/text_defaults_md.css",
      "/css/roboto.css",
      "/roboto/roboto-regular.woff2",
      "/roboto/roboto-medium.woff2",
      "/lit/v3_0/lit.rollup.js",
      "/js/load_time_data.js",
      "/js/assert.js",
      "/mojo/mojo/public/js/bindings.js",
    ].includes(url.pathname);
  return false;
}

export function preparationUiResourceKey(address) {
  try {
    const url = new URL(address);
    if (
      !["http:", "https:", "chrome:", "chrome-extension:", "webpack-internal:"].includes(
        url.protocol,
      )
    )
      return url.protocol;
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

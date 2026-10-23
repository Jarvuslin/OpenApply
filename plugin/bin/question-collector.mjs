import { extractQuestions } from "./question-dom.mjs";

export function collectionUrlAllowed(address, allowLoopback = false) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash || address.length > 4000) return false;
  if (allowLoopback && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    return url.protocol === "http:" && Number(url.port) >= 1024 && /^\/[^\\]*$/.test(url.pathname);
  if (url.protocol !== "https:" || url.port) return false;
  if (
    [
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "boards.eu.greenhouse.io",
      "job-boards.eu.greenhouse.io",
    ].includes(url.hostname)
  )
    return /^\/[^/]+\/jobs\/[^/]+\/?$/.test(url.pathname);
  if (["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname))
    return /^\/[^/]+\/[^/]+(?:\/apply)?\/?$/.test(url.pathname);
  return (
    url.hostname === "jobs.ashbyhq.com" &&
    /^\/[^/]+\/[^/]+(?:\/application)?\/?$/.test(url.pathname)
  );
}

export function sameJobUrl(initialAddress, nextAddress, allowLoopback = false) {
  if (!collectionUrlAllowed(nextAddress, allowLoopback)) return false;
  const initial = new URL(initialAddress);
  const next = new URL(nextAddress);
  if (initial.origin !== next.origin || initial.search !== next.search) return false;
  const base = (url) => {
    let pathname = url.pathname.replace(/\/$/, "");
    if (["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname))
      pathname = pathname.replace(/\/apply$/, "");
    if (url.hostname === "jobs.ashbyhq.com") pathname = pathname.replace(/\/application$/, "");
    return pathname;
  };
  return base(initial) === base(next);
}

export function collectionTarget(address) {
  const url = new URL(address);
  if (
    ["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname) &&
    !/\/apply\/?$/.test(url.pathname)
  )
    url.pathname = `${url.pathname.replace(/\/$/, "")}/apply`;
  if (url.hostname === "jobs.ashbyhq.com" && !/\/application\/?$/.test(url.pathname))
    url.pathname = `${url.pathname.replace(/\/$/, "")}/application`;
  return url.href;
}

export async function collectPage(browser, config) {
  if (!collectionUrlAllowed(config.url, config.allowLoopback === true))
    throw new Error("Unsupported question collection URL.");
  const initial = new URL(config.url);
  const target = collectionTarget(config.url);
  let observedUrl = target;
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
    permissions: [],
  });
  let blocked = 0;
  let requests = 0;
  const limit = 160;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const safe =
      ["GET", "HEAD"].includes(request.method()) &&
      url.origin === initial.origin &&
      !url.username &&
      !url.password &&
      ++requests <= limit &&
      (!request.isNavigationRequest() ||
        sameJobUrl(config.url, request.url(), config.allowLoopback === true));
    if (!safe) {
      blocked++;
      await route.abort("blockedbyclient");
    } else {
      // Browser routes do not reliably re-run for redirect hops, so validate each response before following.
      let address = request.url();
      for (let hop = 0; hop < 4; hop++) {
        if (hop > 0 && ++requests > limit) break;
        let response;
        try {
          response = await route.fetch({ url: address, maxRedirects: 0, timeout: 15_000 });
        } catch {
          blocked++;
          await route.abort("blockedbyclient").catch(() => {});
          return;
        }
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location) {
          let next;
          try {
            next = new URL(location, address);
          } catch {
            break;
          }
          if (
            next.origin !== initial.origin ||
            next.username ||
            next.password ||
            (request.isNavigationRequest() &&
              !sameJobUrl(config.url, next.href, config.allowLoopback === true))
          )
            break;
          address = next.href;
          continue;
        }
        if (request.isNavigationRequest() && !request.frame().parentFrame()) observedUrl = address;
        await route.fulfill({ response });
        return;
      }
      blocked++;
      await route.abort("blockedbyclient");
    }
  });
  await context.routeWebSocket("**/*", (socket) => {
    blocked++;
    socket.close();
  });
  await context.addInitScript(() => {
    const prevent = () => {
      throw new Error("Question collection is read-only.");
    };
    HTMLFormElement.prototype.submit = prevent;
    HTMLFormElement.prototype.requestSubmit = prevent;
    window.open = () => null;
    document.addEventListener("submit", (event) => event.preventDefault(), true);
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    let response;
    try {
      response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      return {
        definitions: [],
        sourceUrl: target,
        coverage: "blocked",
        reason: "The application form could not load under the read-only job URL policy.",
      };
    }
    if (!response?.ok())
      return {
        definitions: [],
        sourceUrl: target,
        coverage: "blocked",
        reason: "The application form did not load successfully.",
      };
    await page.waitForTimeout(500);
    if (!sameJobUrl(config.url, page.url(), config.allowLoopback === true))
      return {
        definitions: [],
        sourceUrl: target,
        coverage: "blocked",
        reason: "The application navigated outside the supported job URL.",
      };
    const result = await page.evaluate(extractQuestions);
    result.sourceUrl = observedUrl;
    if (blocked) {
      result.coverage = result.definitions.length ? "partial" : "blocked";
      result.reason =
        `${result.reason ?? ""} ${blocked} network requests were blocked by read-only collection.`
          .trim()
          .slice(0, 1000);
    }
    return result;
  } finally {
    await context.close();
  }
}

export function guestCollectionProgram() {
  return `const collectionUrlAllowed=${collectionUrlAllowed.toString()};\nconst sameJobUrl=${sameJobUrl.toString()};\nconst collectionTarget=${collectionTarget.toString()};\nconst extractQuestions=${extractQuestions.toString()};\nconst collectPage=${collectPage.toString()};
const {createInterface}=await import('node:readline');
const lines=createInterface({input:process.stdin});
let browser,aborted=false;
const stop=()=>{aborted=true;void browser?.close();};
process.stdin.once('end',stop);
const config=await new Promise((resolve,reject)=>{lines.once('line',line=>{if(line.length>8000)reject(new Error('Input limit'));else resolve(JSON.parse(line));});lines.once('close',()=>reject(new Error('Interrupted')));});
const timer=setTimeout(stop,35000);
try {
const {chromium}=await import('/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs');
browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],timeout:15000});
if(aborted)throw new Error('Interrupted');
console.log(JSON.stringify(await collectPage(browser,config)));
} catch {process.exitCode=1;} finally {clearTimeout(timer);await browser?.close();lines.close();process.stdin.destroy();}\n`;
}

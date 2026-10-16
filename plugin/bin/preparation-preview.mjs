import {
  fillOwnedPage,
  preparationFieldProblem,
  preparationValueValid,
  readNativePreparationValue,
} from "./preparation-fill.mjs";
import { collectionTarget, collectionUrlAllowed, sameJobUrl } from "./question-collector.mjs";
import { extractQuestions } from "./question-dom.mjs";

export async function previewPreparation(browser, config) {
  const { manifest, documents } = config;
  if (
    manifest?.mode !== "preview" ||
    manifest.submissionAllowed !== false ||
    !Array.isArray(manifest.questions) ||
    manifest.questions.length > 200 ||
    !Array.isArray(documents) ||
    documents.length > 4 ||
    !collectionUrlAllowed(manifest.job.url, config.allowLoopback === true)
  )
    throw new Error("Invalid preparation manifest");
  const initial = new URL(manifest.job.url);
  let sourceUrl = collectionTarget(manifest.job.url);
  let frozen = false;
  let blocked = 0;
  let requests = 0;
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
    permissions: [],
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    let address = request.url();
    const abort = async () => {
      blocked++;
      await route.abort("blockedbyclient").catch(() => {});
    };
    if (frozen || !["GET", "HEAD"].includes(request.method())) return abort();
    for (let hop = 0; hop < 4; hop++) {
      const url = new URL(address);
      if (
        ++requests > 160 ||
        url.origin !== initial.origin ||
        url.username ||
        url.password ||
        (request.isNavigationRequest() &&
          !sameJobUrl(manifest.job.url, address, config.allowLoopback === true))
      )
        return abort();
      let response;
      try {
        const headers = { ...request.headers() };
        delete headers.cookie;
        delete headers.authorization;
        response = await route.fetch({ url: address, headers, maxRedirects: 0, timeout: 15000 });
      } catch {
        return abort();
      }
      if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
        address = new URL(response.headers().location, address).href;
        continue;
      }
      if (request.isNavigationRequest() && !request.frame().parentFrame()) sourceUrl = address;
      await route.fulfill({ response });
      return;
    }
    return abort();
  });
  await context.routeWebSocket("**/*", (socket) => {
    blocked++;
    socket.close();
  });
  await context.addInitScript(() => {
    const prevent = () => {
      throw new Error("Preparation cannot submit.");
    };
    HTMLFormElement.prototype.submit = prevent;
    HTMLFormElement.prototype.requestSubmit = prevent;
    window.open = () => null;
    navigator.sendBeacon = () => false;
    document.addEventListener("submit", (event) => event.preventDefault(), true);
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    let response;
    try {
      response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {
      return {
        sourceUrl,
        status: "blocked",
        fields: [],
        reason: "The form could not load within the supported job URL policy.",
      };
    }
    if (!response?.ok())
      return {
        sourceUrl,
        status: "blocked",
        fields: [],
        reason: "The form did not load successfully.",
      };
    await page.waitForTimeout(300);
    frozen = true;
    if (!sameJobUrl(manifest.job.url, page.url(), config.allowLoopback === true))
      throw new Error("Job identity changed");
    const result = await fillOwnedPage(page, manifest, documents, { networkIsolated: true });
    if (blocked) {
      result.status = result.fields.some((field) => ["verified", "omitted"].includes(field.status))
        ? "partial"
        : "blocked";
      result.reason =
        `${result.reason ?? ""} Network requests were blocked; uploads and dynamic completion need explicit review.`
          .trim()
          .slice(0, 1000);
    }
    return { ...result, sourceUrl };
  } finally {
    await context.close();
  }
}

export function guestPreparationProgram() {
  return `const collectionUrlAllowed=${collectionUrlAllowed.toString()};
const collectionTarget=${collectionTarget.toString()};const sameJobUrl=${sameJobUrl.toString()};
const extractQuestions=${extractQuestions.toString()};const preparationFieldProblem=${preparationFieldProblem.toString()};
const preparationValueValid=${preparationValueValid.toString()};const readNativePreparationValue=${readNativePreparationValue.toString()};
const fillOwnedPage=${fillOwnedPage.toString()};const previewPreparation=${previewPreparation.toString()};
const {createInterface}=await import('node:readline');const lines=createInterface({input:process.stdin});
let browser,aborted=false;const stop=()=>{aborted=true;void browser?.close();};process.stdin.once('end',stop);
const config=await new Promise((resolve,reject)=>{lines.once('line',line=>{if(line.length>16000000)reject(new Error('Bound'));else resolve(JSON.parse(line));});lines.once('close',()=>reject(new Error('Interrupted')));});
const timer=setTimeout(stop,55000);
try {const {chromium}=await import('/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs');
browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],timeout:15000});
if(aborted)throw new Error('Interrupted');console.log(JSON.stringify(await previewPreparation(browser,config)));
}catch{process.exitCode=1;}finally{clearTimeout(timer);await browser?.close();lines.close();process.stdin.destroy();}`;
}

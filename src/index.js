import {Browser, BrowserContext, chromium, firefox, webkit, Request, Route} from "playwright";
import {createHandyClient} from 'handy-redis';

import RequestInterceptor from "./RequestInterceptor";

const launchConfig = [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-component-extensions-with-background-pages",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-features=TranslateUI,BlinkGenPropertyTrees",
    "--disable-ipc-flooding-protection",
    "--disable-renderer-backgrounding",
    "--enable-features=NetworkService,NetworkServiceInProcess",
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--metrics-recording-only",
    "--mute-audio",
    // "--headless",
    "--no-sandbox",
    // `--window-size=${device.viewportWidth},${device.viewportHeight}`
]

async function main() {
    const browser = await chromium.launch({
        headless: false,
        args: launchConfig
    });
    const browserContext = await browser.newContext();
    const interceptor = new RequestInterceptor(browserContext);
    await browserContext.route('**/*', interceptor.requestInterceptor());
    const page = await browserContext.newPage();
    await page.goto('https://google.com');
    console.log('========== LOADED'); // this will happen only on first load without cache
}

main();
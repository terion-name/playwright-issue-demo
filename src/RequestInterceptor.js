import {Browser, Request, Response, Route} from "playwright";
import axios from "axios";
import parseCacheControl from "parse-cache-control";
import tough from "tough-cookie";
import moment from "moment";
import {toPairs} from "lodash/object";
import axiosCookieJarSupport from "axios-cookiejar-support";
import {createHandyClient} from "handy-redis";

const redis = createHandyClient();

axiosCookieJarSupport(axios);

export default class RequestInterceptor {
  browser: Browser;
  jar: tough.CookieJar;

  _cache = {};
  _etags = {};


  constructor(browser: Browser, jar: tough.CookieJar = null) {
    this.browser = browser;
    this.jar = jar || new tough.CookieJar;
    this.requestInterceptor = this.requestInterceptor.bind(this);
  }

  requestInterceptor() {
    return async (route: Route, request: Request) => {
      if(
        ['media', 'image'].includes(request.resourceType())
      ) {
        return route.abort("blockedbyclient");
      }
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('about:')) {
        return route.continue();
      }
      const cached = await this.fromCache(request);
      if (cached) {
        console.log('fulfill from cache', url);
        return await route.fulfill(cached);
      }

      try {
        const headers = this.buildHeaders(request);
        const resp = await axios({
          url: url,
          method: request.method(),
          headers,
          data: request.postData(),
          timeout: request.isNavigationRequest() ? 20000 : 10000,
          responseType: 'stream',
          maxRedirects: 10,
          proxy: false,
          jar: this.jar,
          withCredentials: true,
          validateStatus: function (status) {
            return true// status >= 200 && status < 300; // default
          },
        });
        // console.log('response headers', resp.headers);
        const stream = resp.data;
        const bufs = [];
        stream.on('data', (chunk) => {
          bufs.push(chunk);
        });
        stream.on('end', () => {
          const responseBuffer = Buffer.concat(bufs);
          this.cache({
            status: resp.status,
            headers: resp.headers,
            contentType: resp.headers['content-type'],
            body: responseBuffer,
          }, request, resp).then(data => route.fulfill(data))
        });
      } catch (e) {
        console.error(`Request failed with code ${e.response?.status} (url: ${url})`);
        await route.abort(e.response?.status ? 'failed' : 'connectionfailed');
      }
    }
  }

  buildHeaders(request: Request) {
    return {
      ...request.headers(),
      "connection": "keep-alive",
      "accept-encoding": "gzip, deflate",
      "DNT": 1,
      ...(request.isNavigationRequest() ? {
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": request.headers()['referer'] ? "cross-site" : "none",
        "sec-fetch-user": "?1",
      } : {
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "same-origin"
      })
    }
  }

  async cache(data, request: Request, response: Response) {
    const cacheControl = parseCacheControl(response.headers['cache-control']);
    const etag = response.headers['etag'];
    // console.log(response.headers['cache-control']);
    if ((!cacheControl && !etag) || (cacheControl && cacheControl['no-store'])) {
      // don't cache
      return data;
    }
    const ttl = (cacheControl && cacheControl['max-age']) || 3600 * 24 * 30;
    const storage = (cacheControl && cacheControl['private']) ? 'memory' : 'redis';

    const url = request.url();
    console.log(`Caching ${url} in ${storage} for ${ttl} sec`)

    if (storage === 'memory') {
      this._cache[url] = {data, ttl, saved_at: moment()};
      this._etags[url] = etag;
    } else {
      // console.log(toPairs({...data, headers: JSON.stringify(data.headers)}));
      await redis.hmset('httpcache:data:' + url, toPairs({...data, headers: JSON.stringify(data.headers)}));
      await redis.expire('httpcache:data:' + url, ttl);
      if (etag) await redis.set('httpcache:etag:' + url, etag);
    }

    return data;
  }

  async fromCache(request: Request) {
    const url = request.url();
    console.log('searching cache', url);
    if (url in this._cache) {
      const c = this._cache[url];
      if (c.saved_at.add(c.ttl, 'seconds') < moment()) {
        delete this._cache[url];
        return false;
      }
      console.log('getting from cache', url);
      return c.data;
    } else {
      const c = await redis.hgetall('httpcache:data:' + url);
      if (c) {
        console.log('getting from cache', url);
        // const unpacked = fromPairs(c);
        return {...c, body: Buffer.from(c.body, 'utf8'), headers: JSON.parse(c.headers)};
      }
    }
    return false;
  }

}

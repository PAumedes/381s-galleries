import { describe, expect, it } from "vitest";
import { parseUserAgent } from "../app/lib/server/user-agent";

const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
  chromeAndroidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  firefoxWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  firefoxLinux:
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
  edgeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.2592.80",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  operaWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.5.8.103 (iPhone14,5; iOS 17_5; es_AR; es; scale=3.00; 1170x2532; 612011345)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A546E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.72 Mobile Safari/537.36 Instagram 330.0.0.38.88 Android (33/13; 420dpi; 1080x2186; samsung; SM-A546E; a54x; s5e8835; es_AR; 600000000)",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 12; SM-G991B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/460.0.0.45.108;FBBV/123;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBLC/es_LA]",
  whatsappPreview: "WhatsApp/2.24.12.78 A",
  crOs: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googlebotMobile:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.60 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  fbPreview:
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  curl: "curl/8.5.0",
};

const p = (k: keyof typeof UA) => parseUserAgent(UA[k]);

describe("parseUserAgent", () => {
  it.each([
    ["chromeWin", "Chrome", "126", "Windows", "desktop"],
    ["chromeMac", "Chrome", "125", "macOS", "desktop"],
    ["chromeAndroid", "Chrome", "126", "Android", "mobile"],
    ["chromeAndroidTablet", "Chrome", "124", "Android", "tablet"],
    ["safariIphone", "Safari", "17", "iOS", "mobile"],
    ["safariMac", "Safari", "17", "macOS", "desktop"],
    ["safariIpad", "Safari", "16", "iOS", "tablet"],
    ["chromeIos", "Chrome", "126", "iOS", "mobile"],
    ["firefoxWin", "Firefox", "127", "Windows", "desktop"],
    ["firefoxLinux", "Firefox", "128", "Linux", "desktop"],
    ["firefoxIos", "Firefox", "127", "iOS", "mobile"],
    ["edgeWin", "Edge", "126", "Windows", "desktop"],
    ["edgeAndroid", "Edge", "126", "Android", "mobile"],
    ["samsung", "Samsung Internet", "25", "Android", "mobile"],
    ["operaWin", "Opera", "111", "Windows", "desktop"],
    ["instagramIos", "Instagram", "340", "iOS", "mobile"],
    ["instagramAndroid", "Instagram", "330", "Android", "mobile"],
    ["facebookAndroid", "Facebook", "450", "Android", "mobile"],
    ["facebookIos", "Facebook", "460", "iOS", "mobile"],
    ["crOs", "Chrome", "124", "ChromeOS", "desktop"],
  ] as const)("%s", (k, browser, version, os, device) => {
    expect(p(k)).toEqual({
      browser,
      browserVersion: version,
      os,
      device,
    });
  });

  it("WhatsApp link previews are bots", () => {
    expect(p("whatsappPreview")).toMatchObject({
      browser: "WhatsApp",
      browserVersion: "2",
      device: "bot",
    });
  });

  it.each(["googlebot", "googlebotMobile", "fbPreview", "curl"] as const)(
    "%s is a bot",
    (k) => {
      expect(p(k).device).toBe("bot");
    },
  );

  it("a bot pretending to be Chrome mobile is still a bot", () => {
    expect(p("googlebotMobile").os).toBe("Android");
  });

  it("missing, empty and garbage user agents are unknown, never throw", () => {
    const unknown = {
      browser: null,
      browserVersion: null,
      os: null,
      device: "unknown",
    };
    expect(parseUserAgent(null)).toEqual(unknown);
    expect(parseUserAgent(undefined)).toEqual(unknown);
    expect(parseUserAgent("")).toEqual(unknown);
    expect(parseUserAgent("   ")).toEqual(unknown);
    expect(parseUserAgent("\u0000\u0007\n")).toEqual(unknown);
    expect(parseUserAgent("lorem ipsum")).toEqual(unknown);
  });

  it("versions are major only, digits only", () => {
    expect(
      parseUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/<script>alert(1)"),
    ).toMatchObject({ browser: "Chrome", browserVersion: null });
    expect(
      parseUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/99999999999.1"),
    ).toMatchObject({ browserVersion: null });
  });

  it("is cheap on huge or hostile input", () => {
    const evil = "Chrome/".repeat(100_000) + "(".repeat(100_000);
    const t0 = performance.now();
    const r = parseUserAgent(evil);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r.device).toMatch(/^(mobile|tablet|desktop|bot|unknown)$/);
  });

  it("only returns allowed device values and short strings", () => {
    for (const k of Object.keys(UA) as (keyof typeof UA)[]) {
      const r = p(k);
      expect(["mobile", "tablet", "desktop", "bot", "unknown"]).toContain(
        r.device,
      );
      for (const v of [r.browser, r.os, r.browserVersion])
        expect((v ?? "").length).toBeLessThanOrEqual(20);
    }
  });
});

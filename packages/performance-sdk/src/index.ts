import {
  createPerformanceUploadEvent,
  sanitizePerformanceText as sanitizeText,
  sanitizePerformanceUrl,
  type PerformanceEvent,
  type PerformanceRating
} from "./contract";
import { FinalVitalAccumulator, RouteCumulativeValue } from "./vitals";

export {
  createPerformanceUploadEvent,
  sanitizePerformanceUrl,
  type PerformanceEvent,
  type PerformanceEventType,
  type PerformanceRating,
  type PerformanceUploadEvent
} from "./contract";

export type PerformanceSdkOptions = {
  endpoint: string;
  appId: string;
  release?: string;
  environment?: string;
  sampleRate?: number;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
  captureFetch?: boolean;
  captureResources?: boolean;
  routeResolver?: (url: URL) => string;
};

export type PerformanceSdk = {
  track: (event: Omit<PerformanceEvent, "schemaVersion" | "eventId" | "appId" | "release" | "environment" | "sessionId" | "occurredAt" | "page"> & {
    page?: string;
    occurredAt?: string;
  }) => void;
  trackPageView: (page?: string) => void;
  flush: () => Promise<void>;
  destroy: () => Promise<void>;
};

type WindowWithFetch = Window & typeof globalThis;

const MAX_RESOURCE_EVENTS = 50;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : undefined;
}

function eventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function currentPage(win: WindowWithFetch, routeResolver?: (url: URL) => string) {
  if (routeResolver) {
    try {
      return sanitizePerformanceUrl(routeResolver(new URL(win.location.href)), win.location.href);
    } catch {
      // A custom resolver must never prevent telemetry from using the privacy-safe fallback.
    }
  }
  return sanitizePerformanceUrl(win.location.href, win.location.href);
}

function ratingFor(name: string, value: number): PerformanceRating | undefined {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    CLS: [0.1, 0.25],
    INP: [200, 500],
    FCP: [1800, 3000],
    TTFB: [800, 1800]
  };
  const threshold = thresholds[name];
  if (!threshold) {
    return undefined;
  }
  if (value <= threshold[0]) {
    return "good";
  }
  return value <= threshold[1] ? "needs-improvement" : "poor";
}

function supportedObserver(type: string) {
  return typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes(type);
}

export function createPerformanceSdk(options: PerformanceSdkOptions): PerformanceSdk {
  if (!options.endpoint || !options.appId) {
    throw new Error("Performance SDK requires endpoint and appId");
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      track: () => undefined,
      trackPageView: () => undefined,
      flush: async () => undefined,
      destroy: async () => undefined
    };
  }

  const win = window as WindowWithFetch;
  const endpoint = new URL(options.endpoint, win.location.href).toString();
  const sampleRate = clamp(options.sampleRate ?? 1, 0, 1);
  const sampled = Math.random() < sampleRate;
  const batchSize = Math.round(clamp(options.batchSize ?? 20, 1, 50));
  const maxQueueSize = Math.round(clamp(options.maxQueueSize ?? 200, batchSize, 1000));
  const flushIntervalMs = Math.round(clamp(options.flushIntervalMs ?? 5000, 1000, 60_000));
  const release = sanitizeText(options.release ?? "local", 100);
  const environment = sanitizeText(options.environment ?? "development", 50);
  const sessionStorageKey = `performance-sdk:${options.appId}:session`;
  let sessionId = "";
  try {
    sessionId = win.sessionStorage.getItem(sessionStorageKey) ?? "";
    if (!sessionId) {
      sessionId = eventId();
      win.sessionStorage.setItem(sessionStorageKey, sessionId);
    }
  } catch {
    sessionId = eventId();
  }

  const queue: PerformanceEvent[] = [];
  const observers: PerformanceObserver[] = [];
  const pendingVitals = new FinalVitalAccumulator();
  const cumulativeCls = new RouteCumulativeValue();
  let destroyed = false;
  let flushing: Promise<void> | null = null;
  let resourceEvents = 0;
  let navigationTimer: number | undefined;
  const originalFetch = win.fetch.bind(win);
  const originalPushState = win.history.pushState.bind(win.history);

  function enqueue(
    input: Omit<PerformanceEvent, "schemaVersion" | "eventId" | "appId" | "release" | "environment" | "sessionId" | "occurredAt" | "page"> & {
      page?: string;
      occurredAt?: string;
    }
  ) {
    if (!sampled || destroyed) {
      return;
    }
    const next: PerformanceEvent = {
      schemaVersion: "1.0",
      eventId: eventId(),
      appId: sanitizeText(options.appId, 100),
      release,
      environment,
      sessionId,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: input.type,
      page: sanitizePerformanceUrl(input.page ?? currentPage(win, options.routeResolver), win.location.href),
      name: sanitizeText(input.name, 200),
      duration: finite(input.duration),
      value: finite(input.value),
      rating: input.rating,
      statusCode: input.statusCode,
      success: input.success,
      metadata: input.metadata
    };
    queue.push(next);
    if (queue.length > maxQueueSize) {
      queue.splice(0, queue.length - maxQueueSize);
    }
    if (queue.length >= batchSize) {
      void flush();
    }
  }

  async function flush(): Promise<void> {
    if (!sampled || queue.length === 0) {
      return;
    }
    if (flushing) {
      await flushing;
      return;
    }
    const events = queue.splice(0, batchSize);
    const request = originalFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: events.map((event) => createPerformanceUploadEvent(event, win.location.href)) }),
      credentials: "omit",
      keepalive: true
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Performance event upload failed with ${response.status}`);
        }
      })
      .catch(() => {
        if (!destroyed) {
          queue.unshift(...events);
          if (queue.length > maxQueueSize) {
            queue.length = maxQueueSize;
          }
        }
      })
      .finally(() => {
        flushing = null;
      });
    flushing = request;
    await request;
  }

  function trackPageView(page = currentPage(win, options.routeResolver)) {
    enqueue({ type: "page_view", name: "page-view", page });
  }

  function recordVital(name: string, value: number, strategy: "latest" | "max" = "latest") {
    pendingVitals.record(
      {
        name,
        value,
        rating: ratingFor(name, value),
        page: currentPage(win, options.routeResolver)
      },
      strategy
    );
  }

  function emitFinalVitals() {
    for (const vital of pendingVitals.drain()) {
      enqueue({
        type: "web_vital",
        name: vital.name,
        value: vital.value,
        rating: vital.rating,
        page: vital.page
      });
    }
    cumulativeCls.reset();
  }

  function observe(type: string, callback: (entries: PerformanceEntry[]) => void, options?: PerformanceObserverInit) {
    if (!supportedObserver(type)) {
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe(options ?? { type, buffered: true });
      observers.push(observer);
    } catch {
      // Browsers can expose an entry type but still reject unsupported observer options.
    }
  }

  function captureNavigation() {
    const navigation = win.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navigation) {
      return;
    }
    const ttfb = finite(navigation.responseStart);
    if (ttfb !== undefined) {
      recordVital("TTFB", ttfb);
    }
    enqueue({
      type: "navigation",
      name: "document-load",
      duration: navigation.loadEventEnd || navigation.duration,
      metadata: {
        domContentLoaded: finite(navigation.domContentLoadedEventEnd) ?? 0,
        transferSize: navigation.transferSize
      }
    });
  }

  function captureObservers() {
    observe("paint", (entries) => {
      for (const entry of entries) {
        if (entry.name === "first-contentful-paint") {
          recordVital("FCP", entry.startTime);
        }
      }
    });

    observe(
      "largest-contentful-paint",
      (entries) => {
        const entry = entries.at(-1);
        if (entry) {
          recordVital("LCP", entry.startTime);
        }
      },
      { type: "largest-contentful-paint", buffered: true }
    );

    observe("layout-shift", (entries) => {
      let cls = 0;
      let changed = false;
      for (const entry of entries) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput) {
          cls = cumulativeCls.add(shift.value ?? 0);
          changed = true;
        }
      }
      if (changed) {
        recordVital("CLS", cls);
      }
    });

    observe("event", (entries) => {
      const longest = entries.reduce((maximum, entry) => Math.max(maximum, entry.duration), 0);
      if (longest > 0) {
        recordVital("INP", longest, "max");
      }
    }, { type: "event", durationThreshold: 40 } as PerformanceObserverInit);

    if (options.captureResources !== false) {
      observe("resource", (entries) => {
        for (const entry of entries) {
          if (resourceEvents >= MAX_RESOURCE_EVENTS || entry.name === endpoint) {
            continue;
          }
          const resource = entry as PerformanceResourceTiming;
          resourceEvents += 1;
          enqueue({
            type: "resource",
            name: sanitizePerformanceUrl(resource.name, win.location.href),
            duration: resource.duration,
            metadata: {
              initiatorType: sanitizeText(resource.initiatorType || "other", 40),
              transferSize: resource.transferSize
            }
          });
        }
      });
    }
  }

  const onError = (event: ErrorEvent) => {
    enqueue({
      type: "error",
      name: sanitizeText(event.message || "Uncaught error"),
      metadata: {
        source: event.filename ? sanitizePerformanceUrl(event.filename, win.location.href) : "window",
        line: event.lineno,
        column: event.colno
      }
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const message = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Unhandled rejection");
    enqueue({ type: "error", name: sanitizeText(message), metadata: { source: "unhandledrejection" } });
  };
  const onPageHide = () => {
    emitFinalVitals();
    void flush();
  };
  const trackSpaPageView = () => {
    emitFinalVitals();
    trackPageView();
  };
  const onPopState = () => trackSpaPageView();
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      emitFinalVitals();
      void flush();
    }
  };
  const scheduleNavigationCapture = () => {
    navigationTimer = win.setTimeout(() => {
      navigationTimer = undefined;
      captureNavigation();
    }, 0);
  };
  const onLoad = () => scheduleNavigationCapture();

  if (options.captureFetch !== false) {
    win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = typeof input === "string" || input instanceof URL ? new URL(input, win.location.href) : new URL(input.url);
      if (requestUrl.toString() === endpoint) {
        return originalFetch(input, init);
      }
      const startedAt = win.performance.now();
      try {
        const response = await originalFetch(input, init);
        enqueue({
          type: "api",
          name: sanitizePerformanceUrl(requestUrl.toString(), win.location.href),
          duration: win.performance.now() - startedAt,
          statusCode: response.status,
          success: response.ok,
          metadata: { method: sanitizeText(init?.method ?? (input instanceof Request ? input.method : "GET"), 10).toUpperCase() }
        });
        return response;
      } catch (error) {
        enqueue({
          type: "api",
          name: sanitizePerformanceUrl(requestUrl.toString(), win.location.href),
          duration: win.performance.now() - startedAt,
          success: false,
          metadata: { method: sanitizeText(init?.method ?? (input instanceof Request ? input.method : "GET"), 10).toUpperCase() }
        });
        throw error;
      }
    }) as typeof win.fetch;
  }

  win.history.pushState = ((...args: Parameters<History["pushState"]>) => {
    originalPushState(...args);
    queueMicrotask(() => trackSpaPageView());
  }) as History["pushState"];
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onUnhandledRejection);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("popstate", onPopState);
  document.addEventListener("visibilitychange", onVisibilityChange);
  trackPageView();
  if (document.readyState === "complete") {
    scheduleNavigationCapture();
  } else {
    win.addEventListener("load", onLoad, { once: true });
  }
  captureObservers();
  const interval = win.setInterval(() => void flush(), flushIntervalMs);

  return {
    track: enqueue,
    trackPageView,
    flush,
    destroy: async () => {
      win.clearInterval(interval);
      observers.forEach((observer) => observer.disconnect());
      win.removeEventListener("error", onError);
      win.removeEventListener("unhandledrejection", onUnhandledRejection);
      win.removeEventListener("pagehide", onPageHide);
      win.removeEventListener("popstate", onPopState);
      win.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (navigationTimer !== undefined) {
        win.clearTimeout(navigationTimer);
      }
      win.history.pushState = originalPushState as History["pushState"];
      if (options.captureFetch !== false) {
        win.fetch = originalFetch as typeof win.fetch;
      }
      emitFinalVitals();
      await flush();
      destroyed = true;
    }
  };
}

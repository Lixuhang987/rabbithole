export const DEFAULT_FETCH_PROXY_URL = "https://rabbithole-fetch-proxy.khemanishlok.workers.dev";

// HTTPS supports article ingestion; loopback HTTP supports the paired bridge.
export const WEB_CONNECT_SOURCES = Object.freeze([
  "'self'",
  "blob:",
  "https:",
  "https://api.github.com",
  "https://arxiv.org",
  "https://www.arxiv.org",
  "https://ar5iv.labs.arxiv.org",
  "https://ar5iv.org",
  "https://openreview.net",
  "https://*.workers.dev",
  "http://localhost:*",
  "http://127.0.0.1:*",
]);

// This is a separate server-side SSRF boundary, not the browser CSP list.
export const FETCH_PROXY_ALLOWED_HOSTS = Object.freeze([
  "arxiv.org",
  "www.arxiv.org",
  "ar5iv.labs.arxiv.org",
  "ar5iv.org",
  "openreview.net",
]);

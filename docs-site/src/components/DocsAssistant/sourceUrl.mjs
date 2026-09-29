const CANONICAL_SITE_ORIGIN = "https://www.enterpriseaigroup.com";
const ALLOWED_HOSTS = new Set([
  "enterpriseaigroup.com",
  "www.enterpriseaigroup.com",
]);
const NON_PAGE_SEGMENTS = new Set([
  "admin",
  "api",
  "media",
  "uploads",
  "storage",
  "_next",
]);

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rawPath(value) {
  if (/^https?:\/\//i.test(value)) {
    return value.match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] || "/";
  }
  return value.split(/[?#]/, 1)[0];
}

function canonicalPageUrl(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\s\\\u0000-\u001f]/.test(value)
  )
    return null;
  const candidate = value.trim();
  if (candidate.startsWith("//") || /%(?:2f|5c)/i.test(candidate)) return null;

  const rawSegments = rawPath(candidate).split("/");
  try {
    if (
    rawSegments.some((segment) => {
      const decoded = decodeURIComponent(segment);
      return decoded.includes("\\") || [".", ".."].includes(decoded);
    })
    )
      return null;
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(candidate, CANONICAL_SITE_ORIGIN);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash
  )
    return null;

  const path = parsed.pathname.replace(/\/{2,}/g, "/");
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (
    segments.some((segment) => NON_PAGE_SEGMENTS.has(segment)) ||
    /\.(?:pdf|docx?|xlsx?|pptx?|zip|tgz|png|jpe?g|gif|svg|mp4|mov)$/i.test(path)
  )
    return null;

  const canonicalPath = path === "/" ? "/" : path.replace(/\/+$/, "");
  return `${CANONICAL_SITE_ORIGIN}${canonicalPath}`;
}

export function sourceHref(source, docsItems = []) {
  if (!source || typeof source !== "object") return null;

  // The chat API returns canonical citations in `url`; reject unsafe URLs instead
  // of replacing them with a guessed page based on a similar title.
  if (typeof source.url === "string") return canonicalPageUrl(source.url);

  for (const key of ["canonicalPath", "path"]) {
    if (typeof source[key] === "string") return canonicalPageUrl(source[key]);
  }

  if (typeof source.route === "string") {
    if (
      !source.route.startsWith("/") ||
      source.route.startsWith("//") ||
      source.route.includes("?") ||
      source.route.includes("#")
    )
      return null;
    const route =
      source.route === "/docs/eai" || source.route.startsWith("/docs/eai/")
        ? source.route
        : "/docs/eai" + source.route;
    const url = canonicalPageUrl(route);
    return url === CANONICAL_SITE_ORIGIN + "/docs/eai" ||
      url?.startsWith(CANONICAL_SITE_ORIGIN + "/docs/eai/")
      ? url
      : null;
  }

  const title = normaliseText(source.title);
  if (!title) return null;
  const matchingDoc = docsItems.find(
    (item) => normaliseText(item.title) === title,
  );
  if (
    !matchingDoc ||
    typeof matchingDoc.route !== "string" ||
    !matchingDoc.route.startsWith("/docs/")
  )
    return null;

  return canonicalPageUrl(`/docs/eai${matchingDoc.route}`);
}

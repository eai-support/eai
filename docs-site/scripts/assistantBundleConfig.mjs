export function extractDocsAssistantApiUrls(bundleContents) {
  const pattern = /\bcustomFields:\{[^{}]*?\bdocsAssistantApiUrl:("(?:\\.|[^"\\])*")/g;
  return [...bundleContents.matchAll(pattern)].map((match) => JSON.parse(match[1]));
}

export function assertNoForbiddenAssistantUrl(bundleContents, forbiddenUrl) {
  if (forbiddenUrl && bundleContents.includes(forbiddenUrl)) {
    throw new Error(`Generated bundles contain a forbidden assistant URL: ${forbiddenUrl}`);
  }
}

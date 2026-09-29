export function extractDocsAssistantApiUrls(bundleContents) {
  const pattern = /\bcustomFields:\{[^{}]*?\bdocsAssistantApiUrl:("(?:\\.|[^"\\])*")/g;
  return [...bundleContents.matchAll(pattern)].map((match) => JSON.parse(match[1]));
}

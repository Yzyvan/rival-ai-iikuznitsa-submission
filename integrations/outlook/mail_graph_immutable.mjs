// The pinned provider has no immutable-ID option. Use it only on the separate
// read-only message-identity process to preserve all other transport IDs.
const graphMessage = /^\/v1\.0\/me\/messages\/[^/]+$/;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.origin !== "https://graph.microsoft.com" || method.toUpperCase() !== "GET" ||
      !graphMessage.test(url.pathname)) {
    return nativeFetch(input, init);
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.append("Prefer", 'IdType="ImmutableId"');
  return nativeFetch(input, { ...init, headers });
};

import { parse } from "node:querystring";
import type { Request } from "express";

/** Avoid the legacy query getter installed by the Vercel Node runtime. */
export function requestQuery(request: Pick<Request, "url">) {
  const url = new URL(request.url, "http://request.invalid");
  return parse(url.search.slice(1));
}

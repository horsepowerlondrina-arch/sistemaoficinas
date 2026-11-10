import assert from "node:assert/strict";
import test from "node:test";
import { requestQuery } from "../server/requestQuery.js";

test("request query preserves repeated and encoded parameters without reading the runtime getter", () => {
  const request = {
    url: "/api/documents/order/example?revision=2&current=1&label=Pe%C3%A7a+nova&tag=a&tag=b",
    get query() {
      throw new Error("Vercel legacy query getter was accessed");
    },
  };
  const query = requestQuery(request);
  assert.deepEqual({ ...query }, {
    revision: "2", current: "1", label: "Peça nova", tag: ["a", "b"],
  });
});

test("request query ignores URL fragments and returns an empty object without parameters", () => {
  assert.deepEqual({ ...requestQuery({ url: "/api/documents/order/example?revision=3#ignored" }) }, { revision: "3" });
  assert.deepEqual({ ...requestQuery({ url: "/api/documents/order/example" }) }, {});
});

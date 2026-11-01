import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { respondAfterCommit } from "../server/db/responseCommit";
import type { DB } from "../server/db/database";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
for (const fail of [false, true]) {
  test("response waits for commit and " + (fail ? "withholds success/cookie on failure" : "returns the committed result"), async () => {
    const atCommit = deferred(), release = deferred();
    const db = {
      async withRequestContext<T>(_settings: Record<string,string>, callback: () => Promise<T>, shouldCommit?: () => boolean) {
        const result = await callback();
        assert.equal(shouldCommit?.(), true);
        atCommit.resolve();
        await release.promise;
        if (fail) throw new Error("simulated commit failure");
        return result;
      },
    } as DB;
    const app = express();
    app.use((_req,res,next) => respondAfterCommit(db, {}, res, next));
    app.get("/", (_req,res) => { res.cookie("hp_session", "fictitious"); res.json({ok:true}); });
    app.use((error: {status?:number}, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({error:"commit failed"}));
    const server = app.listen(0,"127.0.0.1"); await once(server,"listening");
    let responseArrived = false;
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const pending = fetch("http://127.0.0.1:" + address.port).then(response => { responseArrived = true; return response; });
      await atCommit.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(responseArrived,false,"HTTP success cannot precede the commit");
      release.resolve();
      const response = await pending;
      assert.equal(response.status,fail ? 500 : 200);
      assert.deepEqual(await response.json(),fail ? {error:"commit failed"} : {ok:true});
      if (fail) assert.equal(response.headers.get("set-cookie"),null);
      else assert.match(response.headers.get("set-cookie") || "",/^hp_session=fictitious;/);
    } finally { release.resolve(); await new Promise<void>(resolve => server.close(()=>resolve())); }
  });
}
test("error responses request rollback before delivery",async()=>{
 const decisions:boolean[]=[];
 const db={async withRequestContext<T>(_settings:Record<string,string>,callback:()=>Promise<T>,shouldCommit?:()=>boolean){const result=await callback();decisions.push(shouldCommit?.() ?? true);return result;}} as DB;
 const app=express();app.use((_req,res,next)=>respondAfterCommit(db,{},res,next));
 app.get("/",(_req,res)=>res.status(403).json({error:"forbidden"}));
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");
 try{const address=server.address();assert.ok(address&&typeof address!=="string");const response=await fetch("http://127.0.0.1:"+address.port);assert.equal(response.status,403);assert.deepEqual(decisions,[false]);}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

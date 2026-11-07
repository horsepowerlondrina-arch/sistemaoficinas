import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
function worker() {
  let listener: any;
  let fail = false;
  const calls: any[] = [];
  const tabs: any[] = [];
  const area = () => {
    const data: Record<string, any> = {};
    return {
      data,
      async setAccessLevel() {},
      async get(key: string) {
        return structuredClone({ [key]: data[key] });
      },
      async set(v: any) {
        Object.assign(data, structuredClone(v));
      },
      async remove(k: string) {
        delete data[k];
      },
    };
  };
  const local = area(),
    session = area();
  const chrome = {
    storage: { local, session },
    runtime: {
      getURL: (p: string) => "chrome-extension://" + "a".repeat(32) + "/" + p,
      onMessage: { addListener: (f: any) => (listener = f) },
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    tabs: {
      async update() {},
      async create(tab: any) {
        tabs.push(tab);
      },
    },
  };
  runInNewContext(readFileSync("extension/horse-power/background.js", "utf8"), {
    chrome,
    URL,
    Date,
    crypto: { randomUUID },
    AbortSignal,
    fetch: async (url: string, opts: any) => {
      calls.push({ url, ...opts });
      if (fail) throw new Error("offline");
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  const send = (msg: any, sender: any) =>
    new Promise<any>((resolve) => listener(msg, sender, resolve));
  return {
    send,
    local,
    session,
    calls,
    tabs,
    setFail: (v: boolean) => (fail = v),
  };
}
const app = {
  url: "https://sistema-oficinas-homologacao.vercel.app/ordens/o/editar",
  frameId: 0,
  tab: { id: 1 },
};
const sky = {
  url: "https://cliente.skypecas.com.br/catalogo",
  frameId: 0,
  tab: { id: 2 },
};
const popup = { url: "chrome-extension://" + "a".repeat(32) + "/popup.html" };
const retiredSite = { url: "https://sistema.tempar.io/time-search", frameId: 0, tab: { id: 3 } };
const connect = {
  type: "HP_CONNECT",
  target: {
    token: "a".repeat(64),
    number: 123,
    orderId: "o",
    plate: "ABC1D23",
    freight_total: 1750,
    batch_id: "11111111-1111-4111-8111-111111111111",
  },
};
const horsePower = {
  url: "https://oficinahorsepower.com.br/ordens/o/editar",
  frameId: 0,
  tab: { id: 4 },
};

test("commercial extension injects the bridge and can fetch from both app domains", () => {
  const manifest = JSON.parse(readFileSync("extension/horse-power/manifest.json", "utf8"));
  const appHosts = [
    "https://sistema-oficinas-homologacao.vercel.app/*",
    "https://oficinahorsepower.com.br/*",
  ];
  for (const host of appHosts) {
    assert.ok(manifest.host_permissions.includes(host));
    assert.ok(manifest.content_scripts.some((script: any) =>
      script.matches.includes(host) && script.js.includes("bridge.js")));
  }
  assert.ok(manifest.content_scripts.some((script: any) =>
    script.matches.includes("https://cliente.skypecas.com.br/*") &&
    script.js.includes("sky.js")));
  assert.equal(JSON.stringify(manifest).includes("tempar"), false);
});

test("oficinahorsepower.com.br pairs with Sky, sends to its own origin and rejects lookalike sites", async () => {
  const w = worker();
  assert.equal((await w.send({ type: "HP_OPEN" }, popup)).ok, true);
  assert.equal(w.tabs[0].url, "https://oficinahorsepower.com.br/ordens");
  assert.equal((await w.send(connect, horsePower)).ok, true);
  assert.equal((await w.send({ type: "HP_STATUS" }, horsePower)).connected, true);
  assert.equal((await w.send(connect, {
    ...horsePower, url: "https://oficinahorsepower.com.br.evil.example/ordens/o/editar",
  })).ok, false);
  const captureId = randomUUID();
  assert.equal((await w.send({
    type: "HP_CAPTURE", item: { capture_id: captureId, name: "Peça" },
  }, sky)).ok, true);
  assert.equal(w.calls[0].url, "https://oficinahorsepower.com.br/api/extension/import");
  assert.equal(JSON.parse(w.calls[0].body).capture_id, captureId);
  assert.equal(w.local.data.pending.length, 0);
});

test("switching trusted app aliases requires the same destination and no pending capture", async () => {
  const w = worker();
  assert.equal((await w.send(connect, app)).ok, true);
  assert.equal((await w.send({ type: "HP_STATUS" }, horsePower)).connected, false);
  assert.equal((await w.send({ type: "HP_STATUS" }, horsePower)).orderId, undefined);
  assert.equal((await w.send({ type: "HP_SET_FREIGHT", freight_total: 2000 }, horsePower)).ok, false);
  assert.equal((await w.send({
    ...connect, target: { ...connect.target, orderId: "other" },
  }, horsePower)).ok, false);
  w.setFail(true);
  const captureId = randomUUID();
  assert.equal((await w.send({
    type: "HP_CAPTURE", item: { capture_id: captureId, name: "Peça" },
  }, sky)).ok, false);
  assert.equal(w.local.data.pending.length, 1);
  const denied = await w.send(connect, horsePower);
  assert.equal(denied.ok, false);
  assert.match(denied.error, /itens pendentes/);
  assert.equal(w.session.data.target.origin, new URL(app.url).origin);
  assert.equal(w.local.data.pending[0].item.capture_id, captureId);
  w.setFail(false);
  assert.equal((await w.send({ type: "HP_RETRY" }, popup)).ok, true);
  assert.equal((await w.send(connect, horsePower)).ok, true);
  assert.equal(w.session.data.target.origin, "https://oficinahorsepower.com.br");
  assert.equal((await w.send({ type: "HP_STATUS" }, app)).connected, false);
  assert.equal((await w.send({ type: "HP_STATUS" }, horsePower)).connected, true);
  assert.equal((await w.send({
    type: "HP_CAPTURE", item: { capture_id: randomUUID(), name: "Outra peça" },
  }, sky)).ok, true);
  assert.equal(w.calls.at(-1).url, "https://oficinahorsepower.com.br/api/extension/import");
});

test("Sky and popup receive safe plate context while removed origins are rejected", async () => {
  const w = worker();
  await w.send(connect, app);
  const vehicle = await w.send({ type: "HP_VEHICLE" }, sky);
  assert.equal(vehicle.plate, "ABC1D23");
  assert.equal(vehicle.number, 123);
  assert.equal(vehicle.connected, true);
  assert.ok(vehicle.connectionId);
  assert.ok(vehicle.expires > Date.now());
  assert.equal(vehicle.token, undefined);
  assert.equal(vehicle.origin, undefined);
  assert.equal((await w.send({ type: "HP_STATUS" }, sky)).plate, undefined);
  for (const sender of [app, { ...sky, frameId: 1 }, retiredSite])
    assert.equal((await w.send({ type: "HP_VEHICLE" }, sender)).ok, false);
  assert.equal((await w.send({ type: "HP_VEHICLE" }, popup)).plate, "ABC1D23");
  assert.equal(w.local.data.plate, undefined);
  w.session.data.target.expires = Date.now() - 1;
  const expired = await w.send({ type: "HP_VEHICLE" }, sky);
  assert.equal(expired.connected, false);
  assert.equal(expired.plate, undefined);
  assert.equal((await w.send({ type: "HP_STATUS" }, retiredSite)).ok, false);
});
test("Sky can change purchase freight during an active connection", async () => {
  const w = worker();
  await w.send(connect, app);
  assert.equal((await w.send({ type: "HP_STATUS" }, sky)).freightTotal, 1750);
  const changed = await w.send(
    { type: "HP_SET_FREIGHT", freight_total: 2500 },
    sky,
  );
  assert.equal(changed.ok, true);
  assert.equal(changed.freight_total, 2500);
  assert.equal((await w.send({ type: "HP_STATUS" }, sky)).freightTotal, 2500);
  const call = w.calls.find((x) => x.url.endsWith("/api/extension/freight"));
  assert.ok(call);
  assert.equal(JSON.parse(call.body).freight_total, 2500);
  assert.equal(call.credentials, "omit");
  assert.equal(changed.token, undefined);
  assert.equal(changed.origin, undefined);
});

test("reconnection updates the plate and keeps the removed supplier unauthorized", async () => {
  const w = worker();
  await w.send(connect, app);
  const old = await w.send({ type: "HP_VEHICLE" }, sky);
  await w.send({ ...connect, target: { ...connect.target, plate: "DEF2345" } }, app);
  const current = await w.send({ type: "HP_VEHICLE" }, sky);
  assert.equal(current.plate, "DEF2345");
  assert.notEqual(current.connectionId, old.connectionId);
  assert.equal((await w.send({ type: "HP_STATUS" }, retiredSite)).ok, false);
  await w.send({ type: "HP_DISCONNECT", orderId: "o" }, app);
  assert.equal((await w.send({ type: "HP_VEHICLE" }, sky)).plate, undefined);
  await w.send({ ...connect, target: { ...connect.target, plate: "SEM PLACA" } }, app);
  assert.equal((await w.send({ type: "HP_VEHICLE" }, sky)).plate, "");
});
test("worker only accepts app pairing, keeps token away from status, and sends captures to authenticated destination", async () => {
  const w = worker();
  assert.equal((await w.send(connect, sky)).ok, false);
  assert.equal((await w.send(connect, app)).ok, true);
  const status = await w.send({ type: "HP_STATUS" }, sky);
  assert.equal(status.number, 123);
  assert.equal(status.token, undefined);
  await w.send(
    {
      type: "HP_CAPTURE",
      item: { capture_id: randomUUID(), source: "tampered", name: "Peça" },
    },
    sky,
  );
  assert.equal(JSON.parse(w.calls[0].body).source, "sky");
  assert.equal(w.calls[0].credentials, "omit");
  assert.equal(
    w.calls[0].url,
    "https://sistema-oficinas-homologacao.vercel.app/api/extension/import",
  );
  assert.equal(w.local.data.pending.length, 0);
  assert.equal(w.local.data.token, undefined);
  assert.equal(
    (
      await w.send(
        { type: "HP_CAPTURE", item: {} },
        { ...sky, url: "https://evil.example" },
      )
    ).ok,
    false,
  );
});
test("worker preserves pending IDs for retry, refuses changing active target and never sends old items to another quote", async () => {
  const w = worker();
  await w.send(connect, app);
  w.setFail(true);
  const capture_id = randomUUID();
  assert.equal(
    (
      await w.send(
        { type: "HP_CAPTURE", item: { capture_id, name: "Peça" } },
        sky,
      )
    ).ok,
    false,
  );
  assert.equal(w.local.data.pending[0].item.capture_id, capture_id);
  assert.equal(
    (
      await w.send(
        { ...connect, target: { ...connect.target, orderId: "other" } },
        app,
      )
    ).ok,
    false,
  );
  await w.send({ type: "HP_DISCONNECT", orderId: "o" }, app);
  await w.send(
    { ...connect, target: { ...connect.target, orderId: "other" } },
    app,
  );
  w.setFail(false);
  assert.equal((await w.send({ type: "HP_RETRY" }, popup)).ok, false);
  await w.send({ type: "HP_DISCONNECT", orderId: "other" }, app);
  await w.send(connect, app);
  assert.equal((await w.send({ type: "HP_RETRY" }, popup)).ok, true);
  assert.equal(w.local.data.pending.length, 0);
  assert.equal(JSON.parse(w.calls[1].body).capture_id, capture_id);
});
test("Sky parser rejects ambiguous fallback prices instead of guessing the larger value", () => {
  const src = readFileSync("extension/horse-power/sky.js", "utf8");
  const scope: any = {
    crypto: { randomUUID },
    location: { href: "https://cliente.skypecas.com.br/" },
  };
  const helpers = src.slice(
    src.search(/const norm\s*=/),
    src.indexOf("function getProductContainers"),
  );
  const parser = src.slice(
    src.indexOf("function extractProduct"),
    src.indexOf("async function addItem"),
  );
  runInNewContext(
    helpers + parser + ";this.parseProduct=extractProduct;",
    scope,
  );
  const raw = "Cód. Fáb: ABC123\nCorreia dentada\nMarca X\nEstoque: 5\n";
  assert.equal(
    scope.parseProduct({ innerText: raw + "R$ 10,00\nR$ 20,00" }).unitCost,
    0,
  );
  assert.equal(
    scope.parseProduct({ innerText: raw + "R$ 10,00 /UN\nR$ 20,00" }).unitCost,
    10,
  );
  assert.equal(
    scope.parseProduct({
      innerText: raw + "R$ 107,44/JG.\nR$ 91,85 + 15,59(Impostos)",
    }).unitCost,
    107.44,
  );
  assert.equal(
    scope.parseProduct({
      innerText: raw + "R$ 89,90/PC\nR$ 80,00 + 9,90(Impostos)",
    }).unitCost,
    89.9,
  );
});

test("catalog destinations advertise capability and cannot receive pending order captures", async () => {
  const w = worker();
  await w.send(connect, app);
  w.setFail(true);
  await w.send(
    { type: "HP_CAPTURE", item: { capture_id: randomUUID(), name: "Peça" } },
    sky,
  );
  await w.send({ type: "HP_DISCONNECT", orderId: "o" }, app);
  assert.equal(
    (
      await w.send(
        {
          ...connect,
          target: {
            ...connect.target,
            destination: "catalog",
            label: "Catálogo",
            plate: "",
            number: 0,
          },
        },
        app,
      )
    ).ok,
    true,
  );
  const status = await w.send({ type: "HP_STATUS" }, popup);
  assert.equal(status.catalogCapture, true);
  assert.equal(status.label, "Catálogo");
  assert.equal(status.token, undefined);
  w.setFail(false);
  const count = w.calls.length;
  assert.equal((await w.send({ type: "HP_RETRY" }, popup)).ok, false);
  assert.equal(w.calls.length, count);
});

test("discard pending revokes the original target, disconnects and permits another quote", async () => {
  const w = worker();
  await w.send(connect, app);
  w.setFail(true);
  await w.send({ type: "HP_CAPTURE", item: { capture_id: randomUUID(), name: "Peça" } }, sky);
  assert.equal((await w.send({ type: "HP_CLEAR_PENDING" }, sky)).ok, false);
  assert.equal((await w.send({ type: "HP_CLEAR_PENDING" }, popup)).ok, false);
  assert.equal(w.local.data.pending.length, 1);
  w.setFail(false);
  assert.equal((await w.send({ type: "HP_CLEAR_PENDING" }, popup)).ok, true);
  assert.ok(w.calls.at(-1).url.endsWith("/api/extension/discard"));
  assert.equal(w.calls.at(-1).headers.Authorization, "Bearer " + connect.target.token);
  assert.equal(w.local.data.pending.length, 0);
  assert.equal(w.session.data.target, undefined);
  for (const sender of [sky, popup]) {
    assert.equal((await w.send({ type: "HP_STATUS" }, sender)).connected, false);
    assert.equal((await w.send({ type: "HP_VEHICLE" }, sender)).connected, false);
  }
  assert.equal((await w.send({ type: "HP_STATUS" }, retiredSite)).ok, false);
  assert.equal((await w.send({ ...connect, target: { ...connect.target, orderId: "next" } }, app)).ok, true);
});

test("minimizing and restoring panels preserves content and sends no connection messages", () => {
  const buttons: any[] = [];
  const window: any = {};
  runInNewContext(readFileSync("extension/horse-power/transport.js", "utf8"), {
    window, chrome: {}, document: { createElement: () => { const b = { setAttribute() {} }; buttons.push(b); return b; } },
  });
  for (const source of ["sky"]) {
    let minimized = false;
    const children: any[] = [{ freight: 1750, plate: "ABC1D23" }];
    const panel = { classList: { add: () => { minimized = true; }, contains: () => minimized, toggle: () => { minimized = !minimized; } }, appendChild: (b: any) => children.push(b) };
    window.hpMinimizePanel(panel);
    const b = buttons.at(-1);
    assert.equal(minimized, true);
    assert.match(b.innerHTML, /<svg/);
    assert.equal(b.title, "Restaurar painel Horse Power");
    b.onclick();
    assert.equal(minimized, false);
    assert.equal(b.title, "Minimizar painel Horse Power");
    b.onclick();
    assert.equal(minimized, true);
    assert.equal(children[0].freight, 1750);
    assert.equal(children[0].plate, "ABC1D23");
    assert.ok(readFileSync(`extension/horse-power/${source}.js`, "utf8").includes("window.hpMinimizePanel(d)"));
  }
});

test("Sky captures explicit application and only an unambiguous selected department", () => {
 const source=readFileSync("extension/horse-power/sky.js","utf8");
 const scope:any={crypto:{randomUUID},location:{href:"https://cliente.skypecas.com.br/"},document:{querySelectorAll:()=>[{options:[{textContent:"Departamentos"},{textContent:"FILTRO"}],selectedIndex:1,multiple:false}]}};
 const helpers=source.slice(source.search(/const norm\s*=/),source.indexOf("function getProductContainers"));
 const parser=source.slice(source.indexOf("function extractProduct"),source.indexOf("async function addItem"));
 runInNewContext(helpers+parser+";this.parseProduct=extractProduct;",scope);
 const raw="Cód. Fáb: OC506\nFiltro de óleo\nMahle\nAplicação: Cobalt 1.8 2013 a 2016\nEstoque: 5\nR$ 30,00/UN";
 const item=scope.parseProduct({innerText:raw});
 assert.equal(item.brand,"Mahle");assert.equal(item.code,"OC506");
 assert.equal(item.department,"FILTRO");assert.equal(item.application,"Cobalt 1.8 2013 a 2016");
 scope.document.querySelectorAll=()=>[
 {options:[{textContent:"Departamentos"},{textContent:"FILTRO"}],selectedIndex:1},
 {options:[{textContent:"Departamentos"},{textContent:"MOTOR"}],selectedIndex:1},
 ];
 assert.equal(scope.parseProduct({innerText:raw}).department,"");
 assert.equal(scope.parseProduct({innerText:raw.replace("Aplicação: Cobalt 1.8 2013 a 2016","")}).application,"");
});

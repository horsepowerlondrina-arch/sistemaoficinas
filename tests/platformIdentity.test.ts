import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkshopBrand } from "../src/components/WorkshopBrand";
import { PlatformBrand } from "../src/components/PlatformBrand";
import { Login } from "../src/pages/Login";
import { PLATFORM, platformTitle } from "../shared/platformIdentity";
import { workshopLogo } from "./fixtures/workshopLogo";
test("software compartilhado não adota a identidade de uma oficina ou um nome definitivo",()=>{
  const html=renderToStaticMarkup(createElement(Login,{onLogin:async()=>{}}));
  assert.ok(html.includes(PLATFORM.name));assert.ok(html.includes(PLATFORM.icon));
  for(const text of ["Horse Power","Boxmotor","Londrina","horse-power.jpg","login-logo.jpg"])assert.ok(!html.includes(text));
  const compact=renderToStaticMarkup(createElement(PlatformBrand,{compact:true}));
  assert.ok(compact.includes("platform-brand--compact"));
  assert.equal(platformTitle(),"Sistema Oficinas");
  assert.equal(platformTitle("Oficina A"),"Oficina A · Sistema Oficinas");
});
test("barra lateral usa exclusivamente a logo e o nome da oficina informada",()=>{
  const a={name:"Oficina A",document_logo:workshopLogo(20,110,130)};
  const b={name:"Oficina B",document_logo:workshopLogo(100,60,160)};
  for(const [current,other]of [[a,b],[b,a]]){
    const html=renderToStaticMarkup(createElement(WorkshopBrand,{shop:current}));
    assert.ok(html.includes(current.name));assert.ok(html.includes(current.document_logo));
    assert.ok(!html.includes(other.name));assert.ok(!html.includes(other.document_logo));
    assert.ok(!html.includes("Horse Power"));
  }
});
test("oficina sem logo recebe monograma neutro e nome, inclusive nomes longos e caracteres especiais",()=>{
  const html=renderToStaticMarkup(createElement(WorkshopBrand,{shop:{name:"Oficina & Serviços Independentes",document_logo:""}}));
  assert.ok(html.includes("Oficina &amp; Serviços Independentes"));assert.ok(html.includes("workshop-brand-monogram"));
  assert.ok(!html.includes("<img"));assert.ok(!html.includes("/brand/icon.jpg"));
  assert.ok(!html.includes("Horse Power"));
});

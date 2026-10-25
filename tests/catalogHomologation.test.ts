import assert from "node:assert/strict";
import test from "node:test";
import { catalogHomologationProjectId } from "../server/catalogHomologation.js";

const environment={VERCEL:"1",VERCEL_ENV:"production",VERCEL_PROJECT_ID:"prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc"};
const host="sistema-oficinas-homologacao.vercel.app";

test("temporary catalog access is bound to the verified homologation deployment",()=>{
  assert.equal(catalogHomologationProjectId(host,environment),environment.VERCEL_PROJECT_ID);
  assert.equal(catalogHomologationProjectId("localhost",environment),null);
  assert.equal(catalogHomologationProjectId(host,{...environment,VERCEL_ENV:"preview"}),null);
  assert.equal(catalogHomologationProjectId(host,{...environment,VERCEL_PROJECT_ID:"prj_production"}),null);
  assert.equal(catalogHomologationProjectId(host,{...environment,VERCEL:undefined}),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationFailureRecorder, observeIntegration } from '../server/services/integrationMonitoring.js';
import type { Pool } from 'pg';
test('integration failures preserve errors and never persist payloads or credentials',async()=>{
 const calls:unknown[][]=[];
 const query=(async(...args:unknown[])=>{calls.push(args);return {rows:[]};}) as Pool['query'];
 const record=integrationFailureRecorder({query});
 for(const provider of ['stripe','fipeplaca','resend'] as const){
  const failure=new Error('private_token_and_personal_payload');
  await assert.rejects(observeIntegration(provider,record,async()=>{throw failure;}),e=>e===failure);
 }
 assert.equal(calls.length,3);
 assert.equal(JSON.stringify(calls).includes('private_token'),false);
 assert.match(JSON.stringify(calls),/integration.stripe.failure/);
 assert.equal(await observeIntegration('stripe',record,async()=>42),42);
 assert.equal(calls.length,3);
});
test('monitoring outage cannot replace provider error or trigger a retry',async()=>{
 const error=new Error('provider failed');let attempts=0;
 await assert.rejects(observeIntegration('stripe',async()=>{throw Error('database offline');},async()=>{attempts++;throw error;}),e=>e===error);
 assert.equal(attempts,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from '../server/db/database';
import {createApp} from '../server/app';
import {digest} from '../server/auth/session';
import {saveOrder,transitionOrder} from '../server/services/workshop';
test('vehicle owner changes preserve past customers and receipts, retain ongoing OS editing and restrict new OS to the current owner',async()=>{
 const db=createDatabase(':memory:');
 db.exec("INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Admin','owner@test.invalid','disabled'); INSERT INTO memberships VALUES('u','a','owner'); INSERT INTO customers(id,tenant_id,name) VALUES('old','a','Anterior'),('new','a','Atual'),('foreign','b','Outro'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','old','ABC1D23','Fiat','Uno',2020); INSERT INTO orders(id,tenant_id,number,status,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES('done','a',1,'completed','old','v','2026-10-14','2026-10-14',0,10000); INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on,status) VALUES('r','a','done','old','OS #1',10000,'2026-10-14','paid')");
 const ctx={tenantId:'a',userId:'u',role:'owner'};
 const input={status:'quote',customer_id:'old',vehicle_id:'v',guest_name:'',guest_plate:'',guest_vehicle:'',entered_on:'2026-10-14',due_on:'2026-10-14',km:0,problem:'',notes:'',discount:0,items:[]};
 const draft=await saveOrder(db,ctx,input);
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest('owner'),'u','a',Date.now()+60000);
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/vehicles/v`;
 const change=(customer_id:string)=>fetch(url,{method:'PUT',headers:{Cookie:'hp_session=owner','Content-Type':'application/json'},body:JSON.stringify({customer_id,plate:'ABC1D23',brand:'Fiat',model:'Uno',year:2020,km:0})});
 try{
  const invalid=await change('foreign');assert.equal(invalid.status,404);await invalid.text();
  assert.equal(db.prepare('SELECT customer_id FROM vehicles').get()!.customer_id,'old');
  const response=await change('new');assert.equal(response.status,200);await response.text();
  assert.equal(db.prepare('SELECT customer_id FROM vehicles').get()!.customer_id,'new');
  assert.equal(db.prepare("SELECT customer_id FROM orders WHERE id='done'").get()!.customer_id,'old');
  assert.equal(db.prepare('SELECT customer_id FROM receivables').get()!.customer_id,'old');
  await saveOrder(db,ctx,{...input,notes:'Segue com o cliente original'},draft);
  await transitionOrder(db,ctx,draft,'open','2026-10-14');await transitionOrder(db,ctx,draft,'working');
  await assert.rejects(saveOrder(db,ctx,input),/não pertence/);
  const fresh=await saveOrder(db,ctx,{...input,customer_id:'new'});
  assert.equal(db.prepare('SELECT customer_id FROM orders WHERE id=?').get(fresh)!.customer_id,'new');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='vehicles.owner_changed:old:new'").get()!.n,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}
});

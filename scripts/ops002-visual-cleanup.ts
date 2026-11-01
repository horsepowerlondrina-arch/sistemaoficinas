import {adminClient} from './local-admin.js';
const ids=JSON.parse(process.argv[2]||'[]') as string[];
const products=JSON.parse(process.argv[3]||'[]') as string[];
if(!Array.isArray(products)||products.some(id=>!/^[0-9a-f-]{36}$/.test(id)))throw new Error('Identificadores de produto inválidos.');
if(!Array.isArray(ids)||ids.some(id=>!/^[0-9a-f-]{36}$/.test(id)))throw new Error('Identificadores de fixture inválidos.');
const db=adminClient();await db.connect();try{await db.query('BEGIN');for(const id of ids){
 const order=(await db.query("SELECT tenant_id,problem FROM horse_power.orders WHERE id=$1",[id])).rows[0];
 if(!order)continue;if(order.tenant_id!=='local-a'||order.problem!=='OPS-002 fictício')throw new Error('Limpeza recusada fora da fixture OPS-002.');
 const paid=await db.query("SELECT 1 FROM horse_power.payment_installments p JOIN horse_power.receivables r ON r.id=p.receivable_id WHERE r.order_id=$1 AND p.status='paid'",[id]);if(paid.rowCount)throw new Error('Fixture recebida não pode ser removida.');
 // Reverse only this isolated fixture's stock movements before removing its rows.
 await db.query("UPDATE horse_power.catalog c SET stock=stock-COALESCE((SELECT SUM(quantity) FROM horse_power.stock_movements m WHERE m.catalog_id=c.id AND m.order_id=$1),0) WHERE c.tenant_id='local-a'",[id]);
 await db.query("DELETE FROM horse_power.payment_installments WHERE receivable_id IN(SELECT id FROM horse_power.receivables WHERE order_id=$1)",[id]);
 for(const table of ['stock_movements','order_items','receivables'])await db.query(`DELETE FROM horse_power.${table} WHERE tenant_id='local-a' AND order_id=$1`,[id]);
 await db.query("DELETE FROM horse_power.audit_events WHERE tenant_id='local-a' AND entity_id=$1",[id]);
 await db.query("DELETE FROM horse_power.orders WHERE tenant_id='local-a' AND id=$1",[id]);
}for(const id of products){
 await db.query("DELETE FROM horse_power.catalog WHERE id=$1 AND tenant_id='local-a' AND sku='OPS002-VISUAL'",[id]);
 await db.query("DELETE FROM horse_power.audit_events WHERE tenant_id='local-a' AND entity_id=$1",[id]);
}await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}

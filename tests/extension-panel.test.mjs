import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('Sky panel starts minimized and restores without touching connection or form state', () => {
  let messages = 0;
  const window = {};
  runInNewContext(readFileSync('extension/horse-power/transport.js','utf8'), {
    window, chrome: {runtime:{sendMessage(){messages++;}}},
    document:{createElement(){return {attributes:{},setAttribute(k,v){this.attributes[k]=v;}};}}
  });
  for (const site of ['sky']) {
    assert.match(readFileSync(`extension/horse-power/${site}.js`,'utf8'), /hpMinimizePanel\(d\)/);
    const classes = new Set();
    const panel = {connection:{orderId:'os-123'},freight:17.5,children:[],classList:{add(v){classes.add(v);},contains(v){return classes.has(v);},toggle(v){classes.has(v)?classes.delete(v):classes.add(v);}},appendChild(v){this.children.push(v);}};
    const connection = panel.connection;
    window.hpMinimizePanel(panel);
    const button = panel.children[0];
    assert.equal(classes.has('hp-minimized'),true);
    assert.equal(button.attributes['aria-expanded'],'false');
    assert.match(button.innerHTML, /<svg/);
    assert.equal(button.attributes['aria-label'],'Restaurar painel Horse Power');
    button.onclick();
    assert.equal(classes.has('hp-minimized'),false);
    assert.equal(button.attributes['aria-expanded'],'true');
    assert.equal(button.attributes['aria-label'],'Minimizar painel Horse Power');
    button.onclick();
    assert.equal(classes.has('hp-minimized'),true);
    assert.equal(panel.connection,connection);
    assert.equal(panel.freight,17.5);
  }
  assert.equal(messages,0);
});

// Offline lifecycle/evidence tests for the shared archive controller's idle path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPostMatchTable } from '../public/js/post-match-table.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url)));
const archive = () => structuredClone(fixture.archive);
const now = Date.parse(fixture.archive.generated_at) + 300000;
const flush = () => new Promise(resolve => setImmediate(resolve));
const slot = (key = 'idle:0:1', elapsed = 4.3) => ({ key, elapsed });
const input = (changes = {}) => ({ slot: slot(), warm: true, nowMs: now, ...changes });

test('idle warms the same archive without mounting or inventing a match, then shows the remaining slot', async () => {
  const calls = [];
  const c = createPostMatchTable({fetcher:async (...args) => { calls.push(args); return {ok:true,json:async()=>archive()}; }});
  try {
    assert.equal(c.updateIdle(input()), null);
    assert.equal(c.state().status, 'waiting-for-table');
    await flush();
    const shown = c.updateIdle(input({slot:slot('idle:0:1',42)}));
    assert.equal(shown.elapsed,42);
    assert.equal(shown.presentation.mode,'idle');
    assert.equal(shown.presentation.basis,'published-standings');
    assert.equal(shown.presentation.matchId,undefined);
    assert.equal(shown.presentation.home,undefined);
    assert.equal(c.state().matchId,null);
    assert.deepEqual(c.state().movements,[]);
    assert.equal(calls.length,1);
    assert.equal(calls[0][1].credentials,'omit');
    assert.equal(calls[0][1].cache,'no-cache');
    for (let i=0;i<500;i++) c.updateIdle(input());
    assert.equal(calls.length,1,'no per-frame downloads');
    assert.equal(c.updateIdle(input({slot:null})),null);
    assert.equal(c.state().visible,false);
    assert.equal(c.updateIdle(input({slot:slot('idle:0:1',54)})),null);
  } finally { c.dispose(); }
});

test('snapshot stays frozen on air; the next slot reassesses fresh archive data', async () => {
  let doc = archive(), calls = 0;
  const c = createPostMatchTable({fetcher:async()=>{calls++;return {ok:true,json:async()=>structuredClone(doc)};}});
  try {
    c.updateIdle(input()); await flush();
    const first = c.updateIdle(input());
    doc.generated_at = new Date(now + 60000).toISOString();
    c.updateIdle(input({nowMs:now+61000})); await flush();
    const held = c.updateIdle(input({nowMs:now+62000,slot:slot('idle:0:1',50)}));
    assert.equal(held.presentation,first.presentation);
    assert.equal(held.presentation.generatedAt,fixture.archive.generated_at);
    const next = c.updateIdle(input({nowMs:now+63000,slot:slot('idle:0:2',5)}));
    assert.equal(next.presentation.generatedAt,doc.generated_at);
    assert.notEqual(next.presentation,first.presentation);
    assert.equal(calls,2);
  } finally { c.dispose(); }
});

test('unavailable, stale and unreconciled evidence never produce a graphic; fetches are bounded', async () => {
  for (const kind of ['network','stale','mismatch']) {
    let count = 0;
    const c = createPostMatchTable({fetcher:async()=>{
      count++;
      if(kind==='network') throw Error('offline');
      const doc=archive();
      if(kind==='stale') doc.generated_at=new Date(now-21600001).toISOString();
      if(kind==='mismatch') doc.seasons[0].table[0].Pts++;
      return {ok:true,json:async()=>doc};
    }});
    try {
      c.updateIdle(input()); await flush();
      assert.equal(c.updateIdle(input()),null,kind);
      assert.equal(c.state().status,'waiting-for-table');
      assert.ok(c.state().reason);
      for(let i=0;i<100;i++) c.updateIdle(input({nowMs:now+59999}));
      assert.equal(count,1);
      c.updateIdle(input({nowMs:now+60000})); await flush(); assert.equal(count,2);
    } finally {c.dispose();}
  }
});

test('idle and post-match share one fetch and maintain independent snapshot/timer state', async () => {
  let count=0;
  const c=createPostMatchTable({fetcher:async()=>{count++;return {ok:true,json:async()=>archive()};}});
  const final=fixture.hud.score.at(-1), item=fixture.programme.item;
  const m={phase:'match',source:'schedule',loops:0,
    match:{id:item.bundleId,bundleUrl:item.bundleUrl,startsAt:item.startsAt,state:'live'},
    bug:{home:item.home,away:item.away,a:final.a,b:final.b,t:622,over:true,inPlay:false,preroll:false,replay:false},
    ball:{speed:0,measured:true},clockPlan:fixture.hud.clock};
  const at=Date.parse(fixture.programme.now);
  try {
    c.updateIdle(input({nowMs:at}));await flush();
    assert.ok(c.updateIdle(input({nowMs:at})));
    assert.equal(c.update({match:m,camera:'heli',time:0,nowMs:at}),null);
    const post=c.update({match:m,camera:'heli',time:.7,nowMs:at});
    assert.equal(post.presentation.basis,'first-air-hud');
    assert.deepEqual(post.presentation.score,[3,6]);
    assert.equal(post.elapsed,0);
    assert.equal(count,1,'one cache for both modes');
    c.update({match:null,time:0,nowMs:at});
    const idleAgain=c.updateIdle(input({nowMs:at,slot:slot('idle:0:1',40)}));
    assert.equal(idleAgain.presentation.basis,'published-standings');
    assert.equal(idleAgain.elapsed,40);
    assert.equal(idleAgain.presentation.rows.find(r=>r.code==='SGU').points,10,'idle never fabricates unpublished HUD result');
  } finally {c.dispose();}
});

test('disposal aborts pending idle refresh; late resolution cannot revive output', async () => {
  let deliver,signal;
  const c=createPostMatchTable({fetcher:async(_url,init)=>{signal=init.signal;return new Promise(r=>deliver=r);}});
  c.updateIdle(input());
  assert.equal(signal.aborted,false);
  c.dispose();assert.equal(signal.aborted,true);
  deliver({ok:true,json:async()=>archive()});await flush();
  assert.equal(c.updateIdle(input()),null);
  assert.equal(c.state().status,'disposed');
});

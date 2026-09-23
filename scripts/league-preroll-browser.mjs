// Real saved M42, actual /venue and /broadcast, one frozen programme clock.
// Only browser-local feed/clock overrides; publisher SDK and bundle bytes stay real.
// PATH=/opt/homebrew/bin:$PATH node scripts/league-preroll-browser.mjs [--gpu]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';

const args = process.argv.slice(2);
assert.ok(args.every(a => a === '--gpu'), 'Only --gpu supported; isolated local server only.');
const out = resolve('qa-out/league-preroll/integration');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url)));
const { archive, programme: { item } } = fixture;
const start = Date.parse(item.startsAt);
const season = archive.seasons.find(s => s.season === archive.current_season);
assert.equal(season.matches.find(m => m.n === 42).status, 'scheduled');
const gpu = args.includes('--gpu'), sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { scope: 'Real M42 publisher bundle; real automatic production pages and programme. Empty browser-local programme/now feeds, original unmodified scheduled-M42 archive, frozen Date.now; rehearseLive mounts the saved scheduled item. No SDK/runtime modifications, public writes, full-match or benchmark.',
  command: `PATH=/opt/homebrew/bin:$PATH node scripts/league-preroll-browser.mjs${gpu ? ' --gpu' : ''}`, gpu, startedAt: new Date().toISOString(), item,
  samples: {visitor: [], broadcast: []}, comparisons: [], audits: {}, errors: [], failures: [], boots: [], clean: null };
mkdirSync(out, {recursive:true});
let chrome, server, route = 'setup', injectionId, currentBoot;
const save = () => writeFileSync(join(out, 'league-preroll-browser.json'), JSON.stringify(report, null, 2));
const check = (label, fn) => { try { fn(); } catch (e) { report.failures.push({label,message:e.message}); } };
const near = (a,b,label) => assert.ok(Number.isFinite(a) && Math.abs(a-b)<0.000001, `${label}: ${a} vs ${b}`);
// An outer tool can stop this at 480s. Save useful evidence before that bound;
// headless-chrome's exit hook also kills its entire browser process group.
const deadline = setTimeout(() => { report.passed=false; report.fatal={route,message:'450s harness deadline'}; save(); process.exit(1); },450000);
async function wait(expression,predicate,label,timeoutMs=60000) {
  let value; const end = Date.now()+timeoutMs;
  do { value=await chrome.evaluate(expression,{timeoutMs:30000}); if(predicate(value))return value; await sleep(100); } while(Date.now()<end);
  throw Error(`${route}: timeout ${label}: ${JSON.stringify(value)}`);
}
function injection(seconds) {
  return `(() => {
    let fixed=${start}+Math.round(${seconds}*1000);
    window.__prerollTime=seconds=>fixed=${start}+Math.round(seconds*1000);
    Date.now=()=>fixed;
    const audit=window.__prerollAudit={videos:0,mp4:[],bundles:[],writes:[],xhr:[],feeds:[],socketsSuppressed:[],requests:[]};
    const record=(url,type)=>{if(/\\.mp4(?:[?#]|$)/i.test(url))audit.mp4.push({url,type});if(/\\/bundles\\//i.test(url))audit.bundles.push({url,type});};
    new PerformanceObserver(list=>{for(const e of list.getEntries())record(e.name,e.initiatorType);}).observe({type:'resource',buffered:true});
    for(const method of ['createElement','createElementNS']) {
      const original=document[method].bind(document);
      document[method]=function(...a){if(String(a[method==='createElementNS'?1:0]).toLowerCase()==='video')audit.videos++;return original(...a);};
    }
    window.WebSocket=class extends EventTarget {
      static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
      constructor(url){super();this.readyState=3;audit.socketsSuppressed.push(String(url));}
      close(){} send(){audit.writes.push({method:'WebSocket.send'});throw Error('QA forbids writes');}
    };
    const forbidden=(url,method)=>{audit.writes.push({url:String(url),method});throw Error('QA forbids network mutations');};
    navigator.sendBeacon=url=>forbidden(url,'BEACON');
    XMLHttpRequest.prototype.open=function(method,url){audit.xhr.push({method,url:String(url)});throw Error('QA forbids XMLHttpRequest');};
    const original=window.fetch.bind(window);
    window.fetch=function(input,init) {
      const u=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
      const method=String(init?.method||input?.method||'GET').toUpperCase();
      if(!['GET','HEAD'].includes(method))return forbidden(u.href,method);
      record(u.href,'fetch');let data;
      if(u.origin===location.origin&&u.pathname==='/broadcast/now.json')data={bundle:null,audio:false,loop:false};
      if(u.pathname==='/api/v1/programme/rfl')data={schema:'4dgsx-programme/1',now:new Date(Date.now()).toISOString(),channel:{id:'rfl',timezone:'Europe/London',slots:['12:00','16:00','20:00']},items:[]};
      if(u.href==='https://raw.githubusercontent.com/robot-football-league/rfl-league-data/main/site.json')data=${JSON.stringify(archive)};
      if(data){audit.feeds.push(u.href);return Promise.resolve(new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}}));}
      const request={url:u.href,method,status:'pending'};audit.requests.push(request);
      return original(input,init).then(response=>{request.status=response.status;return response;},error=>{request.status='failed';request.error=String(error);throw error;});
    };
    // Observe the real Canvas2D renderer, including actual row positions and
    // highlight strips. Never substitute an overlay or alter draw arguments.
    const contexts=new Map(),p=CanvasRenderingContext2D.prototype;
    for(const method of ['fillText','fillRect','clearRect']) {
      const original=p[method];
      p[method]=function(...a){
        if(!contexts.has(this))contexts.set(this,{text:[],rects:[]});
        const log=contexts.get(this);
        if(method==='clearRect'){log.text=[];log.rects=[];}
        else if(method==='fillText')log.text.push({text:String(a[0]),x:a[1],y:a[2],fill:String(this.fillStyle),font:this.font,alpha:this.globalAlpha});
        else log.rects.push({x:a[0],y:a[1],w:a[2],h:a[3],fill:String(this.fillStyle),alpha:this.globalAlpha});
        return original.apply(this,a);
      };
    }
    window.__prerollPaint=()=>[...contexts.values()].filter(p=>p.text.some(t=>t.text==='LEAGUE TABLE'||t.text==='CURRENT STANDINGS'));
  })()`;
}
const stateExpression = visitor => visitor ? `(() => {
  const b=__venue.venues.get('stadium')?.broadcast, main=b?.state(),m=__venue.venues.module('stadium','match-4dgsx')?.state;
  return {now:Date.now(),programme:main?.programme,main,module:m,bug:m?.bug,serial:main?.frames,graphics:main?.graphics,
    retained:b===window.__prerollRetained&&b?.surface.texture===window.__prerollTexture,paint:__prerollPaint(),errors:__venue.errors};
})()` : `(() => {
  const s=rflBroadcast.state();return {now:Date.now(),programme:s.programme,main:s.feed,module:s.match,bug:s.scorebug,
    serial:s.renderSerial,diagnostics:s,paint:__prerollPaint(),errors:s.errors};
})()`;
const comparable=s=>({phase:s.programme.phase,priority:s.programme.priority,camera:s.programme.camera,clock:s.programme.clock,
  programmeT:s.programme.programmeT,phaseOrigin:s.programme.phaseOrigin,phaseElapsed:s.programme.phaseElapsed,
  table:s.programme.table,paint:s.paint,bug:{clock:s.bug.clock,t:s.bug.t,preroll:s.bug.preroll,inPlay:s.bug.inPlay,over:s.bug.over,a:s.bug.a,b:s.bug.b}});
// whenLoaded/module existence do not await activate()'s asynchronous SDK import.
// Observe the actual module, never retry rehearseLive or treat a failed SDK as ready.
const moduleExpression = visitor => visitor
  ? `window.__venue?.venues.module('stadium','match-4dgsx')?.state`
  : `window.rflBroadcast?.state().match`;
async function bootDiagnostic(visitor,stage) {
  const diagnostic={stage,at:new Date().toISOString()};
  try {
    Object.assign(diagnostic,await chrome.evaluate(`(() => {
      const module=${moduleExpression(visitor)};
      return {url:location.href,now:Date.now(),
        venue:${visitor ? 'window.__venue?.state()' : 'null'},
        venueStats:${visitor ? 'window.__venue?.stats()' : 'null'},
        module:module??null,sdk:module?.sdk??null,
        errors:${visitor ? 'window.__venue?.errors' : 'window.rflBroadcast?.state().errors'},
        requests:window.__prerollAudit?.requests??[],
        resources:performance.getEntriesByType('resource').map(r=>({url:r.name,type:r.initiatorType,duration:r.duration,responseStatus:r.responseStatus})),
        audit:window.__prerollAudit};
    })()`));
  } catch(e) { diagnostic.diagnosticError=e.message; }
  // Copy these now, so pre/post checkpoints remain independently interpretable.
  diagnostic.localRequests=currentBoot.requests.map(r=>({...r}));
  diagnostic.console=currentBoot.console.slice();
  currentBoot.diagnostics.push(diagnostic);save();
}
async function boot(visitor,seconds) {
  currentBoot={route,seconds,startedAt:new Date().toISOString(),requests:[],console:[],diagnostics:[]};
  report.boots.push(currentBoot);
  try { await bootPage(visitor,seconds); }
  catch(e) { await bootDiagnostic(visitor,'failure');throw e; }
}
async function bootPage(visitor,seconds) {
  if(injectionId)await chrome.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injectionId});
  injectionId=(await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:injection(seconds)})).identifier;
  await chrome.goto(`${report.origin}${visitor?'/venue.html?venue=stadium&tier=2&fast=1&street=0':'/broadcast.html'}`);
  await wait(visitor?'!!window.__venue && (__venue.renderer.setAnimationLoop(null), true)':'!!window.rflBroadcast',Boolean,'page API');
  if(visitor) {
    await bootDiagnostic(visitor,'api-ready-before-step');
    // whenLoaded() is false before the first update starts the near asset.
    // Drive the real fixture without advancing either simulation or wall time.
    await chrome.evaluate('__venue.step(1,0)');
    currentBoot.venueLoaded=await chrome.evaluate('__venue.whenLoaded()',{timeoutMs:120000});
    await bootDiagnostic(visitor,'after-venue-loaded');
    assert.equal(currentBoot.venueLoaded,true,`${route}: venue loaded`);
    // A loaded near asset still needs an update to enter Tier 2 / activate().
    await wait(`(__venue.step(1,0),!!__venue.venues.module('stadium','match-4dgsx'))`,Boolean,'match module');
    await chrome.evaluate(`__venue.setCam('screen_main');__venue.step(1,0);`);
  } else {
    await chrome.evaluate('window.__prerollReady=false;rflBroadcast.ready.then(()=>__prerollReady=true,e=>__prerollReady=String(e));true');
    let ready=false;const end=Date.now()+90000;
    for(let i=0;Date.now()<end&&!ready;i++){await sleep(250);ready=await chrome.evaluate(`__prerollTime(${seconds}+${i});__prerollReady`);if(typeof ready==='string')throw Error(ready);}
    assert.equal(ready,true,'broadcast ready');
    report.bootClock='Integer-second ticks only during empty-pitch networkQuiet; exact frozen time restored before real M42 mount and all captures.';
  }
  await chrome.evaluate(`__prerollTime(${seconds})`);
  await bootDiagnostic(visitor,'before-sdk-ready');
  await wait(moduleExpression(visitor),m=>{
    if(m?.sdk==='failed')throw Error(`${route}: match SDK failed: ${JSON.stringify(m.errors||m)}`);
    return m?.sdk==='ready';
  },'match SDK ready');
  await bootDiagnostic(visitor,'before-mount');
  const rehearsal=visitor?`__venue.venues.module('stadium','match-4dgsx').rehearseLive`:'rflBroadcast.rehearseLive';
  const mounted=await chrome.evaluate(`${rehearsal}(${JSON.stringify(item)})`,{timeoutMs:150000});
  currentBoot.mounted=mounted;
  await bootDiagnostic(visitor,'after-mount');
  assert.equal(mounted,true,`${route}: real asynchronous M42 mount`);
  if(visitor) {
    await wait(`(__venue.step(1,0),__venue.venues.get('stadium').broadcast?.state().ready)`,Boolean,'internal broadcast ready');
    await chrome.evaluate(`window.__prerollRetained=__venue.venues.get('stadium').broadcast;window.__prerollTexture=__prerollRetained.surface.texture;true`);
  }
  console.log(`${route}: real M42 mounted at ${seconds}s`);
}
const phases=[
  {name:'authored-before-aerial',seconds:21.999,camera:'screen_main'},
  {name:'first-aerial-start',seconds:22,camera:'heli'},
  {name:'first-pre-cue',seconds:22.699,camera:'heli'},
  {name:'first-cue-exact',seconds:22.7,camera:'heli',cue:22.7},
  {name:'first-read',seconds:28,camera:'heli',cue:22.7,screenshot:true},
  {name:'first-fade-half',seconds:46.4,camera:'heli',cue:22.7},
  {name:'first-last-ms',seconds:46.699,camera:'heli',cue:22.7},
  {name:'first-end-exact',seconds:46.7,camera:'stands',screenshot:true},
  {name:'quiet-gap',seconds:60,camera:'screen_main',screenshot:true},
  {name:'second-before-aerial',seconds:111.999,camera:'screen_main'},
  {name:'second-aerial-start',seconds:112,camera:'heli'},
  {name:'second-pre-cue',seconds:112.699,camera:'heli'},
  {name:'second-cue-exact',seconds:112.7,camera:'heli',cue:112.7},
  {name:'second-read',seconds:118,camera:'heli',cue:112.7,screenshot:true},
  {name:'second-late-read',seconds:135,camera:'heli',cue:112.7,screenshot:true},
  {name:'second-fade-start',seconds:136.1,camera:'heli',cue:112.7},
  {name:'second-fade-half',seconds:136.4,camera:'heli',cue:112.7},
  {name:'second-last-ms',seconds:136.699,camera:'heli',cue:112.7},
  {name:'second-end-exact',seconds:136.7,camera:'screen_main',screenshot:true},
  {name:'kickoff-live-suppression',seconds:180,camera:'gantry',play:true,screenshot:true},
];
report.phases=phases;
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
function checkPaint(s) {
  assert.equal(s.paint.length,1,'one real standings canvas');
  const p=s.paint[0],texts=p.text.map(t=>t.text);
  assert.ok(texts.includes('BEFORE THE MATCH'));
  // "Before M42" is the accounting boundary, not an invented caption:
  // assert every actual row/value against the saved still-scheduled ledger below.
  assert.ok(texts.includes('PRE-MATCH STANDINGS'),'explicit pre-match presentation');
  assert.ok(!texts.some(t=>/AFTER THE MATCH|\bFT\b|FULL.?TIME|PLACES? (GAINED|LOST)|NO CHANGE|Movement from|\d+\s+[-–]\s+\d+/.test(t)),'no result/position movement graphics');
  const rows=p.text.filter(t=>t.x===228&&t.y>=253&&t.y<590);
  assert.equal(rows.length,season.table.length,'all ten published clubs painted');
  for(const expected of season.table) {
    const r=rows.find(r=>r.text===expected.name);assert.ok(r,`club ${expected.name}`);
    near(r.y,253+(expected.pos-1)*(336/10)+(336/10-1)/2,`${expected.code} static published row position`);
    for(const [x,value]of [[113,expected.pos],[615,expected.P],[691,expected.GD>0?`+${expected.GD}`:expected.GD],[788,expected.Pts]]) {
      assert.ok(p.text.some(t=>t.x===x&&t.y===r.y&&t.text===String(value)),`${expected.code} column ${x}: ${value}`);
    }
  }
  const highlights=p.rects.filter(r=>r.x===84&&r.w===758&&r.fill==='#24364b');
  assert.equal(highlights.length,2,'only fixture clubs highlighted');
  for(const code of [item.home.code,item.away.code]) {
    const expected=season.table.find(r=>r.code===code);
    assert.ok(highlights.some(r=>Math.abs(r.y-(253+(expected.pos-1)*33.6))<0.000001),`${code} fixture highlight`);
  }
}
async function capture(visitor,phase) {
  await chrome.evaluate(`__prerollTime(${phase.seconds});${visitor?'__venue.step(1,0);':''}`);
  const expression=visitor?`(__venue.step(1,0),${stateExpression(true)})`:stateExpression(false);
  let s=await wait(expression,s=>s?.now===start+Math.round(phase.seconds*1000)&&s.programme&&Math.abs(s.programme.programmeT-phase.seconds)<0.000001,phase.name);
  // Wait only for archive readiness, not for a desired assertion to become true.
  if(phase.cue!=null&&!s.programme.table.visible) {
    s=await wait(expression,s=>!s.programme.table.dataLoading,`${phase.name} archive ready`,30000);
  }
  const serial=s.serial,copies=visitor?s.main.frames:s.main.copies;
  s=await wait(expression,s=>s.serial>serial,`${phase.name} new frozen frame`,30000);
  report.samples[route].push({name:phase.name,seconds:phase.seconds,framesAdvanced:s.serial-serial,mainFramesAdvanced:(visitor?s.main.frames:s.main.copies)-copies,state:s});
  check(`${route}/${phase.name}`,()=>{
    assert.equal(s.now,start+Math.round(phase.seconds*1000),'exact frozen wall clock');
    assert.equal(s.programme.phase,phase.play?'play':'preroll');assert.equal(s.programme.camera,phase.camera);
    assert.equal(s.programme.clock,'programme');near(s.programme.programmeT,phase.seconds,'programme seconds');
    assert.equal(s.main.attached,true);assert.equal(s.main.error,null);assert.ok((visitor?s.main.frames:s.main.copies)>copies,'new actual main copy');
    assert.deepEqual(s.errors,[]);assert.deepEqual(s.module.errors||[],[]);
    assert.equal(visitor?s.module.match.id:s.module.id,item.bundleId);assert.equal(s.module.source,'schedule');
    assert.equal(s.module.bodies?.ok,true,'actual verified publisher bodies');assert.equal(s.module.replayCam,true);
    assert.equal(s.bug.preroll,!phase.play);assert.equal(s.bug.inPlay,!!phase.play);assert.equal(s.bug.over,false);
    assert.deepEqual([s.bug.a,s.bug.b],[0,0],'never expose the future recorded M42 result');
    const docks=s.module.docks||[];assert.ok(!docks.some(d=>d.slot==='main'&&d.attached),'no main publisher media dock');
    for(const slot of ['left','right'])assert.equal(docks.some(d=>d.slot===slot&&d.attached),!!phase.play,`${slot} dock policy`);
    if(visitor){assert.equal(s.retained,true);assert.equal(s.module.reservedVideo,'filtered before allocation');}
    else {assert.equal(s.diagnostics.director.shot,phase.camera);assert.equal(s.diagnostics.live.deterministic,false,'automatic page, not deterministic capture');assert.equal(s.diagnostics.live.connected,false,'presence suppressed');assert.deepEqual(s.diagnostics.leagueTable,s.programme.table);}
    assert.equal(s.programme.table.visible,phase.cue!=null);
    if(phase.cue!=null) {
      const t=s.programme.table,elapsed=phase.seconds-phase.cue;
      assert.equal(t.mode,'preroll');assert.equal(t.basis,'scheduled-pre-match');assert.equal(t.duration,24);
      assert.equal(t.generatedAt,archive.generated_at);assert.equal(t.matchId,item.bundleId);assert.deepEqual(t.movements,[]);
      near(t.elapsed,elapsed,'absolute cue elapsed');
      checkPaint(s);
      if(visitor){
        assert.equal(s.graphics.mode,'preroll');assert.equal(s.graphics.matchId,item.bundleId);assert.equal(s.graphics.rowCount,10);
        near(s.graphics.elapsedSeconds,elapsed,'actual renderer elapsed');
        const alpha=smooth(elapsed/.55)*(1-smooth((elapsed-23.4)/.6));
        near(s.graphics.opacity,alpha,'exact 24s fade opacity');assert.equal(s.graphics.visible,alpha>0);
        assert.equal(s.graphics.phase,elapsed<.55?'entering':elapsed<23.4?'held':'leaving');
      }
    } else {assert.deepEqual(s.paint,[],'hidden/end/play clears actual table paint');if(visitor)assert.equal(s.graphics.visible,false);}
  });
  if(phase.screenshot) {
    writeFileSync(join(out,`${route}-${phase.name}.png`),await chrome.screenshot());
    if(visitor && phase.cue!=null) {
      // Optical close-up of the same real main screen, not a substituted
      // canvas. Only the spectator view changes; TV time/camera stay frozen.
      const zoom=await chrome.evaluate('__venue.camera.zoom');
      try {
        await chrome.evaluate('__venue.camera.zoom=3.1;__venue.camera.updateProjectionMatrix();__venue.step(1,0);');
        writeFileSync(join(out,`${route}-${phase.name}-main-closeup.png`),await chrome.screenshot());
      } finally { await chrome.evaluate(`__venue.camera.zoom=${zoom};__venue.camera.updateProjectionMatrix();__venue.step(1,0);`); }
    }
  }
  save();return s;
}
async function audit(label) {
  const a=await chrome.evaluate('({...__prerollAudit,domVideos:document.querySelectorAll("video").length})');report.audits[label]=a;
  check(`${label}/transport-and-media-audit`,()=>{
    assert.equal(a.videos,0);assert.equal(a.domVideos,0);assert.deepEqual(a.mp4,[]);assert.deepEqual(a.writes,[]);assert.deepEqual(a.xhr,[]);
    assert.ok(a.bundles.some(r=>r.url.startsWith(item.bundleUrl)),'real publisher bundle requested');
    assert.ok(a.feeds.some(u=>u.endsWith('/site.json')));assert.ok(a.feeds.some(u=>u.endsWith('/api/v1/programme/rfl')));
  });save();
}
async function cleanCheck() {
  await chrome.evaluate('(async()=>{window.__prerollClean=rflBroadcast.cleanOutput();await __prerollClean.ready;})()');
  report.clean=await chrome.evaluate(`(()=>{
    const b=rflBroadcast,s=b.state(),clean=__prerollClean.state(),w=b.width,h=b.height,live=b.pixels();
    const pixels=__prerollClean.canvas.getContext('2d').getImageData(0,0,w,h).data;
    const x0=Math.floor((854-12-66)*w/854)-2,x1=Math.ceil((854-12)*w/854)+2,y0=Math.floor(8*w/854)-2,y1=Math.ceil(34*w/854)+2;
    let outside=0,inside=0,nonzero=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const a=(y*w+x)*4,z=((h-1-y)*w+x)*4;
      if(live[z]||live[z+1]||live[z+2])nonzero++;
      if([0,1,2,3].some(k=>pixels[a+k]!==live[z+k])){if(x>=x0&&x<x1&&y>=y0&&y<y1)inside++;else outside++;}
    }
    return {outside,inside,nonzero,width:w,height:h,clean,serial:s.renderSerial,bug:s.scorebug,matchId:s.match.id,shot:s.director.shot,table:s.leagueTable,errors:s.errors};
  })()`);
  check('same-frame clean output',()=>{
    const c=report.clean;assert.equal(c.outside,0,'exact pixel match outside established outer-LIVE bounds');assert.ok(c.nonzero>10000);
    if(c.bug.live&&!c.bug.replay)assert.ok(c.inside>0);else assert.equal(c.inside,0);
    assert.equal(c.clean.frame.serial,c.serial);assert.equal(c.clean.frame.matchId,c.matchId);assert.equal(c.clean.frame.camera,c.shot);
    assert.equal(c.clean.frame.clock,c.bug.clock??null);assert.equal(c.table.mode,'preroll');assert.equal(c.table.visible,true);assert.deepEqual(c.errors,[]);
  });
  await chrome.evaluate('__prerollClean.stop()');report.clean.stopped=await chrome.evaluate('__prerollClean.state()');
  check('clean stopped',()=>assert.equal(report.clean.stopped.active,false));save();
}
try {
  const hosted=await serve(resolve('public'));server=hosted.server;report.origin=hosted.origin;
  // Include in-flight local module requests, which Resource Timing cannot yet see.
  server.prependListener('request',(req,res)=>{
    if(!currentBoot)return;
    const request={url:new URL(req.url,report.origin).href,method:req.method,status:'pending'};
    currentBoot.requests.push(request);
    res.on('finish',()=>{request.status=res.statusCode;});
    res.on('close',()=>{if(request.status==='pending')request.status='closed';});
  });
  chrome=await launchChrome({width:1280,height:720,gpu});
  chrome.onConsole((type,text)=>{currentBoot?.console.push({type,text});if(type==='error')report.errors.push({route,text});});
  for(const visitor of [true,false]) {
    route=visitor?'visitor':'broadcast';await boot(visitor,21.999);
    for(const phase of phases){await capture(visitor,phase);if(!visitor&&phase.name==='second-late-read')await cleanCheck();}
    await audit(route);
    // A genuinely new document/controller, not merely a seek of warmed state.
    await boot(visitor,135);
    await capture(visitor,{name:'late-join-135',seconds:135,camera:'heli',cue:112.7,screenshot:true});
    await audit(`${route}-late-join`);
  }
  for(const v of report.samples.visitor) {
    const b=report.samples.broadcast.find(s=>s.name===v.name),pair={name:v.name,visitor:comparable(v.state),broadcast:comparable(b.state)};
    report.comparisons.push(pair);check(`route parity/${v.name}`,()=>assert.deepEqual(pair.visitor,pair.broadcast));
  }
  for(const r of ['visitor','broadcast']) {
    const samples=report.samples[r],find=n=>samples.find(s=>s.name===n).state;
    check(`${r}/late join has no local restart`,()=>assert.deepEqual(comparable(find('second-late-read')),comparable(find('late-join-135'))));
    check(`${r}/no position or result animation`,()=>{
      const first=find('first-read').paint;
      for(const name of ['first-fade-half','second-read','second-late-read','second-fade-half','late-join-135'])assert.deepEqual(find(name).paint,first,`${name}: same static painted text, row positions and highlights`);
    });
  }
  check('browser console',()=>assert.deepEqual(report.errors,[]));
  assert.deepEqual(report.failures,[],`${report.failures.length} checks failed; see ${out}`);
  report.passed=true;console.log(`PASS preroll M42: ${report.comparisons.length} paired frozen-clock phases, static scheduled standings/fixture highlights, exact 24s fade/end, late joins, kickoff suppression, clean pixels, real bodies, no video/MP4/XHR/writes/errors. ${out}`);
} catch(e) {report.passed=false;report.fatal={route,message:e.message,stack:e.stack};process.exitCode=1;console.error(e.message);}
finally {
  clearTimeout(deadline);report.finishedAt=new Date().toISOString();
  try {save();writeFileSync(join(out,`attempt-${report.startedAt.replace(/[:.]/g,'-')}.json`),JSON.stringify(report,null,2));}
  finally {try{if(chrome)await chrome.close();}finally{if(server)await new Promise(r=>server.close(r));}}
}

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire('/e2e/package.json');
export const { chromium, expect: unusedExpect } = require('playwright');
export { assert };
export const base = process.env.KINWALL_URL || 'http://kw-travel-e2e-codex:8080';
export const key = process.env.KINWALL_KEY || 'kw_docker_e2e_only';
export const output = process.env.RESULTS_DIR || '/results/codex';
export const results = [], faults = [], apiCalls = [];
export async function api(method, path, body, auth = key, expected) {
  const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : {body: JSON.stringify(body)}) });
  const data = await r.json();
  apiCalls.push({method,path,status:r.status,expected:expected ?? '2xx'});
  if (expected !== undefined) assert.equal(r.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  else assert.ok(r.ok, `${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
export async function test(name, run) {
  try { await run(); results.push({name,status:'passed'}); console.log(`PASS ${name}`); }
  catch (e) { results.push({name,status:'failed',error:e.stack}); console.error(`FAIL ${name}: ${e.stack}`); }
}
export async function context(browser, auth = key, viewport = {width:1024,height:768}, colorScheme = 'light') {
  const ctx = await browser.newContext({viewport,colorScheme,reducedMotion:'reduce',hasTouch:true,locale:'en-US',timezoneId:'America/New_York'});
  await ctx.tracing.start({screenshots:true,snapshots:true,sources:true});
  await ctx.addInitScript(auth => localStorage.setItem('kinwall.apiKey',auth), auth);
  const page = await ctx.newPage();
  page.on('pageerror',e=>faults.push({kind:'pageerror',message:e.message,url:page.url()}));
  page.on('console',m=>{if(m.type()==='error')faults.push({kind:'console',message:m.text(),url:page.url()});});
  page.on('response',r=>{if(r.status()>=400)faults.push({kind:r.status()>=500?'server':'http',status:r.status(),url:r.url(),method:r.request().method()});});
  return {ctx,page};
}
export async function go(page, hash) { await page.bringToFront(); await page.goto(base + '/' + hash); await page.locator('main, .app-main, .meals-view, .calendar-view').first().waitFor(); await page.getByText('Loading…',{exact:true}).first().waitFor({state:'hidden'}); }
export async function shot(page, name) {
  await page.bringToFront();
  await mkdir(output,{recursive:true});
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`${output}/${name}.png`,animations:'disabled'});
  const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));
  assert.ok(overflow.scroll<=overflow.width+1,`${name}: horizontal overflow ${JSON.stringify(overflow)}`);
  const innerOverflow=await page.locator('.scroll-y, .sheet, .sheet-body').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0&&n.scrollWidth>n.clientWidth+1).map(n=>({className:n.className,width:n.clientWidth,scroll:n.scrollWidth})));
  assert.deepEqual(innerOverflow,[],`${name}: horizontal overflow inside a screen/sheet`);
}
export async function closeContext(ctx,name) { await ctx.tracing.stop({path:`${output}/${name}-trace.zip`}); await ctx.close(); }
export async function finish(browser) {
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/results.json`,JSON.stringify({base,node:process.version,browser:browser.version(),results,faults,apiCalls},null,2));
  for (const [i,ctx] of browser.contexts().entries()) await ctx.tracing.stop({path:`${output}/trace-${i}.zip`});
  await browser.close();
  if(results.some(r=>r.status==='failed')||faults.some(f=>f.kind==='pageerror'||f.kind==='server'||(f.kind==='console'&&!/^Failed to load resource:.*status of (400|403|404|409)/.test(f.message))))process.exitCode=1;
}

// One choice in a sheet: a segmented control (few short choices) or a picker row that opens its own sheet.
export async function choose(scope, label, option) {
  const group = scope.getByRole('radiogroup', { name: label });
  if (await group.count()) return group.getByRole('radio', { name: option, exact: true }).click();
  const dialogs = scope.page().getByRole('dialog');
  const n = await dialogs.count();
  await scope.getByRole('button', { name: new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `) }).click();
  await dialogs.nth(n).getByRole('button', { name: option, exact: true }).click();
  await dialogs.nth(n).waitFor({ state: 'detached' });
}

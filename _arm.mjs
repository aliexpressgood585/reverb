import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const PORT = 4209;
const srv = spawn('npx', ['vite','preview','--port',String(PORT),'--host','127.0.0.1'], {stdio:['ignore','pipe','pipe']});
srv.stdout.on('data',()=>{});
process.on('exit',()=>{try{srv.kill('SIGTERM')}catch{}});
for (let i=0;i<80;i++){try{if((await fetch(`http://127.0.0.1:${PORT}/cairn/`)).ok)break}catch{}await delay(400)}
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--headless=new','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p = await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
await p.goto(`http://127.0.0.1:${PORT}/cairn/`,{waitUntil:'load'});
await p.waitForFunction(()=>!!window.CAIRN);
await p.evaluate(()=>window.CAIRN.panel.show('settings'));
await delay(400);
// Tap the erase button through the real hit-tested touch path.
const box = await p.evaluate(() => {
  const btns=[...document.querySelectorAll('button.btn.danger')];
  if(!btns.length) return null;
  const r=btns[0].getBoundingClientRect();
  return {x:r.x+r.width/2, y:r.y+r.height/2};
});
if(!box){console.log('NO DANGER BUTTON FOUND');process.exit(1);}
await p.touchscreen.tap(box.x, box.y);
await delay(250);
const st = await p.evaluate(()=>{
  const el=document.querySelector('button.btn.danger');
  const cs=getComputedStyle(el);
  return {text:el.textContent, armed:el.classList.contains('armed'), color:cs.color, bg:cs.backgroundColor};
});
console.log('after one tap:', JSON.stringify(st));
await p.screenshot({path:'shots/ui/phone-en-settings-armed.png'});
// And it must forget.
await delay(4600);
const after = await p.evaluate(()=>{
  const el=document.querySelector('button.btn.danger');
  return {text:el.textContent, armed:el.classList.contains('armed'), flag:window.CAIRN.panel.wipeArmed};
});
console.log('after 4.6s   :', JSON.stringify(after));
await b.close(); try{srv.kill('SIGTERM')}catch{}

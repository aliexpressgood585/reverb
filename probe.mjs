import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const PORT=4192;
const server = spawn('npx',['vite','preview','--port',String(PORT),'--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
server.stdout.on('data',()=>{}); process.on('exit',()=>{try{server.kill()}catch{}});
for (let i=0;i<60;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; }catch{} await delay(400); }
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--headless=new','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const page = await browser.newPage({viewport:{width:480,height:270}});
page.setDefaultTimeout(300000);
page.on('pageerror',e=>console.log('ERR',e.message));
page.on('console',m=>{ if(m.type()==='error') console.log('[c-err]', JSON.stringify(m.text()).slice(0,2500)); });
await page.goto(`http://127.0.0.1:${PORT}/?lm=512&msaa=0`,{waitUntil:'load'});
await page.waitForFunction(()=>!!window.REVERB);
await page.evaluate(()=>window.REVERB.setFixedStep(1/60));

const test = async (lvl, tweak) => page.evaluate(({lvl,tweak})=>{
  const g=window.REVERB;
  g.debugEnter(lvl,{x:0,z:lvl===2?-20:-12,yaw:Math.PI,pitch:-0.08});
  eval(tweak||'');
  g.frame();
  g.sound.emit('shot', g.player.eyePosition(), {gain:1});
  for(let i=0;i<12;i++) g.frame();
  // read the framebuffer
  const c=g.canvas, tmp=document.createElement('canvas');
  tmp.width=c.width; tmp.height=c.height;
  const ctx=tmp.getContext('2d'); ctx.drawImage(c,0,0);
  const d=ctx.getImageData(0,0,c.width,c.height).data;
  let sum=0,max=0,lit=0;
  for(let i=0;i<d.length;i+=4){ const v=(d[i]+d[i+1]+d[i+2])/3; sum+=v; if(v>max)max=v; if(v>8)lit++; }
  return {level:g.level.def.name, mean:+(sum/(d.length/4)).toFixed(2), max, litPct:+(100*lit/(d.length/4)).toFixed(1),
          children:g.scene.children.length, meshVisible:g.mesh.visible, count:g.pulses.count};
},{lvl,tweak});

console.log('L1 baseline ', await test(0));
console.log('L3 baseline ', await test(2));
console.log('L3 no-occ   ', await test(2, "g.shared.occUniforms.uOccTex.value = g._blankOcc();"));
console.log('L3 wide-fov ', await test(2, "g.camera.fov=100; g.camera.updateProjectionMatrix();"));
await browser.close(); process.exit(0);

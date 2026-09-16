import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FEEL, COLUMN, biomeAt, newBiomeSlot } from './feel.js';
import { EROSION, erosionOf, solidHalfWidth } from './sim.js';

/** @typedef {import('./sim.js').Sim} Sim */
/** @typedef {import('./render.js').Camera} GameCamera */
/** @typedef {import('./render.js').UiState} UiState */
/** @typedef {import('./render.js').Renderer} Effects */
/** @typedef {import('./input.js').Input} Input */
const C = FEEL.city;
/** The arc of a thumb that is not on the glass. Read, never written. */
const EMPTY_ARC = /** @type {number[]} */ ([]);
/** Stable decoration only; never touches the world's random generator.
 * @param {number} n */
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** A 3D city with gameplay on the original x/y plane. No remote assets. */
export class CityRenderer {
  /** @param {HTMLCanvasElement} canvas */
  static create(canvas) {
    try { return new CityRenderer(canvas); }
    catch (error) { console.warn('CAIRN: using the 2D renderer', error); return null; }
  }

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.gpu = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.gpu.setPixelRatio(1);
    this.gpu.outputColorSpace = T.SRGBColorSpace;
    this.gpu.toneMapping = T.ACESFilmicToneMapping;
    this.gpu.toneMappingExposure = C.exposure;
    this.gpu.shadowMap.enabled = true;
    this.gpu.shadowMap.type = T.PCFShadowMap;
    this.scene = new T.Scene();
    this.background = new T.Color(C.night);
    this.scene.background = this.background;
    this.fog = new T.Fog(C.night, C.fogNear, C.fogFar);
    this.scene.fog = this.fog;
    this.camera = new T.PerspectiveCamera(30, 1, 0.1, 1800);
    this.w = 1; this.h = 1; this.time = 0;
    this.biome = newBiomeSlot();
    this.matrix = new T.Object3D();
    this.color = new T.Color();
    this.skyColor = new T.Color();
    this.box = new T.BoxGeometry(1, 1, 1);
    this.round = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
    this.sphere = new T.SphereGeometry(1, 12, 8);
    this.scene.add(new T.HemisphereLight(0xa6c6ff, 0x2b174d, C.ambient));
    this.key = new T.DirectionalLight(0xc3e5ff, C.keyLight);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(C.shadowSize, C.shadowSize);
    this.key.shadow.camera.left = -C.shadowSpan;
    this.key.shadow.camera.right = C.shadowSpan;
    this.key.shadow.camera.top = C.shadowSpan;
    this.key.shadow.camera.bottom = -C.shadowSpan;
    this.key.shadow.normalBias = 0.12;
    this.scene.add(this.key, this.key.target);
    this.rim = new T.DirectionalLight(C.pink, C.rimLight);
    this.scene.add(this.rim, this.rim.target);
    this.metal = new T.MeshStandardMaterial({ color: 0x45617a, metalness: 0.65, roughness: 0.34 });
    this.armor = new T.MeshStandardMaterial({ color: 0xc6d5e6, metalness: 0.5, roughness: 0.3 });
    this.dark = new T.MeshStandardMaterial({ color: 0x101b34, metalness: 0.5, roughness: 0.4 });
    this.cyan = new T.MeshBasicMaterial({ color: C.cyan, toneMapped: false });
    this.pink = new T.MeshBasicMaterial({ color: C.pink, toneMapped: false });
    this.gold = new T.MeshStandardMaterial({ color: 0xb38a46, emissive: C.gold, emissiveIntensity: 0.25, metalness: 0.7, roughness: 0.3 });
    this.platforms = this.instances(this.box, this.metal, C.maxPlatforms);
    this.lips = this.instances(this.box, this.cyan, C.maxPlatforms);
    this.struts = this.instances(this.box, this.dark, C.maxPlatforms);
    this.updrafts = this.instances(this.box, new T.MeshBasicMaterial({color:C.cyan,transparent:true,opacity:0.12,depthWrite:false}), C.maxPlatforms);
    this.stones = this.instances(this.round, this.gold, C.maxStones);
    this.lanterns = this.instances(new T.CircleGeometry(1,16), new T.MeshBasicMaterial({color:C.gold,toneMapped:false}), C.maxStones);
    this.seams = this.instances(this.box, new T.MeshBasicMaterial({ color: C.gold, toneMapped: false }), C.maxStones);
    this.memories = this.instances(new T.OctahedronGeometry(1), new T.MeshBasicMaterial({color:C.gold,wireframe:true,transparent:true,opacity:0.22}), C.maxStones);
    this.city = new T.Group(); this.scene.add(this.city);
    this.buildCity();
    this.robot = new T.Group(); this.scene.add(this.robot);
    this.robot.scale.setScalar(C.robotScale);
    this.buildRobot();
    this.arc = this.instances(this.sphere, this.cyan, C.maxArcPoints);
    this.previewStone = new T.Mesh(this.round, new T.MeshBasicMaterial({ color:C.gold,wireframe:true,transparent:true,opacity:0.65 }));
    this.scene.add(this.previewStone);
    this.halo = new T.Mesh(new T.RingGeometry(0.8, 1, 32), new T.MeshBasicMaterial({color:C.gold,side:T.DoubleSide,transparent:true,opacity:0.8}));
    this.scene.add(this.halo);
    this.rings = this.instances(new T.TorusGeometry(1,0.025,4,32), this.cyan, 32);
    this.particles = this.instances(this.box, this.gold, C.particleCount);
    this.trail = this.instances(this.sphere, this.cyan, C.trailCount);
    this.rain = this.instances(this.box, new T.MeshBasicMaterial({color:0x7bb4d1,transparent:true,opacity:0.18}), C.rainCount);
    this.goal = new T.Mesh(new T.TorusGeometry(17, 0.12, 4, 64, Math.PI), this.pink);
    this.scene.add(this.goal);
    this.record = new T.Mesh(this.box, new T.MeshBasicMaterial({color:C.gold,transparent:true,opacity:0.35}));
    this.scene.add(this.record);
    this.landingAt = -10; this.landingX = 0; this.landingY = 0;
    this.lastGrounded = true;
    this.slowFrames = 0;
    this.detailReduced = false;
  }

  /** @param {T.BufferGeometry} geometry @param {T.Material} material @param {number} count */
  instances(geometry, material, count) {
    const mesh = new T.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.count = 0;
    mesh.castShadow = material === this.metal || material === this.gold;
    mesh.receiveShadow = material === this.metal || material === this.gold;
    this.scene.add(mesh);
    return mesh;
  }

  /** @param {T.InstancedMesh} mesh @param {number} i
   * @param {number} x @param {number} y @param {number} z
   * @param {number} w @param {number} h @param {number} d
   * @param {number} [rotation] */
  put(mesh, i, x, y, z, w, h, d, rotation = 0) {
    this.matrix.position.set(x,y,z); this.matrix.scale.set(w,h,d);
    this.matrix.rotation.set(0,0,rotation); this.matrix.updateMatrix();
    mesh.setMatrixAt(i,this.matrix.matrix);
  }

  /** @param {T.InstancedMesh} mesh @param {number} count */
  finish(mesh,count) { mesh.count=count; mesh.instanceMatrix.needsUpdate=true; }

  /** @param {T.Object3D} parent @param {T.Material} material
   * @param {number[]} size @param {number[]} position @param {boolean} [round] */
  part(parent,material,size,position,round=true) {
    const m = new T.Mesh(round ? this.round : this.box,material);
    m.scale.set(size[0],size[1],size[2]); m.position.set(position[0],position[1],position[2]);
    m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
  }

  buildRobot() {
    // THE LANTERN KEEPER: salvaged ivory shell, one amber lens, a repair arm,
    // and a long signal ribbon. Readable through silhouette at phone scale.
    const ivory = new T.MeshStandardMaterial({color:0xe4d9b9,metalness:0.22,roughness:0.62});
    const copper = new T.MeshStandardMaterial({color:0xb86e48,metalness:0.72,roughness:0.4});
    const coat = new T.MeshStandardMaterial({color:0x245957,roughness:0.86});
    const lamp = new T.MeshBasicMaterial({color:0xffdc8a,toneMapped:false});
    this.torso = this.part(this.robot,coat,[2.2,2.1,1.6],[0,2.95,-0.65]);
    this.part(this.robot,copper,[1.8,0.3,1.7],[0,2.2,-0.65]);
    this.part(this.robot,this.dark,[1.65,0.65,1.2],[0,1.85,-0.6]);
    // A tiny glass courier canister and its three protective ribs.
    this.part(this.robot,copper,[1.65,2.4,0.85],[0.15,3.3,-1.9]);
    this.part(this.robot,lamp,[1.15,1.6,0.25],[0.15,3.4,-2.4]);
    for(const x of [-0.5,0.15,0.8]) this.part(this.robot,this.dark,[0.1,2,0.12],[x,3.4,-2.55]);
    this.head = new T.Group(); this.head.position.set(0,4.5,-0.65); this.robot.add(this.head);
    const shell = new T.Mesh(this.sphere,ivory); shell.scale.set(1.65,1.3,1.1); this.head.add(shell);
    const bezel = new T.Mesh(new T.TorusGeometry(0.92,0.18,8,32),copper);
    bezel.position.set(0,0,0.95); this.head.add(bezel);
    const glass = new T.Mesh(new T.CircleGeometry(0.86,32),this.dark);
    glass.position.z=1.05; this.head.add(glass);
    this.eye = new T.Mesh(new T.CircleGeometry(0.55,24),lamp);
    this.eye.position.set(0,0,1.08); this.head.add(this.eye);
    this.part(this.head,ivory,[1.75,0.21,0.35],[0,0.8,1.07]);
    // An asymmetric antenna, a taped repair patch and a single shoulder plate.
    this.part(this.head,copper,[0.14,1.15,0.14],[-1.14,1.12,0]);
    this.part(this.head,lamp,[0.3,0.3,0.3],[-1.14,1.75,0]);
    this.part(this.head,coat,[0.58,0.3,0.17],[1.18,-0.52,0.65]);
    this.part(this.robot,ivory,[1.1,0.6,1.1],[-1.35,3.85,-0.65]);
    /** @type {T.Group[]} */ this.arms=[];
    /** @type {T.Group[]} */ this.legs=[];
    for (const side of [-1,1]) {
      const arm=new T.Group(); arm.position.set(side*1.4,3.65,-0.65); this.robot.add(arm); this.arms.push(arm);
      this.part(arm,copper,[0.45,0.6,0.6],[0,-0.2,0]);
      this.part(arm,side<0?coat:copper,[side<0?0.7:0.42,1.3,0.65],[0,-0.9,0]);
      this.part(arm,this.dark,[0.7,0.58,0.75],[0,-1.64,0.1]);
      const leg=new T.Group(); leg.position.set(side*0.64,1.75,-0.6); this.robot.add(leg); this.legs.push(leg);
      this.part(leg,copper,[0.45,1.2,0.5],[0,-0.55,0]);
      this.part(leg,ivory,[0.7,0.65,0.7],[0,-0.7,0]);
      this.part(leg,this.dark,[1.05,0.45,1.6],[0,-1.53,0.26]);
      this.part(leg,lamp,[0.6,0.1,0.12],[0,-1.52,1.08]);
    }
    this.scarf = new T.Group(); this.scarf.position.set(-0.8,4.0,-0.7); this.robot.add(this.scarf);
    const cloth=new T.MeshStandardMaterial({color:0xf2754f,emissive:0x421608,roughness:0.9,side:T.DoubleSide});
    this.part(this.robot,cloth,[2.2,0.35,1.8],[0,4.02,-0.65]);
    /** @type {T.Group[]} */ this.ribbon=[];
    let parent=this.scarf;
    for(let i=0;i<5;i++) {
      const joint=new T.Group(); joint.position.x=i===0?0:-0.9; parent.add(joint);
      this.part(joint,cloth,[1.05,0.6-i*0.07,0.1],[-0.45,0,0]);
      this.ribbon.push(joint); parent=joint;
    }
  }

  buildCity() {
    // Atlas of actual window bays. Generated once; its dark pixels retain metal shading.
    const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=512;
    const ctx=canvas.getContext('2d');
    if (!ctx) throw new Error('City texture needs Canvas2D');
    ctx.fillStyle='#101c32'; ctx.fillRect(0,0,256,512);
    for(let row=0;row<32;row++) for(let col=0;col<12;col++) {
      const n=row*13+col, h=hash(n);
      ctx.fillStyle=h>0.70?'#69dbe9':h>0.61?'#e55bba':h>0.45?'#2e586d':'#17263d';
      ctx.fillRect(col*21+5,row*16+4,8+(col%3),7);
    }
    const map=new T.CanvasTexture(canvas); map.colorSpace=T.SRGBColorSpace;
    map.magFilter=T.LinearFilter; map.minFilter=T.LinearMipmapLinearFilter;
    const facade=new T.MeshStandardMaterial({color:0xadc7e5,map,emissive:0x8ec3ec,emissiveMap:map,emissiveIntensity:0.42,metalness:0.35,roughness:0.65});
    const walls=new T.MeshStandardMaterial({color:0x172b45,metalness:0.55,roughness:0.5});
    const ceramic=new T.MeshStandardMaterial({color:0x688985,metalness:0.18,roughness:0.82});
    const patina=new T.MeshStandardMaterial({color:0x294f4b,metalness:0.48,roughness:0.72});
    const copper=new T.MeshStandardMaterial({color:0xa6714e,metalness:0.6,roughness:0.56});
    const keel=new T.ConeGeometry(1,1,4);
    const arc=new T.TorusGeometry(1,0.025,5,48,Math.PI*1.45);
    /** @type {T.Group[]} */ this.towers=[];
    for(let i=0;i<C.buildingCount;i++) {
      const g=new T.Group();
      const band=i%3, side=i%2?1:-1;
      const width=14+hash(i+1)*29, height=70+hash(i+20)*230, depth=18+hash(i+30)*26;
      const x=COLUMN/2+side*(65+hash(i+70)*230);
      g.position.set(x,hash(i+100)*C.skylineSpan-C.skylineSpan/2,-65-band*105-hash(i+44)*80);
      g.userData.baseY=g.position.y;
      const kind=i%3;
      if(kind===0) {
        // Twin ribs carry a suspended habitat, leaving an open vertical slit.
        for(const side of [-1,1]) {
          this.part(g,ceramic,[width*0.24,height,depth],[side*width*0.38,0,0],false);
          this.part(g,facade,[width*0.23,height*0.76,0.3],[side*width*0.38,0,depth/2+0.2],false);
        }
        for(let deck=0;deck<4;deck++) {
          this.part(g,copper,[width*1.14,2.6,depth*1.12],[0,(deck/3-0.5)*height*0.75,0],false);
        }
      } else if(kind===1) {
        // Stacked seed-pod apartments with offset terraces, not a rectangular skyline.
        this.part(g,patina,[width*0.22,height,depth*0.4],[0,0,0],false);
        for(let deck=0;deck<5;deck++) {
          const dx=(deck%2?1:-1)*width*0.16, yy=(deck/4-0.5)*height*0.75;
          this.part(g,ceramic,[width,height*0.12,depth],[dx,yy,0]);
          this.part(g,facade,[width*0.8,height*0.07,0.2],[dx,yy,depth/2+0.1],false);
          this.part(g,patina,[width*1.15,1.4,depth*1.1],[dx,yy-height*0.065,0],false);
        }
      } else {
        this.part(g,walls,[width*0.7,height,depth],[0,0,0],false);
        this.part(g,facade,[width*0.7,height*0.85,0.2],[0,0,depth/2+0.1],false);
        const crown=new T.Mesh(arc,copper); crown.scale.set(width*0.8,width*0.8,width*0.8);
        crown.position.set(0,height/2,-depth/2); crown.rotation.z=0.4; g.add(crown);
        this.part(g,ceramic,[width*1.3,4,depth*1.1],[0,height*0.3,0],false);
      }
      const hanging=new T.Mesh(keel,patina);
      hanging.position.y=-height/2-12; hanging.rotation.z=Math.PI;
      hanging.scale.set(width*0.48,24,depth*0.48);g.add(hanging);
      // Hanging signal cables and warm beacons belong to the same world as the keeper.
      if(i%4===0) {
        this.part(g,copper,[0.2,38,0.2],[width*0.35,-height/2-15,depth/2],false);
        this.part(g,this.gold,[2,3,2],[width*0.35,-height/2-35,depth/2]);
      }
      if(i%7===0) {
        const ad=new T.Mesh(new T.PlaneGeometry(width*0.5,12),this.sign(i%2?'POST / 09':'↑  CAIRN','#ffcc8c'));
        ad.position.set(width*0.58,height*0.14,depth/2+0.3); g.add(ad);
      }
      g.traverse(object => { object.castShadow=false; });
      this.city.add(g); this.towers.push(g);
    }
    // The city's defining landmark: a fractured copper transit wheel.
    // Camera-relative background anchoring keeps it visible throughout an ascent.
    this.transit=new T.Group(); this.scene.add(this.transit);
    for(let i=0;i<3;i++) {
      const rail=new T.Mesh(new T.TorusGeometry(105+i*7,0.65,6,64,Math.PI*1.42),i===1?this.gold:copper);
      rail.rotation.z=0.35+i*0.12; rail.rotation.y=0.32; this.transit.add(rail);
    }
    for(let i=0;i<9;i++) {
      const angle=0.35+i*0.48;
      const pod=this.part(this.transit,ceramic,[9,4,5],[Math.cos(angle)*112,Math.sin(angle)*112,0]);
      pod.rotation.z=angle;
    }
    this.part(this.transit,this.gold,[0.7,150,0.7],[-40,-20,-3],false);
    this.moon=new T.Mesh(new T.SphereGeometry(25,24,16),new T.MeshBasicMaterial({color:0xc2b897}));
    this.scene.add(this.moon);
  }

  /** @param {string} label @param {string} color */
  sign(label,color) {
    const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=128;
    const c=canvas.getContext('2d');
    if(c) {
      c.fillStyle='#09172b'; c.fillRect(0,0,256,128);
      c.strokeStyle=color; c.lineWidth=5; c.strokeRect(4,4,248,120);
      c.fillStyle=color; c.font='bold 46px sans-serif'; c.textAlign='center'; c.fillText(label,128,78);
    }
    const map=new T.CanvasTexture(canvas); map.colorSpace=T.SRGBColorSpace;
    return new T.MeshBasicMaterial({map,toneMapped:false,side:T.DoubleSide});
  }

  /** @param {number} w @param {number} h @param {number} dpr */
  resize(w,h,dpr) {
    this.w=w; this.h=h;
    this.gpu.setPixelRatio(Math.min(dpr,C.dpr)); this.gpu.setSize(w,h,false);
    this.camera.aspect=w/h;
  }

  /** @param {Sim} sim @param {GameCamera} cam @param {Input|null} input
   * @param {UiState} ui @param {number} dt @param {boolean} reduced @param {Effects} fx */
  draw(sim,cam,input,ui,dt,reduced,fx) {
    // A NULL INPUT IS LEGAL, as it is for the 2D renderer this replaced — that
    // one is typed `Input|null` and every offline harness passes null. This
    // method dereferenced `input.aiming` directly, so the whole test surface
    // (perf probes, frame captures, the erosion gate) threw on its first call.
    // Not reachable from the live loop, which always holds a real Input; that is
    // exactly why it survived review. Rather than substitute a fake Input, the
    // four fields actually read are lifted out once, so the type stays honest
    // about what a renderer needs from the player's thumb.
    const aiming=!!input?.aiming, aimVx=input?.vx??0;
    const arc=input?.arc??EMPTY_ARC, landing=input?.landing??null;
    this.time+=dt;
    const b=sim.body, B=biomeAt(Math.max(0,b.y),this.biome);
    const cx=cam.x-cam.shakeX;
    const cy=cam.y-FEEL.camera.playerOffsetY*cam.viewH+cam.shakeY;
    cam.aspect=this.w/this.h;
    this.camera.fov=T.MathUtils.radToDeg(2*Math.atan(cam.viewH/(2*C.cameraDistance)));
    this.camera.aspect=cam.aspect; this.camera.position.set(cx,cy,C.cameraDistance);
    this.camera.rotation.set(0,0,0); this.camera.updateProjectionMatrix();
    this.key.position.set(cx-35,cy+60,65); this.key.target.position.set(cx,cy,0);
    this.rim.position.set(cx+55,cy+10,-10); this.rim.target.position.set(cx,cy,0);
    this.skyColor.setHex(C.phases[B.index%6]); this.color.setHex(C.phases[(B.index+1)%6]);
    this.skyColor.lerp(this.color,B.blend);
    this.background.copy(this.skyColor); this.fog.color.copy(this.skyColor);
    this.city.position.y=cy*C.parallax;
    if(this.transit) {
      this.transit.position.set(COLUMN/2-28,cy*0.94+58,-260);
      this.transit.visible=cam.mon<0.85;
    }
    if(this.moon) {
      this.moon.position.set(COLUMN/2+80,cy+140,-580);
      this.moon.visible=cam.mon<0.85;
    }
    for(const tower of this.towers) {
      const localY=cy*(1-C.parallax);
      tower.position.y=tower.userData.baseY+Math.floor((localY-tower.userData.baseY+C.skylineSpan/2)/C.skylineSpan)*C.skylineSpan;
    }
    let pi=0,si=0,mi=0,wi=0;
    const lo=cy-cam.viewH,hi=cy+cam.viewH;
    for(const s of sim.world.solids) {
      if(!s.live || s.y<lo || s.y>hi) continue;
      const hw=solidHalfWidth(s,sim), top=s.y+s.hh;
      if(s.updraft && wi<C.maxPlatforms) {
        this.put(this.updrafts,wi++,s.x,top+FEEL.verbs.updraftH/2,-0.5,FEEL.verbs.updraftW*2,FEEL.verbs.updraftH,0.1);
      }
      if(!s.corpse) {
        if(pi>=C.maxPlatforms || hw<=0) continue;
        // The luminous FRONT edge is exactly at z=0, matching collision x/y.
        this.put(this.platforms,pi,s.x,s.y,-C.platformDepth/2,hw*2,s.hh*2,C.platformDepth);
        this.put(this.lips,pi,s.x,top,0,hw*2,0.27,0.15);
        this.put(this.struts,pi,s.x,s.y-s.hh-1,-4,hw*1.5,2,C.platformDepth*0.65);
        let tint=C.cyan;
        if(s.crumble) tint=s.crumbleAt>0?C.pink:C.gold;
        else if(s.drift>0) tint=C.pink;
        this.color.setHex(tint);
        this.lips.setColorAt(pi,this.color);
        pi++;
      } else if(erosionOf(s,sim)===EROSION.MEMORY) {
        if(mi<C.maxStones) this.put(this.memories,mi++,s.x,s.y,-1.6,s.hw,s.hh,2,s.rot);
      } else if(si<C.maxStones) {
        const stage=erosionOf(s,sim);
        this.put(this.stones,si,s.x,s.y,-2,hw*2,s.hh*2,4,s.rot*0.3);
        // THE BODY AGES, not only the seam above it. Every corpse is one
        // instance of one shared material, so an instance colour is the only
        // place the ladder can live on the stone itself — and without it THIN
        // and TOP rendered pixel-identically. See FEEL.city.stoneLadder.
        this.color.setScalar(C.stoneLadder[stage]??C.stoneLadder[2]);
        this.stones.setColorAt(si,this.color);
        this.put(this.seams,si,s.x,top,0,hw*2,stage===EROSION.FRESH?0.45:0.18,0.15);
        this.color.setScalar(stage===EROSION.FRESH?1:stage===EROSION.THIN?0.45:0.2);
        this.seams.setColorAt(si,this.color);
        const lens=Math.min(hw*0.34,s.hh*0.48);
        this.put(this.lanterns,si,s.x,s.y,0.1,lens,lens,1);
        this.lanterns.setColorAt(si,this.color);
        si++;
      }
    }
    this.finish(this.updrafts,wi);
    this.finish(this.platforms,pi); this.finish(this.lips,pi); this.finish(this.struts,pi);
    this.finish(this.lanterns,si);
    if(this.lanterns.instanceColor)this.lanterns.instanceColor.needsUpdate=true;
    this.finish(this.stones,si); this.finish(this.seams,si); this.finish(this.memories,mi);
    if(this.lips.instanceColor)this.lips.instanceColor.needsUpdate=true;
    if(this.seams.instanceColor)this.seams.instanceColor.needsUpdate=true;
    if(this.stones.instanceColor)this.stones.instanceColor.needsUpdate=true;
    const x=b.rx??b.x, y=b.ry??b.y;
    if(b.grounded&&!this.lastGrounded) {this.landingAt=this.time;this.landingX=x;this.landingY=y-FEEL.body.h/2;}
    this.lastGrounded=b.grounded;
    const pulse=Math.max(0,1-(this.time-this.landingAt)/C.ringSeconds);
    this.robot.position.set(x,y-FEEL.body.h/2,0);
    const squash=reduced?0:ui.squash;
    this.robot.scale.set(C.robotScale*(1-squash),C.robotScale*(1+squash),C.robotScale);
    this.robot.rotation.z=reduced?0:T.MathUtils.clamp(-b.vx*0.002,-0.18,0.18);
    this.robot.rotation.y=T.MathUtils.clamp(b.vx*0.008,-0.45,0.45);
    this.robot.visible=ui.dead===0;
    if(this.head) this.head.rotation.y=T.MathUtils.clamp(aiming?aimVx*0.009:b.vx*0.009,-0.5,0.5);
    for(let i=0;i<2;i++) {
      const side=i?1:-1;
      this.arms[i].rotation.z=side*(aiming?0.32:!b.grounded?0.75:0.1+pulse*0.3);
      this.legs[i].rotation.z=!b.grounded?side*0.19:0;
      this.legs[i].rotation.x=!b.grounded?side*0.2:0;
    }
    if(this.scarf) this.scarf.rotation.z=reduced?0:0.10*Math.sin(this.time*6)+Math.min(0.5,Math.abs(b.vx)*0.01);
    if(this.eye) {
      const blink=reduced?1:(Math.sin(this.time*C.blinkRate)>0.995?0.12:1);
      this.eye.scale.y=blink;
      this.eye.position.x=T.MathUtils.clamp((aiming?aimVx:b.vx)*0.006,-0.22,0.22);
    }
    for(let i=0;i<this.ribbon.length;i++) {
      this.ribbon[i].rotation.z=reduced?-0.08:Math.sin(this.time*C.ribbonSpeed-i*0.65)*C.ribbonWave-b.vx*0.001;
    }
    let ai=0;
    if(aiming) for(let i=0;i<arc.length-1&&ai<C.maxArcPoints;i+=2) {
      this.put(this.arc,ai++,arc[i],arc[i+1],0.2,0.28,0.28,0.28);
    }
    this.finish(this.arc,ai);
    this.previewStone.visible=aiming&&sim.predictPeak.dies;
    this.previewStone.position.set(sim.predictPeak.x,sim.predictPeak.y-FEEL.tower.corpseH/2,-2);
    this.previewStone.scale.set(FEEL.tower.corpseW,FEEL.tower.corpseH,4);
    this.halo.visible=aiming&&!!landing;
    if(landing) {this.halo.position.set(landing.x,landing.y+landing.hh,0.3);this.halo.scale.set(4,0.7,1);}
    let ri=0;
    if(!reduced) for(let i=0;i<fx.ringN&&ri<32;i++) {
      const o=i*4,life=fx.rings[o+2]/(FEEL.juice.ringMs/1000),radius=2+life*10;
      this.put(this.rings,ri++,fx.rings[o],fx.rings[o+1],0.3,radius,radius*0.28,1);
    }
    this.finish(this.rings,ri);
    let ti=0;
    if(!reduced) for(let i=0;i<fx.trailN&&ti<C.trailCount;i++) {
      const o=i*3;
      // The legacy trail storage is not a gameplay source; decorative particles follow below.
      if(Number.isFinite(fx.trail[o])&&Number.isFinite(fx.trail[o+1]))
        this.put(this.trail,ti++,fx.trail[o],fx.trail[o+1],-0.2,0.18,0.18,0.18);
    }
    this.finish(this.trail,ti);
    // Pooled sparks on a landing; no allocations or new geometry per frame.
    let sparks=0;
    if(!reduced&&pulse>0) for(let i=0;i<12;i++) {
      const age=1-pulse,side=hash(i+52)*2-1;
      this.put(this.particles,sparks++,this.landingX+side*age*12,this.landingY+Math.sin(age*Math.PI)*hash(i+32)*5,-0.2,pulse*0.23,pulse*0.23,pulse*0.23);
    }
    this.finish(this.particles,sparks);
    this.goal.visible=ui.started&&!ui.monument;
    this.goal.position.set(COLUMN/2,ui.goal||100,-18);
    this.record.visible=ui.started&&sim.best>10;
    this.record.position.set(COLUMN/2,sim.best,-0.1);this.record.scale.set(COLUMN,0.06,0.05);
    let rainCount=0;
    if(!reduced&&!this.detailReduced&&!ui.monument) for(let i=0;i<C.rainCount;i++) {
      const rx=cx+(hash(i+12)-0.5)*cam.viewH*cam.aspect*1.6;
      const ry=cy+((hash(i+71)*cam.viewH-this.time*C.rainSpeed)%cam.viewH+cam.viewH)%cam.viewH-cam.viewH/2;
      this.put(this.rain,rainCount++,rx,ry,-35,0.04,1.7,0.04,-0.15);
    }
    this.finish(this.rain,rainCount);
    this.city.visible=cam.mon<0.85;
    // Optional scenery yields before play does on a sustained slow device.
    if(ui.started&&dt>0.045)this.slowFrames++;else this.slowFrames=Math.max(0,this.slowFrames-1);
    if(this.slowFrames>90&&!this.detailReduced) {
      this.detailReduced=true; this.gpu.setPixelRatio(1); this.gpu.setSize(this.w,this.h,false);
      this.gpu.shadowMap.enabled=false;
    }
    this.gpu.render(this.scene,this.camera);
    return B;
  }
}

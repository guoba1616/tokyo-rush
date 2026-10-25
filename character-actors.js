/* Animated Quaternius actors (CC0); independent skeletons and in-place clips. */
(function () {
  'use strict';
  const templates = {};
  const aliases = {idle:'Idle_Neutral',walk:'Walk',sprint:'Run',
    'holding-right':'Idle_Gun_Pointing','holding-both':'Idle_Gun_Pointing',
    'holding-right-shoot':'Idle_Gun_Shoot','holding-both-shoot':'Idle_Gun_Shoot',
    'run-aim':'Run_Shoot',punch:'Punch_Right',die:'Death'};
  function cloneRig(source) {
    const clone = source.clone(true), map = new Map();
    function pair(a,b) {map.set(a,b);for(let i=0;i<a.children.length;i++)pair(a.children[i],b.children[i]);}
    pair(source,clone);
    source.traverse(node=>{
      if(!node.isSkinnedMesh)return;
      const mesh=map.get(node);mesh.skeleton=node.skeleton.clone();
      mesh.skeleton.bones=node.skeleton.bones.map(b=>map.get(b));
      mesh.bind(mesh.skeleton,node.bindMatrix.clone());
    });
    return clone;
  }
  function prepare(gl) {
    // These untextured CC0 characters use one skin and identity mesh transforms.
    // Bake material colors into vertices so a crowd needs one draw per actor.
    gl.scene.updateMatrixWorld(true);
    const parts=[];gl.scene.traverse(m=>{if(m.isSkinnedMesh)parts.push(m);});
    const first=parts[0],identity=new THREE.Matrix4();
    if(first&&parts.every(m=>!Array.isArray(m.material)&&!m.material.map&&m.matrixWorld.equals(identity)&&m.bindMatrix.equals(first.bindMatrix)&&m.skeleton.bones.every((b,i)=>b===first.skeleton.bones[i]))){
      const attrs={position:[],normal:[],skinIndex:[],skinWeight:[],color:[],policeColor:[]},indices=[],groups=[];let offset=0;
      for(const mesh of parts){
        const geo=mesh.geometry,c=mesh.material.color;
        const police=/Swat/.test(mesh.material.name)?new THREE.Color(/Black/.test(mesh.material.name)?0x14223a:0x244c80):c;
        for(const name of ['position','normal','skinIndex','skinWeight']){
          const attr=geo.getAttribute(name);for(let i=0;i<attr.count;i++)for(let j=0;j<attr.itemSize;j++)attrs[name].push(attr.array[i*attr.itemSize+j]);
        }
        for(let i=0;i<geo.attributes.position.count;i++){attrs.color.push(c.r,c.g,c.b);attrs.policeColor.push(police.r,police.g,police.b);}
        const count=geo.index?geo.index.count:geo.attributes.position.count;
        for(let i=0;i<count;i++)indices.push(offset+(geo.index?geo.index.getX(i):i));
        groups.push({name:mesh.material.name||'',start:offset,count:geo.attributes.position.count});
        offset+=geo.attributes.position.count;
      }
      const geometry=new THREE.BufferGeometry();
      for(const name of ['position','normal','color'])geometry.setAttribute(name,new THREE.Float32BufferAttribute(attrs[name],3));
      geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(attrs.skinIndex,4));
      geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(attrs.skinWeight,4));geometry.setIndex(indices);
      geometry.userData.policeColors=attrs.policeColor;geometry.userData.groups=groups;
      const merged=new THREE.SkinnedMesh(geometry,new THREE.MeshLambertMaterial({vertexColors:true}));
      merged.name='AnimatedCharacter';merged.bind(first.skeleton,first.bindMatrix);
      for(const mesh of parts)mesh.removeFromParent();gl.scene.add(merged);
    }
    gl.scene.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const convert=m=>new THREE.MeshLambertMaterial({name:m.name,color:m.color,
        map:m.map,side:m.side,transparent:m.transparent,opacity:m.opacity,vertexColors:m.vertexColors});
      mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material);
      mesh.castShadow=true;mesh.receiveShadow=true;
      // Animated limbs can leave the bind-pose bounds.
      if(mesh.isSkinnedMesh)mesh.frustumCulled=false;
    });
    gl.animations=gl.animations.map(original=>{
      const clip=original.clone();
      // Movement belongs to game physics; keep vertical bounce in the animation.
      for(const track of clip.tracks){
        if(!/^(Root|Body|CharacterArmature)\.position$/.test(track.name))continue;
        for(let i=0;i<track.values.length;i+=3){track.values[i]=track.values[0];track.values[i+2]=track.values[2];}
      }
      return clip;
    });
    return gl;
  }
  window.loadCharacterPack=function(done){
    const entries=Object.entries(window.CHARACTER_PACK||{});
    if(!entries.length){done();return;}
    const loader=new THREE.GLTFLoader();let left=entries.length;
    const finish=()=>{if(--left===0){window.CHARACTER_PACK=null;done();}};
    entries.forEach(([key,b64])=>{
      const s=atob(b64),buf=new Uint8Array(s.length);for(let i=0;i<s.length;i++)buf[i]=s.charCodeAt(i);
      loader.parse(buf.buffer,'',gl=>{try{templates[key]=prepare(gl);}catch(e){console.warn('Character preparation:',key,e);}finally{finish();}},e=>{console.warn('Character load:',key,e);finish();});
    });
  };
  window.loadLateCharacters=function(){
    if(window.__lateChars)return;window.__lateChars=true;
    const sc=document.createElement('script');sc.src='character-pack-late.js?v=14';
    sc.onload=()=>{
      const entries=Object.entries(window.CHARACTER_PACK_LATE||{});window.CHARACTER_PACK_LATE=null;
      const loader=new THREE.GLTFLoader();
      const next=()=>{
        const e=entries.shift();if(!e)return;
        const s=atob(e[1]),buf=new Uint8Array(s.length);for(let i=0;i<s.length;i++)buf[i]=s.charCodeAt(i);
        loader.parse(buf.buffer,'',gl=>{try{templates[e[0]]=prepare(gl);}catch(err){console.warn('Late character:',e[0],err);}setTimeout(next,30);},()=>setTimeout(next,30));
      };
      setTimeout(next,30);
    };
    document.head.appendChild(sc);
  };
  const lin=hex=>new THREE.Color(hex).convertSRGBToLinear();
  const SKIN=[[.80,.58,.42],[.62,.42,.24],[.72,.5,.33],[.5,.32,.19],[.36,.21,.11],[.24,.13,.07]].map(a=>new THREE.Color(a[0],a[1],a[2]));
  const HAIR=[[.015,.012,.01],[.05,.025,.01],[.12,.06,.025],[.32,.21,.07],[.28,.28,.28],[.2,.04,.02],[.02,.02,.025]].map(a=>new THREE.Color(a[0],a[1],a[2]));
  const CLOTH=[0x1f2a44,0x1a1a1c,0xe6e4dc,0x7a7d82,0xc8b48c,0x5a6a3a,0x6a1f28,0xb02a2a,0xc89a2a,0x2a6a6a,0x3a5a8a,0xd88aa0,0x6a4a30,0x9a8a5a,0x4a3a6a,0xd8d0c0].map(lin);
  const FORMAL=[0x1f2a44,0x1a1a1c,0x3a3c42,0x4a3a2a,0x2a3a4a,0x5a5c62].map(lin);
  const pickc=a=>a[(Math.random()*a.length)|0];
  function recolour(o,key){
    const formal=key==='suit'||key==='formal',skin=pickc(SKIN),hair=pickc(HAIR),used={};
    o.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.geometry.userData.groups)return;
      const src=mesh.geometry,geo=new THREE.BufferGeometry();
      for(const k of['position','normal','skinIndex','skinWeight'])geo.setAttribute(k,src.getAttribute(k));
      geo.setIndex(src.index);geo.userData=src.userData;geo.boundingSphere=src.boundingSphere;
      const col=src.getAttribute('color').clone();geo.setAttribute('color',col);mesh.geometry=geo;
      for(const g of src.userData.groups){
        const n=g.name;let c;
        if(/^Skin/.test(n)){c=skin.clone();if(/Darker/.test(n))c.multiplyScalar(.8);}
        else if(/Hair|Eyebrow|Moustache/.test(n)){c=hair.clone();if(/Eyebrow|Moustache/.test(n))c.multiplyScalar(.75);}
        else if(/Eye|LightBlue|Visor|Gold|Earring/.test(n))continue;
        else c=used[n]||(used[n]=pickc(formal&&!/White/.test(n)?FORMAL:CLOTH));
        for(let i=g.start;i<g.start+g.count;i++)col.setXYZ(i,c.r,c.g,c.b);
      }
    });
  }
  function create(key,role){
    const gl=templates[key]||templates[{suit:'man',formal:'man',worker:'man',gang:'swat'}[key]]||templates.man;if(!gl)return null;
    const o=cloneRig(gl.scene),g=new THREE.Group();g.add(o);
    const mixer=new THREE.AnimationMixer(o),actions={};
    for(const [alias,name] of Object.entries(aliases)){
      const clip=gl.animations.find(c=>c.name===name);if(clip)actions[alias]=mixer.clipAction(clip);
    }
    // Sample a neutral pose before measuring the character, not the exported pose.
    if(actions.idle){actions.idle.play();mixer.update(0);}
    o.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(o),size=box.getSize(new THREE.Vector3());
    const scale=1.78/Math.max(.01,size.y)*(role==='civilian'?.94+Math.random()*.12:1);o.scale.setScalar(scale);
    o.position.set(-(box.min.x+box.max.x)*scale/2,-box.min.y*scale,-(box.min.z+box.max.z)*scale/2);
    const find=n=>o.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
    const armR=find('UpperArm.R'),wrist=find('Wrist.R');
    const gun=new THREE.Group();
    const material=new THREE.MeshLambertMaterial({color:0x20242b});
    const barrel=new THREE.Mesh(new THREE.BoxGeometry(.065,.065,.26),material);barrel.position.z=.08;
    const grip=new THREE.Mesh(new THREE.BoxGeometry(.055,.11,.07),material);grip.position.set(0,-.07,-.015);
    gun.add(barrel,grip);gun.visible=false;
    if(wrist){gun.position.set(0,.07,.01);gun.rotation.x=Math.PI/2;wrist.add(gun);}else{o.add(gun);gun.position.set(-.3,1.1,.3);}
    // Derive the mounting rotation from this rig's authored aiming pose.
    // Bone-local axes differ from weapon-local +Z forward / +Y up.
    if(wrist&&actions['holding-right']){
      mixer.stopAllAction();actions['holding-right'].reset().play();mixer.setTime(0);o.updateMatrixWorld(true);
      gun.quaternion.copy(wrist.getWorldQuaternion(new THREE.Quaternion()).invert());
      mixer.stopAllAction();actions.idle.reset().play();mixer.update(0);
    }
    if(role==='civilian')recolour(o,key);
    if(role==='police')o.traverse(mesh=>{
      if(!mesh.isMesh)return;
      if(mesh.geometry.userData.policeColors){mesh.geometry=mesh.geometry.clone();mesh.geometry.setAttribute('color',new THREE.Float32BufferAttribute(mesh.geometry.userData.policeColors,3));return;}
      const tint=m=>{const mat=m.clone();if(/Swat/.test(mat.name))mat.color.set(/Black/.test(mat.name)?0x14223a:0x244c80);return mat;};
      mesh.material=Array.isArray(mesh.material)?mesh.material.map(tint):tint(mesh.material);
    });
    g.userData={pack:true,model:true,actorKey:key,role,visual:o,mixer,actions,cur:'idle',gun,
      legL:find('UpperLeg.L'),legR:find('UpperLeg.R'),armL:find('UpperArm.L'),armR,
      head:find('Head'),torso:find('Torso'),two:false,animClock:0,animTime:0};
    mixer.update(Math.random());return g;
  }
  function play(u,name,rate){
    const action=u.actions[name]||u.actions.idle;if(!action)return;
    if(u.cur!==name){
      const previous=u.actions[u.cur];action.reset().setEffectiveWeight(1).setEffectiveTimeScale(rate);
      if(name==='punch'){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}
      action.fadeIn(.15).play();if(previous&&previous!==action)previous.fadeOut(.15);u.cur=name;
    }
    action.timeScale=rate;
  }
  function animate(mesh,opt){
    const u=mesh.userData;u.animClock+=opt.dt;u.animTime+=opt.dt;
    let name='idle',rate=1;
    const amp=opt.amp;
    if(u.punching&&!opt.armed){name='punch';rate=u.actions.punch?u.actions.punch.getClip().duration/.42:1;}
    else if(amp>.55){name=opt.armed&&opt.aim?'run-aim':'sprint';rate=Math.max(.75,Math.min(1.8,opt.speed?opt.speed/5.2:.7+amp*.65));}
    else if(amp>.12){name=opt.armed&&opt.aim?'run-aim':'walk';rate=Math.max(.65,Math.min(1.4,.55+amp*1.7));}
    else if(opt.armed&&opt.aim)name=opt.now-(u.shootAt||-1000)<260?'holding-right-shoot':'holding-right';
    // Hands follow the authored skeleton; never overwrite bones with box-character rotations.
    u.gun.visible=!!opt.armed;
    const interval=u.role==='hero'?0:opt.distance>150?.4:opt.distance>65?.1:1/30;
    if(u.cur!==name||u.animClock>=interval){play(u,name,rate);u.mixer.update(u.animClock);u.animClock=0;}
  }
  window.CharacterActors={create,animate,templates,cloneRig};
})();

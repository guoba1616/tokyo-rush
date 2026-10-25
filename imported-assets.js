/* Free world assets; geometry is shared, static crowds/foliage are instanced. */
(function(){
  'use strict';
  const templates={},geometries={},units={},counts={},pending={},weaponGeometries={};
  const material=new THREE.MeshLambertMaterial({vertexColors:true});
  function ancestry(node){let s='';while(node){s+=' '+node.name;node=node.parent;}return s;}
  function flatten(root,predicate){
    root.updateMatrixWorld(true);
    const positions=[],normals=[],colors=[];
    root.traverse(mesh=>{
      if(!mesh.isMesh||predicate&&!predicate(mesh))return;
      const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry;
      const p=geo.getAttribute('position'),n=geo.getAttribute('normal'),c=geo.getAttribute('color');
      const normal=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),v=new THREE.Vector3(),nv=new THREE.Vector3();
      for(let i=0;i<p.count;i++){
        v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);positions.push(v.x,v.y,v.z);
        if(n)nv.fromBufferAttribute(n,i).applyMatrix3(normal).normalize();else nv.set(0,1,0);
        normals.push(nv.x,nv.y,nv.z);
        const mat=Array.isArray(mesh.material)?mesh.material[0]:mesh.material,mc=mat.color||new THREE.Color(1,1,1);
        colors.push((c?c.getX(i):1)*mc.r,(c?c.getY(i):1)*mc.g,(c?c.getZ(i):1)*mc.b);
      }
      if(geo!==mesh.geometry)geo.dispose();
    });
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeBoundingBox();return g;
  }
  function raw(key){if(!templates[key])return null;return geometries[key]||(geometries[key]=flatten(templates[key].scene));}
  function unit(key){
    if(units[key])return units[key];const original=raw(key);if(!original)return null;
    const g=original.clone(),b=g.boundingBox,size=b.getSize(new THREE.Vector3());
    g.translate(-(b.min.x+b.max.x)/2,-b.min.y,-(b.min.z+b.max.z)/2);g.scale(1/Math.max(.001,size.x),1/Math.max(.001,size.y),1/Math.max(.001,size.z));g.computeBoundingBox();units[key]=g;return g;
  }
  function record(key,n){counts[key]=(counts[key]||0)+n;}
  function fit(key,w,h,d){const geo=unit(key);if(!geo)return null;const m=new THREE.Mesh(geo,material);m.scale.set(w,h,d);m.castShadow=m.receiveShadow=true;record(key,1);return m;}
  // ---- chunked instancing with frustum culling + distance LOD (r149 never culls InstancedMesh) ----
  const chunkList=[],lodGeos={};
  function merged(parts){
    const P=[],N=[],C=[];
    for(const part of parts){
      const g=part.geo.index?part.geo.toNonIndexed():part.geo,p=g.attributes.position,n=g.attributes.normal;
      for(let i=0;i<p.count;i++){P.push(p.getX(i),p.getY(i),p.getZ(i));N.push(n.getX(i),n.getY(i),n.getZ(i));C.push(part.c[0],part.c[1],part.c[2]);}
    }
    const o=new THREE.BufferGeometry();o.setAttribute('position',new THREE.Float32BufferAttribute(P,3));o.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));o.setAttribute('color',new THREE.Float32BufferAttribute(C,3));return o;
  }
  function lodGeometry(key){
    if(key in lodGeos)return lodGeos[key];
    let g=null;
    if(/^tree/.test(key)){
      g=merged([{geo:new THREE.CylinderGeometry(.05,.08,.5,5).translate(0,.25,0),c:[.36,.25,.15]},{geo:new THREE.IcosahedronGeometry(.5,0).scale(1,.85,1).translate(0,.72,0),c:[.2,.42,.2]}]);
    }else if(key==='palm'){
      g=merged([{geo:new THREE.CylinderGeometry(.03,.06,.85,5).translate(0,.42,0),c:[.5,.38,.22]},{geo:new THREE.ConeGeometry(.5,.28,7).translate(0,.9,0),c:[.2,.5,.2]}]);
    }
    return lodGeos[key]=g;
  }
  function mk(geo,list){
    const mesh=new THREE.InstancedMesh(geo,material,list.length),o=new THREE.Object3D();
    list.forEach((p,i)=>{o.position.set(p.x,p.y||0,p.z);o.rotation.set(0,p.ry||0,0);o.scale.set(p.w,p.h,p.d);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});
    mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;return mesh;
  }
  function batch(scene,key,items){
    const geo=unit(key);if(!geo||!items.length)return null;
    const lod=lodGeometry(key),CH=180,groups=new Map();
    for(const p of items){const k=Math.floor(p.x/CH)+','+Math.floor(p.z/CH);let a=groups.get(k);if(!a){a=[];groups.set(k,a);}a.push(p);}
    let any=null;
    groups.forEach(list=>{
      let sx=0,sz=0;for(const p of list){sx+=p.x;sz+=p.z;}
      const cx=sx/list.length,cz=sz/list.length;let r=0;for(const p of list)r=Math.max(r,Math.hypot(p.x-cx,p.z-cz)+Math.max(p.w,p.h,p.d));
      const hi=mk(geo,list);scene.add(hi);
      let lo=null;if(lod){lo=mk(lod,list);scene.add(lo);}
      chunkList.push({cx,cz,r,hi,lo,lodDist:lod?150:1e9});any=hi;
    });
    record(key,items.length);return any;
  }
  const _fr=new THREE.Frustum(),_pm=new THREE.Matrix4(),_inv=new THREE.Matrix4(),_sp=new THREE.Sphere();
  function update(camera){
    camera.updateMatrixWorld();_inv.copy(camera.matrixWorld).invert();_pm.multiplyMatrices(camera.projectionMatrix,_inv);_fr.setFromProjectionMatrix(_pm);
    const cp=camera.position;
    for(const c of chunkList){
      _sp.center.set(c.cx,6,c.cz);_sp.radius=c.r+14;
      const vis=_fr.intersectsSphere(_sp),near=Math.hypot(c.cx-cp.x,c.cz-cp.z)-c.r<c.lodDist;
      const dd=Math.hypot(c.cx-cp.x,c.cz-cp.z)-c.r;c.hi.visible=vis&&near;c.hi.castShadow=dd<135;if(c.lo){c.lo.visible=vis&&!near;c.lo.castShadow=false;}
    }
  }
  function equip(actor,key){
    if(!actor.userData.pack||!raw(key)||actor.userData.weaponKey===key)return false;
    const gun=actor.userData.gun;if(!gun.userData.originalParts)gun.userData.originalParts=gun.children.slice();gun.clear();gun.scale.setScalar(1);
    const length={pistol:.32,smg:.5,shotgun:.95,rifle:.85}[key]||.4;
    let geo=weaponGeometries[key];if(!geo){geo=raw(key).clone();let b=geo.boundingBox,s=b.getSize(new THREE.Vector3());
    if(s.x>s.z){geo.rotateY(-Math.PI/2);geo.computeBoundingBox();b=geo.boundingBox;s=b.getSize(new THREE.Vector3());}
    const k=length/Math.max(.001,s.z);geo.translate(-(b.min.x+b.max.x)/2,-(b.min.y+b.max.y)/2,-b.min.z);geo.scale(k,k,k);geo.translate(0,0,-length*.15);weaponGeometries[key]=geo;}
    const visual=new THREE.Mesh(geo,material);visual.castShadow=true;gun.add(visual);actor.userData.weaponKey=key;record(key,1);return true;
  }
  function unequip(actor){const gun=actor.userData.gun;if(!gun.userData.originalParts)return;gun.clear();for(const m of gun.userData.originalParts)gun.add(m);actor.userData.weaponKey=null;}
  function forget(set){for(let i=chunkList.length-1;i>=0;i--){const c=chunkList[i];if(set.has(c.hi)||(c.lo&&set.has(c.lo)))chunkList.splice(i,1);}}
  function queue(key,p){if(!templates[key])return false;(pending[key]||(pending[key]=[])).push(p);return true;}
  function flush(scene){for(const key in pending){batch(scene,key,pending[key]);delete pending[key];}}
  function helicopter(key,length){
    const gl=templates[key];if(!gl)return null;
    const root=gl.scene,all=raw(key),bounds=all.boundingBox,center=bounds.getCenter(new THREE.Vector3()),k=length/(bounds.max.z-bounds.min.z);
    const g=new THREE.Group(),body=new THREE.Group();g.add(body);
    const isTail=m=>key==='helicopter'?/Propeller/i.test(ancestry(m))&&!/Propeller_2/i.test(ancestry(m)):/Tail_Rotor|Tail rotor/i.test(ancestry(m));
    const isMain=m=>key==='helicopter'?/Propeller_2/i.test(ancestry(m)):/Main_Rotor|Main rotor/i.test(ancestry(m));
    const transformed=predicate=>{const geo=flatten(root,predicate);geo.translate(-center.x,-bounds.min.y,-center.z);geo.scale(k,k,k);return geo;};
    const bm=material.clone(),shell=new THREE.Mesh(transformed(m=>!isMain(m)&&!isTail(m)),bm);shell.castShadow=true;body.add(shell);
    const rotorPart=predicate=>{
      const geo=transformed(predicate),box=geo.boundingBox||new THREE.Box3().setFromBufferAttribute(geo.attributes.position),p=box.getCenter(new THREE.Vector3());
      // Recalculate after transforming the geometry.
      geo.computeBoundingBox();geo.boundingBox.getCenter(p);geo.translate(-p.x,-p.y,-p.z);
      const pivot=new THREE.Group(),mesh=new THREE.Mesh(geo,material);pivot.position.copy(p);pivot.add(mesh);body.add(pivot);mesh.castShadow=true;return pivot;
    };
    const rotor=rotorPart(isMain),trot=rotorPart(isTail);
    record(key,1);return{g,body,rotor,trot,bm,height:(bounds.max.y-bounds.min.y)*k};
  }
  function busVehicle(T){
    const root=templates.bus&&templates.bus.scene;if(!root)return null;
    const box=raw('bus').boundingBox,size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    const transform=geo=>{geo.translate(-center.x,-box.min.y,-center.z);geo.scale(T.wid/size.x,T.hgt/size.y,T.len/size.z);geo.computeBoundingBox();return geo;};
    const isWheel=m=>/Wheels/i.test(ancestry(m));
    const bm=material.clone(),visual=new THREE.Group(),bodyMesh=new THREE.Mesh(transform(flatten(root,m=>!isWheel(m))),bm);bodyMesh.castShadow=true;visual.add(bodyMesh);
    const wheels=[];
    for(const front of [true,false]){
      const geo=transform(flatten(root,m=>isWheel(m)&&(/FrontWheels/i.test(ancestry(m)))===front));
      for(const side of [-1,1]){
        const attrs={position:[],normal:[],color:[]},p=geo.attributes.position;
        for(let i=0;i<p.count;i+=3){if(Math.sign((p.getX(i)+p.getX(i+1)+p.getX(i+2))/3)!==side)continue;
          for(const name of Object.keys(attrs)){const a=geo.attributes[name];for(let j=i;j<i+3;j++)attrs[name].push(a.getX(j),a.getY(j),a.getZ(j));}}
        const wheelGeo=new THREE.BufferGeometry();for(const name in attrs)wheelGeo.setAttribute(name,new THREE.Float32BufferAttribute(attrs[name],3));wheelGeo.computeBoundingBox();
        const center=wheelGeo.boundingBox.getCenter(new THREE.Vector3());wheelGeo.translate(-center.x,-center.y,-center.z);
        const pivot=new THREE.Group(),mesh=new THREE.Mesh(wheelGeo,material);pivot.position.copy(center);pivot.add(mesh);visual.add(pivot);mesh.castShadow=true;wheels.push({pivot,mesh,hub:mesh,front});
      }
    }
    record('bus',1);return{visual,wheels,bm,paintMeshes:[bodyMesh]};
  }
  window.loadWorldPack=function(done){
    const entries=Object.entries(window.WORLD_PACK||{});if(!entries.length){done();return;}
    const loader=new THREE.GLTFLoader();let left=entries.length;const finish=()=>{if(--left===0){window.WORLD_PACK=null;done();}};
    entries.forEach(([key,b64])=>{const s=atob(b64),buf=new Uint8Array(s.length);for(let i=0;i<s.length;i++)buf[i]=s.charCodeAt(i);loader.parse(buf.buffer,'',gl=>{if(['bus','helicopter','container','barrier','stop-sign'].includes(key))gl.scene.rotation.y+=Math.PI/2;templates[key]=gl;finish();},e=>{console.warn('World asset:',key,e);finish();});});
  };
  window.ImportedAssets={templates,counts,has:key=>!!templates[key],raw,unit,fit,batch,update,queue,flush,forget,equip,unequip,helicopter,busVehicle};
})();

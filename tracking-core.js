// Local reference tracking using normalized correlation, not a semantic watermark detector.
export function prepareTrackingFrame(rgba,width,height){
  const n=width*height,gray=new Float32Array(n),blur=new Float32Array(n),detail=new Float32Array(n);
  for(let i=0;i<n;i++){const p=i*4;gray[i]=.299*rgba[p]+.587*rgba[p+1]+.114*rgba[p+2];}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;let sum=0,weight=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
      const w=(dx===0?2:1)*(dy===0?2:1);sum+=gray[yy*width+xx]*w;weight+=w;
    }
    blur[i]=sum/weight;detail[i]=gray[i]-blur[i];
  }
  return{width,height,blur,detail};
}
function sampleSet(frame,box,nx,ny){
  const points=[],g=[],d=[];nx=Math.min(nx,box.width);ny=Math.min(ny,box.height);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const dx=Math.min(box.width-1,Math.floor((x+.5)*box.width/nx)),dy=Math.min(box.height-1,Math.floor((y+.5)*box.height/ny));
    const i=(box.y+dy)*frame.width+box.x+dx;points.push(dy*frame.width+dx);g.push(frame.blur[i]);d.push(frame.detail[i]);
  }
  const norm=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length,centered=Float32Array.from(values,v=>v-mean),energy=centered.reduce((a,b)=>a+b*b,0);return{centered,norm:Math.sqrt(energy),std:Math.sqrt(energy/values.length)};};
  return{offsets:Int32Array.from(points),gray:norm(g),detail:norm(d)};
}
export function createTrackingTemplate(frame,box){
  const roi={x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width),height:Math.round(box.height)};
  if(roi.width<8||roi.height<6||roi.x<0||roi.y<0||roi.x+roi.width>frame.width||roi.y+roi.height>frame.height)throw new Error('参考区域太小或超出画面，请框选一处清晰、完整的水印。');
  const coarse=sampleSet(frame,roi,9,7),fine=sampleSet(frame,roi,17,13);
  if(fine.gray.std<4||fine.detail.std<1.4)throw new Error('参考区域缺少清晰细节，请换到水印更清楚的一帧，并尽量框紧水印。');
  return{width:roi.width,height:roi.height,frameWidth:frame.width,frameHeight:frame.height,coarse,fine,reference:roi};
}
function correlation(values,base,samples,reference){
  let sum=0,square=0,dot=0;const n=samples.length;
  for(let k=0;k<n;k++){const v=values[base+samples[k]];sum+=v;square+=v*v;dot+=v*reference.centered[k];}
  const variance=square-sum*sum/n;if(variance<1e-6||reference.norm<1e-6)return -1;
  return Math.max(-1,Math.min(1,dot/(Math.sqrt(variance)*reference.norm)));
}
function scoreAt(frame,tpl,x,y,fine){
  const set=fine?tpl.fine:tpl.coarse,base=y*frame.width+x;
  const g=correlation(frame.blur,base,set.offsets,set.gray);
  if(!fine)return g;
  const d=correlation(frame.detail,base,set.offsets,set.detail);
  return .38*g+.62*d;
}
function overlap(a,b,w,h){const iw=Math.max(0,w-Math.abs(a.x-b.x)),ih=Math.max(0,h-Math.abs(a.y-b.y));return iw*ih/(2*w*h-iw*ih);}
function search(frame,tpl,region,global){
  const minX=Math.max(0,Math.floor(region.x)),minY=Math.max(0,Math.floor(region.y)),maxX=Math.min(frame.width-tpl.width,Math.ceil(region.x+region.width)),maxY=Math.min(frame.height-tpl.height,Math.ceil(region.y+region.height));
  const seeds=[],limit=global?28:8,step=2;
  const add=(x,y)=>{const score=scoreAt(frame,tpl,x,y,false);if(seeds.length>=limit&&score<=seeds[seeds.length-1].score)return;seeds.push({x,y,score});seeds.sort((a,b)=>b.score-a.score);if(seeds.length>limit)seeds.pop();};
  for(let y=minY;y<=maxY;y+=step)for(let x=minX;x<=maxX;x+=step)add(x,y);
  // Include opposite boundaries even when stride parity differs.
  if((maxX-minX)%step)for(let y=minY;y<=maxY;y+=step)add(maxX,y);
  if((maxY-minY)%step)for(let x=minX;x<=maxX;x+=step)add(x,maxY);
  const candidates=[],seen=new Set();
  for(const seed of seeds)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const x=seed.x+dx,y=seed.y+dy;if(x<0||y<0||x>frame.width-tpl.width||y>frame.height-tpl.height)continue;
    const key=y*frame.width+x;if(seen.has(key))continue;seen.add(key);candidates.push({x,y,score:scoreAt(frame,tpl,x,y,true)});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0]||{x:0,y:0,score:-1},second=candidates.find(c=>overlap(best,c,tpl.width,tpl.height)<.2);
  return{...best,width:tpl.width,height:tpl.height,secondScore:second?.score??-1,margin:best.score-(second?.score??-1)};
}
export function findWatermark(frame,tpl,{previous=null,forceGlobal=true,threshold=.72}={}){
  if(frame.width!==tpl.frameWidth||frame.height!==tpl.frameHeight)throw new Error('跟踪画面尺寸发生变化，请重新分析。');
  let result=null,global=forceGlobal||!previous;
  if(!global){
    result=search(frame,tpl,{x:previous.x-16,y:previous.y-16,width:32,height:32},false);
    if(result.score<Math.max(.84,threshold+.06)||result.margin<.055)global=true;
  }
  if(global)result=search(frame,tpl,{x:0,y:0,width:frame.width-tpl.width,height:frame.height-tpl.height},true);
  const accepted=result.score>=threshold&&result.margin>=.055;
  return{...result,score:Math.max(0,result.score),accepted,global,reason:accepted?'matched':result.score<threshold?'lost':'ambiguous'};
}
export function summarizeTracking(records,duration,interval=.25){
  let matched=0,jumps=0,last=null;const issues=[];
  for(const r of records){
    if(r.accepted){matched++;if(last&&r.time-last.time<=interval*1.6&&Math.hypot(r.x-last.x,r.y-last.y)>Math.max(r.width,r.height)*1.6)jumps++;last=r;}
    else{const end=Math.min(duration,r.time+interval),prev=issues.at(-1);if(prev&&r.time<=prev.end+.02){prev.end=end;prev.samples++;}else issues.push({start:r.time,end,samples:1});last=null;}
  }
  return{total:records.length,matched,uncertain:records.length-matched,jumps,issues};
}
export function trackingPreviewAt(records,time){
  if(!records.length)return null;
  let low=0,high=records.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(records[mid].time<=time)low=mid;else high=mid-1;}
  const a=records[low],b=records[low+1];
  if(!b||!a.accepted||!b.accepted||Math.hypot(a.x-b.x,a.y-b.y)>Math.max(a.width,a.height))return b&&time-a.time>b.time-time?b:a;
  const u=Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time||1)));
  return{...a,x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,score:Math.min(a.score,b.score)};
}

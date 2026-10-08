import {prepareTrackingFrame,createTrackingTemplate,findWatermark,summarizeTracking,trackingPreviewAt} from './tracking-core.js';
import {makePlan,smoothRepair} from './repair-core.js';
const $=id=>document.getElementById(id);
const seconds=t=>Number(t).toFixed(2)+' 秒';
export function createAutoTracking(hooks){
  const sampleCanvas=document.createElement('canvas'),sampleCtx=sampleCanvas.getContext('2d',{willReadFrequently:true});
  const overlayCtx=hooks.overlayCanvas.getContext('2d');
  let template=null,records=[],stats=null,referenceTime=0,threshold=.72,worker=null,pending=null,run=null,aw=0,ah=0,previewKey='',exportStats=null;
  function summary(){return stats?{...stats,issues:stats.issues.map(x=>({...x})),export:exportStats}:null;}
  function stopWorker(message='已取消分析，原视频没有改变。'){
    if(worker)worker.terminate();worker=null;
    if(pending){const p=pending;pending=null;clearTimeout(p.timer);p.reject(new Error(message));}
  }
  function reset(){
    if(run)run.cancelled=true;stopWorker();template=null;records=[];stats=null;exportStats=null;previewKey='';
    $('tracking-reference').hidden=true;$('tracking-results').hidden=true;$('tracking-export-note').hidden=true;
    overlayCtx.clearRect(0,0,hooks.overlayCanvas.width,hooks.overlayCanvas.height);
  }
  function sync(){
    const state=hooks.getState(),off=state.busy||state.loading||!state.video;
    $('auto-tracking').hidden=state.videoTiming!=='auto';
    $('analyze-tracking').disabled=off||(!state.count&&!template);
    $('track-threshold').disabled=off;
    $('analyze-tracking').querySelector('span').textContent=stats?'重新分析整段视频':'自动分析整段视频';
    document.querySelectorAll('.tracking-jumps button,.tracking-issue-list button').forEach(b=>b.disabled=off);
  }
  function boundsOfMask(){
    const {width,height}=hooks.getState(),data=hooks.maskCanvas.getContext('2d').getImageData(0,0,width,height).data;
    let x=width,y=height,right=-1,bottom=-1;
    for(let i=0;i<width*height;i++)if(data[i*4+3]>20){const xx=i%width,yy=(i/width)|0;x=Math.min(x,xx);y=Math.min(y,yy);right=Math.max(right,xx);bottom=Math.max(bottom,yy);}
    if(right<0)throw new Error('请先紧贴一处水印框选一次，作为追踪参考。');
    const box={x,y,width:right-x+1,height:bottom-y+1};
    if(box.width*box.height>width*height*.12)throw new Error('参考框太大，请只圈住一处水印，控制在画面 12% 以内。');
    return box;
  }
  function takeReference(){
    const state=hooks.getState(),box=boundsOfMask(),scale=Math.min(1,480/Math.max(state.width,state.height));
    aw=Math.max(1,Math.round(state.width*scale));ah=Math.max(1,Math.round(state.height*scale));sampleCanvas.width=aw;sampleCanvas.height=ah;
    sampleCtx.drawImage(state.video,0,0,aw,ah);
    const x=Math.max(0,Math.floor(box.x*aw/state.width)),y=Math.max(0,Math.floor(box.y*ah/state.height));
    const roi={x,y,width:Math.min(aw-x,Math.ceil(box.width*aw/state.width)),height:Math.min(ah-y,Math.ceil(box.height*ah/state.height))};
    const next=createTrackingTemplate(prepareTrackingFrame(sampleCtx.getImageData(0,0,aw,ah).data,aw,ah),roi);
    template=next;referenceTime=state.video.currentTime;threshold=Number($('track-threshold').value);
    const preview=$('reference-preview');preview.width=box.width;preview.height=box.height;
    const sx=state.video.videoWidth/state.width,sy=state.video.videoHeight/state.height;
    preview.getContext('2d').drawImage(state.video,box.x*sx,box.y*sy,box.width*sx,box.height*sy,0,0,box.width,box.height);
    $('tracking-reference').hidden=false;$('reference-caption').textContent=`${seconds(referenceTime)} · ${box.width} × ${box.height}`;
  }
  function startWorker(){
    worker=new Worker('/tracking-worker.js',{type:'module'});
    worker.onmessage=({data})=>{if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data);};
    worker.onerror=()=>stopWorker('分析程序中断，请重试或选择更短的视频。');
  }
  function askWorker(data,transfer=[]){return new Promise((resolve,reject)=>{
    if(!worker)return reject(new Error('分析已停止。'));
    const timer=setTimeout(()=>stopWorker('单帧分析超时，请缩小参考水印或重试。'),20000);pending={resolve,reject,timer};
    try{worker.postMessage(data,transfer);}catch(e){clearTimeout(timer);pending=null;reject(e);}
  });}
  async function jumpTo(time){
    const state=hooks.getState();if(state.busy||!state.video)return;
    hooks.stopPreview();hooks.setView(false);
    try{await hooks.seekTo(state.video,Math.min(time,state.video.duration));hooks.render();hooks.updateTime();}catch(e){hooks.toast(e.message);}
  }
  function renderResults(){
    if(!stats){$('tracking-results').hidden=true;return;}
    $('tracking-results').hidden=false;
    $('tracking-summary').textContent=`抽样匹配 ${stats.matched} / ${stats.total} · 检出 ${stats.jumps} 次换位`;
    const strip=$('tracking-strip');strip.replaceChildren();strip.setAttribute('aria-label',`${stats.matched} 个采样画面匹配，${stats.uncertain} 个未可靠匹配`);
    for(const record of records){const mark=document.createElement('span');mark.className=record.accepted?'':'uncertain';mark.title=`${seconds(record.time)} · 相似度 ${record.score.toFixed(2)} · ${record.accepted?'已匹配':'待检查'}`;strip.append(mark);}
    const jumps=$('tracking-jumps');jumps.replaceChildren();let previous=null,jumpCount=0;
    for(const record of records){
      if(record.accepted&&previous&&record.time-previous.time<.4&&Math.hypot(record.x-previous.x,record.y-previous.y)>Math.max(record.width,record.height)*1.6){
        if(jumpCount++<16){const button=document.createElement('button');button.textContent=`${seconds(record.time)} 查看换位`;button.addEventListener('click',()=>jumpTo(record.time));jumps.append(button);}
      }
      previous=record.accepted?record:null;
    }
    const list=$('tracking-issue-list');list.replaceChildren();$('tracking-issues').hidden=stats.issues.length===0;
    $('tracking-issues-title').textContent=`${stats.issues.length} 段未可靠匹配，点击检查`;
    for(const issue of stats.issues){const button=document.createElement('button');button.textContent=`${issue.start.toFixed(2)}–${issue.end.toFixed(2)} 秒`;button.addEventListener('click',()=>jumpTo(issue.start));list.append(button);}
    if(stats.matched===0){$('tracking-issues').open=true;hooks.toast('没有可靠匹配。请换一帧重新框选清晰水印，或使用手动分段。');}
  }
  async function analyze(){
    const state=hooks.getState();if(state.busy||state.loading||!state.video||state.videoTiming!=='auto')return;
    hooks.stopPreview();hooks.setView(false);
    try{if(state.count)takeReference();if(!template)throw new Error('请先框选一次水印。');}
    catch(e){hooks.toast(e.message);return;}
    const token={cancelled:false};run=token;const v=state.video,oldTime=v.currentTime;
    records=[];stats=null;exportStats=null;previewKey='';$('tracking-results').hidden=true;$('tracking-export-note').hidden=true;hooks.invalidateResult();
    hooks.setBusy(true,'正在自动分析水印…','正在全画面搜索同一图案，查找移动、换位和未可靠匹配的片段。');
    const onVisibility=()=>{if(document.hidden&&run===token){token.cancelled=true;stopWorker('页面进入后台，分析已停止。回到本页后可重新分析。');}};
    document.addEventListener('visibilitychange',onVisibility);
    try{
      startWorker();await askWorker({type:'init',template});
      const times=[];for(let t=0;t<v.duration;t+=.25)times.push(t);
      const last=Math.max(0,v.duration-.015);if(last>times.at(-1)+.02)times.push(last);
      const found=[];
      for(let i=0;i<times.length;i++){
        if(token.cancelled)throw new Error('已取消分析，原视频没有改变。');
        await hooks.seekTo(v,times[i]);if(token.cancelled)throw new Error('已取消分析，原视频没有改变。');
        sampleCtx.drawImage(v,0,0,aw,ah);const pixels=sampleCtx.getImageData(0,0,aw,ah).data;
        const data=await askWorker({type:'frame',pixels:pixels.buffer,width:aw,height:ah,threshold},[pixels.buffer]);
        found.push({time:times[i],...data.result});hooks.setProgress((i+1)/times.length*100);
        $('busy-text').textContent=`已分析 ${i+1} / ${times.length} 个采样画面 · 当前 ${seconds(times[i])}`;
      }
      if(token.cancelled)throw new Error('已取消分析。');
      records=found;stats=summarizeTracking(records,v.duration);hooks.clearSelection();renderResults();
      if(stats.matched)hooks.toast(`分析完成：${stats.matched}/${stats.total} 个采样画面匹配，${stats.issues.length} 段待检查。`);
    }catch(e){records=[];stats=null;renderResults();hooks.toast(e.message||'自动分析失败，请重试。');}
    finally{
      stopWorker();document.removeEventListener('visibilitychange',onVisibility);
      await hooks.seekTo(v,Math.min(oldTime,v.duration)).catch(()=>{});
      if(run===token)run=null;hooks.setBusy(false);previewKey='';hooks.render();hooks.updateTime();hooks.sync();
    }
  }
  function paintPreview(){
    const state=hooks.getState();if(state.busy)return;
    const record=trackingPreviewAt(records,state.video?.currentTime||0),key=record?[record.x,record.y,record.accepted,record.score].join(':'):'none';
    if(previewKey===key)return;previewKey=key;
    overlayCtx.clearRect(0,0,state.width,state.height);
    if(!record){$('tracking-live').textContent='';return;}
    $('tracking-live').textContent=record.accepted?`抽样预览 · 相似度 ${record.score.toFixed(2)}`:'该处未可靠匹配 · 导出时会重新核对';
    if(record.score<.5)return;
    const sx=state.width/aw,sy=state.height/ah;overlayCtx.save();
    overlayCtx.strokeStyle=record.accepted?'#a5d5ff':'#ffcb75';overlayCtx.fillStyle=record.accepted?'#8bbff044':'#f0be5f22';
    overlayCtx.lineWidth=Math.max(2,state.width/300);if(!record.accepted)overlayCtx.setLineDash([9,7]);
    overlayCtx.fillRect(record.x*sx,record.y*sy,record.width*sx,record.height*sy);overlayCtx.strokeRect(record.x*sx,record.y*sy,record.width*sx,record.height*sy);overlayCtx.restore();
  }
  function createRenderer(){
    if(!template||!stats?.matched)throw new Error('请先自动分析，并确认有可靠匹配结果。');
    const state=hooks.getState(),width=state.width,height=state.height,sx=width/aw,sy=height/ah;
    const sourceCanvas=document.createElement('canvas');sourceCanvas.width=aw;sourceCanvas.height=ah;
    const context=sourceCanvas.getContext('2d',{willReadFrequently:true}),planCache=new Map();
    let total=0,matched=0,skipped=0;const gaps=[];
    return{
      apply(output,time,video){
        context.drawImage(video,0,0,aw,ah);
        const frame=prepareTrackingFrame(context.getImageData(0,0,aw,ah).data,aw,ah);
        // Re-search the whole frame, so an abrupt jump does not inherit a stale position.
        const result=findWatermark(frame,template,{threshold,forceGlobal:true});total++;
        if(!result.accepted){skipped++;const last=gaps.at(-1);if(last&&time-last.end<.12)last.end=time;else gaps.push({start:time,end:time});return;}
        matched++;
        const x=Math.max(0,Math.floor(result.x*sx)-2),y=Math.max(0,Math.floor(result.y*sy)-2);
        const right=Math.min(width,Math.ceil((result.x+result.width)*sx)+2),bottom=Math.min(height,Math.ceil((result.y+result.height)*sy)+2);
        const px=Math.max(0,x-7),py=Math.max(0,y-7),pr=Math.min(width,right+7),pb=Math.min(height,bottom+7),pw=pr-px,ph=pb-py;
        const key=[pw,ph,x-px,y-py,right-px,bottom-py].join(',');let plan=planCache.get(key);
        if(!plan){const mask=new Uint8Array(pw*ph);for(let yy=y-py;yy<bottom-py;yy++)for(let xx=x-px;xx<right-px;xx++)mask[yy*pw+xx]=1;plan=makePlan(mask,pw,ph);if(planCache.size>=12)planCache.delete(planCache.keys().next().value);planCache.set(key,plan);}
        const patch=output.getImageData(px,py,pw,ph);smoothRepair(patch.data,plan,5);output.putImageData(patch,px,py);
      },
      finish(){
        exportStats={checkedFrames:total,matchedFrames:matched,skippedFrames:skipped,gaps};
        if(!matched)throw new Error('导出时没有可靠匹配到水印，未生成修复结果。请重新选择参考水印。');
        const note=$('tracking-export-note');note.hidden=false;note.classList.toggle('warning',skipped>0);
        note.textContent=skipped?`导出检查：${total} 个已处理画面中，${skipped} 个未可靠匹配，已保留原画面。请检查成片中的剩余水印。`:`导出检查：${matched} 个已处理画面均匹配到参考图案。请播放成片检查修复效果。`;
        return exportStats;
      }
    };
  }
  $('analyze-tracking').addEventListener('click',analyze);
  $('track-threshold').addEventListener('change',()=>{
    if(hooks.getState().busy)return;threshold=Number($('track-threshold').value);records=[];stats=null;previewKey='';$('tracking-results').hidden=true;$('tracking-export-note').hidden=true;hooks.invalidateResult();hooks.sync();hooks.render();
  });
  $('cancel').addEventListener('click',()=>{if(run){run.cancelled=true;stopWorker();}});
  return{reset,sync,summary,paintPreview,createRenderer,analyze,get ready(){return Boolean(stats?.matched)},invalidatePreview(){previewKey='';}};
}

import { makePlan, smoothRepair } from './repair-core.js';
import { createPhotoStudio } from './photo-studio.js';
import { createAutoTracking } from './auto-tracking.js';
import { validateTimeRange, activeSegmentsAt, compileVideoTimeline, timelinePlanAt } from './video-timeline.js';
const $ = id => document.getElementById(id);
const canvas = $('display'), maskCanvas = $('mask'), ctx = canvas.getContext('2d', {willReadFrequently:true}), mctx = maskCanvas.getContext('2d', {willReadFrequently:true});
const original = document.createElement('canvas'), working = document.createElement('canvas');
const scheduleCanvas=$('schedule-mask'),scheduleCtx=scheduleCanvas.getContext('2d'),segmentScratch=document.createElement('canvas'),segmentCtx=segmentScratch.getContext('2d',{willReadFrequently:true});
const state = {mode:'image',tool:'brush',size:32,file:null,video:null,url:null,resultUrl:null,resultBlob:null,strokes:[],stroke:null,drawing:false,result:false,compare:false,busy:false,loading:false,count:0,width:0,height:0,worker:null,cancelVideo:null,audio:null,audioSource:null,playing:false,videoTiming:'auto',segments:[],segmentNext:1,editingSegment:null,schedulePaintKey:'',segmentsRevision:0};
const tracking=createAutoTracking({getState:()=>state,maskCanvas,overlayCanvas:scheduleCanvas,setBusy,setProgress,sync,toast,seekTo,stopPreview,setView,render,updateTime,invalidateResult:invalidateVideoResult,clearSelection});
const photo=createPhotoStudio({getState:()=>state,working,original,maskCanvas,overlayCanvas:scheduleCanvas,render,sync,setView,setBusy,setProgress,toast,clearSelection,resizeDocument});
let toastTimer, previewFrame, loadId = 0;
function resizeDocument(width,height){state.width=width;state.height=height;for(const c of [canvas,maskCanvas,working,scheduleCanvas,segmentScratch]){c.width=width;c.height=height;}$('resolution').textContent=`${width} × ${height}`;}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
function formatTime(s) { if (!Number.isFinite(s)) return '0:00'; return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0'); }
function preciseTime(s){return formatTime(s)+'.'+String(Math.floor((s%1)*100+1e-6)).padStart(2,'0');}
function setProgress(n) { $('progress').value = n; $('progress-label').textContent = Math.round(n)+'%'; }
function setBusy(value,title='',description='') {
  state.busy = value; $('busy').hidden = !value;
  if (value) { $('busy-title').textContent=title; $('busy-text').textContent=description; setProgress(0); }
  document.querySelectorAll('.mode,[data-tool],#brush-size,#methods input,#format,#open-top,#open-center,#play,#seek,#edit-view,#compare-view,#help').forEach(el => el.disabled=value);
  sync();
}
function sync() {
  const off = state.busy || state.loading;
  const timed=state.mode==='video'&&state.videoTiming==='segments';
  const automatic=state.mode==='video'&&state.videoTiming==='auto';
  const hasWork=automatic?tracking.ready:timed?state.segments.length>0&&state.count===0:state.count>0;
  $('process').disabled = !state.file || !hasWork || off;
  $('download').disabled = !state.result || off;
  $('reset').disabled = !state.file || off;
  $('undo').disabled = !state.strokes.length || off;
  $('clear').disabled = !state.count || off;
  $('selection-summary').textContent = state.count ? `已标记 ${(100*state.count/(state.width*state.height)).toFixed(1)}% 的画面` : '还没有标记区域';
  $('view-toggle').hidden = !state.result;
  if(timed)$('selection-summary').textContent=state.count?'请先保存当前选区的生效时段':state.segments.length?`已保存 ${state.segments.length} 个时段，可以开始修复`:'请标记水印并保存生效时段';
  if(automatic)$('selection-summary').textContent=tracking.ready?'分析完成，可按跟踪位置修复':state.count?'已选择参考区域，请自动分析整段视频':'先框选一处清晰的水印作为参考';
  $('process').querySelector('span').textContent=automatic?'追踪修复并导出':'开始修复';
  syncVideoControls();
  photo.sync();
}
function setMode(mode) {
  if (!['image','video'].includes(mode)) throw new Error('素材类型无效。');
  if (state.busy || state.loading) return;
  if (state.mode === mode) return;
  clearMedia(); state.mode=mode;
  document.querySelectorAll('.mode').forEach(b => {const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('page-title').innerHTML = (mode==='image'?'照片工作台':'视频去水印')+'<span class="version">本地处理</span>';
  $('page-subtitle').textContent = mode==='image'?'修复、调色、抠图合成，让照片多一点可能。':'框选一次水印，自动分析位置变化，再追踪修复。';
  $('drop-title').textContent = mode==='image'?'将照片拖到这里':'将视频拖到这里';
  $('empty').querySelector('.upload-illustration use').setAttribute('href', mode==='image'?'#i-image':'#i-video');
  ['open-top','open-center'].forEach(id => $(id).querySelector('span').textContent=mode==='image'?'选择照片':'选择视频');
  $('format-note').textContent=mode==='image'?'JPG、PNG、WebP · 最大 25 MB':'MP4、WebM、MOV · 最大 200 MB · 2 分钟以内';
  $('file-input').multiple=mode==='image';
  $('file-input').accept=mode==='image'?'image/jpeg,image/png,image/webp':'video/mp4,video/webm,video/quicktime,.mov';
  $('methods').hidden=mode==='video'; $('video-note').hidden=mode!=='video';
  $('selection-tip').textContent=mode==='image'?'将水印或杂物完整涂满，边缘稍微多涂一点。':'暂停到水印清晰的一帧，框选水印所在位置。';
  $('format').innerHTML=mode==='image'?'<option value="image/png">PNG · 无损</option><option value="image/jpeg">JPG · 更小文件</option><option value="image/webp">WebP</option>':'<option value="auto">MP4 / WebM · 自动</option>';
  $('compare-view').textContent=mode==='image'?'前后对比':'查看结果';
  $('edit-view').textContent=mode==='image'?'编辑':'原视频';
  $('canvas-hint').textContent=mode==='image'?'先选择照片，再涂抹需要擦除的区域':'先选择视频，再框选一处清晰水印作为追踪参考';
  const tips=$('empty').querySelector('.empty-tips');
  const texts=mode==='image'?['去除局部水印','擦除多余杂物','保留原始文件']:['自动追踪换位','保留视频音轨','保留原始文件'];
  tips.querySelectorAll('span').forEach((span,i)=>{span.lastChild.textContent=texts[i];});
  chooseTool(mode==='image'?'brush':'rect');sync();
}
function clearMedia() {
  photo.clear();
  tracking.reset();
  stopPreview(); if(state.worker)state.worker.terminate();state.worker=null;
  if(state.video){state.video.pause();state.video.removeAttribute('src');state.video.load();}
  if(state.audio)state.audio.close().catch(()=>{});
  if(state.url)URL.revokeObjectURL(state.url);
  if(state.resultUrl)URL.revokeObjectURL(state.resultUrl);
  Object.assign(state,{file:null,video:null,url:null,resultUrl:null,resultBlob:null,result:false,compare:false,strokes:[],stroke:null,count:0,audio:null,audioSource:null,videoTiming:'auto',segments:[],segmentNext:1,editingSegment:null,schedulePaintKey:'',segmentsRevision:0});
  $('result-video').pause();$('result-video').removeAttribute('src');$('result-video').hidden=true;
  $('canvas-wrap').hidden=true;maskCanvas.hidden=false;state.drawing=false;$('cursor').style.display='none';$('edit-view').classList.add('active');$('compare-view').classList.remove('active');$('empty').hidden=false;$('drop-zone').classList.remove('loaded');
  $('timeline').hidden=true;$('compare-control').hidden=true;$('compare-tags').hidden=true;$('compare-line').hidden=true;
  $('file-title').textContent='编辑画布';$('file-meta').textContent='尚未选择文件';$('resolution').textContent='—';
  canvas.width=maskCanvas.width=original.width=working.width=1;canvas.height=maskCanvas.height=original.height=working.height=1;
  scheduleCanvas.width=segmentScratch.width=scheduleCanvas.height=segmentScratch.height=1;renderSegmentList();
  sync();
}
function waitEvent(target,event,action,timeout=25000) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('文件读取超时，请尝试更小的文件。')),timeout);
    const good=()=>finish(), bad=()=>finish(new Error('无法读取这个文件，请换用兼容的格式。'));
    function finish(error){clearTimeout(timer);target.removeEventListener(event,good);target.removeEventListener('error',bad);error?reject(error):resolve();}
    target.addEventListener(event,good,{once:true});target.addEventListener('error',bad,{once:true});try{action();}catch(e){finish(e);}
  });
}
async function loadFile(file) {
  if (!file || state.busy || state.loading) return;
  const video=/\.(mp4|webm|mov)$/i.test(file.name)||file.type.startsWith('video/');
  const photo=/\.(jpe?g|png|webp)$/i.test(file.name)||['image/jpeg','image/png','image/webp'].includes(file.type);
  if (!video && !photo) return toast('请选择 JPG、PNG、WebP 照片，或 MP4、WebM、MOV 视频。');
  if(file.size>(video?200:25)*1024*1024)return toast(video?'视频不能超过 200 MB。':'照片不能超过 25 MB。');
  setMode(video?'video':'image');
  state.loading=true;sync();const job=++loadId,url=URL.createObjectURL(file);let retained=false;
  $('file-meta').textContent='正在读取…';
  try {
    let media,sw,sh;
    if(video){
      media=document.createElement('video');media.preload='auto';media.playsInline=true;media.muted=true;
      await waitEvent(media,'loadeddata',()=>{media.src=url;media.load();});
      if(!Number.isFinite(media.duration)||media.duration<=0||media.duration>120.1)throw new Error('请选择时长不超过 2 分钟的视频。');
      sw=media.videoWidth;sh=media.videoHeight;
    }else{
      media=new Image();await waitEvent(media,'load',()=>media.src=url);sw=media.naturalWidth;sh=media.naturalHeight;
      if(sw*sh>30000000)throw new Error('照片超过 3000 万像素，请先缩小尺寸。');
    }
    if(job!==loadId)return;
    if(!sw||!sh)throw new Error('无法识别文件尺寸。');
    clearMedia();const scale=Math.min(1,(video?1280:2400)/Math.max(sw,sh));
    state.width=Math.max(1,Math.round(sw*scale));state.height=Math.max(1,Math.round(sh*scale));state.file=file;state.url=url;retained=true;
    for(const c of [canvas,maskCanvas,original,working,scheduleCanvas,segmentScratch]){c.width=state.width;c.height=state.height;}
    original.getContext('2d').drawImage(media,0,0,state.width,state.height);working.getContext('2d').drawImage(original,0,0);
    if(video){state.video=media;media.addEventListener('ended',stopPreview);media.addEventListener('timeupdate',updateTime);$('seek').max=String(media.duration);$('seek').value='0';$('timeline').hidden=false;$('segment-start').value='0';$('segment-end').value=media.duration.toFixed(3);$('segment-start').max=$('segment-end').max=String(media.duration);updateTime();renderSegmentList();}
    $('empty').hidden=true;$('canvas-wrap').hidden=false;$('drop-zone').classList.add('loaded');
    $('file-title').textContent=file.name;$('file-title').title=file.name;$('file-meta').textContent=(file.size/1024/1024).toFixed(1)+' MB';
    $('resolution').textContent=`${state.width} × ${state.height}${scale<1?' · 已适配':''}`;
    $('canvas-hint').textContent=video?'原视频静音预览 · 蓝色为已保存标记，绿色为当前草稿':'用画笔涂抹，或使用框选工具标记区域';
    if(!video)photo.init(working,file.name);
    state.compare=false;render();
    if(scale<1)toast(`已将处理尺寸适配为 ${state.width} × ${state.height}，原文件保持不变。`);
    return true;
  }catch(e){$('file-meta').textContent=state.file?(state.file.size/1024/1024).toFixed(1)+' MB':'尚未选择文件';toast(e.message);}
  finally{if(!retained)URL.revokeObjectURL(url);state.loading=false;sync();}
}
async function openFiles(files,addToCanvas=false){
  const list=[...files];if(!list.length||state.busy||state.loading)return;
  const allPhotos=list.every(f=>['image/jpeg','image/png','image/webp'].includes(f.type)||/\.(jpe?g|png|webp)$/i.test(f.name));
  if(addToCanvas&&state.mode==='image'&&state.file&&allPhotos){await photo.addPhotos(list);return;}
  const loaded=await loadFile(list[0]);
  if(loaded&&list.length>1){if(state.mode==='image'&&allPhotos)await photo.addPhotos(list.slice(1),{arrange:true});else toast('视频一次处理一个文件，已读取第一个。');}
}
function render() {
  if(!state.file)return;
  const w=state.width,h=state.height;ctx.clearRect(0,0,w,h);
  if(state.mode==='video'){ctx.drawImage(state.video,0,0,w,h);paintScheduled();return;}
  ctx.drawImage(working,0,0);photo.drawOverlay();
  if(state.compare&&state.result){const split=w*Number($('compare-slider').value)/100;ctx.save();ctx.beginPath();ctx.rect(0,0,split,h);ctx.clip();ctx.clearRect(0,0,w,h);ctx.drawImage(original,0,0);ctx.restore();$('compare-line').style.left=$('compare-slider').value+'%';}
}
function setView(compare) {
  if(state.busy||!state.file)return;
  state.compare=Boolean(compare&&state.result&&(state.mode==='video'||photo.canCompare()));
  $('edit-view').classList.toggle('active',!state.compare);$('compare-view').classList.toggle('active',state.compare);
  const imageCompare=state.mode==='image'&&state.compare;
  $('compare-control').hidden=!imageCompare;$('compare-tags').hidden=!imageCompare;$('compare-line').hidden=!imageCompare;
  maskCanvas.hidden=state.compare;$('cursor').style.display='none';
  if(state.mode==='video'){
    stopPreview();$('canvas-wrap').hidden=state.compare;$('result-video').hidden=!state.compare;$('timeline').hidden=state.compare;
    if(state.compare){$('result-video').src=state.resultUrl;}else{$('result-video').pause();}
  }
  render();syncVideoControls();photo.sync();
}
function chooseTool(tool) {
  if(!['brush','rect','erase'].includes(tool))throw new Error('选区工具无效。');
  state.tool=tool;document.querySelectorAll('[data-tool]').forEach(b=>{const active=b.dataset.tool===tool;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('brush-size').disabled=state.busy||tool==='rect';
}
function point(e){const r=maskCanvas.getBoundingClientRect();return {x:Math.max(0,Math.min(state.width,(e.clientX-r.left)*state.width/r.width)),y:Math.max(0,Math.min(state.height,(e.clientY-r.top)*state.height/r.height))};}
function paint(stroke,target=mctx) {
  target.save();target.globalCompositeOperation=stroke.tool==='erase'?'destination-out':'source-over';target.strokeStyle=target.fillStyle='#c7f59b';target.lineWidth=stroke.size;target.lineCap=target.lineJoin='round';
  if(stroke.tool==='rect'){const a=stroke.points[0],b=stroke.points[stroke.points.length-1];target.fillRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y));}
  else{target.beginPath();stroke.points.forEach((p,i)=>i?target.lineTo(p.x,p.y):target.moveTo(p.x,p.y));target.stroke();for(const p of [stroke.points[0],stroke.points[stroke.points.length-1]]){target.beginPath();target.arc(p.x,p.y,stroke.size/2,0,Math.PI*2);target.fill();}}
  target.restore();
}
function repaintMask(){mctx.clearRect(0,0,state.width,state.height);state.strokes.forEach(stroke=>paint(stroke));if(state.stroke)paint(state.stroke);}
function readMask(){const data=mctx.getImageData(0,0,state.width,state.height).data,result=new Uint8Array(state.width*state.height);let count=0;for(let i=0;i<result.length;i++){if(data[i*4+3]>20){result[i]=1;count++;}}state.count=count;return result;}
function selectionChanged(){readMask();if(state.mode==='video'){if(state.videoTiming==='auto')tracking.reset();invalidateVideoResult();}sync();}
function clearSelection(){state.strokes=[];state.stroke=null;mctx.clearRect(0,0,state.width,state.height);state.count=0;sync();}
function undo(){if(state.busy||!state.strokes.length)return;state.strokes.pop();repaintMask();selectionChanged();}
maskCanvas.addEventListener('pointerdown',e=>{
  if(!state.file||state.busy||state.compare||state.drawing||e.button>0)return;e.preventDefault();stopPreview();
  if(state.mode==='image'&&photo.pointerDown(e,point(e)))return;
  state.drawing=true;maskCanvas.setPointerCapture(e.pointerId);state.stroke={tool:state.tool,size:state.size,points:[point(e)]};paint(state.stroke);
});
maskCanvas.addEventListener('pointermove',e=>{
  if(!state.file||state.busy||state.compare)return;
  if(state.mode==='image'&&photo.pointerMove(e,point(e)))return;
  const r=maskCanvas.getBoundingClientRect(),cursor=$('cursor');cursor.style.display=state.tool==='rect'?'none':'block';cursor.style.left=(e.clientX-r.left)+'px';cursor.style.top=(e.clientY-r.top)+'px';cursor.style.width=cursor.style.height=(state.size*r.width/state.width)+'px';
  if(!state.drawing)return;e.preventDefault();const p=point(e);
  if(state.tool==='rect'){state.stroke.points[1]=p;repaintMask();}else{const last=state.stroke.points[state.stroke.points.length-1];paint({...state.stroke,points:[last,p]});state.stroke.points.push(p);}
});
function finishStroke(e){if(state.mode==='image'&&photo.pointerUp(e))return;if(!state.drawing)return;state.drawing=false;if(e.type==='pointercancel'){state.stroke=null;repaintMask();}else{state.strokes.push(state.stroke);state.stroke=null;}selectionChanged();}
maskCanvas.addEventListener('pointerup',finishStroke);maskCanvas.addEventListener('pointercancel',finishStroke);maskCanvas.addEventListener('pointerleave',()=>$('cursor').style.display='none');
function stopPreview(){state.playing=false;cancelAnimationFrame(previewFrame);if(state.video&&!state.busy)state.video.pause();$('play').textContent='播放';}
function updateTime(){if(!state.video)return;$('seek').value=String(state.video.currentTime);$('video-time').textContent=preciseTime(state.video.currentTime)+' / '+preciseTime(state.video.duration);if(!state.busy)paintScheduled();}
async function playPreview(){if(state.busy||!state.video)return;if(state.playing){stopPreview();return;}try{if(state.video.ended)state.video.currentTime=0;state.video.muted=true;await state.video.play();state.playing=true;$('play').textContent='暂停';const loop=()=>{if(!state.playing)return;render();updateTime();previewFrame=requestAnimationFrame(loop);};loop();}catch{toast('浏览器无法播放此视频，请换用 MP4 / H.264 文件。');}}
async function seekTo(video,time){if(Math.abs(video.currentTime-time)<.005&&video.readyState>=2)return;await waitEvent(video,'seeked',()=>video.currentTime=time,10000);}
async function processImage() {
  const method=document.querySelector('input[name=method]:checked').value,selection=photo.prepareRepair();
  if(method==='texture'&&selection.count>Math.min(160000,selection.width*selection.height*.12))throw new Error('纹理修复请每次选取不超过当前图层 12%、16 万像素的小区域，或使用平滑修复。');
  if(selection.count>selection.width*selection.height*.3)throw new Error('请将选区控制在当前图层 30% 以内，分几次处理。');
  setBusy(true,'正在修复当前图层…',method==='texture'?'正在从周围画面采样纹理，大选区可能需要一段时间。':'正在用周围像素补全选区，请稍等。');
  const pixels=await new Promise((resolve,reject)=>{
    const worker=new Worker('/repair-worker.js',{type:'module'});state.worker=worker;
    state.cancelImage=()=>{worker.terminate();state.worker=null;reject(new Error('已取消修复，选区已保留。'));};
    worker.onmessage=({data})=>{
      if(data.progress!==undefined)setProgress(data.progress);
      if(data.error){worker.terminate();state.worker=null;reject(new Error(data.error));}
      if(data.pixels){worker.terminate();state.worker=null;resolve(data.pixels);}
    };
    worker.onerror=()=>{worker.terminate();state.worker=null;reject(new Error('修复中断，请缩小选区后重试。'));};
    worker.postMessage({pixels:selection.pixels.buffer,mask:selection.mask.buffer,width:selection.width,height:selection.height,method},[selection.pixels.buffer,selection.mask.buffer]);
  });
  state.cancelImage=null;await photo.applyRepair(selection.id,pixels);state.result=true;clearSelection();setBusy(false);setView(photo.canCompare());toast(photo.canCompare()?'照片已修复，可以拖动滑杆对比效果。':'当前图层已修复，其他照片图层保持不变。');
}
function supportedMime(){if(!window.MediaRecorder)return '';return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t))||'';}
async function processVideo(mask) {
  const mime=supportedMime();if(!mime||!canvas.captureStream)throw new Error('当前浏览器不支持视频导出，请用新版桌面 Chrome 或 Edge 打开。');
  if(state.videoTiming==='fixed'&&state.count>state.width*state.height*.12)throw new Error('视频选区较大，请将每次修复范围控制在画面 12% 以内。');
  const timed=state.videoTiming==='segments',automatic=state.videoTiming==='auto';
  const autoRenderer=automatic?tracking.createRenderer():null;
  if(timed&&!state.segments.length)throw new Error('请先保存至少一个水印时段。');
  if(timed&&state.count)throw new Error('当前选区还没有保存，请先保存这个时段。');
  const timing=automatic?null:timed?compileVideoTimeline(state.segments,state.video.duration,(segments,range)=>{
    const merged=new Uint8Array(state.width*state.height);let count=0;
    for(const segment of segments){const selection=rasterizeStrokes(segment.strokes);for(let i=0;i<merged.length;i++)if(selection[i]&&!merged[i]){merged[i]=1;count++;}}
    if(count>merged.length*.12)throw new Error(`${range.start.toFixed(2)}–${range.end.toFixed(2)} 秒同时生效的选区超过画面 12%，请缩小对应选区。`);
    return makePlan(merged,state.width,state.height);
  }):{duration:state.video.duration,intervals:[{start:0,end:state.video.duration,plan:makePlan(mask,state.width,state.height)}]};
  const v=state.video;stopPreview();v.pause();
  setBusy(true,'正在逐帧修复视频…','请保持页面在前台，处理时间约等于视频时长。');
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx)throw new Error('当前浏览器无法保留视频音轨，请换用桌面 Chrome 或 Edge。');
  if(!state.audio){state.audio=new AudioCtx();state.audioSource=state.audio.createMediaElementSource(v);}
  await state.audio.resume();
  const out=document.createElement('canvas');out.width=state.width;out.height=state.height;
  const oc=out.getContext('2d',{willReadFrequently:true}),destination=state.audio.createMediaStreamDestination();
  state.audioSource.connect(destination);let stream,recorder,raf=0,frameCallback=null,watchdog=0,oldTime=v.currentTime;
  try{
    await seekTo(v,0);v.muted=false;v.volume=1;v.playbackRate=1;
    function draw(time=v.currentTime){oc.drawImage(v,0,0,out.width,out.height);if(autoRenderer){autoRenderer.apply(oc,time,v);return;}const plan=timelinePlanAt(timing,time);if(plan){const image=oc.getImageData(0,0,out.width,out.height);smoothRepair(image.data,plan,3);oc.putImageData(image,0,0);}}
    draw();stream=out.captureStream(30);destination.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000,audioBitsPerSecond:128000});
    const parts=[];
    const blob=await new Promise((resolve,reject)=>{
      let settled=false,cancelled=false,lastDraw=-1;
      const cleanup=()=>{cancelAnimationFrame(raf);if(frameCallback!==null&&v.cancelVideoFrameCallback)v.cancelVideoFrameCallback(frameCallback);clearTimeout(watchdog);v.removeEventListener('ended',ended);v.removeEventListener('error',failed);document.removeEventListener('visibilitychange',visibility);};
      const fail=message=>{if(settled)return;settled=true;cancelled=true;cleanup();v.pause();if(recorder.state!=='inactive')recorder.stop();reject(new Error(message));};
      const ended=()=>{draw();if(recorder.state!=='inactive')recorder.stop();};
      const failed=()=>fail('视频解码中断，请换用兼容的视频。');
      const visibility=()=>{if(document.hidden)fail('页面已进入后台，已停止导出以避免缺帧。请保持本页在前台后重试。');};
      state.cancelVideo=()=>fail('已取消视频处理，选区已保留。');
      recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
      recorder.onerror=()=>fail('视频编码失败，请换用较短的视频或桌面浏览器。');
      recorder.onstop=()=>{if(cancelled||settled)return;settled=true;cleanup();const b=new Blob(parts,{type:recorder.mimeType||mime});b.size?resolve(b):reject(new Error('导出文件为空，请重试。'));};
      const loop=(_now,frame)=>{if(settled)return;try{const time=frame?.mediaTime??v.currentTime;if(time!==lastDraw){draw(time);lastDraw=time;setProgress(Math.min(99,time/v.duration*100));}if(v.requestVideoFrameCallback)frameCallback=v.requestVideoFrameCallback(loop);else raf=requestAnimationFrame(loop);}catch{fail('视频处理失败，请缩小选区后重试。');}};
      v.addEventListener('ended',ended);v.addEventListener('error',failed);document.addEventListener('visibilitychange',visibility);
      watchdog=setTimeout(()=>fail('处理时间过长，已停止导出。请尝试更短的视频。'),(v.duration+40)*1000);
      recorder.start(250);v.play().then(loop).catch(()=>fail('无法启动视频，请重新选择文件后重试。'));
    });
    const trackingExport=autoRenderer?.finish();
    if(state.resultUrl)URL.revokeObjectURL(state.resultUrl);state.resultBlob=blob;state.resultUrl=URL.createObjectURL(blob);state.result=true;
    const ext=blob.type.includes('mp4')?'MP4':'WebM';$('format').innerHTML=`<option>${ext} · 保留音轨</option>`;
    clearSelection();setBusy(false);setView(true);toast(trackingExport?.skippedFrames?`已生成 ${ext} 文件，部分画面未可靠匹配并已跳过，请检查成片。`:`视频修复完成，已生成 ${ext} 文件。请播放检查后下载。`);
  }finally{
    cancelAnimationFrame(raf);if(frameCallback!==null&&v.cancelVideoFrameCallback)v.cancelVideoFrameCallback(frameCallback);clearTimeout(watchdog);v.pause();v.muted=true;state.cancelVideo=null;
    if(recorder&&recorder.state!=='inactive')recorder.stop();
    if(stream)stream.getTracks().forEach(t=>t.stop());
    state.audioSource.disconnect(destination);destination.stream.getTracks().forEach(t=>t.stop());
    await seekTo(v,Math.min(oldTime,v.duration)).catch(()=>{});
  }
}
async function process(){
  if(state.busy||!state.file||state.mode==='image'&&photo.pending())return;const mask=readMask();
  if(state.mode==='video'&&state.videoTiming==='segments'){
    if(state.count)return toast('请先保存当前选区的生效时段。');
    if(!state.segments.length)return toast('请先框选水印，设置时间并保存时段。');
  }else if(state.mode==='video'&&state.videoTiming==='auto'){
    if(!tracking.ready)return toast('请先框选一次水印，并自动分析整段视频。');
  }else if(!state.count)return toast('请先在画面上涂抹或框选要擦除的区域。');
  if(state.count>state.width*state.height*.3)return toast('选区超过画面的 30%。请分几次处理，保留足够的周围画面。');
  try{if(state.mode==='image')await processImage(mask);else await processVideo(mask);}
  catch(e){setBusy(false);toast(e.message||'处理失败，请重试。');}
  finally{state.cancelImage=null;state.cancelVideo=null;sync();}
}
function downloadBlob(blob,ext){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(state.file.name.replace(/\.[^.]+$/,'')||'qingying')+'-清影修复.'+ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function download(){
  if(!state.result||state.busy||state.mode==='image'&&photo.pending())return;
  try{
    if(state.mode==='video'){downloadBlob(state.resultBlob,state.resultBlob.type.includes('mp4')?'mp4':'webm');return;}
    const type=$('format').value;let exportCanvas=working;
    if(type==='image/jpeg'){exportCanvas=document.createElement('canvas');exportCanvas.width=state.width;exportCanvas.height=state.height;const c=exportCanvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,state.width,state.height);c.drawImage(working,0,0);}
    const blob=await new Promise(resolve=>exportCanvas.toBlob(resolve,type,.94));if(!blob)throw new Error('无法生成下载文件，请重试。');
    downloadBlob(blob,blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png');
  }catch(e){toast(e.message||'下载失败，请重试。');}
}
function reset(){if(state.busy||!state.file)return;if(state.mode==='image'){photo.resetToOriginal();return;}tracking.reset();state.segments=[];state.editingSegment=null;state.segmentsRevision++;state.schedulePaintKey='';renderSegmentList();working.getContext('2d').clearRect(0,0,state.width,state.height);working.getContext('2d').drawImage(original,0,0);setView(false);state.result=false;state.resultBlob=null;if(state.resultUrl)URL.revokeObjectURL(state.resultUrl);state.resultUrl=null;$('result-video').removeAttribute('src');clearSelection();if(state.video){$('segment-start').value='0';$('segment-end').value=state.video.duration.toFixed(3);}render();sync();toast('已恢复原始画面，所有标记已清除。');}

function copyStrokes(strokes){return strokes.map(s=>({...s,points:s.points.map(p=>({...p}))}));}
function syncVideoControls(){
  const available=state.mode==='video'&&Boolean(state.video),off=!available||state.busy||state.loading;
  $('video-segments').hidden=!available;
  const timed=state.videoTiming==='segments';
  $('segment-form').hidden=!timed;$('fixed-note').hidden=state.videoTiming!=='fixed';
  tracking.sync();
  $('video-note').textContent=state.videoTiming==='auto'?'先框选一次水印，再点击画布下方的“自动分析整段视频”。检查蓝色跟踪框后，开始修复。':timed?'水印换位时，分别标记每个位置的生效时段，保存后开始修复。':'当前选区会应用到整个视频。';
  document.querySelectorAll('input[name=video-timing]').forEach(input=>{input.checked=input.value===state.videoTiming;input.disabled=off;});
  for(const id of ['segment-start','segment-end','start-now','end-now','step-back','step-forward','cancel-segment-edit'])$(id).disabled=off;
  $('save-segment').disabled=off||!state.count;
  $('save-segment').textContent=state.editingSegment===null?'保存这个时段':'更新这个时段';
  $('cancel-segment-edit').hidden=state.editingSegment===null;
  document.querySelectorAll('.segment-actions button').forEach(button=>button.disabled=off);
}
function rasterizeStrokes(strokes){
  segmentCtx.clearRect(0,0,state.width,state.height);strokes.forEach(stroke=>paint(stroke,segmentCtx));
  const data=segmentCtx.getImageData(0,0,state.width,state.height).data,mask=new Uint8Array(state.width*state.height);
  for(let i=0;i<mask.length;i++)mask[i]=data[i*4+3]>20?1:0;
  return mask;
}
function invalidateVideoResult(){
  if(state.mode!=='video'||!state.result)return;
  setView(false);state.result=false;state.resultBlob=null;
  $('result-video').pause();$('result-video').removeAttribute('src');
  if(state.resultUrl)URL.revokeObjectURL(state.resultUrl);state.resultUrl=null;
}
function paintScheduled(){
  if(!state.video||state.busy)return;
  if(state.videoTiming==='auto'){tracking.paintPreview();return;}
  const active=state.videoTiming==='segments'?activeSegmentsAt(state.segments,state.video.currentTime,state.video.duration):[];
  const key=state.videoTiming+':'+state.segmentsRevision+':'+state.editingSegment+':'+active.map(s=>s.id).join(',');
  if(state.schedulePaintKey===key)return;state.schedulePaintKey=key;
  scheduleCtx.clearRect(0,0,state.width,state.height);
  for(const segment of active){
    if(segment.id===state.editingSegment)continue;
    segmentCtx.clearRect(0,0,state.width,state.height);segment.strokes.forEach(stroke=>paint(stroke,segmentCtx));
    segmentCtx.save();segmentCtx.globalCompositeOperation='source-in';segmentCtx.fillStyle='#91c8ef';segmentCtx.fillRect(0,0,state.width,state.height);segmentCtx.restore();
    scheduleCtx.drawImage(segmentScratch,0,0);
  }
  const ids=new Set(active.map(s=>s.id));
  document.querySelectorAll('.segment-row').forEach(row=>row.classList.toggle('active-time',ids.has(Number(row.dataset.id))));
  $('active-segments').textContent=active.length?`当前 ${active.length} 个时段生效 · 蓝色标记`:'当前时间没有已保存的标记';
}
function renderSegmentList(){
  const list=$('segment-list');list.replaceChildren();
  [...state.segments].sort((a,b)=>a.start-b.start||a.id-b.id).forEach((segment,index)=>{
    const row=document.createElement('li');row.className='segment-row';row.dataset.id=String(segment.id);row.classList.toggle('editing',segment.id===state.editingSegment);
    const label=document.createElement('div');label.className='segment-label';
    const title=document.createElement('strong');title.textContent=`${String(index+1).padStart(2,'0')} · ${segment.start.toFixed(2)}–${segment.end.toFixed(2)} 秒`;
    const detail=document.createElement('small');detail.textContent=`修复 ${(100*segment.count/(state.width*state.height)).toFixed(1)}% 的画面${segment.id===state.editingSegment?' · 正在编辑':''}`;
    label.append(title,detail);const actions=document.createElement('div');actions.className='segment-actions';
    const edit=document.createElement('button');edit.textContent='查看 / 修改';edit.addEventListener('click',()=>editSegment(segment.id));
    const remove=document.createElement('button');remove.textContent='删除';remove.setAttribute('aria-label',`删除 ${segment.start.toFixed(2)} 到 ${segment.end.toFixed(2)} 秒的标记`);remove.addEventListener('click',()=>removeSegment(segment.id));
    actions.append(edit,remove);row.append(label,actions);list.append(row);
  });
  $('segment-count').textContent=state.segments.length?`已保存 ${state.segments.length} 个时段`:'尚未保存时段';
  $('no-segments').hidden=state.segments.length>0;state.schedulePaintKey='';paintScheduled();syncVideoControls();
}
function inputRange(){return validateTimeRange($('segment-start').valueAsNumber,$('segment-end').valueAsNumber,state.video.duration);}
async function saveSegment(){
  if(state.busy||!state.video||state.videoTiming!=='segments')return;
  try{
    const range=inputRange();readMask();if(!state.count)throw new Error('请先在画面上标记这个时段的水印位置。');
    if(state.count>state.width*state.height*.12)throw new Error('每个时段请只标记小范围水印，选区不能超过画面 12%。');
    if(state.editingSegment===null&&state.segments.length>=60)throw new Error('一次最多保存 60 个时段，请将视频分成更短的片段。');
    const segment={id:state.editingSegment??state.segmentNext++,...range,count:state.count,strokes:copyStrokes(state.strokes)};
    const index=state.segments.findIndex(s=>s.id===segment.id);if(index<0)state.segments.push(segment);else state.segments[index]=segment;
    invalidateVideoResult();state.editingSegment=null;state.segmentsRevision++;clearSelection();renderSegmentList();
    $('segment-start').value=Math.min(range.end,state.video.duration).toFixed(3);$('segment-end').value=state.video.duration.toFixed(3);sync();
    stopPreview();setView(false);await seekTo(state.video,Math.min(range.end+.015,state.video.duration));render();updateTime();
    toast(`已保存 ${range.start.toFixed(2)}–${range.end.toFixed(2)} 秒。可以继续标记下一处，或开始修复。`);
  }catch(e){toast(e.message);}
}
async function editSegment(id){
  if(state.busy||!state.video)return;
  if(state.count&&state.editingSegment!==id)return toast('当前还有未保存的选区，请先保存或清空后再修改其他时段。');
  const segment=state.segments.find(s=>s.id===id);if(!segment)return;
  stopPreview();setView(false);state.editingSegment=id;state.strokes=copyStrokes(segment.strokes);state.stroke=null;
  $('segment-start').value=segment.start.toFixed(3);$('segment-end').value=segment.end.toFixed(3);repaintMask();readMask();renderSegmentList();sync();
  try{await seekTo(state.video,Math.min(segment.start+.015,(segment.start+segment.end)/2));render();updateTime();}catch(e){toast(e.message);}
}
function removeSegment(id){
  if(state.busy)return;
  state.segments=state.segments.filter(s=>s.id!==id);
  if(state.editingSegment===id){state.editingSegment=null;clearSelection();}
  state.segmentsRevision++;invalidateVideoResult();renderSegmentList();sync();
}
function cancelSegmentEdit(){if(state.busy)return;state.editingSegment=null;clearSelection();renderSegmentList();sync();}
async function nudgeTime(delta){if(!state.video||state.busy)return;stopPreview();try{await seekTo(state.video,Math.min(state.video.duration,Math.max(0,state.video.currentTime+delta)));render();updateTime();}catch(e){toast(e.message);}}
$('save-segment').addEventListener('click',saveSegment);$('cancel-segment-edit').addEventListener('click',cancelSegmentEdit);
$('start-now').addEventListener('click',()=>{if(state.video&&!state.busy){stopPreview();$('segment-start').value=state.video.currentTime.toFixed(3);}});
$('end-now').addEventListener('click',()=>{if(state.video&&!state.busy){stopPreview();$('segment-end').value=state.video.currentTime.toFixed(3);}});
$('step-back').addEventListener('click',()=>nudgeTime(-.1));$('step-forward').addEventListener('click',()=>nudgeTime(.1));
document.querySelectorAll('input[name=video-timing]').forEach(input=>input.addEventListener('change',()=>{
  if(state.busy)return;state.videoTiming=input.value;state.editingSegment=null;tracking.invalidatePreview();invalidateVideoResult();state.schedulePaintKey='';paintScheduled();renderSegmentList();sync();
}));
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>chooseTool(b.dataset.tool)));
['open-center','open-top'].forEach(id=>$(id).addEventListener('click',()=>{if(!state.busy&&!state.loading)$('file-input').click();}));
$('file-input').addEventListener('change',e=>{const files=[...e.target.files];e.target.value='';openFiles(files);});
$('brush-size').addEventListener('input',e=>{state.size=Number(e.target.value);$('brush-value').textContent=state.size+' px';});
$('undo').addEventListener('click',undo);$('clear').addEventListener('click',clearSelection);$('reset').addEventListener('click',reset);
$('process').addEventListener('click',process);$('download').addEventListener('click',download);
$('edit-view').addEventListener('click',()=>setView(false));$('compare-view').addEventListener('click',()=>setView(true));$('compare-slider').addEventListener('input',render);
$('cancel').addEventListener('click',()=>{if(state.cancelImage)state.cancelImage();if(state.cancelVideo)state.cancelVideo();});
$('play').addEventListener('click',playPreview);
$('seek').addEventListener('input',async e=>{if(state.busy||!state.video)return;stopPreview();try{await seekTo(state.video,Number(e.target.value));render();updateTime();}catch(e){toast(e.message);}});
document.querySelectorAll('input[name=method]').forEach(el=>el.addEventListener('change',()=>document.querySelectorAll('.method').forEach(l=>l.classList.toggle('selected',l.querySelector('input').checked))));
$('help').addEventListener('click',()=>$('help-dialog').showModal());$('close-help').addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog')){const r=$('help-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('help-dialog').close();}});
const drop=$('drop-zone');let dragCounter=0;
drop.addEventListener('dragenter',e=>{e.preventDefault();if(!state.busy){dragCounter++;drop.classList.add('dragover');}});
drop.addEventListener('dragover',e=>e.preventDefault());drop.addEventListener('dragleave',e=>{e.preventDefault();if(--dragCounter<=0)drop.classList.remove('dragover');});
drop.addEventListener('drop',e=>{e.preventDefault();dragCounter=0;drop.classList.remove('dragover');openFiles(e.dataTransfer.files,Boolean(state.file&&state.mode==='image'));});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
window.addEventListener('keydown',e=>{if(state.busy||$('help-dialog').open||/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;if(state.mode==='image'&&photo.keydown(e))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return;}if(e.ctrlKey||e.metaKey||e.altKey)return;const tool={b:'brush',r:'rect',e:'erase'}[e.key.toLowerCase()];if(tool){e.preventDefault();chooseTool(tool);}});
window.addEventListener('beforeunload',e=>{if(state.busy){e.preventDefault();e.returnValue='';}});
// Same state/actions as the visible editor; no hidden file access.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  const tools=[
    {name:'read_editor_state',title:'读取编辑状态',description:'Read the currently opened file metadata, selection and result status. Does not read or upload file bytes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({mode:state.mode,file:state.file?.name||null,width:state.width,height:state.height,selectedPixels:state.count,busy:state.busy,resultReady:state.result&&!photo.pending(),photo:state.mode==='image'?photo.snapshot():null,videoTiming:state.videoTiming,automaticTrackingReady:tracking.ready,automaticMatchedSamples:tracking.summary()?.matched||0,segments:state.segments.map(({id,start,end})=>({id,start,end}))})},
    {name:'set_repair_selection',title:'设置修复选区',description:'Stage a rectangular pixel selection on the currently loaded image or video. Replaces the previous selection; does not process or download.',inputSchema:{type:'object',properties:{x:{type:'integer',minimum:0},y:{type:'integer',minimum:0},width:{type:'integer',minimum:1},height:{type:'integer',minimum:1}},required:['x','y','width','height'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(!input||typeof input!=='object')throw new Error('需要矩形坐标。');const{x,y,width,height}=input;if(![x,y,width,height].every(Number.isInteger)||x<0||y<0||width<1||height<1||Object.keys(input).some(k=>!['x','y','width','height'].includes(k)))throw new Error('矩形坐标无效。');if(!state.file||state.busy||state.loading)throw new Error('请先选择文件，等待当前操作完成。');if(x+width>state.width||y+height>state.height)throw new Error('矩形超出画面范围。');if(state.mode==='image')photo.selectPane('repair');setView(false);stopPreview();state.strokes=[{tool:'rect',size:1,points:[{x,y},{x:x+width,y:y+height}]}];repaintMask();selectionChanged();return{selectedPixels:state.count,ready:true};}}
  ];
  for(const tool of tools){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
sync();

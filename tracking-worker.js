import {prepareTrackingFrame,findWatermark} from './tracking-core.js';
let template;
self.onmessage=({data})=>{
  try{
    if(data.type==='init'){template=data.template;self.postMessage({ready:true});return;}
    if(!template)throw new Error('跟踪参考尚未设置。');
    const frame=prepareTrackingFrame(new Uint8ClampedArray(data.pixels),data.width,data.height);
    self.postMessage({result:findWatermark(frame,template,{threshold:data.threshold,forceGlobal:true})});
  }catch(error){self.postMessage({error:error.message});}
};

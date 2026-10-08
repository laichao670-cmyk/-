import {adjustPhotoPixels,removeConnectedBackground,keepPhotoPolygon,featherPhotoMask} from './photo-core.js';
self.onmessage=({data:job})=>{
  try{let result;
    if(job.kind==='adjust'){result=adjustPhotoPixels(new Uint8ClampedArray(job.pixels),job.width,job.height,job.settings);self.postMessage({id:job.id,pixels:result.buffer},[result.buffer]);return;}
    const alpha=new Uint8ClampedArray(job.alpha);
    if(job.kind==='background'){const r=removeConnectedBackground(new Uint8ClampedArray(job.pixels),alpha,job.width,job.height,job.x,job.y,job.tolerance);result=r.alpha;self.postMessage({id:job.id,alpha:result.buffer,removed:r.removed},[result.buffer]);return;}
    if(job.kind==='polygon')result=keepPhotoPolygon(alpha,job.width,job.height,job.points);
    else if(job.kind==='feather')result=featherPhotoMask(alpha,job.width,job.height);
    else throw new Error('未知照片操作。');
    self.postMessage({id:job.id,alpha:result.buffer},[result.buffer]);
  }catch(error){self.postMessage({id:job.id,error:error.message});}
};

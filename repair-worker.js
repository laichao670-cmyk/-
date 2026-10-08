import { makePlan, smoothRepair, textureRepair } from './repair-core.js';
self.onmessage = ({data: job}) => {
  try {
    const pixels = new Uint8ClampedArray(job.pixels), mask = new Uint8Array(job.mask);
    const plan = makePlan(mask, job.width, job.height);
    const report = progress => self.postMessage({progress});
    if (job.method === 'texture') textureRepair(pixels, plan, report);
    else smoothRepair(pixels, plan, 85, report);
    self.postMessage({pixels: pixels.buffer}, [pixels.buffer]);
  } catch (e) { self.postMessage({error: e.message || '修复失败，请缩小选区后再试。'}); }
};

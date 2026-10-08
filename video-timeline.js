// End-exclusive intervals prevent adjacent left/right marks from both applying at a jump.
export function validateTimeRange(start, end, duration) {
  if (![start,end,duration].every(Number.isFinite) || duration <= 0 || start < 0 || end > duration + .001 || start >= duration || end <= start) {
    throw new Error('请输入有效时段：开始时间小于结束时间，且不超过视频时长。');
  }
  return {start,end:Math.min(end,duration)};
}
export function activeSegmentsAt(segments, time, duration) {
  if (!Number.isFinite(time) || time < 0 || time > duration + .001) return [];
  const t = Math.min(time, Math.max(0,duration - 1e-7));
  return segments.filter(segment => t >= segment.start && t < segment.end);
}
export function compileVideoTimeline(segments, duration, createPlan) {
  const ids = new Set();
  for (const segment of segments) {
    validateTimeRange(segment.start, segment.end, duration);
    if(ids.has(segment.id))throw new Error('时段标记重复，请重新保存。');
    ids.add(segment.id);
  }
  const points = [...new Set([0,duration,...segments.flatMap(s=>[s.start,Math.min(s.end,duration)])])].sort((a,b)=>a-b);
  const cache = new Map(), intervals = [];
  for(let i=0;i<points.length-1;i++){
    const start=points[i],end=points[i+1];
    if(end<=start)continue;
    const active=activeSegmentsAt(segments,(start+end)/2,duration),key=active.map(s=>s.id).join('|');
    if(!cache.has(key))cache.set(key,active.length?createPlan(active,{start,end}):null);
    intervals.push({start,end,plan:cache.get(key),segmentIds:active.map(s=>s.id)});
  }
  return {duration,intervals};
}
export function timelinePlanAt(timeline,time){
  if(!Number.isFinite(time)||time<0||time>timeline.duration+.001)return null;
  const t=Math.min(time,Math.max(0,timeline.duration-1e-7));
  return timeline.intervals.find(interval=>t>=interval.start&&t<interval.end)?.plan??null;
}

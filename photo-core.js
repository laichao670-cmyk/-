export const neutralAdjustments=()=>({brightness:0,contrast:0,saturation:0,warmth:0,clarity:0});
export function adjustPhotoPixels(input,width,height,settings={}){
  const {brightness=0,contrast=0,saturation=0,warmth=0,clarity=0}=settings;
  const out=new Uint8ClampedArray(input.length),factor=(100+Math.max(-90,Math.min(90,contrast)))/(100-Math.max(-90,Math.min(90,contrast))),sat=Math.max(0,1+saturation/100);
  for(let p=0;p<input.length;p+=4){
    let r=(input[p]-128)*factor+128+brightness*1.28+warmth*.45;
    let g=(input[p+1]-128)*factor+128+brightness*1.28+warmth*.05;
    let b=(input[p+2]-128)*factor+128+brightness*1.28-warmth*.45;
    const luminance=.2126*r+.7152*g+.0722*b;
    out[p]=luminance+(r-luminance)*sat;out[p+1]=luminance+(g-luminance)*sat;out[p+2]=luminance+(b-luminance)*sat;out[p+3]=input[p+3];
  }
  if(clarity>0){const base=out.slice(),amount=Math.min(100,clarity)/65;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4;if(!base[p+3])continue;
      let rs=0,gs=0,bs=0,weight=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;
        const q=(yy*width+xx)*4,a=base[q+3]/255;rs+=base[q]*a;gs+=base[q+1]*a;bs+=base[q+2]*a;weight+=a;
      }
      if(weight){out[p]=base[p]+amount*(base[p]-rs/weight);out[p+1]=base[p+1]+amount*(base[p+1]-gs/weight);out[p+2]=base[p+2]+amount*(base[p+2]-bs/weight);}
    }
  }
  return out;
}
export function removeConnectedBackground(rgba,alpha,width,height,x,y,tolerance=24){
  x=Math.floor(x);y=Math.floor(y);if(x<0||y<0||x>=width||y>=height)throw new Error('请点击照片范围内的背景。');
  const n=width*height,result=alpha.slice(),visited=new Uint8Array(n),queue=new Int32Array(n),seed=(y*width+x)*4;
  const r=rgba[seed],g=rgba[seed+1],b=rgba[seed+2],limit=Math.max(0,Math.min(100,tolerance))*2.55,limit2=limit*limit;
  let head=0,tail=0,removed=0;queue[tail++]=y*width+x;visited[y*width+x]=1;
  while(head<tail){const i=queue[head++],p=i*4,dr=rgba[p]-r,dg=rgba[p+1]-g,db=rgba[p+2]-b;
    if(rgba[p+3]&&dr*dr+dg*dg+db*db>limit2)continue;
    if(result[i])removed++;result[i]=0;const xx=i%width,yy=(i/width)|0;
    for(const j of [xx?i-1:-1,xx+1<width?i+1:-1,yy?i-width:-1,yy+1<height?i+width:-1])if(j>=0&&!visited[j]){visited[j]=1;queue[tail++]=j;}
  }
  return{alpha:result,removed};
}
export function keepPhotoPolygon(alpha,width,height,points){
  if(points.length<3||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('请沿主体至少标记三个点，再完成圈选。');
  const result=new Uint8ClampedArray(alpha.length);
  for(let y=0;y<height;y++){
    const scan=y+.5,crossings=[];
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i];if((a.y>scan)!==(b.y>scan))crossings.push(a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y));
    }
    crossings.sort((a,b)=>a-b);
    for(let k=0;k+1<crossings.length;k+=2){const x0=Math.max(0,Math.ceil(crossings[k]-.5)),x1=Math.min(width,Math.ceil(crossings[k+1]-.5));for(let x=x0;x<x1;x++)result[y*width+x]=alpha[y*width+x];}
  }
  return result;
}
export function featherPhotoMask(alpha,width,height){
  const result=new Uint8ClampedArray(alpha.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let sum=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if(xx>=0&&xx<width&&yy>=0&&yy<height){sum+=alpha[yy*width+xx];n++;}
    }result[y*width+x]=sum/n;
  }
  return result;
}
export function collagePositions(items,kind='grid',maxSide=2400){
  if(!items.length)throw new Error('请先添加照片。');
  const gap=20,pad=20,placements=[];let width,height;
  if(kind==='horizontal'){height=840;let x=pad;for(const item of items){const scale=800/item.height;placements.push({id:item.id,x,y:pad,scale});x+=item.width*scale+gap;}width=x-gap+pad;}
  else if(kind==='vertical'){width=840;let y=pad;for(const item of items){const scale=800/item.width;placements.push({id:item.id,x:pad,y,scale});y+=item.height*scale+gap;}height=y-gap+pad;}
  else{const cols=Math.ceil(Math.sqrt(items.length)),rows=Math.ceil(items.length/cols),cw=600,ch=500;width=cols*cw+(cols-1)*gap+pad*2;height=rows*ch+(rows-1)*gap+pad*2;items.forEach((item,i)=>{const scale=Math.min(cw/item.width,ch/item.height);placements.push({id:item.id,x:pad+(i%cols)*(cw+gap)+(cw-item.width*scale)/2,y:pad+Math.floor(i/cols)*(ch+gap)+(ch-item.height*scale)/2,scale});});}
  const ratio=Math.min(1,maxSide/Math.max(width,height));return{width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio)),placements:placements.map(p=>({...p,x:p.x*ratio,y:p.y*ratio,scale:p.scale*ratio}))};
}

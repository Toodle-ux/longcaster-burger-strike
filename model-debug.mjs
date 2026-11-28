import './ar/coarse-model.js?v=198';
import './ar/attack-region-game.js?v=198';
import {sourcePoint,MAX_EVIDENCE_AGE} from './recognition.mjs?v=198';

// Read-only view of the same model/pose used by the Worker. Never feeds back
// into tracking or permission; the gameplay marker has separate UI smoothing.
export function modelSnapshot(view){
  const live=view.type!=='demo'&&view.diagnostics?.live;
  const fresh=live&&view.diagnostics.resultAgeMs<=MAX_EVIDENCE_AGE&&view.diagnostics.frameAgeMs<=MAX_EVIDENCE_AGE;
  const held=view.displayStatus==='held';
  const pose=live&&view.displayPose?(held?view.displayPose:fresh?view.result?.pose:null):null;
  return {pose,held:!!pose&&held,contour:fresh?view.result?.bunContour:null,
    range:pose&&!held?view.result?.elevationRangeDegrees:null,
    status:!live?'inactive':!pose?'missing':held?'held':'measured',state:view.state};
}

export function screenPose(pose,sourceWidth,sourceHeight,width,height,type){
  const fit=type==='camera'?'cover':'contain';
  const center=sourcePoint(pose.center,sourceWidth,sourceHeight,width,height,fit);
  const zoom=(fit==='cover'?Math.max:Math.min)(width/sourceWidth,height/sourceHeight);
  return {...center,scale:pose.scalePerSourceWidth*sourceWidth*zoom,
    elevation:pose.elevationDegrees,roll:pose.rollDegrees,...(pose.focalPerSourceWidth?
      {focal:pose.focalPerSourceWidth*sourceWidth*zoom,principalX:width/2,principalY:height/2}:{})};
}

function hull(points){
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=items=>{const out=[];for(const p of items){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out;};
  return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];
}

export function createModelDebug({canvas,info,toggle,t}){
  const api=globalThis.BurgerModel,model=api.mesh(api.presets.game),ctx=canvas.getContext('2d');
  const parts=['upper','filling','lower'].map(part=>({part,
    vertices:[...new Set(model.faces.filter(f=>f.part===part).flatMap(f=>f.ids))].map(i=>model.vertices[i])}));
  let lastKey='';
  const clear=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);canvas.dataset.modelState='none';};
  toggle.addEventListener('change',()=>{lastKey='';if(!toggle.checked){canvas.hidden=info.hidden=true;clear();}});
  function render(view,width,height){
    if(!toggle.checked){canvas.hidden=info.hidden=true;return;}
    canvas.hidden=info.hidden=false;
    const snap=modelSnapshot(view),p=snap.pose;
    const label=snap.status==='inactive'?t('模型预览：等待摄像头或播放视频'):snap.status==='missing'?t('当前无有效模型'):
      snap.held?t('短时保留 · 灰色虚线不是当前测量'):t('当前测量 · {state}',{state:t(snap.state==='exposed'?'核心露出':snap.state==='blocked'?'被面包遮挡':'角度不确定')});
    const angle=p?t('模型估计角度 {angle}° · 画面内旋转 {roll}°',{angle:p.elevationDegrees.toFixed(1),roll:p.rollDegrees.toFixed(1)}):'';
    const range=snap.range?t('候选角度 {min}°～{max}°',{min:snap.range[0].toFixed(1),max:snap.range[1].toFixed(1)}):'';
    const text=[label,angle,range,t('青：上面包 · 紫：夹层 · 黄：下面包'),t('白线：检测轮廓 · 白十字：核心位置'),t('模型包含隐藏部分；中心未做界面平滑')].filter(Boolean).join('\n');
    const ratio=Math.min(globalThis.devicePixelRatio||1,2);
    const key=JSON.stringify([view.result?.timestampMs,snap.status,snap.state,p,width,height,ratio,text]);
    if(key===lastKey)return;lastKey=key;
    const w=Math.round(width*ratio),h=Math.round(height*ratio);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    info.textContent=text;canvas.dataset.modelState=snap.status;
    const video=view.video;if(!video?.videoWidth||!video.videoHeight)return;
    const line=(points,color,dash=[])=>{
      if(points.length<2)return;ctx.beginPath();points.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.closePath();
      ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.setLineDash(dash);ctx.stroke();
    };
    if(p){
      const transform=screenPose(p,video.videoWidth,video.videoHeight,width,height,view.type);
      const project=globalThis.BurgerAttackRegion.projector(transform);
      for(const part of parts)line(hull(part.vertices.map(project)),
        snap.held?'#aeb8c3':{upper:'#57e4ff',filling:'#ef8cff',lower:'#ffe182'}[part.part],snap.held?[5,5]:[]);
      const {x,y}=globalThis.BurgerAttackRegion.projectCore(transform);ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x-6,y);ctx.lineTo(x+6,y);ctx.moveTo(x,y-6);ctx.lineTo(x,y+6);
      ctx.strokeStyle=snap.held?'#aeb8c3':'#fff';ctx.lineWidth=2;ctx.stroke();
    }
    if(snap.contour)line(snap.contour.map(q=>sourcePoint(q,video.videoWidth,video.videoHeight,width,height,
      view.type==='camera'?'cover':'contain')),'#ffffffb3',[2,3]);
  }
  return {render,clear};
}

'use client';
import { useState } from 'react';
import { VisualPage } from '@/components/VisualDesignStudio';
import { WebSearchImageGrid } from '@/components/ChatInterface';
import { normalizePresentation } from '@/lib/design/visual-design-engine';
import type { PresentationData } from '@/types/presentation';

const images = [
  {url:'https://upload.wikimedia.org/wikipedia/en/4/42/SasukeKishimoto.jpg?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled',title:'Sasuke Uchiha',sourceUrl:'https://en.wikipedia.org/wiki/Sasuke_Uchiha'},
  {url:'https://i.ebayimg.com/images/g/ZhoAAOSwTgFlMHkq/s-l1200.png',title:'Sasuke Uchiha Sharingan',sourceDomain:'ebayimg.com'},
  {url:'https://static.wikia.nocookie.net/wwwdynapaul/images/2/25/Sasuke_Uchiha.png/revision/latest/scale-to-width-down/692?cb=20150301042527',title:'Sasuke Uchiha character reference',sourceDomain:'wikia.nocookie.net'},
];

export default function VisualCheck({poster,presentation}:{poster:unknown;presentation:unknown}) {
  const [view,setView] = useState('poster');
  const [narrow,setNarrow] = useState(false);
  const [light,setLight] = useState(false);
  const source = poster as PresentationData;
  const design = view === 'poster' ? normalizePresentation(source) : view === 'World War II' ? normalizePresentation(presentation as PresentationData) : normalizePresentation({id:view,title:view,theme:'academic-clean',format:'presentation',slides:[
    {id:'qa-hero',slideNumber:1,layout:view==='Image model failure'?'image-feature':'full-bleed',title:view,subtitle:'A clear visual story — tailored to the subject',content:view==='Image model failure'?{bodyText:'The slide content remains readable while the reserved visual field explains the generation problem.'}:{}, ...(view==='Sasuke Uchiha' ? {imageUrl:images[0].url,visualRole:'documentary-image'} : view==='Image model failure' ? {imagePrompt:'Snow leopard in mountains',visualRole:'hero-image',imageGeneration:{status:'failed',message:'This image could not be generated because the connected image model encountered a problem. Please check the API key and quota.'}} : {})},
    {id:'qa-details',slideNumber:2,layout:'editorial',title:'Understanding the bigger picture',content:{bullets:['One focused idea on each page','Readable text and purposeful diagrams','Real sources for documentary imagery']}}
  ]} as PresentationData);
  return <main style={{minHeight:'100vh',padding:24,background:light?'#fff':'#161616',color:light?'#171717':'#fff'}}>
    <nav style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:24}}>
      {['poster','World War II','Ocean ecosystems','Software architecture','Space exploration','Sasuke Uchiha','Image model failure','collage','single'].map(name=><button key={name} onClick={()=>setView(name)}>{name}</button>)}
      <button onClick={()=>setNarrow(!narrow)}>Toggle narrow</button>
      <button onClick={()=>{setLight(!light); document.documentElement.classList.toggle('dark',light);}}>Toggle light</button>
    </nav>
    <p style={{marginBottom:16}}>Development-only visual regression fixture · {view}</p>
    <section style={{width:narrow?360:view==='poster'?680:960,maxWidth:'100%',margin:'0 auto'}}>
      {view==='collage'||view==='single' ? <><WebSearchImageGrid images={view==='single'?images.slice(0,1):images}/><p>Sasuke Uchiha is a fictional character from Naruto. These retrieved source images help identify the character.</p></> : design.slides.map(slide=><div key={slide.id} style={{marginBottom:24}}><VisualPage data={design} slide={slide}/></div>)}
    </section>
  </main>;
}

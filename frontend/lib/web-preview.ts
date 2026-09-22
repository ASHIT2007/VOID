export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

export function previewDimensions(device: PreviewDevice, width: number, height: number) {
  const logicalWidth = device === 'mobile' ? 390 : device === 'tablet' ? 768 : 1280;
  const scale = Math.min(1, Math.max(1, width) / logicalWidth);
  return { width: logicalWidth, height: Math.max(300, Math.floor(height / scale)), scale };
}

/** The frame keeps an opaque origin. Its storage is isolated and temporary. */
export function buildPreviewDocument(source: string, origin: string, channel: string): string {
  let html = source.trim();
  if (/^<svg\b/i.test(html)) html = `<html><head><style>body{margin:0;display:grid;place-items:center;min-height:100vh}svg{max-width:100%;max-height:100vh}</style></head><body>${html}</body></html>`;
  if (!/<html\b/i.test(html)) html = `<html><head></head><body>${html}</body></html>`;
  if (!/<head\b/i.test(html)) html = html.replace(/<html\b[^>]*>/i, '$&<head></head>');
  const runtime = `${origin}/api/preview-runtime/`;
  const imports = { three: `${runtime}build/three.module.js`, 'three/addons/': `${runtime}examples/jsm/`, 'three/examples/jsm/': `${runtime}examples/jsm/` };
  // Pin supported Three imports to the installed version, including old CDN
  // module URLs. Unrelated scripts and the generated source remain intact.
  html = html.replace(/https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/three(?:@[^/"'\s]+)?\/(build\/three\.(?:module|core)(?:\.min)?\.js|examples\/jsm\/[^"'\s]+)/gi, (_match, file: string) => `${runtime}${file}`);
  html = html.replace(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi, (tag, json: string) => {
    try { const map = JSON.parse(json); return `<script type="importmap">${JSON.stringify({ ...map, imports: { ...map.imports, ...imports } })}</script>`; } catch { return tag; }
  });
  const importMap = /type=["']importmap["']/i.test(html) ? '' : `<script type="importmap">${JSON.stringify({ imports })}</script>`;
  const legacyThree = /<script\b[^>]*src=["'][^"']*three(?:@[^/"']+)?\/(?:build\/)?three(?:\.min)?\.js["'][^>]*>\s*<\/script>/i;
  if (legacyThree.test(html)) {
    html = html.replace(legacyThree, '');
    // Legacy globals become available before classic inline scene scripts.
    html = html.replace(/<script(?![^>]*\b(?:src|type)\s*=)([^>]*)>([\s\S]*?)<\/script>/gi,
      (_tag, attrs: string, code: string) => `<script type="module"${attrs}>import * as THREE from 'three';\nwindow.THREE = THREE;\n${code}</script>`);
  }
  const bootstrap = `<meta charset="utf-8">${/<meta[^>]*name=["']viewport["']/i.test(html) ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">'}
<style>html{min-height:100%}body{min-height:100%;margin:0}*,*::before,*::after{box-sizing:border-box}img,video{max-width:100%}</style>
${importMap}<script>(function(){
  var channel=${JSON.stringify(channel)};
  function send(type,message){parent.postMessage({source:'void-preview',channel:channel,type:type,message:message},'*');}
  ['localStorage','sessionStorage'].forEach(function(name){try{void window[name].length;}catch(e){var values=new Map();Object.defineProperty(window,name,{value:{getItem:function(k){return values.has(String(k))?values.get(String(k)):null;},setItem:function(k,v){values.set(String(k),String(v));},removeItem:function(k){values.delete(String(k));},clear:function(){values.clear();},key:function(i){return Array.from(values.keys())[i]||null;},get length(){return values.size;}}});}});
  window.addEventListener('error',function(e){send('error',e.message || 'A preview resource could not load.');});
  window.addEventListener('unhandledrejection',function(e){send('error',String(e.reason && e.reason.message || e.reason));});
  document.addEventListener('DOMContentLoaded',function(){requestAnimationFrame(function(){send('ready','');});});
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(!a)return;var href=a.getAttribute('href');if(!href)return;if(href[0]==='#'){e.preventDefault();var el=document.getElementById(href.slice(1));if(el)el.scrollIntoView({behavior:'smooth'});return;}if(!/^(https?:|mailto:|tel:)/i.test(href)){e.preventDefault();return;}e.preventDefault();window.open(href,'_blank','noopener,noreferrer');},true);
  document.addEventListener('submit',function(e){e.preventDefault();},true);
})();</script>`;
  return html.replace(/<head\b[^>]*>/i, (head) => head + bootstrap);
}

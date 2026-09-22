"use client";
import ArtifactCanvas from '@/components/ArtifactCanvas';

const content = `<!DOCTYPE html><html><head><title>Interactive 3D preview check</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:system-ui;background:#171717;color:white}.app{height:100vh;display:grid;grid-template-rows:auto minmax(0,1fr)}header{display:flex;flex-wrap:wrap;gap:16px;padding:16px;align-items:center}button{min-height:44px;padding:8px 20px;cursor:pointer}#scene{min-height:0;position:relative}canvas{display:block;width:100%;height:100%}@media(max-width:600px){header{gap:8px;padding:8px}}
</style></head><body><main class="app"><header><strong>Interactive 3D preview</strong><button id="increment">Count: 0</button><span id="size"></span><span id="status">Initializing scene</span></header><div id="scene"></div></main>
<script type="module">
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const count=document.querySelector('#increment');let value=Number(localStorage.getItem('count')||0);count.onclick=()=>{value++;localStorage.setItem('count',String(value));count.textContent='Count: '+value;};
const host=document.querySelector('#scene');const scene=new THREE.Scene();scene.background=new THREE.Color('#171717');const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(3,2,4);const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);const controls=new OrbitControls(camera,renderer.domElement);const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshNormalMaterial());scene.add(mesh);let frames=0;
new ResizeObserver(()=>{const width=host.clientWidth,height=Math.max(1,host.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();document.querySelector('#size').textContent=innerWidth+'px';}).observe(host);
renderer.setAnimationLoop(()=>{mesh.rotation.y+=.01;renderer.render(scene,camera);document.querySelector('#status').textContent='Rendering frame '+(++frames);});
</script></body></html>`;
const artifact = { identifier: 'preview-check', type: 'html', title: 'Interactive 3D preview check', content };
export default function PreviewCheck() {
  return <main className="h-screen w-screen"><ArtifactCanvas artifact={artifact} onClose={() => {}} /></main>;
}

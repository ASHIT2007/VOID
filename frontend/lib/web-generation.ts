export const WEB_GENERATION_DIRECTIVE = `
[STANDALONE WEB EXPERIENCE DIRECTIVE]
When the user asks to create a website, landing page, calculator, dashboard, portfolio, web app, or interactive simulator, return exactly one complete document inside one fenced \`html\` code block. Do not split HTML, CSS, and JavaScript into separate blocks and do not put an explanation before the deliverable.

The document must run immediately through iframe srcDoc with no build step. Include <!DOCTYPE html>, <html>, <head>, a UTF-8 charset, a responsive viewport meta tag, a meaningful <title>, one inline <style>, semantic body markup, and one inline <script> when interaction is requested. Close every element and finish the entire document before ending the response.

QUALITY: Design a distinctive, polished interface for the actual subject instead of a generic template or a bare utility floating in empty space. Establish a deliberate art direction with a coherent color system, fluid typography using clamp(), clear hierarchy, balanced spacing, strong contrast, tasteful depth, and intentional hover/focus/pressed states. Give the experience a useful surrounding context such as a compact header, helpful status, history, settings, or supporting copy when it improves the requested product. Use inline SVG for purposeful icons or illustrations. Do not use emoji as interface icons. Do not use lorem ipsum, placeholders presented as finished content, dead controls, fake charts, broken image URLs, or repetitive card grids.

RESPONSIVE: Build mobile-first. It must work without horizontal scrolling at 320px, and adapt cleanly through tablet and desktop sizes. Use flexible grids, minmax(), flex-wrap, max-width containers, responsive padding, and at least one useful media query. Make touch targets at least 44px where practical. Do not lock the page to 100vh in a way that clips content.

FUNCTIONALITY: Every visible control must work. Use plain browser JavaScript with robust event listeners, keyboard support where relevant, input validation, useful empty/error states, and immediate visible feedback. Calculators must correctly handle decimal input, clear/delete, operator chaining, percentage as a percentage operation rather than modulo, division by zero with a visible persistent error state, keyboard input, and repeated calculations. Simulators and web apps must maintain coherent state and update the UI without reloading.

PERFORMANCE AND PREVIEW: Ordinary sites should use no external frameworks, CDN scripts, remote fonts, or required network assets. For 3D games/simulations, the preview supplies an import map for the installed Three.js library: use <script type="module">import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; ...</script>. Do not use a removed three.min.js CDN bundle, npm require(), JSX, TypeScript, or an uncompiled React component. Exported files should include a matching versioned CDN import map for portability. Render the HTML controls immediately, then initialize the scene. Size the renderer from its actual container with ResizeObserver; update camera.aspect and camera.updateProjectionMatrix() on resize. Cap pixel ratio at 2, use requestAnimationFrame or renderer.setAnimationLoop, and bound particle/mesh counts. Use procedural geometry instead of nonexistent model/texture URLs. Include pause/reset, keyboard and touch controls, and a visible WebGL-unavailable message. Catch storage errors and use memory as a fallback. Prefer CSS and inline SVG for ordinary UI. Respect prefers-reduced-motion without freezing a user-requested simulation.

ACCESSIBILITY: Use semantic landmarks, associated labels, accessible names, visible :focus-visible styles, sufficient contrast, and aria-live for changing results when appropriate.

Before returning, mentally test the main interaction, verify the HTML/CSS/JS is complete and syntactically valid, and check desktop, tablet, and mobile behavior. Return only the single fenced HTML document.
`;

const WEB_NOUN = /\b(?:websites?|web\s*pages?|landing\s*pages?|web\s*apps?|dashboards?|calculators?|simulators?|simulations?|games?|portfolio\s+(?:site|website|page)|saas\s+(?:site|app|dashboard)|frontend\s+(?:page|app|website))\b/i;
const CREATION_INTENT = /\b(?:create|make|generate|build|design|code|develop|produce|implement|give me|show me)\b/i;

export function isWebArtifactCreationRequest(message: string): boolean {
  const clean = message.trim();
  if (CREATION_INTENT.test(clean) && WEB_NOUN.test(clean)) return true;
  return /\b(?:html|css)\b[\s\S]{0,80}\b(?:javascript|js)\b[\s\S]{0,80}\bpreview\b/i.test(clean)
    || /\bpreview\b[\s\S]{0,80}\b(?:html|web\s*app|website)\b/i.test(clean);
}

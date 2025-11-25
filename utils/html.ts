/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


/**
 * Extracts a complete HTML document from a string that might contain
 * conversational text, markdown code blocks, etc.
 */
export const extractHtmlFromText = (text: string): string => {
  if (!text) return "";

  // 1. Try to find a complete HTML document structure (most reliable)
  // Matches <!DOCTYPE html>...</html> or <html>...</html>, case insensitive, spanning multiple lines
  const htmlMatch = text.match(/(<!DOCTYPE html>|<html)[\s\S]*?<\/html>/i);
  if (htmlMatch) {
    return htmlMatch[0];
  }

  // 2. Fallback: Try to extract content from markdown code blocks if specific HTML tags weren't found
  const codeBlockMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 3. Return raw text if no structure is found (trim whitespace)
  return text.trim();
};

/**
 * Injects CSS into the HTML to hide common text elements (like loading screens,
 * info overlays, instructions)
 */
export const hideBodyText = (html: string): string => {
  const cssToInject = `
    <style>
      /* Hides common overlay IDs and classes used in Three.js examples and generated code */
      #info, #loading, #ui, #instructions, .label, .overlay, #description {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
      /* Ensure the body doesn't show selected text cursor interaction outside canvas */
      body {
        user-select: none !important;
      }
    </style>
  `;

  // Inject before closing head if possible, otherwise before closing body, or append
  if (html.toLowerCase().includes('</head>')) {
    return html.replace(/<\/head>/i, `${cssToInject}</head>`);
  }
  if (html.toLowerCase().includes('</body>')) {
    return html.replace(/<\/body>/i, `${cssToInject}</body>`);
  }
  return html + cssToInject;
};

/**
 * Three.js scenes are often too zoomed out
 * Zooms the camera in by modifying the camera.position.set() call in the Three.js code.
 * This brings the camera closer to the center (0,0,0) by the specified factor.
 */
export const zoomCamera = (html: string, zoomFactor: number = 0.8): string => {
  // Regex to find camera.position.set(x, y, z)
  // It handles integer, float, and whitespace
  const regex = /camera\.position\.set\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)/g;

  return html.replace(regex, (match, x, y, z) => {
    const newX = parseFloat(x) * zoomFactor;
    const newY = parseFloat(y) * zoomFactor;
    const newZ = parseFloat(z) * zoomFactor;
    return `camera.position.set(${newX}, ${newY}, ${newZ})`;
  });
};

/**
 * Improves OrbitControls configuration to prevent users from scrolling too far out
 * or clipping into the model, and enables damping for smoother interaction.
 */
export const enhanceControls = (html: string): string => {
  // Matches: const controls = new OrbitControls(...); or var ctrl = new THREE.OrbitControls(...);
  const regex = /(const|let|var)\s+(\w+)\s*=\s*new\s+(?:THREE\.)?OrbitControls\s*\([^)]+\);/g;

  return html.replace(regex, (match, keyword, varName) => {
    return `${match}
      // Injected enhancement for better UX
      if (${varName}) {
          ${varName}.minDistance = 5;
          ${varName}.maxDistance = 300;
          ${varName}.enableDamping = true;
          ${varName}.dampingFactor = 0.05;
          ${varName}.zoomSpeed = 0.8;
          ${varName}.rotateSpeed = 0.6;
      }`;
  });
};

/**
 * Injects a script to monitor the scene and report voxel color statistics.
 * It modifies the scene initialization to expose the scene object to window,
 * then appends a script to traverse the scene and count colors.
 */
export const injectSceneMonitor = (html: string): string => {
  // 1. Expose the scene variable to window
  // Look for: const/let/var name = new THREE.Scene();
  // We replace it with: const name = new THREE.Scene(); window.scene = name;
  const sceneRegex = /(const|let|var)\s+(\w+)\s*=\s*new\s+(?:THREE\.)?Scene\(\);/g;
  let modifiedHtml = html.replace(sceneRegex, '$1 $2 = new THREE.Scene(); window.scene = $2;');

  // 2. Inject the analysis script
  const analysisScript = `
<script>
(function() {
  function toHex(c) {
      const hex = Math.floor(Math.max(0, Math.min(1, c)) * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
  }
  
  function analyzeScene() {
    if (!window.scene) return;
    
    const stats = {};
    let total = 0;
    
    window.scene.traverse((obj) => {
       if (obj.visible === false) return;
       
       const add = (r, g, b, count = 1) => {
          const h = "#" + toHex(r) + toHex(g) + toHex(b);
          stats[h] = (stats[h] || 0) + count;
          total += count;
       };

       if (obj.isInstancedMesh) {
            if (obj.instanceColor) {
                const array = obj.instanceColor.array;
                // InstancedMesh colors are stored in a typed array [r,g,b, r,g,b, ...]
                // We access them directly to avoid dependency on global THREE object
                for (let i = 0; i < obj.count; i++) {
                    add(array[i*3], array[i*3+1], array[i*3+2]);
                }
            } else if (obj.material && obj.material.color) {
                // Instanced mesh with single global color
                const c = obj.material.color;
                add(c.r, c.g, c.b, obj.count);
            }
       } else if (obj.isMesh) {
           if (obj.material && obj.material.color) {
               const c = obj.material.color;
               add(c.r, c.g, c.b);
           }
       }
    });

    const sorted = Object.entries(stats)
        .map(([color, count]) => ({color, count}))
        .sort((a, b) => b.count - a.count);
    
    if (sorted.length > 0) {
        window.parent.postMessage({ type: 'voxel_stats', stats: sorted, total }, '*');
    }
  }

  // Check repeatedly until scene is populated, then wait a moment for animations/generation to settle
  let checks = 0;
  const interval = setInterval(() => {
    // We assume if there are children, the scene has started generating
    if (window.scene && window.scene.children.length > 0) {
         // Debounce slightly to allow full generation
         setTimeout(analyzeScene, 2000);
         clearInterval(interval);
    } else {
        checks++;
        if (checks > 20) clearInterval(interval); // Stop checking after ~20s
    }
  }, 1000);
})();
</script>
  `;

  if (modifiedHtml.includes('</body>')) {
    return modifiedHtml.replace('</body>', analysisScript + '</body>');
  }
  return modifiedHtml + analysisScript;
};

/**
 * Injects a vertical slider to control a clipping plane, simulating 3D printing layers.
 */
export const injectLayerSlider = (html: string): string => {
  // 1. Enable localClipping on renderer
  // Matches: const renderer = new THREE.WebGLRenderer(...);
  const rendererRegex = /(const|let|var)\s+(\w+)\s*=\s*new\s+(?:THREE\.)?WebGLRenderer\s*\([^)]*\);/g;
  let modifiedHtml = html.replace(rendererRegex, '$& $2.localClippingEnabled = true;');

  // 2. Inject UI and Logic
  const script = `
<style>
  #layer-control-container {
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    height: 300px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 9000;
    pointer-events: auto !important; /* Ensure clickable */
  }
  
  .slider-track {
    position: relative;
    width: 40px;
    height: 250px;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(4px);
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(0,0,0,0.05);
  }

  /* Rotate range input to make it vertical */
  #layer-slider {
    width: 200px;
    transform: rotate(-90deg);
    cursor: grab;
    accent-color: black;
  }
  
  .layer-icon {
    font-size: 16px;
    opacity: 0.6;
    margin-bottom: -4px;
  }
  
  .layer-tooltip {
    font-family: sans-serif;
    font-size: 10px;
    font-weight: bold;
    color: #333;
    background: white;
    padding: 4px 8px;
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    opacity: 0;
    transition: opacity 0.2s;
    position: absolute;
    right: 50px;
    white-space: nowrap;
    pointer-events: none;
  }
  
  #layer-control-container:hover .layer-tooltip {
    opacity: 1;
  }
</style>

<div id="layer-control-container">
    <div class="layer-tooltip">Layer View</div>
    <div style="font-size:12px">🔼</div>
    <div class="slider-track">
        <input type="range" id="layer-slider" min="0" max="100" value="100">
    </div>
    <div style="font-size:12px">🔽</div>
</div>

<script>
(function() {
    setTimeout(() => {
        if (!window.scene) return;
        
        // Calculate Scene Height Bounds
        const box = new THREE.Box3().setFromObject(window.scene);
        if (box.isEmpty()) return;
        
        const minY = box.min.y;
        const maxY = box.max.y;
        
        // Create Clipping Plane (Normal pointing down: 0, -1, 0)
        // Everything with y < constant is visible
        const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), maxY + 0.1);
        
        // Add plane to all materials
        window.scene.traverse((obj) => {
            if (obj.material) {
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                materials.forEach(m => {
                    m.clippingPlanes = [plane];
                    // m.clipShadows = true; 
                });
            }
        });
        
        // Setup Slider
        const slider = document.getElementById('layer-slider');
        // Add a small buffer so we can see everything easily at max
        slider.min = minY - 1;
        slider.max = maxY + 1;
        slider.step = 0.1;
        slider.value = maxY + 1;
        
        slider.addEventListener('input', (e) => {
            plane.constant = parseFloat(e.target.value);
        });
        
    }, 2500); // Wait for potential animations to settle
})();
</script>
`;

  if (modifiedHtml.includes('</body>')) {
    return modifiedHtml.replace('</body>', script + '</body>');
  }
  return modifiedHtml + script;
};
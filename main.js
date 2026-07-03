/* Hyang Planetary Engine Main Controller */
import { GRID_WIDTH, GRID_HEIGHT, BIOMES } from './core/config.js';
import { createSeededRandom } from './core/utils.js';
import { generateTerrain } from './terrainGenerator.js';
import { renderPhysicalWorld } from './renderer.js';
import { PlanetaryConfig, PRESETS } from './core/planetaryPhysics.js';
import { InfiniteWorldStreamer } from './core/infiniteStreamer.js';

let infiniteStreamer = null;

let world = {
    seed: "Hyang-Titan",
    worldType: 'endless',
    worldScale: 4.0,
    chunkX: 0,
    chunkY: 0,
    planetConfig: new PlanetaryConfig(),
    elevation: null,
    riverFlow: null,
    flowDirection: null,
    moisture: null,
    temperature: null,
    stratigraphy: null,
    biomeIds: null,
    plateGrid: null,
    tectonicBoundaryGrid: null
};

let currentMode = 'elevation';
let canvas, ctx;
let is3DGlobe = false;

// Zoom and Pan State
let zoom = 0.85;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// Three.js Globe variables
let globeScene, globeCamera, globeRenderer, globeSphere, globeControls, cloudsSphere;

window.onload = async () => {
    canvas = document.getElementById('map-canvas');
    const hudCanvas = document.getElementById('hud-canvas');
    const container = document.getElementById('canvas-container');

    if (world.worldType === 'endless') {
        // For endless streaming, canvas fills the full container so chunks tile the screen.
        const cw = container.clientWidth  || window.innerWidth;
        const ch = container.clientHeight || (window.innerHeight - 64);
        canvas.width  = cw;
        canvas.height = ch;
        if (hudCanvas) { hudCanvas.width = cw; hudCanvas.height = ch; }
        canvas.classList.add('endless-mode');
        if (hudCanvas) hudCanvas.classList.add('endless-mode');
        canvas.style.transform = '';
        const endlessNav = document.getElementById('endless-nav');
        if (endlessNav) endlessNav.classList.remove('hidden');
        // ctx stays null — InfiniteWorldStreamer acquires the 2d context itself
    } else {
        // Finite world: fixed 1024×1024 grid, centred in the container
        canvas.width  = GRID_WIDTH;
        canvas.height = GRID_HEIGHT;
        if (hudCanvas) { hudCanvas.width = GRID_WIDTH; hudCanvas.height = GRID_HEIGHT; }
        canvas.classList.add('finite-mode');
        if (hudCanvas) hudCanvas.classList.add('finite-mode');
        // Acquire 2D context AFTER setting canvas size to avoid invalidation
        ctx = canvas.getContext('2d');
    }

    setupListeners();
    if (world.worldType !== 'endless') {
        initThreeGlobe();
    }
    await generateWorld("Hyang-" + Math.floor(Math.random() * 99999));
};

function initThreeGlobe() {
    const container = document.getElementById('globe-container');
    globeScene = new THREE.Scene();
    globeCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight || 1, 0.1, 1000);
    globeCamera.position.z = 3.5;

    globeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    globeRenderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.warn("Three.js WebGL context lost");
    }, false);
    globeRenderer.domElement.addEventListener('webglcontextrestored', () => {
        console.log("Three.js WebGL context restored");
        updateThreeGlobeTexture();
    }, false);
    globeRenderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    globeRenderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(globeRenderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    globeScene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 3, 5);
    globeScene.add(dirLight);

    // Planet Sphere Geometry (High subdivision for relief)
    const geometry = new THREE.SphereGeometry(1.2, 128, 128);
    const material = new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0.1
    });
    globeSphere = new THREE.Mesh(geometry, material);
    globeScene.add(globeSphere);

    // Cloud Halo
    const cloudGeo = new THREE.SphereGeometry(1.225, 64, 64);
    const cloudMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending
    });
    cloudsSphere = new THREE.Mesh(cloudGeo, cloudMat);
    globeScene.add(cloudsSphere);

    if (window.OrbitControls) {
        globeControls = new window.OrbitControls(globeCamera, globeRenderer.domElement);
        globeControls.enableDamping = true;
        globeControls.dampingFactor = 0.05;
        globeControls.rotateSpeed = 0.7;
    }

    function animateGlobe() {
        requestAnimationFrame(animateGlobe);
        if (is3DGlobe) {
            if (!isDragging) globeSphere.rotation.y += 0.001;
            cloudsSphere.rotation.y += 0.0015;
            if (globeControls) globeControls.update();
            globeRenderer.render(globeScene, globeCamera);
        }
    }
    animateGlobe();

    window.addEventListener('resize', () => {
        if (!is3DGlobe) return;
        globeCamera.aspect = container.clientWidth / container.clientHeight;
        globeCamera.updateProjectionMatrix();
        globeRenderer.setSize(container.clientWidth, container.clientHeight);
    });
}

function updateThreeGlobeTexture() {
    if (!globeSphere) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    globeSphere.material.map = texture;

    // Build Displacement map from elevation
    const dispCanvas = document.createElement('canvas');
    dispCanvas.width = GRID_WIDTH;
    dispCanvas.height = GRID_HEIGHT;
    const dispCtx = dispCanvas.getContext('2d');
    const dispImg = dispCtx.createImageData(GRID_WIDTH, GRID_HEIGHT);
    const dData = dispImg.data;
    for (let i = 0; i < world.elevation.length; i++) {
        const e = world.elevation[i];
        const val = e < 0.42 ? 0 : Math.floor((e - 0.42) / 0.58 * 255);
        dData[i * 4] = val;
        dData[i * 4 + 1] = val;
        dData[i * 4 + 2] = val;
        dData[i * 4 + 3] = 255;
    }
    dispCtx.putImageData(dispImg, 0, 0);
    const dispTex = new THREE.CanvasTexture(dispCanvas);
    dispTex.needsUpdate = true;
    globeSphere.material.displacementMap = dispTex;
    globeSphere.material.displacementScale = 0.15;
    globeSphere.material.needsUpdate = true;
}

function setupListeners() {
    const seedInput = document.getElementById('seed-input');
    const genBtn = document.getElementById('btn-generate');
    const toggleViewBtn = document.getElementById('btn-toggle-view');
    const typeSelect = document.getElementById('world-type-select');
    const endlessNav = document.getElementById('endless-nav');
    const sectorDisplay = document.getElementById('sector-display');

    const scaleSelect = document.getElementById('select-world-scale');
    if (scaleSelect) {
        scaleSelect.addEventListener('change', async () => {
            world.worldScale = parseFloat(scaleSelect.value);
            await generateWorld(world.seed);
        });
    }

    if (typeSelect) {
        typeSelect.addEventListener('change', async () => {
            world.worldType = typeSelect.value;
            if (world.worldType === 'endless') {
                if (endlessNav) endlessNav.classList.remove('hidden');
                canvas.style.transform = 'translate(0px, 0px) scale(1)';
            } else {
                if (endlessNav) endlessNav.classList.add('hidden');
            }
            await generateWorld(world.seed);
        });
    }

    const recenterBtn = document.getElementById('btn-recenter-stream');
    if (recenterBtn) {
        recenterBtn.addEventListener('click', () => {
            if (infiniteStreamer) {
                infiniteStreamer.cameraX = 0;
                infiniteStreamer.cameraY = 0;
                infiniteStreamer.render();
            }
        });
    }

    genBtn.addEventListener('click', async () => {
        const seed = seedInput.value.trim() || ("Hyang-" + Math.floor(Math.random() * 99999));
        seedInput.value = seed;
        await generateWorld(seed);
    });

    seedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') genBtn.click();
    });

    if (toggleViewBtn) {
        toggleViewBtn.addEventListener('click', () => {
            is3DGlobe = !is3DGlobe;
            const cCont = document.getElementById('canvas-container');
            const gCont = document.getElementById('globe-container');
            if (is3DGlobe) {
                cCont.classList.add('hidden');
                gCont.classList.remove('hidden');
                if (!globeRenderer) {
                    initThreeGlobe();
                }
                toggleViewBtn.innerHTML = '<span>🗺️ Toggle 2D Tactical View</span>';
                updateThreeGlobeTexture();
            } else {
                gCont.classList.add('hidden');
                cCont.classList.remove('hidden');
                toggleViewBtn.innerHTML = '<span>🌐 Toggle 3D Globe</span>';
            }
        });
    }

    // Map Modes
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
            render();
            if (is3DGlobe) updateThreeGlobeTexture();
        });
    });

    // Planet Lab Panel Handlers
    const labPanel = document.getElementById('planet-lab-panel');
    document.getElementById('btn-planet-lab').addEventListener('click', () => {
        labPanel.classList.toggle('hidden');
        updatePlanetLabUI();
    });
    document.getElementById('close-planet-lab').addEventListener('click', () => {
        labPanel.classList.add('hidden');
    });

    function readPlanetSliders() {
        const water = parseFloat(document.getElementById('slider-water').value);
        const mass  = parseFloat(document.getElementById('slider-mass').value);
        const lumin = parseFloat(document.getElementById('slider-lumin').value);
        const tilt  = parseFloat(document.getElementById('slider-tilt').value);
        const heat  = parseFloat(document.getElementById('slider-heat').value);
        const radius = Math.pow(mass, 0.27); // Mass-radius scaling M ∝ R^3.7
        return new PlanetaryConfig({
            water_fraction: water,
            mass_ratio: mass,
            radius_ratio: radius,
            star_luminosity: lumin,
            axial_tilt: tilt,
            radioactive_heat: heat
        });
    }

    function updatePlanetLabUI(cfg = null) {
        if (!cfg) cfg = readPlanetSliders();
        document.getElementById('val-water').innerText = `${Math.round(cfg.water_fraction * 100)}%`;
        document.getElementById('val-gravity').innerText = `${cfg.mass_ratio.toFixed(2)} M⊕`;
        document.getElementById('val-lumin').innerText = `${cfg.star_luminosity.toFixed(2)} L☉`;
        document.getElementById('val-tilt').innerText = `${cfg.axial_tilt.toFixed(1)}°`;
        document.getElementById('val-heat').innerText = `${cfg.radioactive_heat.toFixed(2)}× H₀`;

        const s = cfg.summary();
        document.getElementById('out-grav').innerText = s.gravity;
        document.getElementById('out-esc').innerText = s.escape;
        document.getElementById('out-temp').innerText = s.T_eq;
        document.getElementById('out-sea').innerText = s.sea_level;
        document.getElementById('out-lapse').innerText = s.lapse;
    }

    ['slider-water', 'slider-mass', 'slider-lumin', 'slider-tilt', 'slider-heat'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            updatePlanetLabUI();
        });
    });

    document.getElementById('preset-select').addEventListener('change', (e) => {
        const preset = PRESETS[e.target.value];
        if (preset) {
            document.getElementById('slider-water').value = preset.water_fraction;
            document.getElementById('slider-mass').value = preset.mass_ratio;
            document.getElementById('slider-lumin').value = preset.star_luminosity;
            document.getElementById('slider-tilt').value = preset.axial_tilt;
            document.getElementById('slider-heat').value = preset.radioactive_heat;
            updatePlanetLabUI(preset);
        }
    });

    document.getElementById('btn-apply-planet').addEventListener('click', async () => {
        world.planetConfig = readPlanetSliders();
        labPanel.classList.add('hidden');
        await generateWorld(world.seed);
    });

    // Hover Inspector
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        if (world.worldType === 'endless' && infiniteStreamer) {
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            const hit = infiniteStreamer.inspectAtScreen(sx, sy);
            if (hit && hit.world) {
                const prevWorld = world;
                world = hit.world;
                updateInspector(hit.localX, hit.localY);
                world = prevWorld;
            }
            return;
        }
        if (!world.elevation) return;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);

        if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
            updateInspector(x, y);
        }
    });

    // Zoom / Pan on Canvas Container
    const container = document.getElementById('canvas-container');
    container.addEventListener('wheel', (e) => {
        if (world.worldType === 'endless' && infiniteStreamer) return;
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        zoom = Math.max(0.3, Math.min(8.0, zoom * zoomFactor));
        applyTransform();
    });

    container.addEventListener('mousedown', (e) => {
        if (world.worldType === 'endless' && infiniteStreamer) return;
        isDragging = true;
        dragStartX = e.clientX - offsetX;
        dragStartY = e.clientY - offsetY;
    });

    window.addEventListener('mousemove', (e) => {
        if (world.worldType === 'endless' && infiniteStreamer) return;
        if (!isDragging) return;
        offsetX = e.clientX - dragStartX;
        offsetY = e.clientY - dragStartY;
        applyTransform();
    });

    window.addEventListener('mouseup', () => {
        if (world.worldType === 'endless' && infiniteStreamer) return;
        isDragging = false;
    });
}

function applyTransform() {
    canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
}

const BIOMES_LIST = Object.values(BIOMES);
const STRAT_NAMES = ["Sedimentary Basin", "Metamorphic Karst", "Granite Shield", "Oceanic Basalt"];

function updateInspector(x, y) {
    const idx = y * GRID_WIDTH + x;
    const e = world.elevation[idx];
    const m = world.moisture ? world.moisture[idx] : 0;
    const t = world.temperature ? world.temperature[idx] : 0;
    const r = world.riverFlow ? world.riverFlow[idx] : 0;
    const strat = world.stratigraphy ? world.stratigraphy[idx] : 0;
    const bIdx = world.biomeIds ? world.biomeIds[idx] : 1;
    const plateId = world.plateGrid ? world.plateGrid[idx] : 0;

    const p = world.planetConfig || new PlanetaryConfig();
    const sl = p.sea_level;

    document.getElementById('insp-coords').innerText = `${x}, ${y}`;
    
    let altMeter = 0;
    let altText = "";
    let elevType = "";
    if (e >= sl) {
        const norm = Math.max(0, Math.min(1.0, (e - sl) / Math.max(0.01, 1.0 - sl)));
        altMeter = Math.round(Math.pow(norm, 2.2) * 8848);
        altText = `+${altMeter}m`;
        if (norm < 0.15) {
            elevType = "Lowland Valley";
        } else if (norm < 0.45) {
            elevType = "Hills & Plateaus";
        } else if (norm < 0.75) {
            elevType = "Highlands";
        } else {
            elevType = "Mountain Peak";
        }
    } else {
        const depthNorm = Math.max(0, Math.min(1.0, (sl - e) / Math.max(0.01, sl)));
        altMeter = -Math.round(Math.pow(depthNorm, 1.8) * 10935);
        if (depthNorm > 0.6) {
            elevType = "Ocean Trench";
            altText = `${altMeter}m (Trench)`;
        } else if (depthNorm > 0.25) {
            elevType = "Abyssal Plain";
            altText = `${altMeter}m (Abyssal)`;
        } else {
            elevType = "Continental Shelf";
            altText = `${altMeter}m (Shelf)`;
        }
    }
    document.getElementById('insp-alt').innerText = altText;
    document.getElementById('insp-elev-type').innerText = elevType;
    
    const tempCelsius = Math.round((t - 0.25) * 65);
    document.getElementById('insp-temp').innerText = `${tempCelsius}°C`;
    
    document.getElementById('insp-moisture').innerText = `${Math.floor(m * 100)}%`;
    document.getElementById('insp-river').innerText = r > 100 ? `${Math.floor(r)} m³/s` : 'None';
    document.getElementById('insp-strat').innerText = STRAT_NAMES[strat] || "Sedimentary";
    const regimeLabel = world.geodynamics && world.geodynamics.regime === 'stagnant_lid' ? 'Stagnant Lid Craton' : 'Dynamic Plate';
    document.getElementById('insp-plate').innerText = `${regimeLabel} #${plateId + 1}`;

    const biomeObj = BIOMES_LIST[bIdx] || BIOMES.GRASSLAND;
    const badge = document.getElementById('insp-biome');
    badge.innerText = biomeObj.name;
    badge.style.backgroundColor = biomeObj.color;
    badge.style.color = e < sl ? '#fff' : '#000';

    let biomeType = "Terrestrial";
    switch (biomeObj.name) {
        case "Deep Ocean":
        case "Ocean":
            biomeType = "Marine";
            break;
        case "River":
            biomeType = "Freshwater";
            break;
        case "Wetland":
            biomeType = "Wetland";
            break;
        case "Beach":
            biomeType = "Coastal";
            break;
        case "Grassland":
        case "Savanna":
            biomeType = "Grassland";
            break;
        case "Forest":
        case "Jungle":
        case "Taiga":
            biomeType = "Forest";
            break;
        case "Tundra":
            biomeType = "Tundra";
            break;
        case "Desert":
            biomeType = "Arid / Desert";
            break;
        case "Mountain":
            biomeType = "Alpine";
            break;
        case "Snowy Peak":
            biomeType = "Glacial";
            break;
        default:
            biomeType = "Terrestrial";
    }
    document.getElementById('insp-biome-type').innerText = biomeType;
}

async function generateWorld(seed) {
    const overlay = document.getElementById('status-overlay');
    const statusText = document.getElementById('status-text');
    overlay.classList.remove('hidden');

    if (world.worldType === 'endless') {
        statusText.innerText = `Initializing for '${seed}'...`;
        await new Promise(r => setTimeout(r, 30));
        if (!infiniteStreamer) {
            infiniteStreamer = new InfiniteWorldStreamer('map-canvas');
            infiniteStreamer.onHUDUpdate = (wx, wy, loaded, pending) => {
                const coordsEl = document.getElementById('infinite-coords');
                const statsEl = document.getElementById('infinite-stats');
                if (coordsEl) coordsEl.innerText = `Pos: X: ${Math.round(wx * 1024)} km, Y: ${Math.round(wy * 1024)} km`;
                if (statsEl) statsEl.innerText = `Generated Sectors: ${loaded} | Generating: ${pending}`;
            };
        }
        infiniteStreamer.currentMode = currentMode;
        infiniteStreamer.resetStream(seed, world.planetConfig);
        overlay.classList.add('hidden');
        return;
    }

    statusText.innerText = `Simulating for '${seed}'...`;
    await new Promise(r => setTimeout(r, 50));

    world.seed = seed;
    const rand = createSeededRandom(seed);
    const size = GRID_WIDTH * GRID_HEIGHT;
    if (!world.elevation) world.elevation = new Float32Array(size);
    if (!world.riverFlow) world.riverFlow = new Float32Array(size);

    try {
        await generateTerrain(world, rand, (curr, total) => {
            statusText.innerText = `Erosion & Hydrology (${Math.round((curr / total) * 100)}%)...`;
        });
        statusText.innerText = "Rendering tiles...";
        await new Promise(r => setTimeout(r, 20));
        render();
        updateInspector(GRID_WIDTH / 2, GRID_HEIGHT / 2);
        if (is3DGlobe) updateThreeGlobeTexture();
    } catch (err) {
        console.error("Generation failed:", err);
        statusText.innerText = "Error during generation: " + err.message;
        return;
    }

    overlay.classList.add('hidden');
}

function render() {
    if (world.worldType === 'endless' && infiniteStreamer) {
        infiniteStreamer.setMode(currentMode);
    } else {
        renderPhysicalWorld(ctx, world, currentMode);
    }
}

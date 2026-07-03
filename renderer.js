/* Hyang Physical World Renderer */
import { GRID_WIDTH, GRID_HEIGHT, BIOMES } from './core/config.js';

export const BIOMES_LIST = [
    BIOMES.DEEP_OCEAN,
    BIOMES.OCEAN,
    BIOMES.RIVER,
    BIOMES.WETLAND,
    BIOMES.BEACH,
    BIOMES.GRASSLAND,
    BIOMES.SAVANNA,
    BIOMES.FOREST,
    BIOMES.JUNGLE,
    BIOMES.TAIGA,
    BIOMES.TUNDRA,
    BIOMES.DESERT,
    BIOMES.MOUNTAIN,
    BIOMES.SNOW
];

const PLATE_COLORS = [
    "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
    "#14b8a6", "#a855f7", "#eab308", "#d946ef", "#64748b"
];

// Pre-parsed plate colors as RGB arrays for fast access
const PLATE_RGB = PLATE_COLORS.map(hex => {
    const h = hex.replace('#', '');
    return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
});

// Pre-parsed biome colors as RGB arrays
const BIOME_RGB = BIOMES_LIST.map(biome => {
    const h = biome.color.replace('#', '');
    return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
});

let imageData = null;

export function renderPhysicalWorld(ctx, world, mode = 'biomes') {

    if (!imageData || imageData.width !== GRID_WIDTH || imageData.height !== GRID_HEIGHT || !imageData.data || imageData.data.length === 0) {
        imageData = ctx.createImageData(GRID_WIDTH, GRID_HEIGHT);
    }
    const data = imageData.data;

    const elevation    = world.elevation;
    const moisture     = world.moisture;
    const temperature  = world.temperature;
    const riverFlow    = world.riverFlow;
    const biomeIds     = world.biomeIds;
    const stratigraphy = world.stratigraphy;
    const plateGrid    = world.plateGrid;
    const boundaryGrid = world.tectonicBoundaryGrid;
    const sl           = world.planetConfig ? world.planetConfig.sea_level : 0.42;

    for (let y = 0; y < GRID_HEIGHT; y++) {
        const row = y * GRID_WIDTH;
        for (let x = 0; x < GRID_WIDTH; x++) {
            const i = row + x;
            const idx = i * 4;
            const e = elevation ? elevation[i] : 0;
            const m = moisture  ? moisture[i]  : 0;
            const t = temperature ? temperature[i] : 0;
            const r = riverFlow ? riverFlow[i] : 0;

            let rVal = 0, gVal = 0, bVal = 0;

            let shade = 1.0;
            if (elevation && (e >= sl || mode === 'tectonics' || mode === 'stratigraphy')) {
                const eL = x > 0 ? elevation[i - 1] : e;
                const eR = x < GRID_WIDTH - 1 ? elevation[i + 1] : e;
                const eU = y > 0 ? elevation[i - GRID_WIDTH] : e;
                const eD = y < GRID_HEIGHT - 1 ? elevation[i + GRID_WIDTH] : e;
                const dzdx = (x === 0 || x === GRID_WIDTH - 1 ? (eR - eL) * 2.0 : (eR - eL)) * 4.0;
                const dzdy = (y === 0 || y === GRID_HEIGHT - 1 ? (eD - eU) * 2.0 : (eD - eU)) * 4.0;
                const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1.0);
                const dot = (-dzdx * 0.5 + dzdy * 0.5 + 0.7071) / len;
                shade = 0.55 + 0.80 * (dot > 0 ? dot : 0);
            }

            if (mode === 'biomes') {
                if (e >= sl) {
                    const biomeIdx = biomeIds ? biomeIds[i] : 1;
                    const rgb = BIOME_RGB[biomeIdx] || BIOME_RGB[5];
                    rVal = Math.min(255, rgb[0] * shade);
                    gVal = Math.min(255, rgb[1] * shade);
                    bVal = Math.min(255, rgb[2] * shade);
                } else {
                    const depth = Math.max(0, Math.min(1, e / sl));
                    rVal = Math.floor(4  + depth * 18);
                    gVal = Math.floor(12 + depth * 32);
                    bVal = Math.floor(38 + depth * 48);
                }

            } else if (mode === 'elevation') {
                if (e < sl * 0.48) {
                    rVal = 4; gVal = 10; bVal = 30;
                } else if (e < sl) {
                    const depth = (e - sl * 0.48) / (sl * 0.52 || 0.1);
                    rVal = Math.floor(8  + depth * 16);
                    gVal = Math.floor(22 + depth * 50);
                    bVal = Math.floor(68 + depth * 80);
                } else {
                    const height = (e - sl) / (1.0 - sl || 0.58);
                    if (height < 0.08) {
                        rVal = 214; gVal = 196; bVal = 150;
                    } else if (height < 0.35) {
                        const h = (height - 0.08) / 0.27;
                        rVal = Math.floor(88  - h * 20);
                        gVal = Math.floor(148 - h * 30);
                        bVal = Math.floor(78  - h * 18);
                    } else if (height < 0.65) {
                        const h = (height - 0.35) / 0.30;
                        rVal = Math.floor(140 + h * 60);
                        gVal = Math.floor(118 + h * 30);
                        bVal = Math.floor(80  + h * 30);
                    } else if (height < 0.88) {
                        const h = (height - 0.65) / 0.23;
                        rVal = Math.floor(160 + h * 60);
                        gVal = Math.floor(148 + h * 60);
                        bVal = Math.floor(140 + h * 60);
                    } else {
                        rVal = 238; gVal = 244; bVal = 255;
                    }
                    rVal = Math.min(255, rVal * shade);
                    gVal = Math.min(255, gVal * shade);
                    bVal = Math.min(255, bVal * shade);
                }

            } else if (mode === 'moisture') {
                if (e < sl) {
                    rVal = 14; gVal = 24; bVal = 48;
                } else {
                    rVal = Math.floor(230 - m * 190);
                    gVal = Math.floor(215 - m * 65);
                    bVal = Math.floor(175 + m * 75);
                }

            } else if (mode === 'temperature') {
                if (e < sl) {
                    rVal = 15; gVal = 28; bVal = 60;
                } else {
                    const tc = Math.max(0, Math.min(1, t));
                    rVal = Math.floor(20  + 235 * Math.pow(tc, 0.7));
                    gVal = Math.floor(10  + 160 * Math.sin(tc * Math.PI));
                    bVal = Math.floor(200 - 180 * Math.pow(tc, 0.6));
                }

            } else if (mode === 'rivers') {
                if (e < sl) {
                    rVal = 8; gVal = 28; bVal = 72;
                } else if (r > 600) {
                    const flowIntensity = Math.min(1.0, Math.log10(r) / 5.5);
                    rVal = Math.floor(20  + flowIntensity * 36);
                    gVal = Math.floor(120 + flowIntensity * 80);
                    bVal = Math.floor(210 + flowIntensity * 45);
                } else {
                    const base = Math.floor(30 + e * 55);
                    rVal = Math.min(255, base * shade);
                    gVal = Math.min(255, base * shade);
                    bVal = Math.min(255, base * shade);
                }

            } else if (mode === 'stratigraphy') {
                const strat = stratigraphy ? stratigraphy[i] : 0;
                if (e < sl) {
                    rVal = 12; gVal = 18; bVal = 40;
                } else if (strat === 2) {
                    rVal = 160; gVal = 168; bVal = 180;
                } else if (strat === 1) {
                    rVal = 95; gVal = 110; bVal = 128;
                } else {
                    rVal = 200; gVal = 178; bVal = 128;
                }
                rVal = Math.min(255, rVal * shade);
                gVal = Math.min(255, gVal * shade);
                bVal = Math.min(255, bVal * shade);

            } else if (mode === 'tectonics') {
                const plateId = plateGrid ? plateGrid[i] : 0;
                const bType = boundaryGrid ? boundaryGrid[i] : 0;
                if (bType > 0) {
                    if      (bType === 1) { rVal = 251; gVal = 210; bVal = 24;  }
                    else if (bType === 2) { rVal = 239; gVal = 58;  bVal = 58;  }
                    else if (bType === 3) { rVal = 168; gVal = 85;  bVal = 247; }
                    else                  { rVal = 248; gVal = 248; bVal = 248; }
                } else {
                    const rgb = PLATE_RGB[Math.abs(plateId) % PLATE_RGB.length];
                    rVal = Math.floor(rgb[0] * 0.38);
                    gVal = Math.floor(rgb[1] * 0.38);
                    bVal = Math.floor(rgb[2] * 0.38);
                    const clampedShade = Math.min(1.4, Math.max(0.6, shade));
                    rVal = Math.min(255, rVal * clampedShade);
                    gVal = Math.min(255, gVal * clampedShade);
                    bVal = Math.min(255, bVal * clampedShade);
                }
            }

            if (mode !== 'rivers' && mode !== 'tectonics' && e >= sl && r > 1200) {
                rVal = 48; gVal = 180; bVal = 248;
            }

            data[idx]     = rVal;
            data[idx + 1] = gVal;
            data[idx + 2] = bVal;
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return imageData;
}

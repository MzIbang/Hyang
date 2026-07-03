/* Hyang Physical World Generation Utilities */

import { GRID_WIDTH, GRID_HEIGHT, BIOMES } from './config.js';

export function createSeededRandom(seed) {
    let h = 1779033703, i = 0, ch;
    for (i = 0; i < seed.length; i++) {
        ch = seed.charCodeAt(i);
        h = Math.imul(h ^ ch, 2654435761);
    }
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    let a = (h ^= h >>> 16) >>> 0;

    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

export function SimpleNoise(rand) {
    const p = Array.from({length: 256}, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = p.concat(p);
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (t, a, b) => a + t * (b - a);
    const grad = (hash, x, y) => {
        const h = hash & 7;
        const u = h < 4 ? x : y;
        const v = h < 4 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    };
    return function(x, y) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        const u = fade(x), v = fade(y);
        const aa = perm[X] + Y, ab = perm[X] + Y + 1, ba = perm[X + 1] + Y, bb = perm[X + 1] + Y + 1;
        return lerp(v, lerp(u, grad(perm[aa], x, y), grad(perm[ba], x - 1, y)), lerp(u, grad(perm[ab], x, y - 1), grad(perm[bb], x - 1, y - 1)));
    };
}

export function createVirtualTiles(world) {
    const biomesList = [
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
    return new Proxy([], {
        get(target, prop) {
            if (prop === 'length') {
                return world.elevation ? world.elevation.length : GRID_WIDTH * GRID_HEIGHT;
            }
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                const idx = Number(prop);
                if (world.elevation && idx < world.elevation.length) {
                    const w = world.GRID_WIDTH || GRID_WIDTH || 600;
                    return {
                        x: idx % w,
                        y: Math.floor(idx / w),
                        elevation: world.elevation[idx],
                        moisture: world.moisture ? world.moisture[idx] : 0,
                        temperature: world.temperature ? world.temperature[idx] : 0,
                        biome: world.biomeIds ? biomesList[world.biomeIds[idx]] : biomesList[1]
                    };
                }
            }
            return Reflect.get(target, prop);
        }
    });
}

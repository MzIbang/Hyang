import { GRID_WIDTH, GRID_HEIGHT, BIOMES } from './core/config.js';
import { createSeededRandom, SimpleNoise, createVirtualTiles } from './core/utils.js';
import { DEFAULT_PLANET } from './core/planetaryPhysics.js';
import { generateTectonics } from './tectonicsGenerator.js';
import { GeochemicalCycleModel } from './core/geochemistry.js';

let wasmInstance = null;

async function getWasm() {
    if (!wasmInstance) {
        const wasmUrl = new URL('./terrain.wasm', import.meta.url);
        let buffer;
        if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            const fs = await import('fs/promises');
            buffer = await fs.readFile(wasmUrl);
        } else {
            const response = await fetch(wasmUrl);
            buffer = await response.arrayBuffer();
        }
        const module = await WebAssembly.instantiate(buffer, { env: {} });
        wasmInstance = module.instance.exports;
    }
    return wasmInstance;
}

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

export async function generateTerrain(world, rand, progressCallback) {
    const rFunc = typeof rand === 'function' ? rand : createSeededRandom(world.seed || "hyang");
    const wasm = await getWasm();

    const seedBytes = new TextEncoder().encode(world.seed);
    const elevationPtr    = wasm.getElevationPtr();
    const riverFlowPtr    = wasm.getRiverFlowPtr();
    const flowDirectionPtr = wasm.getFlowDirectionPtr();

    // Phase 0.1: New Wasm atmospheric output pointers
    const moisturePtr     = wasm.getMoisturePtr ? wasm.getMoisturePtr() : 0;
    const temperaturePtr  = wasm.getTemperaturePtr ? wasm.getTemperaturePtr() : 0;
    const stratigraphyPtr = wasm.getStratigraphyPtr ? wasm.getStratigraphyPtr() : 0;
    const biomeIdsPtr     = wasm.getBiomeIdsPtr ? wasm.getBiomeIdsPtr() : 0;

    const memory = new Uint8Array(wasm.memory.buffer);

    // We can just write the seed bytes at the elevationPtr since it gets overwritten immediately
    memory.set(seedBytes, elevationPtr);

    wasm.initRand(elevationPtr, seedBytes.length);
    wasm.initNoise();

    if (wasm.setWorldType) wasm.setWorldType(world.worldType === 'island' ? 0 : 1);
    const scale = world.worldScale || (world.worldType === 'island' ? 1.0 : 4.0);
    if (wasm.setWorldScale) {
        wasm.setWorldScale(scale);
    }
    if (wasm.setChunkOffset) {
        const ox = world.chunkX ? world.chunkX * scale : 0.0;
        const oy = world.chunkY ? world.chunkY * scale : 0.0;
        wasm.setChunkOffset(ox, oy);
    }

    if (wasm.setPlanetParams) {
        const p = world.planetConfig || DEFAULT_PLANET;
        const params = typeof p.toWasm === 'function' ? p.toWasm() : [
            p.sea_level ?? 0.42,
            p.gravity_g ?? 1.0,
            p.eq_temp_norm ?? 0.625,
            p.lapse_norm ?? 1.0,
            p.axial_tilt ?? 23.5,
            p.water_fraction ?? 0.71
        ];
        wasm.setPlanetParams(...params);
    }

    wasm.generateFractalTerrain();
    if (progressCallback) progressCallback(10, 100);

    const size = GRID_WIDTH * GRID_HEIGHT;
    if (!world.elevation) world.elevation = new Float32Array(size);
    world.elevation.set(new Float32Array(wasm.memory.buffer, elevationPtr, size));

    // Run organic plate tectonics on the base fractal elevation field
    generateTectonics(world, rFunc);
    world.geochemistry = new GeochemicalCycleModel(world.planetConfig, world.geodynamics);

    // Write the tectonically uplifted/rifted elevation back to WASM linear memory before erosion!
    new Float32Array(wasm.memory.buffer, elevationPtr, size).set(world.elevation);

    wasm.runHydraulicErosion();
    if (progressCallback) progressCallback(35, 100);

    wasm.generateRivers();
    if (progressCallback) progressCallback(55, 100);

    // Sync JS rand to match WASM consumption (erosion uses nextRand internally)
    const calls = wasm.getRandCallCount();
    for (let i = 0; i < calls; i++) {
        rFunc();
    }

    // Copy elevation and river buffers back
    world.elevation.set(new Float32Array(wasm.memory.buffer, elevationPtr, size));
    if (!world.riverFlow) world.riverFlow = new Float32Array(size);
    world.riverFlow.set(new Float32Array(wasm.memory.buffer, riverFlowPtr, size));
    world.flowDirection = new Int32Array(wasm.memory.buffer, flowDirectionPtr, size).slice();

    // Phase 0.1: Run the full atmospheric + biome simulation entirely in Wasm
    // This replaces the old JS assignBiomes() / 5-pass Coriolis loop
    wasm.runAtmosphericSimulation();
    if (progressCallback) progressCallback(90, 100);

    // Read back all atmospheric outputs directly from Wasm linear memory
    world.moisture     = new Float32Array(wasm.memory.buffer, moisturePtr, size).slice();
    world.temperature  = new Float32Array(wasm.memory.buffer, temperaturePtr, size).slice();
    world.stratigraphy = new Uint8Array(wasm.memory.buffer, stratigraphyPtr, size).slice();
    world.biomeIds     = new Uint8Array(wasm.memory.buffer, biomeIdsPtr, size).slice();

    // Build virtual tile proxy for downstream consumers
    world.tiles = createVirtualTiles(world);

    if (progressCallback) progressCallback(100, 100);
}

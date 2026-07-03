/* Hyang Dedicated Parallel Simulation Worker (Multi-Core Wasm Engine) */
import { generateTerrain } from '../terrainGenerator.js';
import { renderPhysicalWorld } from '../renderer.js';
import { PlanetaryConfig } from './planetaryPhysics.js';
import { createSeededRandom } from './utils.js';

let offCanvas = null;
let offCtx = null;

self.onmessage = async (e) => {
    const { taskId, cx, cy, baseSeed, planetConfigData, mode } = e.data;
    try {
        const chunkWorld = {
            seed: baseSeed,
            worldType: 'endless',
            worldScale: 1.0,
            isStreaming: true,
            chunkX: cx,
            chunkY: cy,
            planetConfig: planetConfigData ? new PlanetaryConfig(planetConfigData) : new PlanetaryConfig()
        };

        const randFunc = createSeededRandom(`${baseSeed}_${cx}_${cy}`);
        await generateTerrain(chunkWorld, randFunc);

        if (!offCanvas) {
            offCanvas = new OffscreenCanvas(1024, 1024);
            offCtx = offCanvas.getContext('2d');
        } else {
            offCtx.clearRect(0, 0, 1024, 1024);
        }
        const imgData = renderPhysicalWorld(offCtx, chunkWorld, mode);

        let bitmap = null;
        let imgDataBuffer = null;
        try {
            bitmap = await createImageBitmap(imgData);
        } catch (bmErr) {
            try {
                bitmap = await createImageBitmap(offCanvas);
            } catch (bmErr2) {
                imgDataBuffer = imgData.data.buffer;
            }
        }

        // Transfer all typed array buffers directly to eliminate ~25MB of synchronous structured cloning per chunk.
        const transferables = [
            bitmap,
            imgDataBuffer,
            chunkWorld.elevation ? chunkWorld.elevation.buffer : null,
            chunkWorld.moisture ? chunkWorld.moisture.buffer : null,
            chunkWorld.temperature ? chunkWorld.temperature.buffer : null,
            chunkWorld.stratigraphy ? chunkWorld.stratigraphy.buffer : null,
            chunkWorld.biomeIds ? chunkWorld.biomeIds.buffer : null,
            chunkWorld.plateGrid ? chunkWorld.plateGrid.buffer : null,
            chunkWorld.riverFlow ? chunkWorld.riverFlow.buffer : null,
            chunkWorld.tectonicBoundaryGrid ? chunkWorld.tectonicBoundaryGrid.buffer : null
        ].filter(Boolean);

        self.postMessage({
            taskId,
            cx,
            cy,
            bitmap,
            imgDataBuffer,
            width: imgData.width,
            height: imgData.height,
            worldData: {
                seed: chunkWorld.seed,
                chunkX: cx,
                chunkY: cy,
                planetConfig: chunkWorld.planetConfig,
                elevation: chunkWorld.elevation,
                moisture: chunkWorld.moisture,
                temperature: chunkWorld.temperature,
                stratigraphy: chunkWorld.stratigraphy,
                biomeIds: chunkWorld.biomeIds,
                plateGrid: chunkWorld.plateGrid,
                riverFlow: chunkWorld.riverFlow,
                tectonicBoundaryGrid: chunkWorld.tectonicBoundaryGrid
            }
        }, transferables);
    } catch (err) {
        self.postMessage({ taskId, cx, cy, error: err && err.message ? err.message : String(err) });
    }
};

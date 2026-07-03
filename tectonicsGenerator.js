import { GRID_WIDTH, GRID_HEIGHT } from './core/config.js';
import { SimpleNoise, createSeededRandom } from './core/utils.js';
import { GeodynamicalModel, TECTONIC_REGIME } from './core/geodynamics.js';
import { IsostaticModel, CRUST_DENSITY } from './core/isostasy.js';

export const BOUNDARY_TYPES = {
    NONE: 0,
    DIVERGENT_RIFT: 1,
    CONVERGENT_COLLISION: 2,
    CONVERGENT_SUBDUCTION: 3,
    TRANSFORM_FAULT: 4
};

export function generateTectonics(world, rand) {
    const size = GRID_WIDTH * GRID_HEIGHT;
    const r = rand || Math.random;

    // Initialize physics-first geodynamical and isostatic models
    const geoModel = new GeodynamicalModel(world.planetConfig || {});
    const isoModel = new IsostaticModel(world.planetConfig || {});
    world.geodynamics = geoModel;
    world.isostasy = isoModel;

    const seedStr = world.seed ? String(world.seed) : "tec";
    const noiseX = SimpleNoise(createSeededRandom(seedStr + "_wx"));
    const noiseY = SimpleNoise(createSeededRandom(seedStr + "_wy"));
    const noiseZ = SimpleNoise(createSeededRandom(seedStr + "_wz"));

    const seaLevel = world.planetConfig ? world.planetConfig.sea_level : 0.42;
    const mantleVigor = world.planetConfig ? (world.planetConfig.radioactive_heat || 1.0) : 1.0;
    const wScale = world.worldScale || (world.worldType === 'island' ? 1.0 : 4.0);
    const numPlates = world.isStreaming ? Math.min(10, geoModel.plate_count) : Math.min(64, Math.floor(geoModel.plate_count * Math.sqrt(wScale * 2.0)));
    const speedFactor = geoModel.plate_speed_factor;

    // 1. Seed Tectonic Plates
    const plates = [];
    const plateRand = world.isStreaming ? createSeededRandom(seedStr + "_global_plates") : r;
    const plateRange = world.isStreaming ? 16 : 1;
    for (let i = 0; i < numPlates * (world.isStreaming ? 6 : 1); i++) {
        const pcx = Math.floor((-plateRange + plateRand() * (2 * plateRange)) * GRID_WIDTH);
        const pcy = Math.floor((-plateRange + plateRand() * (2 * plateRange)) * GRID_HEIGHT);
        const angle = plateRand() * Math.PI * 2;
        
        const baseSpeed = geoModel.regime === TECTONIC_REGIME.STAGNANT_LID ? 0.08 : (0.4 + plateRand() * 1.6);
        const speed = baseSpeed * speedFactor;
        
        plates.push({
            cx: pcx,
            cy: pcy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            type: plateRand() > 0.45 ? 'continental' : 'oceanic'
        });
    }
    world.plates = plates;

    // 2. Assign Voronoi Tectonic Regions & Fault Boundaries
    const chunkOffsetX = (world.chunkX || 0) * GRID_WIDTH;
    const chunkOffsetY = (world.chunkY || 0) * GRID_HEIGHT;
    const plateGrid = new Int16Array(size).fill(-1);
    const boundaryGrid = new Uint8Array(size).fill(BOUNDARY_TYPES.NONE);

    // Pre-filter candidate plates near this chunk (bounding radius 724 + warp offset 36 + safety margin 1500)
    const chunkCenterX = chunkOffsetX + GRID_WIDTH * 0.5;
    const chunkCenterY = chunkOffsetY + GRID_HEIGHT * 0.5;
    const plateDistList = plates.map((p, idx) => ({
        idx,
        p,
        dist: Math.hypot(p.cx - chunkCenterX, p.cy - chunkCenterY)
    })).sort((a, b) => a.dist - b.dist);
    const maxDistThreshold = (plateDistList[1] ? plateDistList[1].dist : plateDistList[0].dist) + 2300;
    const candidatePlates = plateDistList.filter(item => item.dist <= maxDistThreshold);

    for (let y = 0; y < GRID_HEIGHT; y++) {
        const gy = y + chunkOffsetY;
        for (let x = 0; x < GRID_WIDTH; x++) {
            const idx = y * GRID_WIDTH + x;
            const gx = x + chunkOffsetX;

            // Fast single-octave smooth domain warp instead of 6 expensive noise calls
            const warpX = 25 * noiseX(gx / 60, gy / 60);
            const warpY = 25 * noiseY(gx / 60, gy / 60);

            const wx = gx + warpX;
            const wy = gy + warpY;

            let d1Sq = 1e18, d2Sq = 1e18;
            let p1 = 0, p2 = 0;

            for (let c = 0; c < candidatePlates.length; c++) {
                const item = candidatePlates[c];
                const p = item.p;
                const dx = wx - p.cx;
                const dy = wy - p.cy;
                const distSq = dx * dx + dy * dy;

                if (distSq < d1Sq) {
                    d2Sq = d1Sq;
                    p2 = p1;
                    d1Sq = distSq;
                    p1 = item.idx;
                } else if (distSq < d2Sq) {
                    d2Sq = distSq;
                    p2 = item.idx;
                }
            }

            plateGrid[idx] = p1;

            const d1 = Math.sqrt(d1Sq);
            const d2 = Math.sqrt(d2Sq);
            const diff = d2 - d1;

            if (geoModel.regime === TECTONIC_REGIME.STAGNANT_LID) {
                const plumeNoise = noiseZ(x / 35, y / 35);
                if (plumeNoise > 0.45 && world.elevation) {
                    const dome = (plumeNoise - 0.45) * 0.35 * speedFactor;
                    world.elevation[idx] = Math.min(0.96, world.elevation[idx] + dome);
                    if (plumeNoise > 0.62) boundaryGrid[idx] = BOUNDARY_TYPES.DIVERGENT_RIFT;
                }
            } else if (geoModel.regime === TECTONIC_REGIME.EPISODIC_OVERTURN) {
                if (diff < 65 && world.elevation) {
                    const plumeNoise = noiseZ(x / 35, y / 35);
                    const weight = Math.max(0, 1.0 - diff / 65);
                    const sWeight = 0.5 - 0.5 * Math.cos(weight * Math.PI);
                    if (plumeNoise > 0.1) {
                        boundaryGrid[idx] = BOUNDARY_TYPES.CONVERGENT_COLLISION;
                        world.elevation[idx] = Math.min(0.98, world.elevation[idx] + sWeight * 0.22 * speedFactor);
                    } else {
                        boundaryGrid[idx] = BOUNDARY_TYPES.DIVERGENT_RIFT;
                        world.elevation[idx] = Math.max(0.18, world.elevation[idx] - sWeight * 0.18 * speedFactor);
                    }
                }
            } else {
                if (diff < 55) {
                    const plateA = plates[p1];
                    const plateB = plates[p2];

                    const nx = plateB.cx - plateA.cx;
                    const ny = plateB.cy - plateA.cy;
                    const len = Math.hypot(nx, ny) || 1;
                    const dirX = nx / len;
                    const dirY = ny / len;

                    const rvx = plateA.vx - plateB.vx;
                    const rvy = plateA.vy - plateB.vy;
                    const dot = rvx * dirX + rvy * dirY;

                    const effectiveStress = Math.abs(dot) * geoModel.convective_stress_norm;
                    const yieldThresh = geoModel.yield_resistance_norm * 0.12;

                    if (effectiveStress > yieldThresh) {
                        const weight = Math.max(0, 1.0 - diff / 55);
                        const sWeight = 0.5 - 0.5 * Math.cos(weight * Math.PI);
                        const ridgeNoise = Math.max(0.2, 0.65 + 0.35 * noiseZ(gx / 14, gy / 14));

                        let bType = BOUNDARY_TYPES.TRANSFORM_FAULT;

                        if (dot > 0.15) {
                            if (plateA.type === 'continental' && plateB.type === 'continental') {
                                bType = BOUNDARY_TYPES.CONVERGENT_COLLISION;
                                if (world.elevation) {
                                    const uplift = sWeight * ridgeNoise * (0.20 + Math.min(dot, 1.5) * 0.12) * speedFactor;
                                    world.elevation[idx] = Math.min(0.98, world.elevation[idx] + uplift);
                                }
                            } else {
                                bType = BOUNDARY_TYPES.CONVERGENT_SUBDUCTION;
                                if (world.elevation) {
                                    const baseUplift = sWeight * ridgeNoise * 0.13 * speedFactor * geoModel.water_lubrication;
                                    world.elevation[idx] = Math.min(0.96, isoModel.differentiateSubductionArc(world.elevation[idx] + baseUplift, dot, mantleVigor));
                                }
                            }
                        } else if (dot < -0.15) {
                            bType = BOUNDARY_TYPES.DIVERGENT_RIFT;
                            if (world.elevation && world.elevation[idx] > (seaLevel + 0.02)) {
                                const depression = sWeight * 0.13 * (0.7 + 0.3 * noiseZ(gx / 16, gy / 16)) * speedFactor;
                                world.elevation[idx] = Math.max(0.18, world.elevation[idx] - depression);
                            }
                        }

                        if (diff < 24) {
                            boundaryGrid[idx] = bType;
                        }
                    }
                }
            }
        }
    }

    world.plateGrid = plateGrid;
    world.tectonicBoundaryGrid = boundaryGrid;
}

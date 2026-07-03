/* Hyang Physical World Generation Configuration */

export const TILE_SIZE = 2.0;
export const GRID_WIDTH = 1024;
export const GRID_HEIGHT = 1024;

export const TERRAIN_OCTAVES = 6;
export const TERRAIN_PERSISTENCE = 0.5;
export const TERRAIN_LACUNARITY = 2.0;
export const TERRAIN_INITIAL_FREQUENCY = 2.0;
export const LANDMASS_EXPONENT = 1.2;
export const EROSION_ITERATIONS = 150000;
export const RIVER_COUNT = Math.floor(GRID_WIDTH * GRID_HEIGHT / 700);
export const RIVER_SOURCE_ELEVATION = 0.65;

export const BIOMES = {
    DEEP_OCEAN: { name: "Deep Ocean", color: "#061329", cost: 1000, dev: 0 },
    OCEAN: { name: "Ocean", color: "#0c2854", cost: 1000, dev: 0 },
    RIVER: { name: "River", color: "#38bdf8", cost: 10, dev: 2 },
    WETLAND: { name: "Wetland", color: "#10b981", cost: 15, dev: -0.5 },
    BEACH: { name: "Beach", color: "#fde047", cost: 2, dev: 3 },
    GRASSLAND: { name: "Grassland", color: "#4ade80", cost: 1, dev: 1 },
    SAVANNA: { name: "Savanna", color: "#eab308", cost: 2, dev: 0.5 },
    FOREST: { name: "Forest", color: "#15803d", cost: 5, dev: 1 },
    JUNGLE: { name: "Jungle", color: "#065f46", cost: 8, dev: 0.5 },
    TAIGA: { name: "Taiga", color: "#0f766e", cost: 7, dev: 0.5 },
    TUNDRA: { name: "Tundra", color: "#94a3b8", cost: 10, dev: -1 },
    DESERT: { name: "Desert", color: "#facc15", cost: 3, dev: 0 },
    MOUNTAIN: { name: "Mountain", color: "#64748b", cost: 20, dev: -1 },
    SNOW: { name: "Snowy Peak", color: "#ffffff", cost: 30, dev: -2 }
};

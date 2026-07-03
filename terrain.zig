const std = @import("std");

const GRID_WIDTH = 1024;
const GRID_HEIGHT = 1024;
const GRID_SIZE = GRID_WIDTH * GRID_HEIGHT;
const EROSION_ITERATIONS = 150000;

// Global arrays for static allocation (prevents stack overflow)
var elevation: [GRID_SIZE]f32 = undefined;
var riverFlow: [GRID_SIZE]f32 = undefined;
var flowDirection: [GRID_SIZE]i32 = undefined;
var processed: [GRID_SIZE]u8 = undefined;
var newElevation: [GRID_SIZE]f32 = undefined;
var sorted_indices: [GRID_SIZE]usize = undefined;

// Atmospheric and geological simulation buffers
var moisture: [GRID_SIZE]f32 = undefined;
var temperature: [GRID_SIZE]f32 = undefined;
var stratigraphy: [GRID_SIZE]u8 = undefined;
var biomeIds: [GRID_SIZE]u8 = undefined;
var moistureBuffer: [GRID_SIZE]f32 = undefined;
var baseContinentalHumidity: [GRID_SIZE]f32 = undefined;

// Secondary noise permutation table for bio/geo noise
var permBio: [512]u32 = undefined;
var permGeo: [512]u32 = undefined;

// Chunk offsets for multi-sector navigation
var chunk_offset_x_int: i32 = 0;
var chunk_offset_y_int: i32 = 0;

export fn getMoisturePtr() [*]f32 {
    return &moisture;
}
export fn getTemperaturePtr() [*]f32 {
    return &temperature;
}
export fn getStratigraphyPtr() [*]u8 {
    return &stratigraphy;
}
export fn getBiomeIdsPtr() [*]u8 {
    return &biomeIds;
}

export fn getElevationPtr() [*]f32 {
    return &elevation;
}
export fn getRiverFlowPtr() [*]f32 {
    return &riverFlow;
}
export fn getFlowDirectionPtr() [*]i32 {
    return &flowDirection;
}

var world_type: u32 = 1; // 1 = Endless Multi-Continent, 0 = Bounded Island
var chunk_offset_x: f64 = 0.0;
var chunk_offset_y: f64 = 0.0;

export fn setWorldType(t: u32) void {
    world_type = t;
}

// ─── Phase 1: Planetary Physics Parameters ───────────────────────────────────
// Received from core/planetaryPhysics.js via setPlanetParams().
// Defaults match Earth (water_fraction=0.71 → sea_level=0.42).
var planet_sea_level:     f32 = 0.42; // normalised elevation threshold for ocean surface
var planet_gravity_g:     f32 = 1.0;  // normalised gravity (Earth = 1.0)
var planet_eq_temp:       f32 = 0.625;// normalised equilibrium temperature (Earth ~15°C → 0.625)
var planet_lapse_norm:    f32 = 1.0;  // altitude lapse rate normalised (Earth = 1.0)
var planet_axial_tilt:    f32 = 23.5; // axial tilt in degrees
var planet_water_frac:    f32 = 0.71; // ocean water fraction [0,1]

/// Receive planetary constants from the JS PlanetaryConfig module.
/// Called once per world generation before runAtmosphericSimulation().
export fn setPlanetParams(
    sea_level:    f32,
    gravity_g:    f32,
    eq_temp:      f32,
    lapse_norm:   f32,
    axial_tilt:   f32,
    water_frac:   f32
) void {
    planet_sea_level  = sea_level;
    planet_gravity_g  = gravity_g;
    planet_eq_temp    = eq_temp;
    planet_lapse_norm = lapse_norm;
    planet_axial_tilt = axial_tilt;
    planet_water_frac = water_frac;
}
export fn setChunkOffset(ox: f64, oy: f64) void {
    chunk_offset_x = ox;
    chunk_offset_y = oy;
    chunk_offset_x_int = @intFromFloat(ox);
    chunk_offset_y_int = @intFromFloat(oy);
}

var world_scale: f64 = 1.0;

export fn setWorldScale(scale: f64) void {
    world_scale = scale;
}

var rand_state: u32 = 0;
var rand_call_count: u32 = 0;

export fn initRand(seed_ptr: [*]const u8, seed_len: usize) void {
    var h: u32 = 1779033703;
    var i: usize = 0;
    while (i < seed_len) : (i += 1) {
        const ch: u32 = seed_ptr[i];
        h = h ^ ch;
        h = h *% 2654435761;
    }
    h = h ^ (h >> 16);
    h = h *% 2246822507;
    h = h ^ (h >> 13);
    h = h *% 3266489909;
    h = h ^ (h >> 16);
    rand_state = h;
    rand_call_count = 0;
}

fn nextRand() f64 {
    rand_call_count += 1;
    rand_state +%= 0x6D2B79F5;
    var t = rand_state;
    t = (t ^ (t >> 15)) *% (t | 1);
    t ^= t +% ((t ^ (t >> 7)) *% (t | 61));
    const val: u32 = t ^ (t >> 14);
    return @as(f64, @floatFromInt(val)) / 4294967296.0;
}

export fn getRandCallCount() u32 {
    return rand_call_count;
}

// ─── Noise Utilities ────────────────────────────────────────────────────────

var perm: [512]u32 = undefined;

fn shufflePerm(src_state: u32, out_perm: *[512]u32) void {
    var p: [256]u32 = undefined;
    var i: usize = 0;
    while (i < 256) : (i += 1) {
        p[i] = @intCast(i);
    }
    // LCG shuffle using provided seed state
    var s = src_state;
    i = 255;
    while (i > 0) : (i -= 1) {
        s +%= 0x6D2B79F5;
        var t2 = s;
        t2 = (t2 ^ (t2 >> 15)) *% (t2 | 1);
        t2 ^= t2 +% ((t2 ^ (t2 >> 7)) *% (t2 | 61));
        const r: u32 = t2 ^ (t2 >> 14);
        const j: usize = @intCast(r % @as(u32, @intCast(i + 1)));
        const tmp = p[i];
        p[i] = p[j];
        p[j] = tmp;
    }
    i = 0;
    while (i < 256) : (i += 1) {
        out_perm[i] = p[i];
        out_perm[i + 256] = p[i];
    }
}

export fn initNoise() void {
    var p: [256]u32 = undefined;
    var i: usize = 0;
    while (i < 256) : (i += 1) {
        p[i] = @intCast(i);
    }

    i = 255;
    while (i > 0) : (i -= 1) {
        const j: usize = @intFromFloat(@floor(nextRand() * @as(f64, @floatFromInt(i + 1))));
        const temp = p[i];
        p[i] = p[j];
        p[j] = temp;
    }

    i = 0;
    while (i < 256) : (i += 1) {
        perm[i] = p[i];
        perm[i + 256] = p[i];
    }

    // Initialize secondary noise tables with offset seeds for bio and geo layers
    shufflePerm(rand_state +% 0xABCDEF01, &permBio);
    shufflePerm(rand_state +% 0x12345678, &permGeo);
}

fn fade(t: f64) f64 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
fn lerp(t: f64, a: f64, b: f64) f64 {
    return a + t * (b - a);
}
fn grad(hash: u32, x: f64, y: f64) f64 {
    const h = hash & 7;
    const u = if (h < 4) x else y;
    const v = if (h < 4) y else x;
    return (if ((h & 1) != 0) -u else u) + (if ((h & 2) != 0) -v else v);
}

fn noiseWith(p: *const [512]u32, x: f64, y: f64) f64 {
    const X: usize = @as(usize, @intCast(@as(isize, @intFromFloat(@floor(x))) & 255));
    const Y: usize = @as(usize, @intCast(@as(isize, @intFromFloat(@floor(y))) & 255));
    const xf = x - @floor(x);
    const yf = y - @floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = p[X] + Y;
    const ab = p[X] + Y + 1;
    const ba = p[X + 1] + Y;
    const bb = p[X + 1] + Y + 1;
    return lerp(v, lerp(u, grad(p[aa], xf, yf), grad(p[ba], xf - 1.0, yf)), lerp(u, grad(p[ab], xf, yf - 1.0), grad(p[bb], xf - 1.0, yf - 1.0)));
}

fn simpleNoise(x: f64, y: f64) f64 {
    return noiseWith(&perm, x, y);
}

fn bioNoise(x: f64, y: f64) f64 {
    return noiseWith(&permBio, x, y);
}

fn geoNoise(x: f64, y: f64) f64 {
    return noiseWith(&permGeo, x, y);
}

// ─── Terrain Generation ─────────────────────────────────────────────────────

export fn generateFractalTerrain() void {
    var y: usize = 0;
    while (y < GRID_HEIGHT) : (y += 1) {
        var x: usize = 0;
        while (x < GRID_WIDTH) : (x += 1) {
            const idx = y * GRID_WIDTH + x;
            const wx = ((@as(f64, @floatFromInt(x)) / @as(f64, @floatFromInt(GRID_WIDTH))) * world_scale) + chunk_offset_x;
            const wy = ((@as(f64, @floatFromInt(y)) / @as(f64, @floatFromInt(GRID_HEIGHT))) * world_scale) + chunk_offset_y;

            var e: f64 = 0.0;
            var f: f64 = 1.0;
            var a: f64 = 1.0;
            var o: usize = 0;
            while (o < 4) : (o += 1) {
                e += simpleNoise(wx * f, wy * f) * a;
                f *= 2.0;
                a *= 0.5;
            }
            var detail: f64 = 0.0;
            f = 4.0;
            a = 0.5;
            o = 0;
            while (o < 5) : (o += 1) {
                detail += simpleNoise(wx * f + 100.0, wy * f + 100.0) * a;
                f *= 2.1;
                a *= 0.45;
            }

            var rawVal = e * 0.7 + detail * 0.3 + 0.25;

            if (world_type == 0) {
                const nx = @as(f64, @floatFromInt(x)) / @as(f64, @floatFromInt(GRID_WIDTH));
                const ny = @as(f64, @floatFromInt(y)) / @as(f64, @floatFromInt(GRID_HEIGHT));
                const dx = (nx - 0.5) * 2.0;
                const dy = (ny - 0.5) * 2.0;
                const r = @sqrt(dx * dx + dy * dy);
                const absDx = if (dx < 0.0) -dx else dx;
                const absDy = if (dy < 0.0) -dy else dy;
                const squareDist = if (absDx > absDy) absDx else absDy;
                const dist = r * 0.3 + squareDist * 0.7;
                const noiseVal = simpleNoise(nx * 4.0, ny * 4.0) * 0.12;
                var softFalloff = 1.0 - std.math.pow(f64, dist + noiseVal, 5.0);
                if (softFalloff < 0.0) softFalloff = 0.0;
                if (softFalloff > 1.0) softFalloff = 1.0;
                rawVal *= softFalloff;
            } else {
                // Endless Mode: add large-scale continental domain warping
                const cont = simpleNoise(wx * 0.65, wy * 0.65);
                rawVal = (rawVal - 0.3) * 1.35 + cont * 0.38 + 0.35;
            }

            elevation[idx] = @floatCast(rawVal);
        }
    }
}

// ─── Hydraulic Erosion ──────────────────────────────────────────────────────

export fn runHydraulicErosion() void {
    var i: usize = 0;
    while (i < EROSION_ITERATIONS) : (i += 1) {
        const margin: f64 = if (world_type == 1) 3.0 else 1.0;
        var px = nextRand() * @as(f64, @floatFromInt(GRID_WIDTH - 1));
        var py = nextRand() * @as(f64, @floatFromInt(GRID_HEIGHT - 1));
        var dx: f64 = 0.0;
        var dy: f64 = 0.0;
        var sediment: f64 = 0.0;

        // Track last valid cell for deposition on termination
        var last_idx: usize = 0;
        var has_valid_idx: bool = false;

        var step: usize = 0;
        while (step < 40) : (step += 1) {
            if (px < margin or px >= @as(f64, @floatFromInt(GRID_WIDTH)) - margin or py < margin or py >= @as(f64, @floatFromInt(GRID_HEIGHT)) - margin) break;

            const ix = @as(usize, @intFromFloat(@floor(px)));
            const iy = @as(usize, @intFromFloat(@floor(py)));
            const idx = iy * GRID_WIDTH + ix;

            // Extreme safety: check both index and its offset neighbors
            if (idx + GRID_WIDTH >= GRID_SIZE) break;

            last_idx = idx;
            has_valid_idx = true;

            const gx = @as(f64, @floatCast(elevation[idx + 1] - elevation[idx]));
            const gy = @as(f64, @floatCast(elevation[idx + GRID_WIDTH] - elevation[idx]));
            dx = dx * 0.3 - gx * 0.7;
            dy = dy * 0.3 - gy * 0.7;
            px += dx;
            py += dy;

            if (px < margin or px >= @as(f64, @floatFromInt(GRID_WIDTH)) - margin or py < margin or py >= @as(f64, @floatFromInt(GRID_HEIGHT)) - margin) break;
            const targetIdx = @as(usize, @intFromFloat(@floor(py))) * GRID_WIDTH + @as(usize, @intFromFloat(@floor(px)));

            if (targetIdx >= GRID_SIZE) break;

            const heightDiff = @as(f64, @floatCast(elevation[targetIdx] - elevation[idx]));
            if (heightDiff > 0.0) {
                const deposit = if (sediment > heightDiff) heightDiff else sediment;
                sediment -= deposit;
                elevation[idx] += @floatCast(deposit);
            } else {
                const capacity = if (heightDiff < -0.01) -heightDiff * 4.0 else 0.01;
                if (sediment > capacity) {
                    const deposit = (sediment - capacity) * 0.3;
                    sediment -= deposit;
                    elevation[idx] += @floatCast(deposit);
                } else {
                    const erode = (capacity - sediment) * 0.3;
                    const limit = -heightDiff * 0.9;
                    const actualErode = if (erode > limit) limit else erode;
                    sediment += actualErode;
                    elevation[idx] -= @floatCast(actualErode);
                }
            }
        }

        // Phase 0.2 FIX: Deposit all remaining suspended sediment at last valid cell
        // This enforces strict mass conservation — no material escapes the grid.
        if (sediment > 0.0 and has_valid_idx and world_type == 0) {
            elevation[last_idx] += @floatCast(sediment);
        }
    }

    // Phase 3.3 FIX: Eliminate artificial post-erosion min/max clamping.
    // Preserve true absolute elevations so sea level remains physically consistent across chunks.
    for (&elevation) |*e| {
        if (e.* < 0.0) e.* = 0.0;
        if (e.* > 1.0) e.* = 1.0;
    }

    if (world_type == 0) {
        // Apply strict squircle falloff to guarantee clean edges for bounded island mode
        var y: usize = 0;
        while (y < GRID_HEIGHT) : (y += 1) {
            var x: usize = 0;
            while (x < GRID_WIDTH) : (x += 1) {
                const idx = y * GRID_WIDTH + x;
                const nx = @as(f64, @floatFromInt(x)) / @as(f64, @floatFromInt(GRID_WIDTH));
                const ny = @as(f64, @floatFromInt(y)) / @as(f64, @floatFromInt(GRID_HEIGHT));
                const dx = (nx - 0.5) * 2.0;
                const dy = (ny - 0.5) * 2.0;

                const r = @sqrt(dx * dx + dy * dy);
                const absDx = if (dx < 0.0) -dx else dx;
                const absDy = if (dy < 0.0) -dy else dy;
                const squareDist = if (absDx > absDy) absDx else absDy;
                const dist = r * 0.3 + squareDist * 0.7;

                const noiseVal = simpleNoise(nx * 4.0, ny * 4.0) * 0.12 + simpleNoise(nx * 10.0, ny * 10.0) * 0.04;
                const perturbedDist = dist + noiseVal;

                var falloff = 1.0 - std.math.pow(f64, perturbedDist, 3.5);
                if (falloff < 0.0) falloff = 0.0;
                if (falloff > 1.0) falloff = 1.0;

                elevation[idx] *= @floatCast(falloff);
            }
        }
    }
}

// ─── River Routing ───────────────────────────────────────────────────────────

const HeapNode = struct {
    idx: usize,
    val: f32,
};

var heap: [GRID_SIZE]HeapNode = undefined;
var heap_size: usize = 0;

fn heapPush(node: HeapNode) void {
    if (heap_size >= GRID_SIZE) return;
    heap[heap_size] = node;
    var index = heap_size;
    heap_size += 1;
    while (index > 0) {
        const parent = (index - 1) / 2;
        if (heap[index].val >= heap[parent].val) break;
        const temp = heap[index];
        heap[index] = heap[parent];
        heap[parent] = temp;
        index = parent;
    }
}

fn heapPop() ?HeapNode {
    if (heap_size == 0) return null;
    const top = heap[0];
    heap_size -= 1;
    const last = heap[heap_size];
    if (heap_size > 0) {
        heap[0] = last;
        var index: usize = 0;
        while (true) {
            const left = 2 * index + 1;
            const right = 2 * index + 2;
            var smallest = index;
            if (left < heap_size and heap[left].val < heap[smallest].val) smallest = left;
            if (right < heap_size and heap[right].val < heap[smallest].val) smallest = right;
            if (smallest == index) break;
            const temp = heap[index];
            heap[index] = heap[smallest];
            heap[smallest] = temp;
            index = smallest;
        }
    }
    return top;
}

fn fillSinks() void {
    var i: usize = 0;
    while (i < GRID_SIZE) : (i += 1) {
        newElevation[i] = 1.0;
        processed[i] = 0;
    }
    heap_size = 0;

    i = 0;
    while (i < GRID_SIZE) : (i += 1) {
        const x = i % GRID_WIDTH;
        const y = i / GRID_WIDTH;
        if (x == 0 or x == GRID_WIDTH - 1 or y == 0 or y == GRID_HEIGHT - 1 or elevation[i] < 0.42) {
            newElevation[i] = elevation[i];
            processed[i] = 1;
            heapPush(.{ .idx = i, .val = elevation[i] });
        }
    }

    const epsilon: f32 = 1e-5;
    const neighbors = [_][2]i32{ .{ 0, 1 }, .{ 0, -1 }, .{ 1, 0 }, .{ -1, 0 }, .{ 1, 1 }, .{ 1, -1 }, .{ -1, 1 }, .{ -1, -1 } };

    while (heapPop()) |node| {
        const x: i32 = @intCast(node.idx % GRID_WIDTH);
        const y: i32 = @intCast(node.idx / GRID_WIDTH);
        for (neighbors) |d| {
            const nx = x + d[0];
            const ny = y + d[1];
            if (nx < 0 or nx >= GRID_WIDTH or ny < 0 or ny >= GRID_HEIGHT) continue;
            const nIdx = @as(usize, @intCast(ny)) * GRID_WIDTH + @as(usize, @intCast(nx));
            if (processed[nIdx] == 1) continue;
            processed[nIdx] = 1;
            var nextVal = elevation[nIdx];
            if (node.val + epsilon > nextVal) nextVal = node.val + epsilon;
            newElevation[nIdx] = nextVal;
            heapPush(.{ .idx = nIdx, .val = newElevation[nIdx] });
        }
    }

    i = 0;
    while (i < GRID_SIZE) : (i += 1) {
        elevation[i] = newElevation[i];
    }
}

fn compareDesc(context: void, a: usize, b: usize) bool {
    _ = context;
    return elevation[b] < elevation[a];
}

export fn generateRivers() void {
    fillSinks();

    var i: usize = 0;
    while (i < GRID_SIZE) : (i += 1) {
        riverFlow[i] = 1.0;
        flowDirection[i] = -1;
        sorted_indices[i] = i;
    }

    std.sort.block(usize, &sorted_indices, {}, compareDesc);

    i = 0;
    while (i < GRID_SIZE) : (i += 1) {
        const idx = sorted_indices[i];
        if (elevation[idx] < 0.42) continue;

        const x: i32 = @intCast(idx % GRID_WIDTH);
        const y: i32 = @intCast(idx / GRID_WIDTH);
        var bestN: i32 = -1;
        var minH: f32 = elevation[idx];
        const neighbors = [_][2]i32{ .{ 0, 1 }, .{ 0, -1 }, .{ 1, 0 }, .{ -1, 0 }, .{ 1, 1 }, .{ 1, -1 }, .{ -1, 1 }, .{ -1, -1 } };

        for (neighbors) |d| {
            const nx = x + d[0];
            const ny = y + d[1];
            if (nx >= 0 and nx < GRID_WIDTH and ny >= 0 and ny < GRID_HEIGHT) {
                const nIdx = @as(usize, @intCast(ny)) * GRID_WIDTH + @as(usize, @intCast(nx));
                if (elevation[nIdx] < minH) {
                    minH = elevation[nIdx];
                    bestN = @intCast(nIdx);
                }
            }
        }
        flowDirection[idx] = bestN;
    }

    if (world_type == 1) {
        var by: usize = 0;
        while (by < GRID_HEIGHT) : (by += 1) {
            var bx: usize = 0;
            while (bx < GRID_WIDTH) : (bx += 1) {
                if (bx == 0 or bx == GRID_WIDTH - 1 or by == 0 or by == GRID_HEIGHT - 1) {
                    const bIdx = by * GRID_WIDTH + bx;
                    const e = elevation[bIdx];
                    if (e >= planet_sea_level and flowDirection[bIdx] != -1) {
                        var isValley = false;
                        if (bx == 0 or bx == GRID_WIDTH - 1) {
                            if (by > 0 and by < GRID_HEIGHT - 1) {
                                if (e < elevation[bIdx - GRID_WIDTH] and e < elevation[bIdx + GRID_WIDTH]) {
                                    isValley = true;
                                }
                            }
                        } else {
                            if (bx > 0 and bx < GRID_WIDTH - 1) {
                                if (e < elevation[bIdx - 1] and e < elevation[bIdx + 1]) {
                                    isValley = true;
                                }
                            }
                        }
                        if (isValley) {
                            const gx = @as(f64, @floatFromInt(@as(i32, @intCast(bx)) + chunk_offset_x_int * GRID_WIDTH));
                            const gy = @as(f64, @floatFromInt(@as(i32, @intCast(by)) + chunk_offset_y_int * GRID_HEIGHT));
                            const basinNoise = bioNoise(gx / 300.0, gy / 300.0);
                            if (basinNoise > 0.0) {
                                const bonus = 1400.0 + @as(f32, @floatCast(basinNoise)) * 4500.0;
                                riverFlow[bIdx] += bonus;
                            }
                        }
                    }
                }
            }
        }
    }

    for (&sorted_indices) |idx| {
        const next = flowDirection[idx];
        if (next != -1) {
            const nextIdx = @as(usize, @intCast(next));
            if (nextIdx < GRID_SIZE) {
                riverFlow[nextIdx] += riverFlow[idx];
            }
        }
    }
}

// ─── Atmospheric & Biome Simulation ─────────────────────────────────────────

// Biome index constants (must match JS BIOMES_LIST order)
const BIO_DEEP_OCEAN: u8 = 0;
const BIO_OCEAN: u8     = 1;
const BIO_RIVER: u8     = 2;
const BIO_WETLAND: u8   = 3;
const BIO_BEACH: u8     = 4;
const BIO_GRASSLAND: u8 = 5;
const BIO_SAVANNA: u8   = 6;
const BIO_FOREST: u8    = 7;
const BIO_JUNGLE: u8    = 8;
const BIO_TAIGA: u8     = 9;
const BIO_TUNDRA: u8    = 10;
const BIO_DESERT: u8    = 11;
const BIO_MOUNTAIN: u8  = 12;
const BIO_SNOW: u8      = 13;

fn getBiome(e: f32, m: f32, t: f32, noiseVal: f64, sea_level: f32) u8 {
    const beach_thresh = sea_level + 0.005;
    if (e < sea_level * 0.48) return BIO_DEEP_OCEAN;
    if (e < sea_level) return BIO_OCEAN;
    if (e < beach_thresh) return BIO_BEACH;
    const jT = t + @as(f32, @floatCast(noiseVal * 0.08));
    const jM = m + @as(f32, @floatCast(noiseVal * 0.08));
    const land_span = 1.0 - sea_level;
    const mountain_thresh = sea_level + land_span * 0.68;
    const snow_thresh     = sea_level + land_span * 0.84;
    if (e > snow_thresh) return BIO_SNOW;
    if (e > mountain_thresh) return BIO_MOUNTAIN;
    if (jT < 0.25) return BIO_TUNDRA;
    if (jT < 0.45) return if (jM > 0.5) BIO_TAIGA else BIO_GRASSLAND;
    if (jT > 0.75) {
        if (jM > 0.7) return BIO_JUNGLE;
        if (jM > 0.45) return BIO_FOREST;
        return if (jM > 0.2) BIO_SAVANNA else BIO_DESERT;
    }
    if (jM > 0.75) return BIO_WETLAND;
    if (jM > 0.45) return BIO_FOREST;
    return if (jM > 0.25) BIO_GRASSLAND else BIO_SAVANNA;
}

/// Full atmospheric simulation + biome assignment running entirely in Wasm.
/// Call after generateRivers(). Writes moisture[], temperature[], stratigraphy[], biomeIds[].
export fn runAtmosphericSimulation() void {
    const cx: i32 = chunk_offset_x_int * GRID_WIDTH;
    const cy: i32 = chunk_offset_y_int * GRID_HEIGHT;

    // 1. Initialize temperature envelope, stratigraphy & seed ocean humidity
    var y: usize = 0;
    while (y < GRID_HEIGHT) : (y += 1) {
        var x: usize = 0;
        while (x < GRID_WIDTH) : (x += 1) {
            const idx = y * GRID_WIDTH + x;
            const gx = @as(i32, @intCast(x)) + cx;
            const gy = @as(i32, @intCast(y)) + cy;
            const gxf = @as(f64, @floatFromInt(gx));
            const gyf = @as(f64, @floatFromInt(gy));

            // Map y across the sector from cold poles (or temperate) to warm equator
            const sector_y = if (world_type == 1) (@mod(gyf / 8192.0, 1.0)) else @as(f64, @floatFromInt(y)) / @as(f64, @floatFromInt(GRID_HEIGHT));
            const dist_from_eq = @abs(sector_y - 0.5) * 2.0;
            const clamped_dist = if (dist_from_eq > 1.0) 1.0 else dist_from_eq;
            const lat_temp_base = 0.88 - clamped_dist * 0.55; // 0.88 equator (~38°C) down to 0.33 poles (~5°C at sea level)

            const e = elevation[idx];
            const ef = @as(f64, @floatCast(e));
            const sl = planet_sea_level;
            const sl64 = @as(f64, @floatCast(sl));

            // Coherent multi-octave geological province assignment tied to topography
            const gProv = geoNoise(gxf / 380.0, gyf / 380.0) * 0.7 + geoNoise(gxf / 150.0, gyf / 150.0) * 0.3;
            if (e < sl) {
                stratigraphy[idx] = 3; // Basalt oceanic crust
            } else if (e > sl + (1.0 - sl) * 0.55 or gProv > 0.35) {
                stratigraphy[idx] = 2; // Igneous Granite shield (mountain cores / cratons)
            } else if (gProv > -0.15 and e > sl + (1.0 - sl) * 0.15) {
                stratigraphy[idx] = 1; // Metamorphic Karst plateaus / foothills
            } else {
                stratigraphy[idx] = 0; // Alluvial Sedimentary basin (plains / river valleys)
            }

            const land_span64 = if ((1.0 - sl64) < 0.05) 0.05 else (1.0 - sl64);
            const land_elev_norm = if (e > sl) (ef - sl64) / land_span64 else 0.0;
            const curved_elev = std.math.pow(f64, land_elev_norm, 2.2);
            const lapse_effect = curved_elev * 0.38 * @as(f64, @floatCast(planet_lapse_norm));
            const eq_scale = @as(f64, @floatCast(planet_eq_temp)) / 0.625;
            const tempVal = (lat_temp_base * eq_scale) - lapse_effect + bioNoise(gxf / 140.0, gyf / 140.0) * 0.10;
            const tempClamped = if (tempVal < 0.0) 0.0 else if (tempVal > 1.0) 1.0 else tempVal;
            temperature[idx] = @floatCast(tempClamped);

            if (e < sl) {
                moisture[idx] = 1.0;
            } else {
                const riverF = @as(f64, @floatCast(riverFlow[idx]));
                const riverBoost = if (riverF > 500.0) blk: {
                    const logVal = std.math.log10(riverF) * 0.08;
                    break :blk if (logVal < 0.35) logVal else 0.35;
                } else 0.0;
                const rawM = 0.18 + bioNoise((gxf + 600.0) / 160.0, (gyf + 600.0) / 160.0) * 0.28 + riverBoost;
                const clampedM = if (rawM < 0.05) 0.05 else if (rawM > 0.95) 0.95 else rawM;
                moisture[idx] = @floatCast(clampedM);
            }
            baseContinentalHumidity[idx] = moisture[idx];
        }
    }

    // Copy moisture into the advection buffer
    var i: usize = 0;
    while (i < GRID_SIZE) : (i += 1) {
        moistureBuffer[i] = moisture[i];
    }

    // 2. Coriolis Planetary Atmospheric Circulation Solver
    // 5-pass multi-cell advection: Hadley (0-30°), Ferrel (30-60°), Polar (60-90°)
    var pass: usize = 0;
    while (pass < 5) : (pass += 1) {
        y = 1;
        while (y < GRID_HEIGHT - 1) : (y += 1) {
            const gy_wind = @as(f64, @floatFromInt(@as(i32, @intCast(y)) + cy));
            const latRaw = if (world_type == 1) (@mod(gy_wind / 8192.0, 1.0) - 0.5) * 180.0 else (@as(f64, @floatFromInt(y)) / @as(f64, @floatFromInt(GRID_HEIGHT)) - 0.5) * 180.0;
            const latDeg = if (latRaw < 0.0) -latRaw else latRaw;

            var windX: f64 = 0.0;
            var windY: f64 = 0.0;
            if (latDeg < 30.0) {
                windX = -1.8; // Easterly trade winds (Hadley cell)
                windY = if (latRaw > 0.0) -0.4 else 0.4;
            } else if (latDeg < 60.0) {
                windX = 2.2; // Westerlies (Ferrel cell)
                windY = if (latRaw > 0.0) 0.6 else -0.6;
            } else {
                windX = -1.2; // Polar easterlies
                windY = 0.0;
            }

            var x: usize = 1;
            while (x < GRID_WIDTH - 1) : (x += 1) {
                const idx = y * GRID_WIDTH + x;
                const ef = @as(f64, @floatCast(elevation[idx]));
                if (ef < @as(f64, @floatCast(planet_sea_level))) continue;

                const gxf2 = @as(f64, @floatFromInt(x));
                const gyf2 = @as(f64, @floatFromInt(y));

                // Micro-turbulence from noise
                const turbulenceAngle = bioNoise(gxf2 / 160.0, gyf2 / 160.0) * std.math.pi;
                const upX = @as(i32, @intFromFloat(@floor(windX + std.math.cos(turbulenceAngle) * 0.8 + 0.5)));
                const upY = @as(i32, @intFromFloat(@floor(windY + std.math.sin(turbulenceAngle) * 0.8 + 0.5)));

                const srcY = @as(i32, @intCast(y)) - upY;
                const srcX = @as(i32, @intCast(x)) - upX;

                var upwindEf: f64 = 0.0;
                var upwindMf: f64 = 0.0;
                if (srcX >= 0 and srcX < GRID_WIDTH and srcY >= 0 and srcY < GRID_HEIGHT) {
                    const upwindIdx = @as(usize, @intCast(srcY)) * GRID_WIDTH + @as(usize, @intCast(srcX));
                    upwindEf = @as(f64, @floatCast(elevation[upwindIdx]));
                    upwindMf = @as(f64, @floatCast(moistureBuffer[upwindIdx]));
                } else {
                    const clampedSrcY: usize = @intCast(if (srcY < 0) 0 else if (srcY >= GRID_HEIGHT) GRID_HEIGHT - 1 else srcY);
                    const clampedSrcX: usize = @intCast(if (srcX < 0) 0 else if (srcX >= GRID_WIDTH) GRID_WIDTH - 1 else srcX);
                    const upwindIdx = clampedSrcY * GRID_WIDTH + clampedSrcX;
                    const borderEf = @as(f64, @floatCast(elevation[upwindIdx]));
                    upwindEf = borderEf - (windX * 0.0015 + windY * 0.0015);
                    upwindMf = @as(f64, @floatCast(moistureBuffer[upwindIdx]));
                }

                const slope = ef - upwindEf;
                var advectedM = upwindMf * 0.992;

                if (slope > 0.006) {
                    // Windward orographic rain dump
                    const bump = slope * 10.0;
                    advectedM += if (bump < 0.35) bump else 0.35;
                } else if (slope < -0.006 and ef > (@as(f64, @floatCast(planet_sea_level)) + 0.13)) {
                    // Leeward rain shadow desertification
                    advectedM *= 0.28;
                }

                // Local Laplacian diffusion (weighted averaging with neighbours)
                const laplacian = (@as(f64, @floatCast(moistureBuffer[idx - 1])) +
                    @as(f64, @floatCast(moistureBuffer[idx + 1])) +
                    @as(f64, @floatCast(moistureBuffer[idx - GRID_WIDTH])) +
                    @as(f64, @floatCast(moistureBuffer[idx + GRID_WIDTH]))) * 0.25;

                const weatherFront = advectedM * 0.58 + laplacian * 0.42;
                const baseHumf = @as(f64, @floatCast(baseContinentalHumidity[idx]));
                const finalM = weatherFront * 0.65 + baseHumf * 0.35;
                moisture[idx] = @floatCast(if (finalM < 0.04) 0.04 else if (finalM > 1.0) 1.0 else finalM);
            }
        }
        // Copy moisture back into buffer for next pass
        i = 0;
        while (i < GRID_SIZE) : (i += 1) {
            moistureBuffer[i] = moisture[i];
        }
    }

    // Phase 4.2: Dynamic Ocean Thermohaline Currents & Heat Transport
    // 2-pass advection of surface ocean heat along gyres (Gulf Stream / Humboldt analogues)
    var oPass: usize = 0;
    while (oPass < 2) : (oPass += 1) {
        y = 1;
        while (y < GRID_HEIGHT - 1) : (y += 1) {
            const latRaw = (@as(f64, @floatFromInt(y)) / @as(f64, @floatFromInt(GRID_HEIGHT)) - 0.5) * 180.0;
            const latDeg = if (latRaw < 0.0) -latRaw else latRaw;

            // Ocean surface currents follow wind stress gyres deflected by Coriolis
            var currX: i32 = 0;
            var currY: i32 = 0;
            if (latDeg < 35.0) {
                currX = -1; // Westward equatorial current
                currY = if (y > GRID_HEIGHT / 2) -1 else 1; // Poleward deflection against continents
            } else {
                currX = 1;  // Eastward North/South Atlantic Drift
                currY = if (y > GRID_HEIGHT / 2) 1 else -1; // Equatorward return current
            }

            var x: usize = 1;
            while (x < GRID_WIDTH - 1) : (x += 1) {
                const idx = y * GRID_WIDTH + x;
                if (elevation[idx] >= planet_sea_level) continue; // Ocean only

                const srcY = @as(i32, @intCast(y)) - currY;
                const srcX = @as(i32, @intCast(x)) - currX;
                if (srcY >= 0 and srcY < GRID_HEIGHT and srcX >= 0 and srcX < GRID_WIDTH) {
                    const srcIdx = @as(usize, @intCast(srcY)) * GRID_WIDTH + @as(usize, @intCast(srcX));
                    if (elevation[srcIdx] < planet_sea_level) {
                        // Blend upwind ocean heat (advection)
                        const advectedT = temperature[srcIdx] * 0.35 + temperature[idx] * 0.65;
                        temperature[idx] = @floatCast(advectedT);
                    }
                }
            }
        }
    }

    // Phase 4.3: Milankovitch Glacial Cycles & Cryosphere Albedo Feedback + Biome Assignment
    i = 0;
    while (i < GRID_SIZE) : (i += 1) {
        const e = elevation[i];
        const m = moisture[i];
        var t = temperature[i];

        // Cryosphere Ice Albedo Feedback: snow/ice reflection cools high latitude/altitude regions
        if (t < 0.26 or e > (planet_sea_level + (1.0 - planet_sea_level) * 0.82)) {
            t = if (t > 0.04) t - 0.04 else 0.0;
            temperature[i] = t;
        }

        const lx = @as(i32, @intCast(i % GRID_WIDTH)) + cx;
        const ly = @as(i32, @intCast(i / GRID_WIDTH)) + cy;
        const nv = bioNoise(@as(f64, @floatFromInt(lx)) / 35.0, @as(f64, @floatFromInt(ly)) / 35.0);

        var biome = getBiome(e, m, t, nv, planet_sea_level);
        if (e >= planet_sea_level) {
            const rf = riverFlow[i];
            if (rf > 4000.0) {
                biome = BIO_RIVER;
            } else if (rf > 1500.0 and flowDirection[i] == -1) {
                biome = BIO_OCEAN;
            }
        }
        biomeIds[i] = biome;
    }
}

// ─── Legacy noise exports (kept for backwards compatibility) ─────────────────

export fn assignBiomesNoise(seed_ptr: [*]const u8, seed_len: usize) void {
    initRand(seed_ptr, seed_len);
    initNoise();
}

export fn getMoistureTempAndBiomeNoise(x: usize, y: usize) f64 {
    return simpleNoise(@as(f64, @floatFromInt(x)) / 100.0, @as(f64, @floatFromInt(y)) / 100.0);
}
export fn getMoistureTempAndBiomeNoise2(x: usize, y: usize) f64 {
    return simpleNoise((@as(f64, @floatFromInt(x)) + 600.0) / 160.0, (@as(f64, @floatFromInt(y)) + 600.0) / 160.0);
}
export fn getMoistureTempAndBiomeNoise3(x: usize, y: usize) f64 {
    return simpleNoise(@as(f64, @floatFromInt(x)) / 30.0, @as(f64, @floatFromInt(y)) / 30.0);
}

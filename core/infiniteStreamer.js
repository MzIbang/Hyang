/* Hyang True Infinite Procedural Streamer — Multi-Core Wasm Worker Pool Engine */
import { GRID_WIDTH, GRID_HEIGHT } from './config.js';
import { renderPhysicalWorld } from '../renderer.js';
import { WorkerPool } from './workerPool.js';

export const CHUNK_SIZE = GRID_WIDTH; // World units per chunk = 1024

export class InfiniteWorldStreamer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.canvas.style.display = 'block';

        // Always use Canvas 2D for rock-solid rendering.
        // We acquire the context directly on map-canvas.
        // NOTE: main.js must NOT call canvas.getContext('2d') before this,
        // and must NOT set canvas.width/height after this point.
        this.ctx = this.canvas.getContext('2d');

        // hud-canvas sits on top for "Generating..." wireframe text only
        this.hudCanvas = document.getElementById('hud-canvas');
        if (this.hudCanvas) {
            this.hudCanvas.width = this.canvas.width;
            this.hudCanvas.height = this.canvas.height;
            this.hudCtx = this.hudCanvas.getContext('2d');
        } else {
            this.hudCtx = null;
        }

        this.cameraX = 0; // World pixel offset (top-left corner of view)
        this.cameraY = 0;
        this.zoom = 1.0;
        this.isDragging = false;
        this.dragLastX = 0;
        this.dragLastY = 0;
        this.dragAnimFrame = null;

        this.chunkCache = new Map();    // key -> { bitmap, worldData }
        this.pendingChunks = new Set(); // keys currently being generated
        this.renderPending = false;

        // Multi-core worker pool
        const cores = navigator.hardwareConcurrency || 4;
        this.workerPool = new WorkerPool(cores);

        this.currentMode = 'elevation';
        this.baseSeed = 'Hyang-Infinite';
        this.planetConfig = null;
        this.onHUDUpdate = null;

        this.initListeners();

        // Initial render (shows dark background)
        requestAnimationFrame(() => this.render());
    }

    initListeners() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.dragLastX = e.clientX;
            this.dragLastY = e.clientY;
            this.canvas.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            const dx = (e.clientX - this.dragLastX) / this.zoom;
            const dy = (e.clientY - this.dragLastY) / this.zoom;
            this.dragLastX = e.clientX;
            this.dragLastY = e.clientY;
            this.cameraX -= dx;
            this.cameraY -= dy;
            if (!this.dragAnimFrame) {
                this.dragAnimFrame = requestAnimationFrame(() => {
                    this.render();
                    this.dragAnimFrame = null;
                });
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.canvas.style.cursor = 'grab';
            }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            const newZoom = Math.max(0.15, Math.min(6.0, this.zoom * zoomFactor));
            const rect = this.canvas.getBoundingClientRect();
            const mouseScreenX = e.clientX - rect.left;
            const mouseScreenY = e.clientY - rect.top;
            const worldMouseX = this.cameraX + mouseScreenX / this.zoom;
            const worldMouseY = this.cameraY + mouseScreenY / this.zoom;
            this.zoom = newZoom;
            this.cameraX = worldMouseX - mouseScreenX / this.zoom;
            this.cameraY = worldMouseY - mouseScreenY / this.zoom;
            if (!this.dragAnimFrame) {
                this.dragAnimFrame = requestAnimationFrame(() => {
                    this.render();
                    this.dragAnimFrame = null;
                });
            }
        }, { passive: false });
    }

    getScratchCtx() {
        if (!this.scratchCanvas) {
            this.scratchCanvas = document.createElement('canvas');
            this.scratchCanvas.width = GRID_WIDTH;
            this.scratchCanvas.height = GRID_HEIGHT;
        }
        return this.scratchCanvas.getContext('2d');
    }

    setMode(mode) {
        this.currentMode = mode;
        const targetMode = mode;
        this.modeVersion = (this.modeVersion || 0) + 1;
        const currentVer = this.modeVersion;

        // Re-render all cached chunks in the new mode
        for (const [key, item] of this.chunkCache.entries()) {
            if (item.worldData) {
                const scratchCtx = this.getScratchCtx();
                const rawImgData = renderPhysicalWorld(scratchCtx, item.worldData, targetMode);
                const cloneImgData = new ImageData(
                    new Uint8ClampedArray(rawImgData.data),
                    rawImgData.width,
                    rawImgData.height
                );
                // Close old bitmap
                if (item.bitmap && typeof item.bitmap.close === 'function') {
                    item.bitmap.close();
                }
                item.bitmap = null;
                // Create new bitmap asynchronously from distinct snapshot
                createImageBitmap(cloneImgData).then(newBitmap => {
                    if (this.currentMode !== targetMode || this.modeVersion !== currentVer) {
                        newBitmap.close();
                        return;
                    }
                    item.bitmap = newBitmap;
                    this.render();
                }).catch(() => {
                    if (this.currentMode === targetMode && this.modeVersion === currentVer) {
                        item.bitmap = cloneImgData;
                        this.render();
                    }
                });
            }
        }
        this.render();
    }

    resetStream(seed, planetConfig) {
        this.baseSeed = seed;
        this.planetConfig = planetConfig;
        // Clean up all cached bitmaps
        for (const item of this.chunkCache.values()) {
            if (item.bitmap && typeof item.bitmap.close === 'function') {
                item.bitmap.close();
            }
        }
        this.chunkCache.clear();
        this.pendingChunks.clear();
        this.cameraX = 0;
        this.cameraY = 0;
        this.render();
    }

    render() {
        if (!this.ctx) return;

        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // Clear main canvas to dark background
        this.ctx.fillStyle = '#030712';
        this.ctx.fillRect(0, 0, cw, ch);

        // Clear HUD overlay
        if (this.hudCtx) {
            this.hudCtx.clearRect(0, 0, cw, ch);
        }

        const minX = this.cameraX;
        const minY = this.cameraY;
        const maxX = this.cameraX + cw / this.zoom;
        const maxY = this.cameraY + ch / this.zoom;

        const minCx = Math.floor(minX / CHUNK_SIZE);
        const maxCx = Math.floor(maxX / CHUNK_SIZE);
        const minCy = Math.floor(minY / CHUNK_SIZE);
        const maxCy = Math.floor(maxY / CHUNK_SIZE);

        // Prune worker queue for offscreen sectors
        this.workerPool.pruneQueue(this.cameraX, this.cameraY, this.zoom, cw, ch, CHUNK_SIZE * 1.2);

        // Prune chunk cache: keep chunks within margin 4.0 sectors, or evict farthest if > 80 chunks
        const MAX_CACHE_CHUNKS = 80;
        for (const [key, item] of this.chunkCache.entries()) {
            const [cx, cy] = key.split(',').map(Number);
            if (!this.isChunkVisible(cx, cy, 4.0)) {
                if (item.bitmap && typeof item.bitmap.close === 'function') {
                    item.bitmap.close();
                }
                this.chunkCache.delete(key);
            }
        }
        if (this.chunkCache.size > MAX_CACHE_CHUNKS) {
            const centerCx = (this.cameraX + (cw / this.zoom) / 2) / CHUNK_SIZE;
            const centerCy = (this.cameraY + (ch / this.zoom) / 2) / CHUNK_SIZE;
            const entries = Array.from(this.chunkCache.entries());
            entries.sort((a, b) => {
                const [ax, ay] = a[0].split(',').map(Number);
                const [bx, by] = b[0].split(',').map(Number);
                const distA = (ax - centerCx) ** 2 + (ay - centerCy) ** 2;
                const distB = (bx - centerCx) ** 2 + (by - centerCy) ** 2;
                return distB - distA; // Farthest first
            });
            while (this.chunkCache.size > MAX_CACHE_CHUNKS && entries.length > 0) {
                const [key, item] = entries.shift();
                if (item.bitmap && typeof item.bitmap.close === 'function') {
                    item.bitmap.close();
                }
                this.chunkCache.delete(key);
            }
        }

        for (let cy = minCy; cy <= maxCy; cy++) {
            for (let cx = minCx; cx <= maxCx; cx++) {
                const key = `${cx},${cy}`;

                const screenX = Math.floor((cx * CHUNK_SIZE - this.cameraX) * this.zoom);
                const screenY = Math.floor((cy * CHUNK_SIZE - this.cameraY) * this.zoom);
                const nextScreenX = Math.floor(((cx + 1) * CHUNK_SIZE - this.cameraX) * this.zoom);
                const nextScreenY = Math.floor(((cy + 1) * CHUNK_SIZE - this.cameraY) * this.zoom);
                const screenW = Math.max(1, nextScreenX - screenX);
                const screenH = Math.max(1, nextScreenY - screenY);

                if (this.chunkCache.has(key)) {
                    const item = this.chunkCache.get(key);
                    if (item.bitmap) {
                        try {
                            this.ctx.drawImage(item.bitmap, screenX, screenY, screenW, screenH);
                        } catch (e) {
                            // bitmap may be closed or invalid
                            item.bitmap = null;
                        }
                    }
                } else {
                    // Draw placeholder grid on HUD while chunk is being generated
                    if (this.hudCtx) {
                        this.hudCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
                        this.hudCtx.lineWidth = 1;
                        this.hudCtx.strokeRect(screenX, screenY, screenW, screenH);
                        this.hudCtx.fillStyle = 'rgba(6, 182, 212, 0.06)';
                        this.hudCtx.fillRect(screenX, screenY, screenW, screenH);
                        this.hudCtx.fillStyle = 'rgba(6, 182, 212, 0.85)';
                        this.hudCtx.font = `${Math.max(10, Math.min(18, 14 * this.zoom))}px Inter, sans-serif`;
                        this.hudCtx.fillText(`Generating [${cx}, ${cy}]...`, screenX + 12, screenY + 26);
                    }

                    if (!this.pendingChunks.has(key)) {
                        this.dispatchToWorkerPool(cx, cy, key);
                    }
                }
            }
        }

        // HUD info
        if (this.onHUDUpdate) {
            const worldKmX = Math.floor(this.cameraX);
            const worldKmY = Math.floor(this.cameraY);
            this.onHUDUpdate(worldKmX, worldKmY, this.chunkCache.size, this.pendingChunks.size);
        }
    }

    async dispatchToWorkerPool(cx, cy, key) {
        this.pendingChunks.add(key);
        const requestedMode = this.currentMode;
        try {
            const { bitmap, imgDataBuffer, width, height, worldData } =
                await this.workerPool.dispatchTask(cx, cy, this.baseSeed, this.planetConfig, requestedMode);

            // Only cache if still visible within retention margin
            if (!this.isChunkVisible(cx, cy, 4.0)) {
                if (bitmap && typeof bitmap.close === 'function') bitmap.close();
                return;
            }

            let finalBitmap = bitmap;

            // If no transferable bitmap came back, reconstruct from raw pixel data
            if (!finalBitmap && imgDataBuffer) {
                const imgData = new ImageData(
                    new Uint8ClampedArray(imgDataBuffer),
                    width || GRID_WIDTH,
                    height || GRID_HEIGHT
                );
                try {
                    finalBitmap = await createImageBitmap(imgData);
                } catch (_) {
                    // Use ImageData directly as a draw source
                    finalBitmap = imgData;
                }
            }

            // If mode changed while this chunk was being generated, re-render it now
            if (requestedMode !== this.currentMode && worldData) {
                if (finalBitmap && typeof finalBitmap.close === 'function') finalBitmap.close();
                const scratchCtx = this.getScratchCtx();
                const newImgData = renderPhysicalWorld(scratchCtx, worldData, this.currentMode);
                try {
                    finalBitmap = await createImageBitmap(newImgData);
                } catch (_) {
                    finalBitmap = newImgData;
                }
            }

            this.chunkCache.set(key, { bitmap: finalBitmap, worldData });

        } catch (err) {
            if (err && err.message !== 'Cancelled offscreen') {
                console.error(`Streaming error [${cx}, ${cy}]:`, err);
            }
        } finally {
            this.pendingChunks.delete(key);
            if (!this.renderPending) {
                this.renderPending = true;
                requestAnimationFrame(() => {
                    this.renderPending = false;
                    this.render();
                });
            }
        }
    }

    isChunkVisible(cx, cy, margin = 1) {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const minX = this.cameraX - margin * CHUNK_SIZE;
        const minY = this.cameraY - margin * CHUNK_SIZE;
        const maxX = this.cameraX + cw / this.zoom + margin * CHUNK_SIZE;
        const maxY = this.cameraY + ch / this.zoom + margin * CHUNK_SIZE;
        const cxMin = cx * CHUNK_SIZE;
        const cyMin = cy * CHUNK_SIZE;
        return !(cxMin + CHUNK_SIZE < minX || cxMin > maxX || cyMin + CHUNK_SIZE < minY || cyMin > maxY);
    }

    inspectAtScreen(screenX, screenY) {
        const worldX = this.cameraX + screenX / this.zoom;
        const worldY = this.cameraY + screenY / this.zoom;
        const cx = Math.floor(worldX / CHUNK_SIZE);
        const cy = Math.floor(worldY / CHUNK_SIZE);
        const key = `${cx},${cy}`;
        if (!this.chunkCache.has(key)) return null;
        const item = this.chunkCache.get(key);
        const localX = Math.floor(worldX - cx * CHUNK_SIZE);
        const localY = Math.floor(worldY - cy * CHUNK_SIZE);
        if (localX < 0 || localX >= GRID_WIDTH || localY < 0 || localY >= GRID_HEIGHT) return null;
        const idx = localY * GRID_WIDTH + localX;
        return { world: item.worldData, localX, localY, idx, cx, cy };
    }
}

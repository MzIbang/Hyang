/* Hyang Multi-Core Thread Scheduler & Wasm Worker Pool */
export class WorkerPool {
    constructor(poolSize = (navigator.hardwareConcurrency || 8)) {
        this.poolSize = Math.max(2, Math.min(16, poolSize));
        this.workers = [];
        this.idleWorkers = [];
        this.taskQueue = [];
        this.activeTasks = new Map();
        this.taskIdCounter = 1;

        this.initPool();
    }

    initPool() {
        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (e) => this.handleWorkerMessage(worker, e);
            worker.onerror = (err) => {
                console.error("Worker unhandled exception:", err);
            };
            this.workers.push(worker);
            this.idleWorkers.push(worker);
        }
    }

    dispatchTask(cx, cy, baseSeed, planetConfigData, mode) {
        return new Promise((resolve, reject) => {
            const taskId = this.taskIdCounter++;
            const task = { taskId, cx, cy, baseSeed, planetConfigData, mode, resolve, reject };

            if (this.idleWorkers.length > 0) {
                const worker = this.idleWorkers.pop();
                this.runTaskOnWorker(worker, task);
            } else {
                this.taskQueue.push(task);
            }
        });
    }

    runTaskOnWorker(worker, task) {
        this.activeTasks.set(task.taskId, { ...task, worker });
        worker.postMessage({
            taskId: task.taskId,
            cx: task.cx,
            cy: task.cy,
            baseSeed: task.baseSeed,
            planetConfigData: task.planetConfigData,
            mode: task.mode
        });
    }

    handleWorkerMessage(worker, e) {
        const { taskId, bitmap, imgDataBuffer, width, height, worldData, error } = e.data;
        if (this.activeTasks.has(taskId)) {
            const task = this.activeTasks.get(taskId);
            this.activeTasks.delete(taskId);

            if (error) {
                task.reject(new Error(error));
            } else {
                task.resolve({ bitmap, imgDataBuffer, width, height, worldData });
            }
        }

        if (this.taskQueue.length > 0) {
            const nextTask = this.taskQueue.shift();
            this.runTaskOnWorker(worker, nextTask);
        } else {
            this.idleWorkers.push(worker);
        }
    }

    pruneQueue(cameraX, cameraY, zoom, cw, ch, margin) {
        const minX = cameraX - margin;
        const minY = cameraY - margin;
        const maxX = cameraX + cw / zoom + margin;
        const maxY = cameraY + ch / zoom + margin;

        const keepQueue = [];
        for (const task of this.taskQueue) {
            const cxMin = task.cx * 1024;
            const cyMin = task.cy * 1024;
            const visible = !(cxMin + 1024 < minX || cxMin > maxX || cyMin + 1024 < minY || cyMin > maxY);
            if (visible) {
                keepQueue.push(task);
            } else {
                task.reject(new Error("Cancelled offscreen"));
            }
        }
        this.taskQueue = keepQueue;
    }
}

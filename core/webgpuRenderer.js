/* Hyang WebGPU High-Performance Hardware Blitter & Quad Renderer */

export class WebGPURenderer {
    constructor() {
        this.device = null;
        this.context = null;
        this.pipeline = null;
        this.sampler = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.format = null;
        this.isReady = false;
        this.instanceBuffer = null;
        this.instanceBufferCapacity = 0;
    }

    async init(canvas) {
        if (!navigator.gpu) {
            console.warn("WebGPU not supported in this browser/OS. Falling back to Canvas 2D.");
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn("No appropriate WebGPU adapter found.");
                return false;
            }

            this.device = await adapter.requestDevice();
            if (this.device.lost) {
                this.device.lost.then((info) => {
                    console.warn("WebGPU device lost:", info);
                    this.isReady = false;
                });
            }
            this.context = canvas.getContext('webgpu');
            if (!this.context) {
                console.warn("Could not acquire 'webgpu' context on canvas (likely locked to 2d context).");
                return false;
            }
            this.format = navigator.gpu.getPreferredCanvasFormat();

            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied'
            });

            // Uniform buffer for canvas size [width, height, pad, pad]
            this.uniformBuffer = this.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            this.sampler = this.device.createSampler({
                magFilter: 'nearest',
                minFilter: 'nearest',
                mipmapFilter: 'nearest',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge'
            });

            const wgslCode = `
                struct Uniforms {
                    canvasSize: vec2<f32>,
                }
                @group(0) @binding(0) var<uniform> uniforms: Uniforms;
                @group(0) @binding(1) var tileSampler: sampler;
                @group(0) @binding(2) var tileTexture: texture_2d<f32>;

                struct RectInstance {
                    @location(0) rect: vec4<f32>, // screenX, screenY, screenW, screenH
                }

                struct VertexOutput {
                    @builtin(position) position: vec4<f32>,
                    @location(0) uv: vec2<f32>,
                }

                @vertex
                fn vs_main(
                    @builtin(vertex_index) vIdx: u32,
                    @location(0) rect: vec4<f32>
                ) -> VertexOutput {
                    var uvs = array<vec2<f32>, 6>(
                        vec2<f32>(0.0, 0.0),
                        vec2<f32>(1.0, 0.0),
                        vec2<f32>(0.0, 1.0),
                        vec2<f32>(0.0, 1.0),
                        vec2<f32>(1.0, 0.0),
                        vec2<f32>(1.0, 1.0)
                    );
                    let uv = uvs[vIdx];
                    let screenPos = vec2<f32>(rect.x + uv.x * rect.z, rect.y + uv.y * rect.w);
                    let ndcX = (screenPos.x / uniforms.canvasSize.x) * 2.0 - 1.0;
                    let ndcY = 1.0 - (screenPos.y / uniforms.canvasSize.y) * 2.0;

                    var out: VertexOutput;
                    out.position = vec4<f32>(ndcX, ndcY, 0.0, 1.0);
                    out.uv = uv;
                    return out;
                }

                @fragment
                fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                    return textureSample(tileTexture, tileSampler, in.uv);
                }
            `;

            const shaderModule = this.device.createShaderModule({
                label: 'Hyang Sector Quad Shader',
                code: wgslCode
            });

            this.bindGroupLayout = this.device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
                ]
            });

            const pipelineLayout = this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout]
            });

            this.pipeline = this.device.createRenderPipeline({
                label: 'Hyang Sector Quad Pipeline',
                layout: pipelineLayout,
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_main',
                    buffers: [{
                        arrayStride: 16, // 4 * sizeof(f32) for rect (x, y, w, h)
                        stepMode: 'instance',
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x4'
                        }]
                    }]
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{
                        format: this.format,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            }
                        }
                    }]
                },
                primitive: {
                    topology: 'triangle-list'
                }
            });

            this.isReady = true;
            return true;
        } catch (err) {
            console.error("Failed to initialize WebGPU:", err);
            return false;
        }
    }

    createSectorTexture(bitmap) {
        if (!this.isReady || !bitmap || !bitmap.width || !bitmap.height || bitmap.width === 0 || bitmap.height === 0) return null;
        try {
            const texture = this.device.createTexture({
                size: [bitmap.width, bitmap.height, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });

            this.device.queue.copyExternalImageToTexture(
                { source: bitmap },
                { texture },
                [bitmap.width, bitmap.height]
            );

            const bindGroup = this.device.createBindGroup({
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer } },
                    { binding: 1, resource: this.sampler },
                    { binding: 2, resource: texture.createView() }
                ]
            });

            return { texture, bindGroup };
        } catch (err) {
            console.error("Error creating WebGPU sector texture:", err);
            return null;
        }
    }

    destroySectorTexture(gpuObj) {
        if (gpuObj && gpuObj.texture) {
            gpuObj.texture.destroy();
        }
    }

    renderFrame(sectors, canvasWidth, canvasHeight) {
        if (!this.isReady || !this.device || sectors.length === 0) return;

        try {
            // Update uniform buffer with current canvas size
            this.device.queue.writeBuffer(
                this.uniformBuffer,
                0,
                new Float32Array([canvasWidth, canvasHeight, 0, 0])
            );

            // Build instance buffer containing rect [screenX, screenY, screenW, screenH] for each sector
            const instanceData = new Float32Array(sectors.length * 4);
            for (let i = 0; i < sectors.length; i++) {
                const s = sectors[i];
                instanceData[i * 4 + 0] = s.screenX;
                instanceData[i * 4 + 1] = s.screenY;
                instanceData[i * 4 + 2] = s.screenW;
                instanceData[i * 4 + 3] = s.screenH;
            }

            if (!this.instanceBuffer || this.instanceBufferCapacity < instanceData.byteLength) {
                if (this.instanceBuffer) {
                    try { this.instanceBuffer.destroy(); } catch (e) {}
                }
                this.instanceBufferCapacity = Math.max(1024 * 16, instanceData.byteLength * 2);
                this.instanceBuffer = this.device.createBuffer({
                    size: this.instanceBufferCapacity,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
            }
            this.device.queue.writeBuffer(this.instanceBuffer, 0, instanceData);

            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: { r: 0.012, g: 0.027, b: 0.07, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });

            passEncoder.setPipeline(this.pipeline);

            for (let i = 0; i < sectors.length; i++) {
                const s = sectors[i];
                if (s.bindGroup) {
                    passEncoder.setBindGroup(0, s.bindGroup);
                    passEncoder.setVertexBuffer(0, this.instanceBuffer, i * 16, 16);
                    passEncoder.draw(6, 1, 0, 0);
                }
            }

            passEncoder.end();
            this.device.queue.submit([commandEncoder.finish()]);
        } catch (err) {
            console.warn("WebGPU renderFrame exception:", err);
            this.isReady = false;
        }
    }
}

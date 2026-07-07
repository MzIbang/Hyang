# HYANG - Infinite Procedural World Engine & Planetary Simulation

<div align="center">

[![Live Demo: Online](https://img.shields.io/badge/Live%20Demo-hyang.pages.dev-00EAFF?logo=cloudflarepages&logoColor=black)](https://hyang.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Zig: 0.13.0](https://img.shields.io/badge/Zig-0.13.0-F7A41D?logo=zig&logoColor=white)](https://ziglang.org/)
[![WebAssembly: Enabled](https://img.shields.io/badge/WebAssembly-Powered-654FF0?logo=webassembly&logoColor=white)](https://webassembly.org/)
[![Rendering: WebGPU / Three.js](https://img.shields.io/badge/Rendering-WebGPU%20%7C%20Three.js-black?logo=three.js&logoColor=white)](https://threejs.org/)
[![Node.js: Required](https://img.shields.io/badge/Node.js-Server-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**A standalone, high-performance physical world simulation featuring hydraulic erosion, tectonic geodynamics, Coriolis atmospheric circulation, and geological stratigraphy - powered by Zig & WebAssembly.**

---

<img src="https://github.com/user-attachments/assets/c2dac2d3-00a9-4b19-a605-1493c21f6747" alt="HYANG Planetary Simulation" width="100%" style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);" />

</div>

> **🌐 Try the Live Simulation Online**  
> Experience the real-time planetary world engine directly in your browser without any installation: **[https://hyang.pages.dev](https://hyang.pages.dev)**

---

## Overview

**HYANG** is an advanced procedural planetary simulation engine designed to bridge the gap between real-time web graphics and rigorous geophysical modeling. Unlike simple noise-based heightmap generators, HYANG simulates interconnected Earth systems: stellar radiation, atmospheric lapse rates, tectonic plate movement, mantle heat decay, hydrological routing, and chemical geochemistry.

By compiling high-performance algorithms written in **Zig** directly to **WebAssembly (WASM)**, HYANG achieves near-native execution speeds in the browser. It leverages **Web Workers** and **SharedArrayBuffer** for non-blocking, infinite terrain streaming and real-time 3D relief displacement via **WebGPU/WebGL** and **Three.js**.

---

## Key Features

- **Near-Native WASM Computation**: Core algorithms (including multi-octave fractal generation, hydraulic erosion routing, and atmospheric thermal solvers) are implemented in clean, zero-allocation **Zig** compiled to WebAssembly.
- **Planet Physics Lab & Archetypes**: Live-tune astronomical and planetary parameters in real time. Experiment with custom mass, water fraction, axial tilt, star luminosity, and radioactive mantle heat, or load curated celestial archetypes:
  - 🌍 **Earth-like (Water World)** - Balanced ocean basins and active plate tectonics.
  - 🏜️ **Desert World (Arid Dunes)** - Low moisture retention with vast continental wind patterns.
  - 🌊 **Ocean World (Deep Pelagic)** - High water fraction with submerged volcanic ridges.
  - 🪨 **Super-Earth (High Gravity)** - Denser atmospheres, compressed lapse rates, and strong surface gravity.
  - ❄️ **Ice Giant (Extreme Tilt)** - Extreme seasonal insolation and cryo-geology.
  - 🌋 **Volcanic World** - High radioactive mantle vigour ($H_0$) and intense tectonic activity.
- **7 Multi-Layered Map Modes**:
  - **Elevation**: Real-time 3D displacement and terrain relief.
  - **Biomes**: Dynamic ecosystem classification based on Whittaker’s temperature/moisture matrix.
  - **Geology (Stratigraphy)**: Isostatic crust balance and geochemical rock layer deposition.
  - **Hydrology**: Flow direction accumulation, river network routing, and erosion carving.
  - **Climate**: Temperature fields adjusted for elevation lapse rates and solar insolation.
  - **Humidity**: Moisture evaporation, Coriolis wind transport, and rain shadows.
  - **Tectonics**: Continental drift vectors, crustal boundaries, and mantle heat dynamics.
- **Infinite Procedural Streaming**: Navigate an endless planetary surface with background chunk generation, automated origin recentering, and multi-threaded worker pools.
- **Interactive HUD Inspector**: Inspect real-time coordinates, altitude, elevation type, temperature, humidity, river flow rate, geology, and biome classification at any point on the map.

---

## Scientific & Mathematical Basis

HYANG's physical simulation models are built upon foundational geophysical literature (*Turcotte & Schubert*, *Foley & Driscoll*, *Korenaga 2013*, *Oosterloo et al. 2021*):

1. **Surface Gravity & Atmospheric Retention**:
   
   Gravity (g) = (G × Mₚ) / Rₚ²
   
   Escape Velocity (v_esc) = √(2G × Mₚ / Rₚ)
   
   Atmospheric surface pressure scales dynamically with escape velocity and mass retention.

2. **Stellar Insolation & Energy Balance**:
   
   Solar Constant (S₀) = L⋆ / (4πa²)
   
   T_eq = [S₀(1 - A) / 4σ]^(1/4)

   Surface temperature incorporates greenhouse gas scaling and dry adiabatic lapse rates (Γ = g / Cₚ).

3. **Hydraulic Erosion & Hydrology**:
   Simulates droplet routing across discrete grid cells, calculating sediment carrying capacity, deposition, and erosion carving based on slope velocity and water volume.

4. **Geodynamics & Isostasy**:
   Models crustal buoyancy (Airy isostasy) where continental and oceanic crust float upon a denser viscous mantle governed by radioactive decay heat (H₀).

---

## 🏗️ Architecture & Data Flow

```mermaid
graph TD
    subgraph Frontend ["Browser / UI Layer"]
        UI["HTML5 Glassmorphism UI & Controls"]
        Map["Canvas Map / Three.js 3D Relief"]
        HUD["Compact Physical Inspector"]
    end

    subgraph Concurrency ["Web Worker Pool (workerPool.js)"]
        Streamer["Infinite Streamer & Chunk Coordinator"]
        Worker1["SimWorker 1"]
        Worker2["SimWorker 2"]
    end

    subgraph CoreEngine ["Zig / WebAssembly Core (terrain.wasm)"]
        Fractal["Fractal Noise & Elevation Generator"]
        Erosion["Hydraulic Erosion & River Routing"]
        Atmo["Coriolis & Climate Simulation"]
        Biome["Biome & Stratigraphy Classifier"]
    end

    UI -->|Parameters & Seed| Streamer
    Streamer -->|Dispatch Chunks| Worker1 & Worker2
    Worker1 <-->|SharedArrayBuffer Memory| CoreEngine
    Worker2 <-->|SharedArrayBuffer Memory| CoreEngine
    CoreEngine -->|Float32 / UInt8 Buffers| Map
    Map -->|Hover Coords| HUD
```

---

## 🚀 Getting Started

### Online Access
The easiest way to experience **HYANG** is via the live web deployment. No local installation or compilation is required:  
👉 **[https://hyang.pages.dev](https://hyang.pages.dev)**

---

### 💻 Local Setup & Prerequisites

- **Node.js** (v16.x or higher recommended)
- **Modern Web Browser** with support for **WebAssembly**, **WebGL/WebGPU**, and **SharedArrayBuffer**.
- *(Optional)* **Zig 0.13.0** if you wish to modify and recompile the WebAssembly engine.

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/MzIbang/Hyang.git
   cd Hyang
   ```

2. **Start the local server**:
   ```bash
   npm start
   # or run directly with Node:
   node server.js
   ```

3. **Open in your browser**:
   Navigate to [http://localhost:3005](http://localhost:3005).

> [!IMPORTANT]
> **Why is a custom HTTP server required?**  
> To achieve high-performance multi-threaded simulation without data copying, HYANG uses `SharedArrayBuffer`. For security reasons, web browsers require strict isolation headers to enable this feature. The included `server.js` automatically configures the necessary **COOP** (`Cross-Origin-Opener-Policy: same-origin`) and **COEP** (`Cross-Origin-Embedder-Policy: require-corp`) headers.

---

## 🔨 Compiling Zig to WebAssembly

If you make modifications to `./terrain.zig`, you can recompile the WebAssembly binary using the included Windows build script or manually via the Zig CLI.

### Using Windows Script
```cmd
build.bat
```

### Manual Compilation (Zig 0.13.0)
```bash
zig build-exe terrain.zig \
    -target wasm32-freestanding \
    -O ReleaseFast \
    -fno-entry \
    -femit-bin=terrain.wasm \
    --export=getElevationPtr \
    --export=getRiverFlowPtr \
    --export=getFlowDirectionPtr \
    --export=getMoisturePtr \
    --export=getTemperaturePtr \
    --export=getStratigraphyPtr \
    --export=getBiomeIdsPtr \
    --export=setWorldType \
    --export=setChunkOffset \
    --export=setPlanetParams \
    --export=initRand \
    --export=initNoise \
    --export=generateFractalTerrain \
    --export=runHydraulicErosion \
    --export=generateRivers \
    --export=runAtmosphericSimulation \
    --export=assignBiomesNoise
```


> The compiled binary is emitted to `./terrain.wasm` and is immediately ready to be loaded by `renderer.js` and `simWorker.js`.

---

## 📸 Map Modes Gallery (Placeholders)

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="https://github.com/user-attachments/assets/7a5ecf40-7ffa-4cf4-a5d8-fc16ecc2885f" alt="Elevation Mode Placeholder" width="100%" /><br />
        <b>Elevation & 3D Relief</b>
      </td>
      <td align="center">
        <img src="https://github.com/user-attachments/assets/5bd54ff0-791a-40bc-9664-95be5fe9520e" alt="Biomes Mode Placeholder" width="100%" /><br />
        <b>Biomes & Ecosystems</b>
      </td>
    </tr>
    <tr>
      <td align="center">
        <img src="https://github.com/user-attachments/assets/8534abf9-ed2a-40e5-add7-9f65079b62b1" alt="Hydrology Mode Placeholder" width="100%" /><br />
        <b>Hydrology & River Networks</b>
      </td>
      <td align="center">
        <img src="https://github.com/user-attachments/assets/0fa04dfd-ffc4-40d6-9a60-4c187ec1d52c" alt="Tectonics Mode Placeholder" width="100%" /><br />
        <b>Tectonic Plate Boundaries</b>
      </td>
    </tr>
  </table>
</div>

---

## 📜 License & Credits

- **Author**: Created by **MzIbang**.
- **License**: Distributed under the [MIT License](https://opensource.org/licenses/MIT). See `LICENSE` for more information.

---

<div align="center">
  <p>Built with ❤️ by Ibang using <b>Zig</b>, <b>WebAssembly</b>, and <b>JavaScript</b>.</p>
</div>
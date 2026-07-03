@echo off
REM ============================================================
REM  HYANG — Zig -> WebAssembly Build Script (Zig 0.13.0)
REM  Usage: build.bat
REM ============================================================

SET ZIG=D:\programs\zig\zig.exe

echo Using Zig: %ZIG%
echo Building terrain.zig -^> terrain.wasm ...

%ZIG% build-exe terrain.zig ^
    -target wasm32-freestanding ^
    -O ReleaseFast ^
    -fno-entry ^
    -femit-bin=terrain.wasm ^
    --export=getElevationPtr ^
    --export=getRiverFlowPtr ^
    --export=getFlowDirectionPtr ^
    --export=getMoisturePtr ^
    --export=getTemperaturePtr ^
    --export=getStratigraphyPtr ^
    --export=getBiomeIdsPtr ^
    --export=setWorldType ^
    --export=setChunkOffset ^
    --export=setPlanetParams ^
    --export=initRand ^
    --export=initNoise ^
    --export=getRandCallCount ^
    --export=generateFractalTerrain ^
    --export=runHydraulicErosion ^
    --export=generateRivers ^
    --export=runAtmosphericSimulation ^
    --export=assignBiomesNoise ^
    --export=getMoistureTempAndBiomeNoise ^
    --export=getMoistureTempAndBiomeNoise2 ^
    --export=getMoistureTempAndBiomeNoise3

IF %ERRORLEVEL% EQU 0 (
    echo.
    echo [OK] terrain.wasm compiled successfully!
    for %%F in (terrain.wasm) do echo      Size: %%~zF bytes
) ELSE (
    echo.
    echo [FAIL] Compilation failed. See errors above.
    exit /b 1
)

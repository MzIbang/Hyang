/* ============================================================
 * Hyang — Planetary Physics Module  (Blueprint Phase 1)
 * Steps 1 & 2: Planetary Constants + Stellar / Orbital System
 * Scientific basis: Turcotte & Schubert, Foley & Driscoll,
 *                   Korenaga 2013, Oosterloo et al. 2021
 * ============================================================ */

// ─── Physical Constants ──────────────────────────────────────────────────────
const G           = 6.674e-11;  // N m² kg⁻²      (gravitational constant)
const SIGMA       = 5.67e-8;    // W m⁻² K⁻⁴      (Stefan–Boltzmann)
const EARTH_MASS  = 5.972e24;   // kg
const EARTH_RADIUS= 6.371e6;    // m
const SUN_LUMIN   = 3.828e26;   // W
const AU          = 1.496e11;   // m

// ─── PlanetaryConfig class ───────────────────────────────────────────────────
export class PlanetaryConfig {
    /**
     * @param {Object} params
     * Accepts all parameters as Earth-relative ratios or raw physical units.
     */
    constructor(params = {}) {
        // ── Planet Body ──────────────────────────────────────────────────
        this.mass_ratio     = params.mass_ratio     ?? 1.0;   // × Earth mass
        this.radius_ratio   = params.radius_ratio   ?? 1.0;   // × Earth radius
        this.water_fraction = params.water_fraction ?? 0.71;  // 0–1 (Earth = 0.71)
        this.iron_ratio     = params.iron_ratio     ?? 0.32;  // core mass fraction
        this.age_gyr        = params.age_gyr        ?? 4.5;   // Gyr
        this.radioactive_heat = params.radioactive_heat ?? 1.0; // × Earth H₀

        // ── Star & Orbit ─────────────────────────────────────────────────
        this.star_luminosity    = params.star_luminosity    ?? 1.0;   // × L☉
        this.orbital_distance   = params.orbital_distance   ?? 1.0;   // AU
        this.eccentricity       = params.eccentricity       ?? 0.017; // 0–0.8
        this.axial_tilt         = params.axial_tilt         ?? 23.5;  // degrees

        this._compute();
    }

    _compute() {
        const Mp = this.mass_ratio   * EARTH_MASS;
        const Rp = this.radius_ratio * EARTH_RADIUS;

        // ── Derived Planet Body ──────────────────────────────────────────
        // Surface gravity  g = G M / R²
        this.gravity     = (G * Mp) / (Rp * Rp);           // m s⁻²
        this.gravity_g   = this.gravity / 9.81;             // normalised (Earth = 1)

        // Escape velocity  v = √(2GM/R)
        this.escape_vel  = Math.sqrt(2 * G * Mp / Rp);     // m s⁻¹

        // Atmospheric retention: heavier planets hold denser atmospheres.
        // Simple scaling: p_atm ∝ gravity × (1 - exp(-v_esc/8000))
        this.atm_pressure = this.gravity_g * (1 - Math.exp(-this.escape_vel / 8000));

        // Adiabatic temperature lapse rate scales with gravity:
        // Γ = g / Cp  (dry adiabatic), Cp ≈ 1005 J kg⁻¹ K⁻¹ for N₂/O₂
        this.lapse_rate_K_per_m = this.gravity / 1005;      // K m⁻¹

        // ── Stellar Insolation & Equilibrium Temperature ─────────────────
        const L = this.star_luminosity * SUN_LUMIN;
        const a = this.orbital_distance * AU;
        const S0 = L / (4 * Math.PI * a * a);               // W m⁻² (solar constant)

        const albedo = 0.30;
        // T_eq = [S0(1–A) / 4σ]^0.25  (zero-dim energy balance)
        this.T_eq = Math.pow(S0 * (1 - albedo) / (4 * SIGMA), 0.25); // K
        this.T_eq_C = this.T_eq - 273.15;                   // °C

        // ── Dynamic Sea Level Threshold ──────────────────────────────────
        // Sea level threshold in the normalised [0,1] elevation space.
        // With more water the ocean basin is filled higher.
        // Calibrated so Earth (0.71) → 0.42 (existing default).
        // Anchor: 0.71 → 0.42;  0 → ~0.24;  1 → ~0.54
        this.sea_level = 0.24 + this.water_fraction * 0.42 * (1 / 0.71);
        this.sea_level = Math.max(0.15, Math.min(0.70, this.sea_level));

        // Normalised equilibrium temperature for Wasm atmospheric solver.
        // Maps: –60 °C → 0,  +60 °C → 1  (Earth ~15°C → ~0.625)
        this.eq_temp_norm = Math.max(0, Math.min(1, (this.T_eq_C + 60) / 120));

        // Normalised lapse rate for Wasm (Earth → 1.0)
        // Used to scale altitude-cooling in temperature field.
        this.lapse_norm = this.lapse_rate_K_per_m / (9.81 / 1005);

        // Axial tilt in radians (for insolation function)
        this.axial_tilt_rad = this.axial_tilt * Math.PI / 180;

        // Radioactive heat (mantle vigour proxy, Phase 2 input)
        this.H0_rel = this.radioactive_heat;
    }

    /**
     * Latitudinal annual-mean insolation, normalised [0,1].
     * @param {number} lat_norm  0 = equator, 1 = pole
     */
    insolation(lat_norm) {
        const phi = lat_norm * Math.PI * 0.5;
        // Annual-mean: ∝ cos(φ), redistributed by tilt
        const base = Math.cos(phi);
        const tilt_spread = Math.sin(this.axial_tilt_rad) * 0.5;
        return Math.max(0, Math.min(1, base + tilt_spread * (1 - 2 * lat_norm)));
    }

    /** Pack six f32 values for the Wasm setPlanetParams() call. */
    toWasm() {
        return [
            this.sea_level,       // dynamic ocean threshold
            this.gravity_g,       // normalised gravity (1 = Earth)
            this.eq_temp_norm,    // equilibrium temperature normalised
            this.lapse_norm,      // lapse rate normalised (1 = Earth)
            this.axial_tilt,      // degrees
            this.water_fraction   // 0–1
        ];
    }

    /** Human-readable summary for the UI. */
    summary() {
        return {
            gravity:   `${this.gravity.toFixed(2)} m/s²  (${this.gravity_g.toFixed(2)}g)`,
            escape:    `${(this.escape_vel / 1000).toFixed(1)} km/s`,
            T_eq:      `${this.T_eq_C.toFixed(1)} °C`,
            sea_level: `${(this.sea_level * 100).toFixed(0)}% elev.`,
            pressure:  `${this.atm_pressure.toFixed(2)} atm (est.)`,
            lapse:     `${(this.lapse_rate_K_per_m * 1000).toFixed(2)} K/km`
        };
    }
}

// ─── Default — Earth-like planet ─────────────────────────────────────────────
export const DEFAULT_PLANET = new PlanetaryConfig();

// ─── Preset Library ──────────────────────────────────────────────────────────
export const PRESETS = {
    'Earth-like':   new PlanetaryConfig(),
    'Desert World': new PlanetaryConfig({ water_fraction: 0.15, axial_tilt: 10, T_correction: 8 }),
    'Ocean World':  new PlanetaryConfig({ water_fraction: 0.97, axial_tilt: 5 }),
    'Super-Earth':  new PlanetaryConfig({ mass_ratio: 3.5, radius_ratio: 1.5, water_fraction: 0.60, star_luminosity: 1.4, orbital_distance: 1.3 }),
    'Ice Giant':    new PlanetaryConfig({ mass_ratio: 0.6, radius_ratio: 0.85, water_fraction: 0.80, axial_tilt: 45, star_luminosity: 0.4, orbital_distance: 0.7 }),
    'Volcanic':     new PlanetaryConfig({ radioactive_heat: 4.0, iron_ratio: 0.55, water_fraction: 0.25, axial_tilt: 3, star_luminosity: 1.1 })
};

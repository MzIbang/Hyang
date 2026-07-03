/* Hyang Planetary Geodynamics Module — Phase 2: Physics-First Mantle & Lithospheric Regime */

export const TECTONIC_REGIME = {
    PLATE_TECTONIC: 'plate_tectonic',
    STAGNANT_LID: 'stagnant_lid',
    EPISODIC_OVERTURN: 'episodic_overturn'
};

export class GeodynamicalModel {
    constructor(planetConfig) {
        this.planet = planetConfig;
        this.computeMantleProperties();
    }

    computeMantleProperties() {
        const p = this.planet;

        // Reference Earth geodynamical values
        const D_0 = 2900000; // Mantle thickness in meters (Earth ~2900 km)
        const D = D_0 * (p.radius_ratio || 1.0); // Scaled mantle depth
        const g = p.gravity_g || 9.81;

        // Mantle temperature scaling based on radiogenic heat content (H0_rel)
        // Earth reference mantle potential temperature ~ 1620 K
        const T_m0 = 1620;
        this.mantle_temp = T_m0 * Math.pow(p.radioactive_heat || 1.0, 0.25);

        // Temperature-dependent mantle viscosity (Arrhenius law simplification)
        // eta = eta_0 * exp( E* / R * (1/T - 1/T0) )
        // Higher internal heat -> dramatically lower viscosity -> faster convection
        const eta_0 = 1e21; // Pa·s reference viscosity
        const activation_factor = 28.0; // Scaled non-dimensional activation energy
        const temp_ratio = T_m0 / this.mantle_temp;
        this.viscosity = eta_0 * Math.exp(activation_factor * (temp_ratio - 1.0));

        // Internal Rayleigh Number (Ra_i)
        // Ra = (alpha * rho * g * delta_T * D^3) / (kappa * eta)
        const Ra_0 = 1.2e7; // Reference Earth Rayleigh number
        this.rayleigh_number = Ra_0 * (g / 9.81) * Math.pow(D / D_0, 3) * (1e21 / this.viscosity);

        // Convective mantle velocity scaling: v ~ (kappa / D) * Ra^(2/3)
        // Normalized relative to Earth (1.0 = ~4-5 cm/yr average plate speed)
        const v_norm = Math.pow(this.rayleigh_number / Ra_0, 0.667);
        this.plate_speed_factor = Math.max(0.1, Math.min(5.0, v_norm));

        // Lithospheric Yield Strength & Water Lubrication Effect
        // Water fraction dramatically affects fault friction (serpentinization of mantle wedges)
        // If water fraction < 12%, friction is too high for subduction -> Stagnant Lid!
        const water_frac = p.water_fraction !== undefined ? p.water_fraction : 0.71;
        this.water_lubrication = Math.min(1.0, water_frac / 0.30);
        
        // Critical yield stress threshold
        const convective_stress = Math.pow(this.rayleigh_number / Ra_0, 0.333);
        const yield_resistance = 1.0 / Math.max(0.15, this.water_lubrication);

        if (water_frac < 0.12) {
            // Bone dry planet: lithosphere locks up into a single immobile lid
            this.regime = TECTONIC_REGIME.STAGNANT_LID;
            this.plate_count = Math.floor(2 + Math.random() * 2); // 2-3 massive rigid cratons / coronae
        } else if (p.radioactive_heat > 2.8 && water_frac < 0.35) {
            // High heat + moderate water: Episodic catastrophic resurfacing (like Venus)
            this.regime = TECTONIC_REGIME.EPISODIC_OVERTURN;
            this.plate_count = 6;
        } else {
            // Healthy plate tectonics (Earth or Super-Earth water world)
            this.regime = TECTONIC_REGIME.PLATE_TECTONIC;
            // Super-earths have higher surface gravity and more fragmented convective cells
            const base_plates = 14;
            this.plate_count = Math.floor(base_plates * Math.pow(p.radius_ratio || 1.0, 0.8));
        }

        this.convective_stress_norm = convective_stress;
        this.yield_resistance_norm = yield_resistance;
    }

    summary() {
        return {
            regime: this.regime === TECTONIC_REGIME.STAGNANT_LID ? "Stagnant Lid (Single Crust)" :
                    this.regime === TECTONIC_REGIME.EPISODIC_OVERTURN ? "Episodic Overturn (Volcanic)" :
                    "Active Plate Tectonics",
            rayleigh: `${(this.rayleigh_number / 1e7).toFixed(2)}×10⁷`,
            viscosity: `${(this.viscosity / 1e21).toFixed(2)}×10²¹ Pa·s`,
            plateSpeed: `${(this.plate_speed_factor * 4.5).toFixed(1)} cm/yr`,
            plateCount: `${this.plate_count} Dynamic Plates`
        };
    }
}

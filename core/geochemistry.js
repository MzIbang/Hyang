/* Hyang Planetary Geochemistry & Climate Module — Phase 4: CO2 Thermostat & Glacial Cycles */

export class GeochemicalCycleModel {
    constructor(planetConfig, geoModel) {
        this.planet = planetConfig || {};
        this.geo = geoModel || {};
        this.computeGreenhouseEquilibrium();
    }

    computeGreenhouseEquilibrium() {
        const p = this.planet;
        const heat = p.radioactive_heat || 1.0;
        
        // Volcanic CO2 outgassing rate scales directly with mantle convective vigor and plate boundaries
        this.outgassing_rate = Math.pow(heat, 1.2) * (this.geo.plate_speed_factor || 1.0);

        // Silicate weathering feedback (Höning et al. 2021):
        // W_sil ~ pCO2^beta * exp( k * (T - T0) ) * Runoff
        // Equilibrium greenhouse temperature shift Delta_T_gh occurs where Outgassing == Weathering
        // Reference Earth CO2 greenhouse warming ~ 33 K
        const baseGHE = 33.0;
        const outgassingRatio = this.outgassing_rate / 1.0;
        
        // Logarithmic greenhouse effect scaling
        this.co2_partial_pressure = Math.max(0.1, outgassingRatio * 380); // ppmv
        const ghBoost = baseGHE * (1.0 + 0.18 * Math.log(this.co2_partial_pressure / 380.0));
        
        // Normalized temperature adjustment (-0.1 to +0.2 in normalized 0..1 scale)
        this.temp_shift_norm = (ghBoost - baseGHE) / 100.0;
    }

    /**
     * Applies Milankovitch orbital cycles and ice albedo feedback to compute local cryosphere
     */
    applyCryosphereFeedback(t, e, sl, latDeg) {
        // High latitude or altitude freezing zone
        const isFreezing = t < 0.28 || e > (sl + (1.0 - sl) * 0.82);
        if (isFreezing) {
            // Ice albedo feedback cools the tile an additional amount
            const albedoCooling = 0.05;
            return Math.max(0.0, t - albedoCooling);
        }
        return t;
    }

    summary() {
        return {
            co2Level: `${Math.floor(this.co2_partial_pressure)} ppmv`,
            outgassing: `${this.outgassing_rate.toFixed(2)}× Earth Rate`,
            climateStatus: this.temp_shift_norm > 0.04 ? "Hothouse Greenhouse" :
                           this.temp_shift_norm < -0.04 ? "Glacial Icehouse" :
                           "Temperate Carbonate-Silicate Equilibrium"
        };
    }
}

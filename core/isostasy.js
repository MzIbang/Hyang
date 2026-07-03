/* Hyang Isostasy & Crustal Evolution Module — Phase 3: Airy Isostasy & Juvenile Crust */

export const CRUST_DENSITY = {
    MANTLE: 3300,        // kg/m³ — Peridotite mantle baseline
    OCEANIC_BASALT: 2900, // kg/m³ — Dense mafic basalt crust
    CONTINENTAL_FELSIC: 2700, // kg/m³ — Buoyant granitic/felsic crust
    WATER: 1030          // kg/m³ — Ocean water loading
};

export class IsostaticModel {
    constructor(planetConfig) {
        this.planet = planetConfig || {};
        this.g = this.planet.gravity_g || 9.81;
        this.seaLevel = this.planet.sea_level !== undefined ? this.planet.sea_level : 0.42;
    }

    /**
     * Calculates surface elevation using Airy Isostasy.
     * @param {number} hc - Crustal thickness (normalized or physical scale)
     * @param {number} rho_c - Mean density of this crustal column (2700 for granite, 2900 for basalt)
     * @param {number} baseElevation - Baseline reference mantle height
     */
    computeAiryElevation(hc, rho_c, baseElevation = 0.15) {
        const rho_m = CRUST_DENSITY.MANTLE;
        const buoyancyFactor = 1.0 - (rho_c / rho_m);
        return baseElevation + hc * buoyancyFactor;
    }

    /**
     * Simulates subduction crustal factory differentiation.
     * When oceanic basalt subducts under continental crust, partial melting differentiates
     * light felsic magma, converting dense basalt into buoyant granitic crust.
     */
    differentiateSubductionArc(currentElev, convergenceSpeed, mantleVigor) {
        // Buoyancy lift: converting basalt (rho=2900) to granite (rho=2700) increases
        // elevation factor from 0.121 to 0.182 (+50% buoyancy increase per unit thickness!)
        const differentiationBoost = 0.08 * convergenceSpeed * Math.min(2.0, mantleVigor);
        return currentElev + differentiationBoost;
    }
}

package org.acme.vehiclerouting.solver;

import ai.timefold.solver.core.api.score.buildin.hardsoftlong.HardSoftLongScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;

import org.acme.vehiclerouting.domain.Visit;
import org.acme.vehiclerouting.domain.Vehicle;

public class VehicleRoutingConstraintProvider implements ConstraintProvider {

    public static final String VEHICLE_CAPACITY = "vehicleCapacity";
    public static final String SERVICE_FINISHED_AFTER_MAX_END_TIME = "serviceFinishedAfterMaxEndTime";
    public static final String MINIMIZE_TRAVEL_TIME = "minimizeTravelTime";

    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        return new Constraint[] {
                vehicleCapacity(factory),
                serviceFinishedAfterMaxEndTime(factory),
                workTimeExceeded(factory),
                latestArrivalExceeded(factory),
                // Station constraint: enforces Stations → Vehicles → Visits hierarchy
                stationConstraint(factory),
                // Prime order constraint: prime deliveries have a dedicated hard time-window penalty.
                // Incorporates service/handling time via arrivalTime + serviceDuration (shadow variable
                // chain ensures downstream delays propagate, preventing the domino effect).
                primeOrderTimeWindow(factory),
                // Perishable expiry constraint: enforces arrival_time + handling_time < expiration_time.
                perishableExpiryConstraint(factory),
                // Vehicle-type compatibility: delivery type must match vehicle specialisation.
                vehicleTypeCompatibility(factory),
                // NOTE: Dynamic re-optimization (mid-route re-solve) is supported by the existing
                // stop-and-restart REST API (/route-plans DELETE then POST). No additional solver
                // code is required — the solver is stateless and re-solves from any intermediate state.
                minimizeTravelTime(factory)
        };
    }

    // ************************************************************************
    // Hard constraints
    // ************************************************************************

    protected Constraint vehicleCapacity(ConstraintFactory factory) {
        return factory.forEach(Vehicle.class)
                .filter(vehicle -> vehicle.getTotalDemand() > vehicle.getCapacity())
                .penalizeLong(HardSoftLongScore.ONE_HARD,
                        vehicle -> vehicle.getTotalDemand() - vehicle.getCapacity())
                .asConstraint(VEHICLE_CAPACITY);
    }

    protected Constraint serviceFinishedAfterMaxEndTime(ConstraintFactory factory) {
        return factory.forEach(Visit.class)
                .filter(Visit::isServiceFinishedAfterMaxEndTime)
                .penalizeLong(HardSoftLongScore.ONE_HARD,
                        Visit::getServiceFinishedDelayInMinutes)
                .asConstraint(SERVICE_FINISHED_AFTER_MAX_END_TIME);
    }

    protected Constraint workTimeExceeded(ConstraintFactory factory) {
        return factory.forEach(Vehicle.class)
                .filter(vehicle -> vehicle.getMaxWorkTimeSeconds() > 0
                        && vehicle.getTotalDrivingTimeSeconds() > vehicle.getMaxWorkTimeSeconds())
                .penalizeLong(HardSoftLongScore.ONE_HARD,
                        vehicle -> vehicle.getTotalDrivingTimeSeconds() - vehicle.getMaxWorkTimeSeconds())
                .asConstraint("workTimeExceeded");
    }

    protected Constraint latestArrivalExceeded(ConstraintFactory factory) {
        return factory.forEach(Vehicle.class)
                .filter(vehicle -> vehicle.getLatestArrivalTime() != null
                        && vehicle.arrivalTime().isAfter(vehicle.getLatestArrivalTime()))
                .penalizeLong(HardSoftLongScore.ONE_HARD,
                        vehicle -> java.time.Duration.between(vehicle.getLatestArrivalTime(), vehicle.arrivalTime()).toMinutes())
                .asConstraint("latestArrivalExceeded");
    }

    // ************************************************************************
    // Soft constraints
    // ************************************************************************

    protected Constraint minimizeTravelTime(ConstraintFactory factory) {
        return factory.forEach(Vehicle.class)
                .penalizeLong(HardSoftLongScore.ONE_SOFT,
                        Vehicle::getTotalDrivingTimeSeconds)
                .asConstraint(MINIMIZE_TRAVEL_TIME);
    }

    // ************************************************************************
    // Station hierarchy constraint (3-level: Stations → Vehicles → Visits)
    // ************************************************************************

    /**
     * Hard constraint: a vehicle may only serve visits assigned to its station.
     *
     * This constraint is null-safe: it only fires when BOTH the visit and vehicle
     * have a non-null stationId, and those IDs differ. Visits or vehicles without
     * a stationId are not penalized, preserving backward compatibility with existing
     * plans that pre-date the 3-level hierarchy.
     *
     * Added as part of the Dubai geospatial and hierarchy refactoring.
     */
    protected Constraint stationConstraint(ConstraintFactory factory) {
        return factory.forEach(Visit.class)
                .filter(visit -> visit.getVehicle() != null
                        && visit.getStationId() != null
                        && visit.getVehicle().getStationId() != null
                        && !visit.getStationId().equals(visit.getVehicle().getStationId()))
                .penalizeLong(HardSoftLongScore.ONE_HARD, visit -> 1L)
                .asConstraint("stationConstraint");
    }

    // ************************************************************************
    // New constraints: Prime orders, Perishable goods, Vehicle-type compatibility
    // ************************************************************************

    /**
     * Hard constraint: Prime orders must always be delivered within their requested time window.
     *
     * Fires when speedTag == "prime" and service finishes after maxEndTime.
     * Penalty is minutes of delay, identical in structure to serviceFinishedAfterMaxEndTime
     * but scoped to prime orders so they appear as a distinct constraint in score analysis.
     *
     * Service/handling time is intrinsically included because isServiceFinishedAfterMaxEndTime()
     * checks arrivalTime + serviceDuration > maxEndTime. The shadow variable chain ensures
     * delays at one stop propagate to subsequent stops (preventing the domino effect).
     */
    protected Constraint primeOrderTimeWindow(ConstraintFactory factory) {
        return factory.forEach(Visit.class)
                .filter(visit -> "prime".equals(visit.getSpeedTag())
                        && visit.isServiceFinishedAfterMaxEndTime())
                .penalizeLong(HardSoftLongScore.ONE_HARD,
                        Visit::getServiceFinishedDelayInMinutes)
                .asConstraint("primeOrderTimeWindow");
    }

    /**
     * Hard constraint: Perishable goods must be delivered before their expiration time.
     *
     * Fires when visit.expirationTime is set and arrivalTime + serviceDuration > expirationTime.
     * Penalty is minutes past expiration. Null-safe: visits without expirationTime are unaffected.
     * Enforces: arrival_time + handling_time < expiration_time.
     */
    protected Constraint perishableExpiryConstraint(ConstraintFactory factory) {
        return factory.forEach(Visit.class)
                .filter(Visit::isServiceFinishedAfterExpirationTime)
                .penalizeLong(HardSoftLongScore.ONE_HARD,
                        Visit::getExpirationDelayInMinutes)
                .asConstraint("perishableExpiryConstraint");
    }

    /**
     * Hard constraint: Delivery type must be compatible with vehicle specialisation.
     *
     * Compatibility rules (reflecting real cold-chain requirements):
     *   - refrigerated or frozen commodity → vehicle must be specialised as "refrigerated"
     *   - ambient or standard commodity    → any vehicle is acceptable
     *
     * Only fires when both visit.commodityTag and vehicle.specialisationOfVehicle are non-null.
     * Null on either side means no compatibility restriction (backward-compatible).
     */
    protected Constraint vehicleTypeCompatibility(ConstraintFactory factory) {
        return factory.forEach(Visit.class)
                .filter(visit -> visit.getVehicle() != null
                        && visit.getCommodityTag() != null
                        && visit.getVehicle().getSpecialisationOfVehicle() != null
                        // Refrigerated/frozen deliveries require a refrigerated vehicle
                        && (visit.getCommodityTag().equals("refrigerated") || visit.getCommodityTag().equals("frozen"))
                        && !visit.getVehicle().getSpecialisationOfVehicle().equals("refrigerated"))
                .penalizeLong(HardSoftLongScore.ONE_HARD, visit -> 1L)
                .asConstraint("vehicleTypeCompatibility");
    }
}

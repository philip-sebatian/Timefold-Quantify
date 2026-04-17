package org.acme.vehiclerouting.domain;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.lookup.PlanningId;
import ai.timefold.solver.core.api.domain.variable.InverseRelationShadowVariable;
import ai.timefold.solver.core.api.domain.variable.PreviousElementShadowVariable;
import ai.timefold.solver.core.api.domain.variable.ShadowSources;
import ai.timefold.solver.core.api.domain.variable.ShadowVariable;
import ai.timefold.solver.core.api.domain.variable.ShadowVariablesInconsistent;

import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonIdentityReference;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;

@JsonIdentityInfo(scope = Visit.class, generator = ObjectIdGenerators.PropertyGenerator.class, property = "id")
@PlanningEntity
public class Visit implements LocationAware {

    @PlanningId
    private String id;
    private String name;
    private Location location;
    private int demand;
    /**
     * Pre-assigned station for this delivery visit.
     * The station constraint uses this to ensure only vehicles from the same
     * station can be assigned to this visit.
     * Null means no station restriction (backward-compatible).
     * Added as part of the 3-level hierarchy (Stations → Vehicles → Visits) refactoring.
     */
    private String stationId;
    private LocalDateTime minStartTime;
    private LocalDateTime maxEndTime;
    private Duration serviceDuration;

    /**
     * Delivery type: "ambient", "refrigerated", "frozen", "standard".
     * Used by vehicleTypeCompatibility constraint to match visit with capable vehicle.
     * Null means no compatibility restriction (backward-compatible).
     */
    private String commodityTag;

    /**
     * Order priority: "prime" or "standard".
     * Prime orders are enforced as a dedicated hard constraint (primeOrderTimeWindow)
     * in addition to the general serviceFinishedAfterMaxEndTime constraint.
     * Null means standard priority (no extra prime penalty).
     */
    private String speedTag;

    /**
     * Perishable expiration deadline (nullable).
     * When set, the solver enforces: arrivalTime + serviceDuration < expirationTime.
     * Null means the visit has no expiration constraint (backward-compatible).
     */
    private LocalDateTime expirationTime;

    @JsonIdentityReference(alwaysAsId = true)
    @InverseRelationShadowVariable(sourceVariableName = "visits")
    private Vehicle vehicle;
    @JsonIdentityReference(alwaysAsId = true)
    @PreviousElementShadowVariable(sourceVariableName = "visits")
    private Visit previousVisit;
    @ShadowVariable(supplierName = "arrivalTimeSupplier")
    private LocalDateTime arrivalTime;

    public Visit() {
    }

    public Visit(String id, String name, Location location, int demand,
                 LocalDateTime minStartTime, LocalDateTime maxEndTime, Duration serviceDuration) {
        this.id = id;
        this.name = name;
        this.location = location;
        this.demand = demand;
        this.minStartTime = minStartTime;
        this.maxEndTime = maxEndTime;
        this.serviceDuration = serviceDuration;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    @Override
    public Location getLocation() {
        return location;
    }

    public void setLocation(Location location) {
        this.location = location;
    }

    public int getDemand() {
        return demand;
    }

    public void setDemand(int demand) {
        this.demand = demand;
    }

    public String getStationId() {
        return stationId;
    }

    public void setStationId(String stationId) {
        this.stationId = stationId;
    }

    public String getCommodityTag() {
        return commodityTag;
    }

    public void setCommodityTag(String commodityTag) {
        this.commodityTag = commodityTag;
    }

    public String getSpeedTag() {
        return speedTag;
    }

    public void setSpeedTag(String speedTag) {
        this.speedTag = speedTag;
    }

    public LocalDateTime getExpirationTime() {
        return expirationTime;
    }

    public void setExpirationTime(LocalDateTime expirationTime) {
        this.expirationTime = expirationTime;
    }

    public LocalDateTime getMinStartTime() {
        return minStartTime;
    }

    public LocalDateTime getMaxEndTime() {
        return maxEndTime;
    }

    public Duration getServiceDuration() {
        return serviceDuration;
    }

    public Vehicle getVehicle() {
        return vehicle;
    }

    public void setVehicle(Vehicle vehicle) {
        this.vehicle = vehicle;
    }

    public Visit getPreviousVisit() {
        return previousVisit;
    }

    public void setPreviousVisit(Visit previousVisit) {
        this.previousVisit = previousVisit;
    }

    public LocalDateTime getArrivalTime() {
        return arrivalTime;
    }

    public void setArrivalTime(LocalDateTime arrivalTime) {
        this.arrivalTime = arrivalTime;
    }

    // ************************************************************************
    // Complex methods
    // ************************************************************************

    @SuppressWarnings("unused")
    @ShadowSources({"vehicle", "previousVisit.arrivalTime"})
    private LocalDateTime arrivalTimeSupplier() {
        if (previousVisit == null && vehicle == null) {
            return null;
        }
        LocalDateTime departureTime = previousVisit == null ? vehicle.getDepartureTime() : previousVisit.getDepartureTime();
        return departureTime != null ? departureTime.plusSeconds(getDrivingTimeSecondsFromPreviousStandstill()) : null;
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public LocalDateTime getDepartureTime() {
        if (arrivalTime == null) {
            return null;
        }
        return getStartServiceTime().plus(serviceDuration);
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public LocalDateTime getStartServiceTime() {
        if (arrivalTime == null) {
            return null;
        }
        return arrivalTime.isBefore(minStartTime) ? minStartTime : arrivalTime;
    }

    @JsonIgnore
    public boolean isServiceFinishedAfterMaxEndTime() {
        return arrivalTime != null
                && arrivalTime.plus(serviceDuration).isAfter(maxEndTime);
    }

    @JsonIgnore
    public long getServiceFinishedDelayInMinutes() {
        if (arrivalTime == null) {
            return 0;
        }
        return roundDurationToNextOrEqualMinutes(Duration.between(maxEndTime, arrivalTime.plus(serviceDuration)));
    }

    /**
     * Returns true when this visit is perishable (has an expirationTime) and service
     * finishes after the expiration deadline: arrivalTime + serviceDuration > expirationTime.
     * Used by the perishableExpiryConstraint hard constraint.
     */
    @JsonIgnore
    public boolean isServiceFinishedAfterExpirationTime() {
        return expirationTime != null
                && arrivalTime != null
                && arrivalTime.plus(serviceDuration).isAfter(expirationTime);
    }

    /**
     * Returns minutes past the expiration deadline (always >= 1 when positive).
     * Used by the perishableExpiryConstraint hard constraint for penalty scoring.
     */
    @JsonIgnore
    public long getExpirationDelayInMinutes() {
        if (arrivalTime == null || expirationTime == null) {
            return 0;
        }
        return roundDurationToNextOrEqualMinutes(Duration.between(expirationTime, arrivalTime.plus(serviceDuration)));
    }

    private static long roundDurationToNextOrEqualMinutes(Duration duration) {
        var remainder = duration.minus(duration.truncatedTo(ChronoUnit.MINUTES));
        var minutes = duration.toMinutes();
        if (remainder.equals(Duration.ZERO)) {
            return minutes;
        }
        return minutes + 1;
    }

    @JsonIgnore
    public long getDrivingTimeSecondsFromPreviousStandstill() {
        if (vehicle == null) {
            throw new IllegalStateException(
                    "This method must not be called when the shadow variables are not initialized yet.");
        }
        if (previousVisit == null) {
            return vehicle.getHomeLocation().getDrivingTimeTo(location);
        }
        return previousVisit.getLocation().getDrivingTimeTo(location);
    }

    // Required by the web UI even before the solution has been initialized.
    @JsonProperty(value = "drivingTimeSecondsFromPreviousStandstill", access = JsonProperty.Access.READ_ONLY)
    public Long getDrivingTimeSecondsFromPreviousStandstillOrNull() {
        if (vehicle == null) {
            return null;
        }
        return getDrivingTimeSecondsFromPreviousStandstill();
    }

    @Override
    public String toString() {
        return id;
    }

}

package org.acme.vehiclerouting.domain;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.lookup.PlanningId;
import ai.timefold.solver.core.api.domain.variable.PlanningListVariable;

import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonIdentityReference;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;

@JsonIdentityInfo(scope = Vehicle.class, generator = ObjectIdGenerators.PropertyGenerator.class, property = "id")
@PlanningEntity
public class Vehicle implements LocationAware {

    @PlanningId
    private String id;
    private int capacity;
    @JsonIdentityReference
    private Location homeLocation;

    private LocalDateTime departureTime;
    private LocalDateTime latestArrivalTime;

    private long maxWorkTimeSeconds;

    /**
     * Station constraint hint — used by the solver to restrict cross-station vehicle-visit
     * assignments. A vehicle may only serve visits whose stationId matches this field.
     * Null means no station restriction applies (backward-compatible).
     * Added as part of the 3-level hierarchy (Stations → Vehicles → Visits) refactoring.
     */
    private String stationId;

    /**
     * Vehicle specialisation/capability type: "ambient", "refrigerated", "frozen", "standard".
     * Used by the vehicleTypeCompatibility hard constraint to match vehicles to compatible deliveries.
     * Null means no restriction — the vehicle can serve all order types (backward-compatible).
     */
    private String specialisationOfVehicle;

    @JsonIdentityReference(alwaysAsId = true)
    @PlanningListVariable
    private List<Visit> visits;

    public Vehicle() {
    }

    public Vehicle(String id, int capacity, Location homeLocation, LocalDateTime departureTime) {
        this(id, capacity, homeLocation, departureTime, null, 0L);
    }

    public Vehicle(String id, int capacity, Location homeLocation, LocalDateTime departureTime, long maxWorkTimeSeconds) {
        this(id, capacity, homeLocation, departureTime, null, maxWorkTimeSeconds);
    }

    public Vehicle(String id, int capacity, Location homeLocation, LocalDateTime departureTime, LocalDateTime latestArrivalTime, long maxWorkTimeSeconds) {
        this.id = id;
        this.capacity = capacity;
        this.homeLocation = homeLocation;
        this.departureTime = departureTime;
        this.latestArrivalTime = latestArrivalTime;
        this.maxWorkTimeSeconds = maxWorkTimeSeconds;
        this.visits = new ArrayList<>();
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public int getCapacity() {
        return capacity;
    }

    public void setCapacity(int capacity) {
        this.capacity = capacity;
    }

    public Location getHomeLocation() {
        return homeLocation;
    }

    public void setHomeLocation(Location homeLocation) {
        this.homeLocation = homeLocation;
    }

    public LocalDateTime getDepartureTime() {
        return departureTime;
    }

    public LocalDateTime getLatestArrivalTime() {
        return latestArrivalTime;
    }

    public void setLatestArrivalTime(LocalDateTime latestArrivalTime) {
        this.latestArrivalTime = latestArrivalTime;
    }

    public long getMaxWorkTimeSeconds() {
        return maxWorkTimeSeconds;
    }

    public void setMaxWorkTimeSeconds(long maxWorkTimeSeconds) {
        this.maxWorkTimeSeconds = maxWorkTimeSeconds;
    }

    public List<Visit> getVisits() {
        return visits;
    }

    public void setVisits(List<Visit> visits) {
        this.visits = visits;
    }

    public String getStationId() {
        return stationId;
    }

    public void setStationId(String stationId) {
        this.stationId = stationId;
    }

    public String getSpecialisationOfVehicle() {
        return specialisationOfVehicle;
    }

    public void setSpecialisationOfVehicle(String specialisationOfVehicle) {
        this.specialisationOfVehicle = specialisationOfVehicle;
    }

    // ************************************************************************
    // Complex methods
    // ************************************************************************

    @JsonIgnore
    @Override
    public Location getLocation() {
        return homeLocation;
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public int getTotalDemand() {
        int totalDemand = 0;
        for (Visit visit : visits) {
            totalDemand += visit.getDemand();
        }
        return totalDemand;
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public long getTotalDrivingTimeSeconds() {
        if (visits.isEmpty()) {
            return 0;
        }

        long totalDrivingTime = 0;
        Location previousLocation = homeLocation;

        for (Visit visit : visits) {
            totalDrivingTime += previousLocation.getDrivingTimeTo(visit.getLocation());
            previousLocation = visit.getLocation();
        }
        totalDrivingTime += previousLocation.getDrivingTimeTo(homeLocation);

        return totalDrivingTime;
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public LocalDateTime arrivalTime() {
        if (visits.isEmpty()) {
            return departureTime;
        }

        Visit lastVisit = visits.get(visits.size() - 1);
        return lastVisit.getDepartureTime().plusSeconds(lastVisit.getLocation().getDrivingTimeTo(homeLocation));
    }

    @Override
    public String toString() {
        return id;
    }

}

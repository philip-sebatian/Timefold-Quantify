package org.acme.vehiclerouting.domain;

import java.time.LocalDateTime;
import java.util.List;

import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.buildin.hardsoftlong.HardSoftLongScore;
import ai.timefold.solver.core.api.solver.SolverStatus;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The plan for routing vehicles to visits, including:
 * <ul>
 * <li>capacity - each vehicle has a capacity for visits demand,</li>
 * <li>time windows - each visit accepts the vehicle only in specified time
 * window.</li>
 * </ul>
 *
 * The planning solution is optimized according to the driving time (as opposed
 * to the travel distance, for example)
 * because it is easy to determine if the vehicle arrival time fits into the
 * visit time window.
 * In addition, optimizing travel time optimizes the distance too, as a side
 * effect - in case there is a faster route,
 * the travel time takes precedence (highway vs. local road).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@PlanningSolution
public class VehicleRoutePlan {

    private String name;

    private Location southWestCorner;
    private Location northEastCorner;

    private LocalDateTime startDateTime;

    private LocalDateTime endDateTime;


    @PlanningEntityCollectionProperty
    private List<Vehicle> vehicles;

    @PlanningEntityCollectionProperty
    @ValueRangeProvider
    private List<Visit> visits;

    /**
     * Stations in the 3-level hierarchy (Stations → Vehicles → Visits).
     * Declared as a ProblemFact so Timefold can reference station data in constraints.
     * Optional: existing plans without station data continue to work (null-safe).
     * Added as part of the Dubai 3-level hierarchy refactoring.
     */
    @ProblemFactCollectionProperty
    private List<Station> stations;

    @PlanningScore
    private HardSoftLongScore score;

    private SolverStatus solverStatus;

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    private String scoreExplanation;

    public VehicleRoutePlan() {
    }

    @ai.timefold.solver.core.api.domain.solution.ProblemFactProperty
    @com.fasterxml.jackson.annotation.JsonIgnore
    public VehicleRoutePlan getThis() {
        return this;
    }

    public VehicleRoutePlan(String name, HardSoftLongScore score, SolverStatus solverStatus) {
        this.name = name;
        this.score = score;
        this.solverStatus = solverStatus;
    }

    @JsonCreator
    public VehicleRoutePlan(@JsonProperty("name") String name,
            @JsonProperty("southWestCorner") Location southWestCorner,
            @JsonProperty("northEastCorner") Location northEastCorner,
            @JsonProperty("startDateTime") LocalDateTime startDateTime,
            @JsonProperty("endDateTime") LocalDateTime endDateTime,
            @JsonProperty("vehicles") List<Vehicle> vehicles,
            @JsonProperty("visits") List<Visit> visits,
            @JsonProperty("stations") List<Station> stations) {
        this.name = name;
        this.southWestCorner = southWestCorner;
        this.northEastCorner = northEastCorner;
        this.startDateTime = startDateTime;
        this.endDateTime = endDateTime;
        this.vehicles = vehicles;
        this.visits = visits;
        // stations may be null for backward-compatible payloads without station data
        this.stations = stations;
    }

    public String getName() {
        return name;
    }

    public Location getSouthWestCorner() {
        return southWestCorner;
    }

    public Location getNorthEastCorner() {
        return northEastCorner;
    }

    public LocalDateTime getStartDateTime() {
        return startDateTime;
    }

    public LocalDateTime getEndDateTime() {
        return endDateTime;
    }



    public List<Vehicle> getVehicles() {
        return vehicles;
    }

    public List<Visit> getVisits() {
        return visits;
    }

    public List<Station> getStations() {
        return stations;
    }

    public void setStations(List<Station> stations) {
        this.stations = stations;
    }

    public HardSoftLongScore getScore() {
        return score;
    }

    public void setScore(HardSoftLongScore score) {
        this.score = score;
    }

    // ************************************************************************
    // Complex methods
    // ************************************************************************

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public long getTotalDrivingTimeSeconds() {
        return vehicles == null ? 0 : vehicles.stream().mapToLong(Vehicle::getTotalDrivingTimeSeconds).sum();
    }

    public SolverStatus getSolverStatus() {
        return solverStatus;
    }

    public void setSolverStatus(SolverStatus solverStatus) {
        this.solverStatus = solverStatus;
    }

    public String getScoreExplanation() {
        return scoreExplanation;
    }

    public void setScoreExplanation(String scoreExplanation) {
        this.scoreExplanation = scoreExplanation;
    }
}

package org.acme.vehiclerouting.domain;

import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Represents a logistics dispatch station in the 3-level hierarchy:
 * Stations → Vehicles → Visits.
 *
 * A Station is a ProblemFact (not a PlanningEntity): it is read-only input
 * data used by constraints to enforce that vehicles only serve visits
 * belonging to their assigned station.
 *
 * Added as part of the Dubai 3-level hierarchy refactoring.
 */
public class Station {

    /** Unique station identifier (e.g., "KAR-DS"). Matches stationId on Vehicle and Visit. */
    private String id;

    /** Human-readable station name (e.g., "Karama Post Office"). */
    private String name;

    /**
     * The geographic location of the station.
     * Vehicle home locations are derived from this when no explicit home lat/lon
     * is provided in the vehicles CSV.
     */
    private Location location;

    /** Station operational start time. */
    private LocalDateTime openingTime;

    /** Station operational end time. */
    private LocalDateTime closingTime;

    public Station() {
    }

    @JsonCreator
    public Station(
            @JsonProperty("id") String id,
            @JsonProperty("name") String name,
            @JsonProperty("location") Location location,
            @JsonProperty("openingTime") LocalDateTime openingTime,
            @JsonProperty("closingTime") LocalDateTime closingTime) {
        this.id = id;
        this.name = name;
        this.location = location;
        this.openingTime = openingTime;
        this.closingTime = closingTime;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Location getLocation() {
        return location;
    }

    public void setLocation(Location location) {
        this.location = location;
    }

    public LocalDateTime getOpeningTime() {
        return openingTime;
    }

    public void setOpeningTime(LocalDateTime openingTime) {
        this.openingTime = openingTime;
    }

    public LocalDateTime getClosingTime() {
        return closingTime;
    }

    public void setClosingTime(LocalDateTime closingTime) {
        this.closingTime = closingTime;
    }

    @Override
    public String toString() {
        return id;
    }
}

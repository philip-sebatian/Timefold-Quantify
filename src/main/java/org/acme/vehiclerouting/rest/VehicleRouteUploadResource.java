package org.acme.vehiclerouting.rest;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import org.acme.vehiclerouting.domain.Location;
import org.acme.vehiclerouting.domain.Station;
import org.acme.vehiclerouting.domain.Vehicle;
import org.acme.vehiclerouting.domain.VehicleRoutePlan;
import org.acme.vehiclerouting.domain.Visit;
import org.acme.vehiclerouting.domain.geo.DrivingTimeCalculator;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVRecord;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

@Path("upload-data")
public class VehicleRouteUploadResource {

    @Inject
    DrivingTimeCalculator drivingTimeCalculator;

    private static final org.slf4j.Logger LOGGER = org.slf4j.LoggerFactory.getLogger(VehicleRouteUploadResource.class);

    private static final java.time.format.DateTimeFormatter FORMATTER = java.time.format.DateTimeFormatter
            .ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * Upload endpoint for the 3-level hierarchy (Stations → Vehicles → Visits).
     *
     * stations is optional for backward compatibility. When provided, vehicle home
     * locations are derived from the matching station's coordinates, and the
     * station constraint is activated in the solver.
     *
     * CSV column requirements (must match exactly):
     * vehicles : id, capacity, departure_time, latest_arrival_time,
     * max_duration_hours, station_id
     * visits : id, name, latitude, longitude, demand, min_start_time, max_end_time,
     * service_duration_minutes, station_id
     * stations : station_id, station_name, station_lat, station_lon, opening_time,
     * closing_time
     */
    @POST
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    public VehicleRoutePlan uploadData(
            @RestForm("stations") FileUpload stationsFile,
            @RestForm("vehicles") FileUpload vehiclesFile,
            @RestForm("visits") FileUpload visitsFile) {

        try {
            LOGGER.info("Received upload request. Stations: {}, Vehicles: {}, Visits: {}",
                    stationsFile != null ? stationsFile.fileName() : "null (optional)",
                    vehiclesFile != null ? vehiclesFile.fileName() : "null",
                    visitsFile != null ? visitsFile.fileName() : "null");

            if (vehiclesFile == null || visitsFile == null) {
                LOGGER.error("Missing required file inputs: vehicles or visits");
                throw new IllegalArgumentException("Both vehicles and visits files must be provided.");
            }

            if (vehiclesFile.uploadedFile() == null || visitsFile.uploadedFile() == null) {
                LOGGER.error("File content not on disk. Vehicles: {}, Visits: {}",
                        vehiclesFile.uploadedFile(), visitsFile.uploadedFile());
                throw new IllegalStateException("Upload failed: File content not available on disk.");
            }

            // Shared location de-duplication map (ensures identical lat/lng → same Location
            // instance)
            Map<Location, Location> locationMap = new HashMap<>();

            // ----------------------------------------------------------------
            // Step 1: Parse Stations (optional).
            // Build a stationById map so vehicles can derive their home location.
            // ----------------------------------------------------------------
            List<Station> stations = new ArrayList<>();
            // stationById: station_id → Station, used for vehicle home location derivation
            Map<String, Station> stationById = new HashMap<>();

            if (stationsFile != null && stationsFile.uploadedFile() != null) {
                LOGGER.info("Parsing stations from {}", stationsFile.uploadedFile().toAbsolutePath());
                stations = parseStations(stationsFile.uploadedFile().toAbsolutePath().toString(), locationMap);
                for (Station s : stations) {
                    stationById.put(s.getId(), s);
                }
                LOGGER.info("Parsed {} stations", stations.size());
            } else {
                LOGGER.info("No stations file provided — vehicle home locations must exist in vehicles CSV.");
            }

            // ----------------------------------------------------------------
            // Step 2: Parse Vehicles (home location derived from station when stationsFile
            // present)
            // ----------------------------------------------------------------
            LOGGER.info("Parsing vehicles from {}", vehiclesFile.uploadedFile().toAbsolutePath());
            List<Vehicle> vehicles = parseVehicles(
                    vehiclesFile.uploadedFile().toAbsolutePath().toString(), locationMap, stationById);
            LOGGER.info("Parsed {} vehicles", vehicles.size());

            // ----------------------------------------------------------------
            // Step 3: Parse Visits
            // ----------------------------------------------------------------
            LOGGER.info("Parsing visits from {}", visitsFile.uploadedFile().toAbsolutePath());
            List<Visit> visits = parseVisits(visitsFile.uploadedFile().toAbsolutePath().toString(), locationMap);
            LOGGER.info("Parsed {} visits", visits.size());

            // ----------------------------------------------------------------
            // Step 4: Compute bounding box from all locations
            // ----------------------------------------------------------------
            double minLat = Double.MAX_VALUE;
            double maxLat = -Double.MAX_VALUE;
            double minLng = Double.MAX_VALUE;
            double maxLng = -Double.MAX_VALUE;

            for (Location loc : locationMap.keySet()) {
                minLat = Math.min(minLat, loc.getLatitude());
                maxLat = Math.max(maxLat, loc.getLatitude());
                minLng = Math.min(minLng, loc.getLongitude());
                maxLng = Math.max(maxLng, loc.getLongitude());
            }

            Location southWest = new Location(minLat, minLng);
            Location northEast = new Location(maxLat, maxLng);

            // ----------------------------------------------------------------
            // Step 5: Derive plan time window from visits
            // ----------------------------------------------------------------
            LocalDateTime startDateTime = visits.stream()
                    .map(Visit::getMinStartTime)
                    .min(LocalDateTime::compareTo)
                    .orElse(LocalDateTime.now().with(LocalTime.of(8, 0)));
            LocalDateTime endDateTime = visits.stream()
                    .map(Visit::getMaxEndTime)
                    .max(LocalDateTime::compareTo)
                    .orElse(LocalDateTime.now().with(LocalTime.of(22, 0)));

            // ----------------------------------------------------------------
            // Step 6: Build and return the plan (now 3-level aware)
            // ----------------------------------------------------------------
            // Pass null for stations when empty for JSON serialization cleanliness
            List<Station> stationsForPlan = stations.isEmpty() ? null : stations;

            VehicleRoutePlan plan = new VehicleRoutePlan(
                    "uploaded-plan", southWest, northEast,
                    startDateTime, endDateTime,
                    vehicles, visits, stationsForPlan);

            // Initialize driving times for ALL unique locations (vehicles + visits +
            // stations)
            drivingTimeCalculator.initDrivingTimeMaps(locationMap.values());

            return plan;

        } catch (Exception e) {
            LOGGER.error("Error processing upload", e);
            throw new RuntimeException("Failed to upload data: " + e.getMessage(), e);
        }
    }

    /**
     * Parse stations CSV.
     *
     * Expected columns: station_id, station_name, station_lat, station_lon,
     * opening_time, closing_time
     * Dates must be ISO-8601 LocalDateTime format (e.g., 2026-05-15T06:00:00).
     */
    private List<Station> parseStations(String filePath, Map<Location, Location> locationMap) throws IOException {
        List<Station> stations = new ArrayList<>();
        try (InputStream is = java.nio.file.Files.newInputStream(java.nio.file.Paths.get(filePath));
                InputStreamReader reader = new InputStreamReader(is, StandardCharsets.UTF_8)) {

            Iterable<CSVRecord> records = CSVFormat.DEFAULT
                    .builder()
                    .setHeader()
                    .setSkipHeaderRecord(true)
                    .setTrim(true)
                    .build()
                    .parse(reader);

            for (CSVRecord record : records) {
                String id = record.get("station_id");
                String name = record.get("station_name");
                double lat = Double.parseDouble(record.get("station_lat"));
                double lon = Double.parseDouble(record.get("station_lon"));
                LocalDateTime openingTime = LocalDateTime.parse(record.get("opening_time"), FORMATTER);
                LocalDateTime closingTime = LocalDateTime.parse(record.get("closing_time"), FORMATTER);

                // Register station location in location map for driving time calculation
                Location tempLoc = new Location(lat, lon);
                Location stationLocation = locationMap.computeIfAbsent(tempLoc, k -> k);

                Station station = new Station(id, name, stationLocation, openingTime, closingTime);
                stations.add(station);
            }
        }
        return stations;
    }

    /**
     * Parse vehicles CSV.
     *
     * Expected columns: id, capacity, departure_time, latest_arrival_time,
     * max_duration_hours, station_id
     *
     * When stationById is non-empty, vehicle home location is derived from the
     * station's coordinates (the vehicles CSV does not need
     * home_latitude/home_longitude).
     * If no matching station is found, a warning is logged and the vehicle is
     * skipped.
     *
     * Dates must be ISO-8601 LocalDateTime format (e.g., 2026-05-15T06:00:00).
     */
    private List<Vehicle> parseVehicles(String filePath,
            Map<Location, Location> locationMap,
            Map<String, Station> stationById) throws IOException {
        List<Vehicle> vehicles = new ArrayList<>();
        try (InputStream is = java.nio.file.Files.newInputStream(java.nio.file.Paths.get(filePath));
                InputStreamReader reader = new InputStreamReader(is, StandardCharsets.UTF_8)) {

            Iterable<CSVRecord> records = CSVFormat.DEFAULT
                    .builder()
                    .setHeader()
                    .setSkipHeaderRecord(true)
                    .setTrim(true)
                    .build()
                    .parse(reader);

            for (CSVRecord record : records) {
                String id = record.get("id");
                int capacity = Integer.parseInt(record.get("capacity"));
                LocalDateTime departureTime = LocalDateTime.parse(record.get("departure_time"), FORMATTER);

                LocalDateTime latestArrivalTime = null;
                if (record.isMapped("latest_arrival_time")
                        && record.get("latest_arrival_time") != null
                        && !record.get("latest_arrival_time").isEmpty()) {
                    latestArrivalTime = LocalDateTime.parse(record.get("latest_arrival_time"), FORMATTER);
                }

                long maxWorkTimeSeconds = 0;
                if (record.isMapped("max_work_time_minutes")
                        && record.get("max_work_time_minutes") != null
                        && !record.get("max_work_time_minutes").isEmpty()) {
                    maxWorkTimeSeconds = Long.parseLong(record.get("max_work_time_minutes")) * 60;
                } else if (record.isMapped("max_duration_hours")
                        && record.get("max_duration_hours") != null
                        && !record.get("max_duration_hours").isEmpty()) {
                    maxWorkTimeSeconds = (long) (Double.parseDouble(record.get("max_duration_hours")) * 3600);
                }

                // Read station_id for the 3-level hierarchy constraint
                String stationId = null;
                if (record.isMapped("station_id")
                        && record.get("station_id") != null
                        && !record.get("station_id").isEmpty()) {
                    stationId = record.get("station_id").trim();
                }

                // Derive home location from station when stationById is available
                Location homeLocation = null;

                if (stationId != null && !stationById.isEmpty()) {
                    Station station = stationById.get(stationId);
                    if (station != null) {
                        // Home location is the station's location — already in locationMap
                        homeLocation = station.getLocation();
                    } else {
                        LOGGER.warn("Vehicle {} references station_id '{}' which was not found in stations CSV. " +
                                "Falling back to explicit lat/lng columns if present.", id, stationId);
                    }
                }

                // Fallback: explicit lat/lng columns (for backward compatibility or override)
                if (homeLocation == null) {
                    if (record.isMapped("home_latitude") && record.isMapped("home_longitude")) {
                        double lat = Double.parseDouble(record.get("home_latitude"));
                        double lng = Double.parseDouble(record.get("home_longitude"));
                        Location tempLoc = new Location(lat, lng);
                        homeLocation = locationMap.computeIfAbsent(tempLoc, k -> k);
                    } else {
                        LOGGER.error("Vehicle {} has no home location: no matching station '{}' and no " +
                                "home_latitude/home_longitude columns. Skipping.", id, stationId);
                        continue; // Skip this vehicle — cannot place it without a location
                    }
                }

                Vehicle vehicle = new Vehicle(id, capacity, homeLocation, departureTime, latestArrivalTime,
                        maxWorkTimeSeconds);
                // Set stationId hint for the station constraint
                vehicle.setStationId(stationId);

                // Read specialisation_of_vehicle for the vehicle-type compatibility constraint.
                // Optional: if column is absent or empty, vehicle is unrestricted (serves all
                // types).
                if (record.isMapped("specialisation_of_vehicle")
                        && record.get("specialisation_of_vehicle") != null
                        && !record.get("specialisation_of_vehicle").isEmpty()) {
                    vehicle.setSpecialisationOfVehicle(record.get("specialisation_of_vehicle").trim().toLowerCase());
                }

                vehicles.add(vehicle);
            }
        }
        return vehicles;
    }

    /**
     * Parse visits CSV.
     *
     * Expected columns: id, name, latitude, longitude, demand,
     * min_start_time, max_end_time, service_duration_minutes, station_id
     *
     * station_id is optional; if present it activates the station constraint for
     * this visit.
     * Dates must be ISO-8601 LocalDateTime format (e.g., 2026-05-15T08:00:00).
     */
    private List<Visit> parseVisits(String filePath, Map<Location, Location> locationMap) throws IOException {
        List<Visit> visits = new ArrayList<>();
        try (InputStream is = java.nio.file.Files.newInputStream(java.nio.file.Paths.get(filePath));
                InputStreamReader reader = new InputStreamReader(is, StandardCharsets.UTF_8)) {

            Iterable<CSVRecord> records = CSVFormat.DEFAULT
                    .builder()
                    .setHeader()
                    .setSkipHeaderRecord(true)
                    .setTrim(true)
                    .build()
                    .parse(reader);

            for (CSVRecord record : records) {
                String id = record.get("id");
                String name = record.get("name");
                double lat = Double.parseDouble(record.get("latitude"));
                double lng = Double.parseDouble(record.get("longitude"));
                int demand = Integer.parseInt(record.get("demand"));
                LocalDateTime minStartTime = LocalDateTime.parse(record.get("min_start_time"), FORMATTER);
                LocalDateTime maxEndTime = LocalDateTime.parse(record.get("max_end_time"), FORMATTER);
                long durationMinutes = Long.parseLong(record.get("service_duration_minutes"));

                Location tempLoc = new Location(lat, lng);
                Location location = locationMap.computeIfAbsent(tempLoc, k -> k);

                // Read station_id for the 3-level hierarchy constraint
                String stationId = null;
                if (record.isMapped("station_id")
                        && record.get("station_id") != null
                        && !record.get("station_id").isEmpty()) {
                    stationId = record.get("station_id").trim();
                }

                Visit visit = new Visit(id, name, location, demand, minStartTime, maxEndTime,
                        Duration.ofMinutes(durationMinutes));
                // Set stationId hint for the station constraint
                visit.setStationId(stationId);

                // Read commodity_tag (delivery type: ambient/refrigerated/frozen/standard).
                // Optional: if absent or empty, no vehicle-type compatibility constraint
                // applies.
                if (record.isMapped("commodity_tag")
                        && record.get("commodity_tag") != null
                        && !record.get("commodity_tag").isEmpty()) {
                    visit.setCommodityTag(record.get("commodity_tag").trim().toLowerCase());
                }

                // Read speed_tag (order priority: prime/standard).
                // Optional: if absent or empty, visit is treated as standard priority.
                if (record.isMapped("speed_tag")
                        && record.get("speed_tag") != null
                        && !record.get("speed_tag").isEmpty()) {
                    visit.setSpeedTag(record.get("speed_tag").trim().toLowerCase());
                }

                // Read expiration_time (perishable deadline, ISO-8601 LocalDateTime).
                // Optional: if absent or empty, no perishable expiry constraint applies for
                // this visit.
                if (record.isMapped("expiration_time")
                        && record.get("expiration_time") != null
                        && !record.get("expiration_time").isEmpty()) {
                    visit.setExpirationTime(LocalDateTime.parse(record.get("expiration_time").trim(), FORMATTER));
                }

                visits.add(visit);
            }
        }
        return visits;
    }
}

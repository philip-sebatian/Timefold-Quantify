package org.acme.vehiclerouting.rest;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import org.acme.vehiclerouting.domain.Location;
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

    @POST
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    public VehicleRoutePlan uploadData(
            @RestForm("vehicles") FileUpload vehiclesFile,
            @RestForm("visits") FileUpload visitsFile) {

        try {
            System.out.println("DEBUG: uploadData called");
            LOGGER.info("Received upload request. Vehicles: {}, Visits: {}",
                    vehiclesFile != null ? vehiclesFile.fileName() : "null",
                    visitsFile != null ? visitsFile.fileName() : "null");

            if (vehiclesFile == null || visitsFile == null) {
                LOGGER.error("Missing file inputs");
                throw new IllegalArgumentException("Both vehicles and visits files must be provided.");
            }

            if (vehiclesFile.uploadedFile() == null || visitsFile.uploadedFile() == null) {
                LOGGER.error("File content not on disk. Vehicles: {}, Visits: {}", vehiclesFile.uploadedFile(),
                        visitsFile.uploadedFile());
                throw new IllegalStateException("Upload failed: File content not available on disk.");
            }

            System.out.println("DEBUG: Parsing vehicles from " + vehiclesFile.uploadedFile().toAbsolutePath());
            Map<Location, Location> locationMap = new java.util.HashMap<>();

            List<Vehicle> vehicles = parseVehicles(vehiclesFile.uploadedFile().toAbsolutePath().toString(),
                    locationMap);
            System.out.println("DEBUG: Parsed " + vehicles.size() + " vehicles");

            System.out.println("DEBUG: Parsing visits from " + visitsFile.uploadedFile().toAbsolutePath());
            List<Visit> visits = parseVisits(visitsFile.uploadedFile().toAbsolutePath().toString(), locationMap);
            System.out.println("DEBUG: Parsed " + visits.size() + " visits");

            // Calculate bounding box for the plan
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

            // Calculate start and end times for the plan based on visits
            LocalDateTime startDateTime = visits.stream()
                    .map(Visit::getMinStartTime)
                    .min(LocalDateTime::compareTo)
                    .orElse(LocalDateTime.now().with(LocalTime.of(8, 0)));
            LocalDateTime endDateTime = visits.stream()
                    .map(Visit::getMaxEndTime)
                    .max(LocalDateTime::compareTo)
                    .orElse(LocalDateTime.now().with(LocalTime.of(18, 0)));

            VehicleRoutePlan plan = new VehicleRoutePlan("uploaded-plan", southWest, northEast, startDateTime,
                    endDateTime, vehicles, visits);

            // Initialize driving times - vital for the solver!
            // We only pass unique locations from the map
            drivingTimeCalculator.initDrivingTimeMaps(locationMap.values());

            return plan;

        } catch (Exception e) {
            LOGGER.error("Error processing upload", e);
            throw new RuntimeException("Failed to upload data: " + e.getMessage(), e);
        }
    }

    private List<Vehicle> parseVehicles(String filePath, Map<Location, Location> locationMap) throws IOException {
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
                double lat = Double.parseDouble(record.get("home_latitude"));
                double lng = Double.parseDouble(record.get("home_longitude"));
                LocalDateTime departureTime = LocalDateTime.parse(record.get("departure_time"));

                Location tempLoc = new Location(lat, lng);
                Location homeLocation = locationMap.computeIfAbsent(tempLoc, k -> k);

                Vehicle vehicle = new Vehicle(id, capacity, homeLocation, departureTime);
                vehicles.add(vehicle);
            }
        }
        return vehicles;
    }

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
                LocalDateTime minStartTime = LocalDateTime.parse(record.get("min_start_time"));
                LocalDateTime maxEndTime = LocalDateTime.parse(record.get("max_end_time"));
                long durationMinutes = Long.parseLong(record.get("service_duration_minutes"));

                Location tempLoc = new Location(lat, lng);
                Location location = locationMap.computeIfAbsent(tempLoc, k -> k);

                Visit visit = new Visit(id, name, location, demand, minStartTime, maxEndTime,
                        Duration.ofMinutes(durationMinutes));
                visits.add(visit);
            }
        }
        return visits;
    }
}

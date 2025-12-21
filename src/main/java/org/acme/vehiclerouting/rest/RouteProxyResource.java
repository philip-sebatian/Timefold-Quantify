package org.acme.vehiclerouting.rest;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

@Path("route-proxy")
public class RouteProxyResource {

    private final HttpClient httpClient;

    public RouteProxyResource() {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response getRoute(
            @QueryParam("startLat") double startLat,
            @QueryParam("startLng") double startLng,
            @QueryParam("endLat") double endLat,
            @QueryParam("endLng") double endLng) {

        // Construct the OSRM URL
        // Using openstreetmap.de as it is often more reliable for demos than osrm.org
        String osrmUrl = String.format(java.util.Locale.US,
                "https://routing.openstreetmap.de/routed-car/route/v1/driving/%f,%f;%f,%f?overview=full&geometries=geojson",
                startLng, startLat, endLng, endLat);

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(osrmUrl))
                    .GET()
                    .timeout(Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                return Response.ok(response.body()).build();
            } else {
                return Response.status(response.statusCode()).entity(response.body()).build();
            }

        } catch (Exception e) {
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity("{\"error\": \"Failed to fetch route\", \"details\": \"" + e.getMessage() + "\"}")
                    .build();
        }
    }
}

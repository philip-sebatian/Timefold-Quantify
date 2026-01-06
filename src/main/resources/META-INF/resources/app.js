let autoRefreshIntervalId = null;
let initialized = false;
let optimizing = false;
let demoDataId = null;
let scheduleId = null;
let loadedRoutePlan = null;
let newVisit = null;
let visitMarker = null;
const solveButton = $('#solveButton');
const stopSolvingButton = $('#stopSolvingButton');
const vehiclesTable = $('#vehicles');
const analyzeButton = $('#analyzeButton');
const uploadCsvButton = $('#uploadCsvButton');
const clearPointsButton = $('#clearPointsButton');

/*************************************** Map constants and variable definitions  **************************************/

const homeLocationMarkerByIdMap = new Map();
const visitMarkerByIdMap = new Map();

// Animation state
const vehiclePaths = new Map(); // vehicleId -> Array of [lat, lng] (simplified path)
const vehicleRoadSegments = new Map(); // vehicleId -> Map<segmentIndex, Array of [lat, lng]>
let animationFrameId = null;
let animationRunning = false;
let animationMarkers = [];

const map = L.map('map', { doubleClickZoom: false }).setView([51.505, -0.09], 13);
const visitGroup = L.layerGroup().addTo(map);
const homeLocationGroup = L.layerGroup().addTo(map);
const routeGroup = L.layerGroup().addTo(map);

/************************************ Time line constants and variable definitions ************************************/

const byVehiclePanel = document.getElementById("byVehiclePanel");
const byVehicleTimelineOptions = {
    timeAxis: { scale: "hour" },
    orientation: { axis: "top" },
    stack: false,
    stackSubgroups: false,
    zoomMin: 1000 * 60 * 60, // A single hour in milliseconds
    zoomMax: 1000 * 60 * 60 * 24 // A single day in milliseconds
};
const byVehicleGroupData = new vis.DataSet();
const byVehicleItemData = new vis.DataSet();
const byVehicleTimeline = new vis.Timeline(byVehiclePanel, byVehicleItemData, byVehicleGroupData, byVehicleTimelineOptions);

const byVisitPanel = document.getElementById("byVisitPanel");
const byVisitTimelineOptions = {
    timeAxis: { scale: "hour" },
    orientation: { axis: "top" },
    verticalScroll: true,
    stack: false,
    stackSubgroups: false,
    zoomMin: 1000 * 60 * 60, // A single hour in milliseconds
    zoomMax: 1000 * 60 * 60 * 24 // A single day in milliseconds
};
const byVisitGroupData = new vis.DataSet();
const byVisitItemData = new vis.DataSet();
const byVisitTimeline = new vis.Timeline(byVisitPanel, byVisitItemData, byVisitGroupData, byVisitTimelineOptions);

const BG_COLORS = ["#009E73", "#0072B2", "#D55E00", "#000000", "#CC79A7", "#E69F00", "#F0E442", "#F6768E", "#C10020", "#A6BDD7", "#803E75", "#007D34", "#56B4E9", "#999999", "#8DD3C7", "#FFD92F", "#B3DE69", "#FB8072", "#80B1D3", "#B15928", "#CAB2D6", "#1B9E77", "#E7298A", "#6A3D9A"];
const FG_COLORS = ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#000000", "#000000", "#FFFFFF", "#FFFFFF", "#000000", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#000000", "#000000", "#000000", "#000000", "#FFFFFF", "#000000", "#FFFFFF", "#000000", "#FFFFFF", "#FFFFFF", "#FFFFFF"];
let COLOR_MAP = new Map()
let nextColorIndex = 0

function pickColor(object) {
    let color = COLOR_MAP.get(object);
    if (color !== undefined) {
        return color;
    }
    let index = nextColorIndex++;
    color = { bg: BG_COLORS[index], fg: FG_COLORS[index] };
    COLOR_MAP.set(object, color);
    return color;
}

/************************************ Initialize ************************************/

function showToast(message, type = 'info') {
    const toastId = 'toast-' + Date.now();
    const icon = type === 'danger' ? 'fa-exclamation-circle' : (type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle');
    const color = type === 'danger' ? 'text-danger' : (type === 'warning' ? 'text-warning' : 'text-primary');

    const toastHtml = `
        <div id="${toastId}" class="toast align-items-center border-0 mb-2" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body d-flex align-items-center gap-2">
                    <i class="fas ${icon} ${color} fa-lg"></i>
                    <div>${message}</div>
                </div>
                <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    `;

    $('#toastContainer').append(toastHtml);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
    toast.show();

    // Cleanup after hidden
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}

function showError(title, xhr) {
    const errorMsg = xhr ? (xhr.responseText || xhr.statusText || "Unknown error") : "";
    const message = title + (errorMsg ? " " + errorMsg : "");
    showToast(message, 'danger');
}

$(document).ready(function () {
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    solveButton.click(solve);
    stopSolvingButton.click(stopSolving);
    analyzeButton.click(analyze);
    $('#dashboardButton').click(showDashboard);
    uploadCsvButton.click(uploadCsv);
    clearPointsButton.click(clearPoints);
    refreshSolvingButtons(false);

    // HACK to allow vis-timeline to work within Bootstrap tabs
    $("#byVehicleTab").on('shown.bs.tab', function (event) {
        byVehicleTimeline.redraw();
    })
    $("#byVisitTab").on('shown.bs.tab', function (event) {
        byVisitTimeline.redraw();
    })
    // Add new visit
    map.on('click', function (e) {
        if (!loadedRoutePlan) {
            showToast("Please load a dataset first.", "warning");
            return;
        }
        visitMarker = L.circleMarker(e.latlng);
        visitMarker.setStyle({ color: 'green' });
        visitMarker.addTo(map);
        openRecommendationModal(e.latlng.lat, e.latlng.lng);
    });
    // Remove visit mark
    $("#newVisitModal").on("hidden.bs.modal", function () {
        map.removeLayer(visitMarker);
    });

    $("#fileInput").on('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const content = e.target.result;
                const newPlan = JSON.parse(content);
                loadedRoutePlan = newPlan;
                scheduleId = null;
                demoDataId = null;
                initialized = false;

                homeLocationGroup.clearLayers();
                homeLocationMarkerByIdMap.clear();
                visitGroup.clearLayers();
                visitMarkerByIdMap.clear();
                COLOR_MAP.clear(); // Reset colors

                renderRoutes(loadedRoutePlan);
                renderTimelines(loadedRoutePlan);
                refreshSolvingButtons(false);
                initialized = true;

                // Clear vehicle segment cache on new file load
                vehiclePaths.clear();
                vehicleRoadSegments.clear();

                $("#fileInput").val('');
            } catch (error) {
                showError("Error parsing JSON file: " + error);
            }
        };
        reader.readAsText(file);
    });

    setupAjax();
    fetchDemoData();
});

function colorByVehicle(vehicle) {
    return vehicle === null ? null : pickColor('vehicle' + vehicle.id);
}

function formatDrivingTime(drivingTimeInSeconds) {
    return `${Math.floor(drivingTimeInSeconds / 3600)}h ${Math.round((drivingTimeInSeconds % 3600) / 60)}m`;
}

function homeLocationPopupContent(vehicle) {
    return `<h5>Vehicle ${vehicle.id}</h5>
Home Location`;
}

function visitPopupContent(visit) {
    const arrival = visit.arrivalTime ? `<h6>Arrival at ${showTimeOnly(visit.arrivalTime)}.</h6>` : '';
    return `<h5>${visit.name}</h5>
    <h6>Demand: ${visit.demand}</h6>
    <h6>Available from ${showTimeOnly(visit.minStartTime)} to ${showTimeOnly(visit.maxEndTime)}.</h6>
    ${arrival}`;
}

function showTimeOnly(localDateTimeString) {
    return JSJoda.LocalDateTime.parse(localDateTimeString).toLocalTime();
}

function getHomeLocationMarker(vehicle) {
    let marker = homeLocationMarkerByIdMap.get(vehicle.id);
    if (marker) {
        return marker;
    }
    marker = L.marker(vehicle.homeLocation, {
        icon: L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background-color: ${colorByVehicle(vehicle).bg}; width: 12px; height: 12px; border-radius: 50%; opacity: 0.8; border: 1px solid #333;"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        }),
        draggable: true
    });
    marker.addTo(homeLocationGroup).bindPopup();
    marker.on('dragend', function (event) {
        const latLng = event.target.getLatLng();
        const currentVehicle = loadedRoutePlan.vehicles.find(v => v.id === vehicle.id);
        if (currentVehicle) {
            currentVehicle.homeLocation[0] = latLng.lat;
            currentVehicle.homeLocation[1] = latLng.lng;
        }
    });
    homeLocationMarkerByIdMap.set(vehicle.id, marker);
    return marker;
}

function getVisitMarker(visit) {
    let marker = visitMarkerByIdMap.get(visit.id);
    if (marker) {
        return marker;
    }
    marker = L.marker(visit.location, {
        icon: L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background-color: #3388ff; width: 12px; height: 12px; border-radius: 50%; opacity: 0.8; border: 1px solid #333;"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        }),
        draggable: true
    });
    marker.addTo(visitGroup).bindPopup();
    marker.on('dragend', function (event) {
        const latLng = event.target.getLatLng();
        const currentVisit = loadedRoutePlan.visits.find(v => v.id === visit.id);
        if (currentVisit) {
            currentVisit.location[0] = latLng.lat;
            currentVisit.location[1] = latLng.lng;
        }
    });
    visitMarkerByIdMap.set(visit.id, marker);
    return marker;
}

function renderRoutes(solution) {
    if (!initialized) {
        const bounds = [solution.southWestCorner, solution.northEastCorner];
        map.fitBounds(bounds);
    }
    // Clear stored paths
    vehiclePaths.clear();
    vehicleRoadSegments.clear();

    // Vehicles
    vehiclesTable.children().remove();
    solution.vehicles.forEach(function (vehicle) {
        let marker = getHomeLocationMarker(vehicle);
        marker.setPopupContent(homeLocationPopupContent(vehicle));
        marker.setLatLng(vehicle.homeLocation);
        const { id, capacity, totalDemand, totalDrivingTimeSeconds, maxWorkTimeSeconds } = vehicle;
        const percentage = totalDemand / capacity * 100;
        const color = colorByVehicle(vehicle);
        vehiclesTable.append(`
      <tr>
        <td class="text-center align-middle">
          <i class="fas fa-crosshairs fa-lg" id="crosshairs-${id}"
            style="color: ${color.bg}; cursor: pointer;">
          </i>
        </td>
        <td class="align-middle">
            <div class="fw-bold" style="font-size: 0.9rem;">Vehicle ${id}</div>
            <div class="text-muted" style="font-size: 0.75rem;">${formatDrivingTime(totalDrivingTimeSeconds)}</div>

        </td>
        <td class="align-middle">
          <div class="d-flex align-items-center">
              <div class="progress flex-grow-1" style="height: 6px;" data-bs-toggle="tooltip-load" data-bs-placement="top"
                title="Cargo: ${totalDemand} / Capacity: ${capacity}">
                <div class="progress-bar" role="progressbar" style="width: ${percentage}%; background-color: ${color.bg};"></div>
              </div>
              <small class="ms-1 text-muted" style="font-size: 0.7rem;">${percentage.toFixed(0)}%</small>
          </div>
        </td>
      </tr>`);
    });
    // Visits
    solution.visits.forEach(function (visit) {
        let marker = getVisitMarker(visit);
        marker.setPopupContent(visitPopupContent(visit));
        marker.setLatLng(visit.location);
    });
    // Route
    routeGroup.clearLayers();
    if (useRoadNetwork) {
        fetchAndDrawRoadRoutes(solution);
    } else {
        const visitByIdMap = new Map(solution.visits.map(visit => [String(visit.id), visit]));
        for (let vehicle of solution.vehicles) {
            const homeLocation = vehicle.homeLocation;
            const locations = vehicle.visits
                .map(visitId => visitByIdMap.get(String(visitId)))
                .filter(visit => visit != null)
                .map(visit => visit.location);
            vehiclePaths.set(vehicle.id, [homeLocation, ...locations, homeLocation]);
            L.polyline([homeLocation, ...locations, homeLocation], { color: colorByVehicle(vehicle).bg }).addTo(routeGroup);
        }
    }

    // Summary
    $('#score').text(solution.score);
    $("#info").text(`This dataset has ${solution.visits.length} visits who need to be assigned to ${solution.vehicles.length} vehicles.`);
    $('#drivingTime').text(formatDrivingTime(solution.totalDrivingTimeSeconds));
}

let useRoadNetwork = false;
const routeCache = new Map(); // Key: "lat1,lng1;lat2,lng2", Value: [[lat,lng], ...]

$('#roadViewToggle').change(function () {
    useRoadNetwork = this.checked;
    stopAnimation(); // Stop any running animation when toggling view
    if (loadedRoutePlan) {
        renderRoutes(loadedRoutePlan);
    }
});

$('#animateButton').click(animateVehicles);

function fetchAndDrawRoadRoutes(solution) {
    const visitByIdMap = new Map(solution.visits.map(visit => [String(visit.id), visit]));

    solution.vehicles.forEach(vehicle => {
        const color = colorByVehicle(vehicle).bg;
        const locations = [vehicle.homeLocation];
        vehicle.visits.forEach(visitId => {
            const visit = visitByIdMap.get(String(visitId));
            if (visit) {
                locations.push(visit.location);
            }
        });
        locations.push(vehicle.homeLocation);

        locations.push(vehicle.homeLocation);

        drawRoadRoute(vehicle.id, locations, color);
    });
}

function drawRoadRoute(vehicleId, locations, color) {
    if (!vehicleRoadSegments.has(vehicleId)) {
        vehicleRoadSegments.set(vehicleId, new Map());
    }
    const vehicleSegments = vehicleRoadSegments.get(vehicleId);
    if (locations.length < 2) return;

    // Split into segments to allow caching per leg (optional, but easier cache key management if we did leg by leg)
    // For simplicity, we'll request the whole vehicle route from OSRM if it's not too long.
    // OSRM demo server might reject long URLs, so per-leg is safer.

    for (let i = 0; i < locations.length - 1; i++) {
        const start = locations[i];
        const end = locations[i + 1];
        const cacheKey = `${start[0]},${start[1]};${end[0]},${end[1]}`;

        if (routeCache.has(cacheKey)) {
            L.polyline(routeCache.get(cacheKey), { color: color, weight: 4, opacity: 0.8 }).addTo(routeGroup);
        } else {
            // Use backend proxy to avoid CORS/Network issues
            const url = `/route-proxy?startLat=${start[0]}&startLng=${start[1]}&endLat=${end[0]}&endLng=${end[1]}`;

            $.get(url, function (data) {
                if (data.routes && data.routes.length > 0) {
                    const coordinates = data.routes[0].geometry.coordinates;
                    // GeoJSON is lng,lat. Leaflet needs lat,lng
                    const latLngs = coordinates.map(coord => [coord[1], coord[0]]);
                    routeCache.set(cacheKey, latLngs);
                    L.polyline(latLngs, { color: color, weight: 4, opacity: 0.8 }).addTo(routeGroup);
                    vehicleSegments.set(i, latLngs);
                }
            }).fail(function (jqXHR, textStatus, errorThrown) {
                console.warn("Proxy fetch failed:", textStatus, errorThrown, "URL:", url);
                const straightLine = [start, end];
                L.polyline(straightLine, { color: color, dashArray: '5, 10' }).addTo(routeGroup);
                vehicleSegments.set(i, straightLine);
            });
        }
    }
}

function stopAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    animationRunning = false;
    animationMarkers.forEach(marker => map.removeLayer(marker));
    animationMarkers = [];
}

function animateVehicles() {
    if (!loadedRoutePlan) return;
    if (animationRunning) {
        stopAnimation();
        return;
    }

    animationRunning = true;
    const vehicles = loadedRoutePlan.vehicles;
    const duration = 10000; // Animation duration in ms
    const startTime = performance.now();

    // Prepare paths for each vehicle
    const vehicleAnimationPaths = vehicles.map(vehicle => {
        let path = [];
        if (useRoadNetwork) {
            // Reconstruct full path from segments
            const segments = vehicleRoadSegments.get(vehicle.id);
            if (segments) {
                const sortedKeys = Array.from(segments.keys()).sort((a, b) => a - b);
                sortedKeys.forEach(key => {
                    const segment = segments.get(key);
                    // Avoid duplicating connection points (end of A is start of B)
                    if (path.length > 0 && segment.length > 0) {
                        const last = path[path.length - 1];
                        const first = segment[0];
                        if (last[0] === first[0] && last[1] === first[1]) {
                            path.push(...segment.slice(1));
                        } else {
                            path.push(...segment);
                        }
                    } else {
                        path.push(...segment);
                    }
                });
            }
        } else {
            path = vehiclePaths.get(vehicle.id);
        }

        // If path is undefined or too short, just use home location
        if (!path || path.length < 2) {
            path = [vehicle.homeLocation, vehicle.homeLocation];
        }

        return {
            id: vehicle.id,
            color: colorByVehicle(vehicle).bg,
            path: path,
            totalDistance: calculatePathDistance(path)
        };
    });

    // Calculate speed based on max distance to keep animation reasonable (e.g. 10 sec for long route)
    const maxDistance = Math.max(...vehicleAnimationPaths.map(v => v.totalDistance));
    // Avoid division by zero
    const targetDuration = 10000; // ms for the longest route
    const speed = maxDistance > 0 ? maxDistance / targetDuration : 0;

    // Create markers
    vehicleAnimationPaths.forEach(v => {
        const marker = L.circleMarker(v.path[0], {
            radius: 6,
            fillColor: v.color,
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map);
        animationMarkers.push(marker);
        v.marker = marker;
    });

    function animate(currentTime) {
        if (!animationRunning) return;

        const elapsed = currentTime - startTime;
        // const progress = Math.min(elapsed / duration, 1);

        let activeVehicles = 0;

        vehicleAnimationPaths.forEach(v => {
            if (v.path.length < 2) return;

            // Distance covered at constant speed
            let targetDistance = speed * elapsed;

            // Cap at total distance
            if (targetDistance >= v.totalDistance) {
                targetDistance = v.totalDistance;
            } else {
                activeVehicles++;
            }

            const position = getPositionAtDistance(v.path, targetDistance);
            v.marker.setLatLng(position);
        });

        if (activeVehicles > 0 || elapsed < targetDuration) {
            animationFrameId = requestAnimationFrame(animate);
        } else {
            stopAnimation();
        }
    }

    animationFrameId = requestAnimationFrame(animate);
}

function calculatePathDistance(latLngs) {
    let distance = 0;
    for (let i = 0; i < latLngs.length - 1; i++) {
        distance += L.latLng(latLngs[i]).distanceTo(L.latLng(latLngs[i + 1]));
    }
    return distance;
}

function getPositionAtDistance(latLngs, targetDistance) {
    let coveredDistance = 0;
    for (let i = 0; i < latLngs.length - 1; i++) {
        const p1 = L.latLng(latLngs[i]);
        const p2 = L.latLng(latLngs[i + 1]);
        const segmentDist = p1.distanceTo(p2);

        if (coveredDistance + segmentDist >= targetDistance) {
            const ratio = (targetDistance - coveredDistance) / segmentDist;
            const lat = p1.lat + (p2.lat - p1.lat) * ratio;
            const lng = p1.lng + (p2.lng - p1.lng) * ratio;
            return [lat, lng];
        }
        coveredDistance += segmentDist;
    }
    return latLngs[latLngs.length - 1];
}

function renderTimelines(routePlan) {
    byVehicleGroupData.clear();
    byVisitGroupData.clear();
    byVehicleItemData.clear();
    byVisitItemData.clear();

    $.each(routePlan.vehicles, function (index, vehicle) {
        const { totalDemand, capacity } = vehicle
        const percentage = totalDemand / capacity * 100;
        const vehicleWithLoad = $(`<div><h5 class="card-title mb-1">vehicle-${vehicle.id}</h5>
                                 <div class="progress" data-bs-toggle="tooltip-load" data-bs-placement="left" 
                                      data-html="true" title="Cargo: ${totalDemand} / Capacity: ${capacity}">
                                   <div class="progress-bar" role="progressbar" style="width: ${percentage}%">
                                      ${totalDemand}/${capacity}
                                   </div>
                                 </div></div>`)[0];
        byVehicleGroupData.add({ id: vehicle.id, content: vehicleWithLoad });
    });

    $.each(routePlan.visits, function (index, visit) {
        const minStartTime = JSJoda.LocalDateTime.parse(visit.minStartTime);
        const maxEndTime = JSJoda.LocalDateTime.parse(visit.maxEndTime);
        const serviceDuration = JSJoda.Duration.ofSeconds(visit.serviceDuration);

        const visitGroupElement = $(`<div/>`)
            .append($(`<h5 class="card-title mb-1"/>`).text(`${visit.name}`));
        byVisitGroupData.add({
            id: visit.id,
            content: visitGroupElement[0]
        });

        // Time window per visit.
        byVisitItemData.add({
            id: visit.id + "_readyToDue",
            group: visit.id,
            start: visit.minStartTime,
            end: visit.maxEndTime,
            type: "background",
            style: "background-color: #8AE23433"
        });

        if (visit.vehicle == null) {
            const byJobJobElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text(`Unassigned`));

            // Unassigned are shown at the beginning of the visit's time window; the length is the service duration.
            byVisitItemData.add({
                id: visit.id + '_unassigned',
                group: visit.id,
                content: byJobJobElement[0],
                start: minStartTime.toString(),
                end: minStartTime.plus(serviceDuration).toString(),
                style: "background-color: #EF292999"
            });
        } else {
            const arrivalTime = JSJoda.LocalDateTime.parse(visit.arrivalTime);
            const beforeReady = arrivalTime.isBefore(minStartTime);
            const arrivalPlusService = arrivalTime.plus(serviceDuration);
            const afterDue = arrivalPlusService.isAfter(maxEndTime);

            const byVehicleElement = $(`<div/>`)
                .append('<div/>')
                .append($(`<h5 class="card-title mb-1"/>`).text(visit.name));

            const byVisitElement = $(`<div/>`)
                // visit.vehicle is the vehicle.id due to Jackson serialization
                .append($(`<h5 class="card-title mb-1"/>`).text('vehicle-' + visit.vehicle));

            const byVehicleTravelElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text('Travel'));

            const previousDeparture = arrivalTime.minusSeconds(visit.drivingTimeSecondsFromPreviousStandstill);
            byVehicleItemData.add({
                id: visit.id + '_travel',
                group: visit.vehicle, // visit.vehicle is the vehicle.id due to Jackson serialization
                subgroup: visit.vehicle,
                content: byVehicleTravelElement[0],
                start: previousDeparture.toString(),
                end: visit.arrivalTime,
                style: "background-color: #f7dd8f90"
            });
            if (beforeReady) {
                const byVehicleWaitElement = $(`<div/>`)
                    .append($(`<h5 class="card-title mb-1"/>`).text('Wait'));

                byVehicleItemData.add({
                    id: visit.id + '_wait',
                    group: visit.vehicle, // visit.vehicle is the vehicle.id due to Jackson serialization
                    subgroup: visit.vehicle,
                    content: byVehicleWaitElement[0],
                    start: visit.arrivalTime,
                    end: visit.minStartTime
                });
            }
            let serviceElementBackground = afterDue ? '#EF292999' : '#83C15955'

            byVehicleItemData.add({
                id: visit.id + '_service',
                group: visit.vehicle, // visit.vehicle is the vehicle.id due to Jackson serialization
                subgroup: visit.vehicle,
                content: byVehicleElement[0],
                start: visit.startServiceTime,
                end: visit.departureTime,
                style: "background-color: " + serviceElementBackground
            });
            byVisitItemData.add({
                id: visit.id,
                group: visit.id,
                content: byVisitElement[0],
                start: visit.startServiceTime,
                end: visit.departureTime,
                style: "background-color: " + serviceElementBackground
            });

        }

    });

    $.each(routePlan.vehicles, function (index, vehicle) {
        if (vehicle.visits.length > 0) {
            let lastVisit = routePlan.visits.filter((visit) => visit.id === vehicle.visits[vehicle.visits.length - 1]).pop();
            if (lastVisit) {
                byVehicleItemData.add({
                    id: vehicle.id + '_travelBackToHomeLocation',
                    group: vehicle.id, // visit.vehicle is the vehicle.id due to Jackson serialization
                    subgroup: vehicle.id,
                    content: $(`<div/>`).append($(`<h5 class="card-title mb-1"/>`).text('Travel'))[0],
                    start: lastVisit.departureTime,
                    end: vehicle.arrivalTime,
                    style: "background-color: #f7dd8f90"
                });
            }
        }
    });

    if (!initialized) {
        byVehicleTimeline.setWindow(routePlan.startDateTime, routePlan.endDateTime);
        byVisitTimeline.setWindow(routePlan.startDateTime, routePlan.endDateTime);
    }
}

function analyze() {
    // see score-analysis.js
    analyzeScore(loadedRoutePlan, "/route-plans/analyze")
}

let vehicleChartInstance = null;
let loadDistChartInstance = null;

function showDashboard() {
    if (!loadedRoutePlan || !loadedRoutePlan.vehicles || loadedRoutePlan.vehicles.length === 0) {
        showToast("No data available. Please upload and optimize a route first.", "warning");
        return;
    }

    // Check if optimized (basic check: do we have visits assigned?)
    const activeVehicles = loadedRoutePlan.vehicles.filter(v => v.visits && v.visits.length > 0);
    if (activeVehicles.length === 0 && loadedRoutePlan.visits && loadedRoutePlan.visits.length > 0) {
        showToast("Optimization not started. Please click 'Optimize Route' first.", "warning");
        return;
    }


    // 1. Calculate Metrics
    const totalVehicles = loadedRoutePlan.vehicles.length;
    const totalVisits = loadedRoutePlan.visits ? loadedRoutePlan.visits.length : 0;

    let totalCapacity = 0;
    let totalLoad = 0;
    let totalDrivingTime = 0;

    const labels = [];
    const loadData = [];
    const capacityData = [];
    const timeData = [];

    loadedRoutePlan.vehicles.forEach(v => {
        totalCapacity += v.capacity;
        totalLoad += v.totalDemand;
        totalDrivingTime += v.totalDrivingTimeSeconds;

        labels.push(`V${v.id}`);
        loadData.push(v.totalDemand);
        capacityData.push(v.capacity);
        timeData.push((v.totalDrivingTimeSeconds / 3600).toFixed(1)); // Hours
    });

    const avgUtil = totalCapacity > 0 ? ((totalLoad / totalCapacity) * 100).toFixed(1) : 0;
    // Estimate distance (very rough, assuming 60km/h avg speed if proper distance not available)
    // In real app, we might have meters. Here we have seconds. Let's assume 50km/h for display.
    const estDistanceKm = (totalDrivingTime / 3600 * 50).toFixed(0);

    // 2. Update Summary Cards
    $('#dashTotalVehicles').text(totalVehicles);
    $('#dashTotalDistance').text(`~${estDistanceKm} km`); // Heuristic
    $('#dashAvgUtil').text(`${avgUtil}%`);
    $('#dashTotalVisits').text(totalVisits);

    // 3. Render Charts
    $('#dashboardModal').modal('show');

    // Wait for modal to show before rendering charts to ensure canvas dimensions are correct
    setTimeout(() => {
        // Pass validation of raw seconds for tooltip
        const rawTimeSeconds = loadedRoutePlan.vehicles.map(v => v.totalDrivingTimeSeconds);
        renderVehicleChart(labels, loadData, capacityData, timeData, rawTimeSeconds);
        renderLoadDistChart(activeVehicles.length, totalVehicles - activeVehicles.length);
    }, 200);
}

function renderVehicleChart(labels, loadData, capacityData, timeData, rawTimeSeconds) {
    const ctx = document.getElementById('vehicleChart').getContext('2d');

    if (vehicleChartInstance) {
        vehicleChartInstance.destroy();
    }

    vehicleChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Load',
                    data: loadData,
                    backgroundColor: 'rgba(62, 0, 255, 0.7)',
                    yAxisID: 'y'
                },
                {
                    label: 'Capacity',
                    data: capacityData,
                    type: 'line',
                    borderColor: 'rgba(52, 35, 166, 0.5)',
                    borderDash: [5, 5],
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: 'Driving Time (h)',
                    data: timeData,
                    backgroundColor: 'rgba(255, 193, 7, 0.5)',
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.dataset.yAxisID === 'y1') {
                                // Use the raw seconds to format this exactly like the sidebar
                                const seconds = rawTimeSeconds[context.dataIndex];
                                return label + formatDrivingTime(seconds);
                            }
                            return label + context.formattedValue;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Load / Capacity' }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    title: { display: true, text: 'Hours' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

function renderLoadDistChart(activeCount, idleCount) {
    const ctx = document.getElementById('loadDistributionChart').getContext('2d');

    if (loadDistChartInstance) {
        loadDistChartInstance.destroy();
    }

    loadDistChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Active Vehicles', 'Idle Vehicles'],
            datasets: [{
                data: [activeCount, idleCount],
                backgroundColor: [
                    'rgba(62, 0, 255, 0.7)',
                    'rgba(233, 236, 239, 1)'
                ],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function openRecommendationModal(lat, lng) {

    if (!('score' in loadedRoutePlan) || optimizing) {
        map.removeLayer(visitMarker);
        visitMarker = null;
        let message = "Please click the Solve button before adding new visits.";
        if (optimizing) {
            message = "Please wait for the solving process to finish."
        }
        showToast(message, "warning");
        return;
    }
    // see recommended-fit.js
    const visitId = Math.max(...loadedRoutePlan.visits.map(c => parseInt(c.id))) + 1;
    newVisit = { id: visitId, location: [lat, lng] };
    addNewVisit(visitId, lat, lng, map, visitMarker);
}

function getRecommendationsModal() {
    let formValid = true;
    formValid = validateFormField(newVisit, 'name', '#inputName') && formValid;
    formValid = validateFormField(newVisit, 'demand', '#inputDemand') && formValid;
    formValid = validateFormField(newVisit, 'minStartTime', '#inputMinStartTime') && formValid;
    formValid = validateFormField(newVisit, 'maxEndTime', '#inputMaxStartTime') && formValid;
    formValid = validateFormField(newVisit, 'serviceDuration', '#inputDuration') && formValid;
    if (formValid) {
        const updatedMinStartTime = JSJoda.LocalDateTime.parse(newVisit['minStartTime'], JSJoda.DateTimeFormatter.ofPattern('yyyy-M-d HH:mm')).format(JSJoda.DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        const updatedMaxEndTime = JSJoda.LocalDateTime.parse(newVisit['maxEndTime'], JSJoda.DateTimeFormatter.ofPattern('yyyy-M-d HH:mm')).format(JSJoda.DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        const updatedVisit = { ...newVisit, serviceDuration: `PT${newVisit['serviceDuration']}M`, minStartTime: updatedMinStartTime, maxEndTime: updatedMaxEndTime };
        let updatedVisitList = [...loadedRoutePlan['visits']];
        updatedVisitList.push(updatedVisit);
        let updatedSolution = { ...loadedRoutePlan, visits: updatedVisitList };
        // see recommended-fit.js
        requestRecommendations(updatedVisit.id, updatedSolution, "/route-plans/recommendation")
    }
}

function validateFormField(target, fieldName, inputName) {
    target[fieldName] = $(inputName).val();
    if ($(inputName).val() == "") {
        $(inputName).addClass("is-invalid");
    } else {
        $(inputName).removeClass("is-invalid");
    }
    return $(inputName).val() != "";
}

function applyRecommendationModal(recommendations) {
    let checkedRecommendation = null;
    recommendations.forEach((recommendation, index) => {
        if ($('#option' + index).is(":checked")) {
            checkedRecommendation = recommendations[index];
        }
    });
    const updatedMinStartTime = JSJoda.LocalDateTime.parse(newVisit['minStartTime'], JSJoda.DateTimeFormatter.ofPattern('yyyy-M-d HH:mm')).format(JSJoda.DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    const updatedMaxEndTime = JSJoda.LocalDateTime.parse(newVisit['maxEndTime'], JSJoda.DateTimeFormatter.ofPattern('yyyy-M-d HH:mm')).format(JSJoda.DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    const updatedVisit = { ...newVisit, serviceDuration: `PT${newVisit['serviceDuration']}M`, minStartTime: updatedMinStartTime, maxEndTime: updatedMaxEndTime };
    let updatedVisitList = [...loadedRoutePlan['visits']];
    updatedVisitList.push(updatedVisit);
    let updatedSolution = { ...loadedRoutePlan, visits: updatedVisitList };
    // see recommended-fit.js
    applyRecommendation(updatedSolution, newVisit.id, checkedRecommendation.proposition.vehicleId, checkedRecommendation.proposition.index,
        "/route-plans/recommendation/apply");
}

function updateSolutionWithNewVisit(newSolution) {
    loadedRoutePlan = newSolution;
    renderRoutes(newSolution);
    renderTimelines(newSolution);
    $('#newVisitModal').modal('hide');
}

// TODO: move the general functionality to the webjar.

function setupAjax() {
    $.ajaxSetup({
        contentType: 'application/json',
        headers: {
            'Accept': 'application/json,text/plain', // plain text is required by solve() returning UUID of the solver job
        }
    });

    // Extend jQuery to support $.put() and $.delete()
    jQuery.each(["put", "delete"], function (i, method) {
        jQuery[method] = function (url, data, callback, type) {
            if (jQuery.isFunction(data)) {
                type = type || callback;
                callback = data;
                data = undefined;
            }
            return jQuery.ajax({
                url: url,
                type: method,
                dataType: type,
                data: data,
                success: callback
            });
        };
    });
}

function solve() {
    if (!loadedRoutePlan) {
        alert("No data to solve. Please upload a dataset or select demo data.");
        return;
    }

    // Configuration is now applied via 'Configure Fleet' modal directly to loadedRoutePlan
    // No need to apply on solve click anymore

    $.post("/route-plans", JSON.stringify(loadedRoutePlan), function (data) {
        scheduleId = data;
        refreshSolvingButtons(true);
    }).fail(function (xhr, ajaxOptions, thrownError) {
        showError("Start solving failed.", xhr);
        refreshSolvingButtons(false);
    },
        "text");
}

/* 
 * Configuration is handled by Fleet Modal
 */
function applyConfiguration(count, capacity) {
    // Deprecated
}

$('#configureFleetButton').click(openFleetConfigModal);
$('.dashboard-btn').click(showDashboard);

// Helper to parse LocalDateTime from String or Array
function parseLocalDateTime(input) {
    if (!input) return null;
    try {
        if (Array.isArray(input)) {
            // [year, month, day, hour, minute, second, nano]
            // JSJoda.LocalDateTime.of(year, month, dayOfMonth, hour, minute, second, nanoOfSecond)
            const nano = input[6] || 0;
            const second = input[5] || 0;
            return JSJoda.LocalDateTime.of(input[0], input[1], input[2], input[3], input[4], second, nano);
        } else if (typeof input === 'string') {
            return JSJoda.LocalDateTime.parse(input);
        }
    } catch (e) {
        console.error("Failed to parse date:", input, e);
    }
    return null;
}

// Helper to parse Location from Array or Object
function parseLocation(input) {
    if (!input) return { lat: 0, lng: 0 };
    if (Array.isArray(input) && input.length >= 2) {
        return { lat: input[0], lng: input[1] };
    }
    if (typeof input === 'object') {
        const lat = input.latitude !== undefined ? input.latitude : (input.lat !== undefined ? input.lat : 0);
        const lng = input.longitude !== undefined ? input.longitude : (input.lng !== undefined ? input.lng : 0);
        return { lat: lat, lng: lng };
    }
    return { lat: 0, lng: 0 };
}

function openFleetConfigModal() {
    if (!loadedRoutePlan) return;

    // Reset warning
    $('#fleetConfigWarning').addClass('d-none').text('');

    // Set total vehicles
    $('#totalVehiclesInput').val(loadedRoutePlan.vehicles.length);

    // Populate table
    const tbody = $('#fleetConfigTableBody');
    tbody.empty();

    loadedRoutePlan.vehicles.forEach(vehicle => {
        // Safe access helpers
        const loc = parseLocation(vehicle.homeLocation);
        const lat = loc.lat;
        const lng = loc.lng;

        let startTimeStr = '';
        let latestArrivalStr = '';

        // Max Work Time in Hours (displayed with up to 1 decimal place if needed)
        let maxWorkHours = 0;
        if (vehicle.maxWorkTimeSeconds) {
            maxWorkHours = parseFloat((vehicle.maxWorkTimeSeconds / 3600).toFixed(2));
        }

        try {
            if (vehicle.departureTime) {
                const startDateTime = parseLocalDateTime(vehicle.departureTime);
                if (startDateTime) {
                    // Format for datetime-local: yyyy-MM-ddTHH:mm
                    startTimeStr = startDateTime.format(JSJoda.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"));
                }
            }
            if (vehicle.latestArrivalTime) {
                const latestDateTime = parseLocalDateTime(vehicle.latestArrivalTime);
                if (latestDateTime) {
                    latestArrivalStr = latestDateTime.format(JSJoda.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"));
                }
            }
        } catch (e) {
            console.error("Error parsing times for vehicle " + vehicle.id, e);
        }

        const row = `
            <tr data-vehicle-id="${vehicle.id}">
                <td>${vehicle.id}</td>
                <td>
                    <input type="number" class="form-control form-control-sm capacity-input" value="${vehicle.capacity}" min="1">
                </td>
                <td>
                    <input type="number" step="any" class="form-control form-control-sm lat-input" value="${lat}">
                </td>
                <td>
                    <input type="number" step="any" class="form-control form-control-sm lng-input" value="${lng}">
                </td>
                <td>
                    <input type="datetime-local" class="form-control form-control-sm start-time-input" value="${startTimeStr}">
                </td>
                <td>
                    <input type="datetime-local" class="form-control form-control-sm latest-arrival-input" value="${latestArrivalStr}">
                </td>
                <td>
                    <input type="number" step="0.5" class="form-control form-control-sm max-duration-input" value="${maxWorkHours}" min="0">
                </td>
            </tr>
        `;
        tbody.append(row);
    });

    $('#fleetConfigModal').modal('show');
}

$('#saveFleetConfigButton').click(function () {
    if (!loadedRoutePlan) return;

    const newCount = parseInt($('#totalVehiclesInput').val()) || loadedRoutePlan.vehicles.length;
    const currentCount = loadedRoutePlan.vehicles.length;

    // 1. Handle Resize
    if (newCount > currentCount) {
        // Add vehicles
        const lastVehicle = currentCount > 0 ? loadedRoutePlan.vehicles[currentCount - 1] : null;
        const defaultCapacity = lastVehicle ? lastVehicle.capacity : 10;
        const lastLoc = parseLocation(lastVehicle ? lastVehicle.homeLocation : null);
        const defaultHome = [lastLoc.lat, lastLoc.lng];
        const defaultDep = lastVehicle ? lastVehicle.departureTime : loadedRoutePlan.startDateTime;
        // Default max work time to 0 if not set, or copy last
        const defaultMaxTime = lastVehicle ? lastVehicle.maxWorkTimeSeconds : 0;

        for (let i = currentCount; i < newCount; i++) {
            const newId = String(i + 1);
            const newVehicle = {
                id: newId,
                capacity: defaultCapacity,
                homeLocation: defaultHome,
                departureTime: defaultDep,
                latestArrivalTime: null, // Default to null (no strict deadline)
                maxWorkTimeSeconds: defaultMaxTime,
                visits: [],
                totalDemand: 0,
                totalDrivingTimeSeconds: 0
            };
            loadedRoutePlan.vehicles.push(newVehicle);
        }
    } else if (newCount < currentCount) {
        loadedRoutePlan.vehicles.length = newCount;
    }

    // 2. Update Properties from Table
    let validationErrors = [];

    $('#fleetConfigTableBody tr').each(function () {
        const id = $(this).data('vehicle-id');
        const vehicle = loadedRoutePlan.vehicles.find(v => v.id === String(id));
        if (vehicle) {
            // Capacity
            const cap = parseInt($(this).find('.capacity-input').val()) || 0;
            vehicle.capacity = cap;

            // Location
            const lat = parseFloat($(this).find('.lat-input').val());
            const lng = parseFloat($(this).find('.lng-input').val());
            if (!isNaN(lat) && !isNaN(lng)) {
                vehicle.homeLocation = [lat, lng];
            }

            // Times
            const startTimeVal = $(this).find('.start-time-input').val(); // "yyyy-MM-ddTHH:mm"
            const latestArrivalVal = $(this).find('.latest-arrival-input').val(); // "yyyy-MM-ddTHH:mm"
            const maxDurationHours = parseFloat($(this).find('.max-duration-input').val()) || 0;

            let startDateTime = null;
            let latestArrivalDateTime = null;

            if (startTimeVal) {
                // Parse ISO string
                startDateTime = JSJoda.LocalDateTime.parse(startTimeVal);
                vehicle.departureTime = startDateTime.toString();
            }

            if (latestArrivalVal) {
                latestArrivalDateTime = JSJoda.LocalDateTime.parse(latestArrivalVal);
                vehicle.latestArrivalTime = latestArrivalDateTime.toString();
            } else {
                vehicle.latestArrivalTime = null;
            }

            vehicle.maxWorkTimeSeconds = Math.round(maxDurationHours * 3600);

            // Validation: Start vs Latest Arrival vs Max Duration
            if (startDateTime && latestArrivalDateTime && vehicle.maxWorkTimeSeconds > 0) {
                const windowSeconds = JSJoda.Duration.between(startDateTime, latestArrivalDateTime).seconds();
                if (windowSeconds > vehicle.maxWorkTimeSeconds) {
                    validationErrors.push(`Vehicle ${id}: Window (${(windowSeconds / 3600).toFixed(1)}h) exceeds Max Work Time (${maxDurationHours}h). Consider increasing Max Duration or adjusting times.`);
                }

                if (windowSeconds < 0) {
                    validationErrors.push(`Vehicle ${id}: Latest Arrival is before Start Time.`);
                }
            }
        }
    });

    if (validationErrors.length > 0) {
        const errorHtml = "<strong>Please check the following warnings:</strong><br>" + validationErrors.join("<br>");
        $('#fleetConfigWarning').html(errorHtml).removeClass('d-none');
        // We do NOT close the modal if there are warnings!
        return;
    }

    $('#fleetConfigModal').modal('hide');
    renderRoutes(loadedRoutePlan);
});

function refreshSolvingButtons(solving) {
    optimizing = solving;
    if (solving) {
        $("#solveButton").hide();
        $("#visitButton").hide();
        $("#stopSolvingButton").show();
        if (autoRefreshIntervalId == null) {
            autoRefreshIntervalId = setInterval(refreshRoutePlan, 2000);
        }
    } else {
        $("#solveButton").show();
        $("#visitButton").show();
        $("#stopSolvingButton").hide();
        if (autoRefreshIntervalId != null) {
            clearInterval(autoRefreshIntervalId);
            autoRefreshIntervalId = null;
        }
    }
}

function refreshRoutePlan() {
    let path = "/route-plans/" + scheduleId;
    if (scheduleId === null) {
        if (demoDataId === null) {
            showToast("Please select a test data set.", "warning");
            return;
        }

        path = "/demo-data/" + demoDataId;
    }

    $.getJSON(path, function (routePlan) {
        loadedRoutePlan = routePlan;
        refreshSolvingButtons(routePlan.solverStatus != null && routePlan.solverStatus !== "NOT_SOLVING");
        renderRoutes(routePlan);
        renderTimelines(routePlan);
        initialized = true;
    }).fail(function (xhr, ajaxOptions, thrownError) {
        showError("Getting route plan has failed.", xhr);
        refreshSolvingButtons(false);
    });
}

function stopSolving() {
    $.delete("/route-plans/" + scheduleId, function () {
        refreshSolvingButtons(false);
        refreshRoutePlan();
    }).fail(function (xhr, ajaxOptions, thrownError) {
        showError("Stop solving failed.", xhr);
    });
}

function fetchDemoData() {
    $.get("/demo-data", function (data) {
        data.forEach(function (item) {
            $("#testDataButton").append($('<a id="' + item + 'TestData" class="dropdown-item" href="#">' + item + '</a>'));

            $("#" + item + "TestData").click(function () {
                switchDataDropDownItemActive(item);
                scheduleId = null;
                demoDataId = item;
                initialized = false;
                homeLocationGroup.clearLayers();
                homeLocationMarkerByIdMap.clear();
                visitGroup.clearLayers();
                visitMarkerByIdMap.clear();
                refreshRoutePlan();
            });
        });

        // demoDataId = data[0];
        // switchDataDropDownItemActive(demoDataId);
        // refreshRoutePlan();
    }).fail(function (xhr, ajaxOptions, thrownError) {
        // disable this page as there is no data
        $("#demo").empty();
        $("#demo").html("<h1><p style=\"justify-content: center\">No test data available</p></h1>")
    });
}

function switchDataDropDownItemActive(newItem) {
    activeCssClass = "active";
    $("#testDataButton > a." + activeCssClass).removeClass(activeCssClass);
    $("#" + newItem + "TestData").addClass(activeCssClass);
}

function copyTextToClipboard(id) {
    var text = $("#" + id).text().trim();

    var dummy = document.createElement("textarea");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
}



// We must delete the Content-Type header so the browser sets the correct multipart boundary
function uploadCsv() {
    const vehiclesFile = $('#vehiclesFile')[0].files[0];
    const visitsFile = $('#visitsFile')[0].files[0];

    if (!vehiclesFile || !visitsFile) {
        showToast("Please select both Vehicles CSV and Visits CSV files.", "warning");
        return;
    }

    const formData = new FormData();
    formData.append("vehicles", vehiclesFile);
    formData.append("visits", visitsFile);

    $.ajax({
        url: "/upload-data",
        type: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function (data) {
            // Clear existing data to avoid ID collisions and visual artifacts
            loadedRoutePlan = null;
            scheduleId = null;
            demoDataId = null;
            initialized = false;

            visitGroup.clearLayers();
            homeLocationGroup.clearLayers();
            routeGroup.clearLayers();

            visitMarkerByIdMap.clear();
            homeLocationMarkerByIdMap.clear();
            routeCache.clear();

            byVehicleGroupData.clear();
            byVisitGroupData.clear();
            byVehicleItemData.clear();
            byVisitItemData.clear();

            vehiclesTable.children().remove();
            // Reset colors
            COLOR_MAP.clear();

            updateSolutionWithNewVisit(data);
            openFleetConfigModal();
        },
        error: function (xhr, status, error) {
            showError("Upload failed: " + xhr.status + " " + xhr.statusText + "\n" + xhr.responseText);
        }
    });
}

function clearPoints() {
    loadedRoutePlan = null;
    scheduleId = null;
    demoDataId = null;
    initialized = false;

    // Clear map layers
    visitGroup.clearLayers();
    homeLocationGroup.clearLayers();
    routeGroup.clearLayers();

    // Clear maps
    visitMarkerByIdMap.clear();
    homeLocationMarkerByIdMap.clear();
    routeCache.clear();

    // Clear timelines
    byVehicleGroupData.clear();
    byVisitGroupData.clear();
    byVehicleItemData.clear();
    byVisitItemData.clear();

    // Clear vehicles table
    vehiclesTable.children().remove();

    // Reset stats
    $('#score').text('?');
    $('#drivingTime').text('--');
    $("#info").text('');

    refreshSolvingButtons(false);
}

$('#recenterMapButton').click(function () {
    if (!loadedRoutePlan) {
        return;
    }

    const bounds = L.latLngBounds();

    // Add vehicle home locations to bounds
    if (loadedRoutePlan.vehicles) {
        loadedRoutePlan.vehicles.forEach(vehicle => {
            if (vehicle.homeLocation) {
                bounds.extend(vehicle.homeLocation);
            }
        });
    }

    // Add visits to bounds
    if (loadedRoutePlan.visits) {
        loadedRoutePlan.visits.forEach(visit => {
            if (visit.location) {
                bounds.extend(visit.location);
            }
        });
    }

    if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
    }
});
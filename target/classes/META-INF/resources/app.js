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

/*************************************** Map constants and variable definitions  **************************************/

const homeLocationMarkerByIdMap = new Map();
const visitMarkerByIdMap = new Map();

const map = L.map('map', { doubleClickZoom: false }).setView([51.505, -0.09], 13);
const visitGroup = L.layerGroup().addTo(map);
const homeLocationGroup = L.layerGroup().addTo(map);
const routeGroup = L.layerGroup().addTo(map);

/************************************ Time line constants and variable definitions ************************************/

const byVehiclePanel = document.getElementById("byVehiclePanel");
const byVehicleTimelineOptions = {
    timeAxis: { scale: "hour" },
    orientation: { axis: "top" },
    xss: { disabled: true }, // Items are XSS safe through JQuery
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
    xss: { disabled: true }, // Items are XSS safe through JQuery
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

$(document).ready(function () {
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    solveButton.click(solve);
    stopSolvingButton.click(stopSolving);
    analyzeButton.click(analyze);
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

                $("#fileInput").val('');
            } catch (error) {
                alert("Error parsing JSON file: " + error);
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
    // Vehicles
    vehiclesTable.children().remove();
    solution.vehicles.forEach(function (vehicle) {
        let marker = getHomeLocationMarker(vehicle);
        marker.setPopupContent(homeLocationPopupContent(vehicle));
        marker.setLatLng(vehicle.homeLocation);
        const { id, capacity, totalDemand, totalDrivingTimeSeconds } = vehicle;
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
    const visitByIdMap = new Map(solution.visits.map(visit => [visit.id, visit]));
    for (let vehicle of solution.vehicles) {
        const homeLocation = vehicle.homeLocation;
        const locations = vehicle.visits.map(visitId => visitByIdMap.get(visitId).location);
        L.polyline([homeLocation, ...locations, homeLocation], { color: colorByVehicle(vehicle).bg }).addTo(routeGroup);
    }

    // Summary
    $('#score').text(solution.score);
    $("#info").text(`This dataset has ${solution.visits.length} visits who need to be assigned to ${solution.vehicles.length} vehicles.`);
    $('#drivingTime').text(formatDrivingTime(solution.totalDrivingTimeSeconds));
}

function renderTimelines(routePlan) {
    byVehicleGroupData.clear();
    byVisitGroupData.clear();
    byVehicleItemData.clear();
    byVisitItemData.clear();

    $.each(routePlan.vehicles, function (index, vehicle) {
        const { totalDemand, capacity } = vehicle
        const percentage = totalDemand / capacity * 100;
        const vehicleWithLoad = `<h5 class="card-title mb-1">vehicle-${vehicle.id}</h5>
                                 <div class="progress" data-bs-toggle="tooltip-load" data-bs-placement="left" 
                                      data-html="true" title="Cargo: ${totalDemand} / Capacity: ${capacity}">
                                   <div class="progress-bar" role="progressbar" style="width: ${percentage}%">
                                      ${totalDemand}/${capacity}
                                   </div>
                                 </div>`
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
            content: visitGroupElement.html()
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
                content: byJobJobElement.html(),
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
                content: byVehicleTravelElement.html(),
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
                    content: byVehicleWaitElement.html(),
                    start: visit.arrivalTime,
                    end: visit.minStartTime
                });
            }
            let serviceElementBackground = afterDue ? '#EF292999' : '#83C15955'

            byVehicleItemData.add({
                id: visit.id + '_service',
                group: visit.vehicle, // visit.vehicle is the vehicle.id due to Jackson serialization
                subgroup: visit.vehicle,
                content: byVehicleElement.html(),
                start: visit.startServiceTime,
                end: visit.departureTime,
                style: "background-color: " + serviceElementBackground
            });
            byVisitItemData.add({
                id: visit.id,
                group: visit.id,
                content: byVisitElement.html(),
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
                    content: $(`<div/>`).append($(`<h5 class="card-title mb-1"/>`).text('Travel')).html(),
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

function openRecommendationModal(lat, lng) {

    if (!('score' in loadedRoutePlan) || optimizing) {
        map.removeLayer(visitMarker);
        visitMarker = null;
        let message = "Please click the Solve button before adding new visits.";
        if (optimizing) {
            message = "Please wait for the solving process to finish."
        }
        alert(message);
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
        headers: {
            'Content-Type': 'application/json',
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
    $.post("/route-plans", JSON.stringify(loadedRoutePlan), function (data) {
        scheduleId = data;
        refreshSolvingButtons(true);
    }).fail(function (xhr, ajaxOptions, thrownError) {
        showError("Start solving failed.", xhr);
        refreshSolvingButtons(false);
    },
        "text");
}

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
            alert("Please select a test data set.");
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

        demoDataId = data[0];
        switchDataDropDownItemActive(demoDataId);

        refreshRoutePlan();
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
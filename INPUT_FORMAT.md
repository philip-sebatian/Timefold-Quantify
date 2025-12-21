# VRP Solver Input Format

This document describes the JSON format required for the Vehicle Routing Problem (VRP) solver. The application accepts a single JSON object representing the `VehicleRoutePlan`.

## Root Object

| Field | Type | Description |
|---|---|---|
| `name` | String | Name of the route plan. |
| `southWestCorner` | `[number, number]` | Location [latitude, longitude] of the south-west map bound. |
| `northEastCorner` | `[number, number]` | Location [latitude, longitude] of the north-east map bound. |
| `startDateTime` | String | Start of the planning window (ISO-8601, e.g. `2024-01-01T08:00:00`). |
| `endDateTime` | String | End of the planning window (ISO-8601, e.g. `2024-01-01T18:00:00`). |
| `vehicles` | Array[Vehicle] | List of available vehicles. |
| `visits` | Array[Visit] | List of locations to visit. |

## Vehicle

| Field | Type | Description |
|---|---|---|
| `id` | String | Unique identifier for the vehicle. |
| `capacity` | Integer | Maximum capacity of the vehicle. |
| `homeLocation` | `[number, number]` | Starting location [latitude, longitude]. |
| `departureTime` | String | Departure time from home location (ISO-8601). |

## Visit

| Field | Type | Description |
|---|---|---|
| `id` | String | Unique identifier for the visit. |
| `name` | String | Human-readable name of the visit. |
| `location` | `[number, number]` | Location [latitude, longitude] of the visit. |
| `demand` | Integer | Capacity required for this visit. |
| `minStartTime` | String | Earliest time service can start (ISO-8601). |
| `maxEndTime` | String | Latest time service can finish (ISO-8601). |
| `serviceDuration` | String or Number | Duration of the service. Recommended: ISO-8601 Duration string (e.g. `"PT30M"` for 30 minutes). |

## Example JSON

```json
{
  "name": "Demo Plan",
  "southWestCorner": [40.7, -74.0],
  "northEastCorner": [40.8, -73.9],
  "startDateTime": "2024-01-01T08:00:00",
  "endDateTime": "2024-01-01T18:00:00",
  "vehicles": [
    {
      "id": "1",
      "capacity": 100,
      "homeLocation": [40.75, -73.99],
      "departureTime": "2024-01-01T08:00:00"
    }
  ],
  "visits": [
    {
      "id": "101",
      "name": "Visit A",
      "location": [40.76, -73.98],
      "demand": 10,
      "minStartTime": "2024-01-01T09:00:00",
      "maxEndTime": "2024-01-01T11:00:00",
      "serviceDuration": "PT30M"
    }
  ]
}
```

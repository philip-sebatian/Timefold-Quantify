Objective
Introduce an export functionality to generate the optimized routing output as an Excel file (.xlsx) with a structured, row-level representation of routes, while preserving existing map-based visualization and workflows.

Instructions
Parse and understand the existing system:
UI (map, interactions, controls)
Backend (data models, APIs)
Optimization output structure
Identify where the final optimized solution is constructed and accessible.
Validate all assumptions before implementation.

Key Requirements
1. Export Functionality
Add an option to export the optimization result to an Excel file (.xlsx).
The export must include the following fields per row:
Origin (Station name)
Destination (Visit name)
Priority (order of visit in route)
Previous Stop (previous visit name)
Next Stop (next visit name)
Arrival Time (time at which the vehicle arrives at the current visit)
Departure Time (time at which the vehicle departs from the current visit)
2. Data Integrity & Mapping
Ensure correct sequencing of visits per route.
Accurately derive:
Previous and next stops based on optimized route order
Arrival and departure times from solver output
Maintain consistency with what is displayed on the map.
3. UI Integration
Add export option (e.g., button/action) within the existing UI flow.
Follow strict constraints:
No redesign
Reuse existing components and patterns
Keep interaction consistent with current design
4. Variable Name Consistency (Critical)
Do not assume correctness of variable names.
Treat codebase variable names as the source of truth.
If sheet/input/export field names differ from code:
Align output fields with code variables
Do NOT modify code variable names
If ambiguity exists:
Pause and ask for clarification
Do not hallucinate variable names
5. Stability Constraints
Do not break:
Existing APIs
Map visualization
Optimization logic
Ensure backward compatibility and no regression

Expected Output
Functional Excel export feature (.xlsx) integrated into the UI
File containing correctly structured and ordered route data with all required fields
Accurate reflection of the optimized solution as seen in the map
Minimal, clean and well-contained code changes
Inline comments where logic is added or assumptions are validated

Approach Guidelines
Analyze first, modify second
Trace the data flow of optimization output before implementing export
Keep changes minimal, controlled and reversible
Preserve all existing behavior
Validate each layer independently:
Data extraction
Transformation to tabular format
File generation
UI trigger
Prioritize correctness and stability over assumptions

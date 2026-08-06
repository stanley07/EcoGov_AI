import type { PrototypeRecord } from "./types.js";

export const prototypeAudits: PrototypeRecord[] = [
  {
    id: "AUD-P-104",
    facility: "Awka Industrial Cluster",
    lga: "Awka South",
    status: "Under review",
    date: "2026-08-04",
    detail: "Annual environmental audit",
  },
  {
    id: "AUD-P-103",
    facility: "Onitsha Materials Depot",
    lga: "Onitsha North",
    status: "Corrective action",
    date: "2026-07-28",
    detail: "Waste and effluent review",
  },
];

export const prototypeIncidents: PrototypeRecord[] = [
  {
    id: "INC-P-208",
    facility: "Public report",
    lga: "Onitsha North",
    status: "Investigating",
    date: "2026-08-05",
    detail: "Illegal Dumping · High severity",
  },
  {
    id: "INC-P-207",
    facility: "Public report",
    lga: "Awka South",
    status: "Assigned",
    date: "2026-08-03",
    detail: "Open Burning · Medium severity",
  },
];

export const prototypePermits: PrototypeRecord[] = [
  {
    id: "PER-P-031",
    facility: "Awka Industrial Cluster",
    lga: "Awka South",
    status: "Active",
    date: "2026-12-15",
    detail: "Waste handling permit",
  },
  {
    id: "PER-P-030",
    facility: "Nnewi Fabrication Works",
    lga: "Nnewi North",
    status: "Renewal due",
    date: "2026-09-02",
    detail: "Air emissions permit",
  },
];

export const prototypeInspections: PrototypeRecord[] = [
  {
    id: "INS-P-412",
    facility: "Awka Industrial Cluster",
    lga: "Awka South",
    status: "Conduct inspection",
    date: "2026-08-06",
    detail: "Assigned to Field Inspector",
  },
  {
    id: "INS-P-411",
    facility: "Onitsha Materials Depot",
    lga: "Onitsha North",
    status: "Supervisor review",
    date: "2026-08-05",
    detail: "High-risk follow-up",
  },
];

export const inspectionSteps = [
  "Assign Inspection",
  "Conduct Inspection",
  "Complete Checklist",
  "Photographs",
  "GPS",
  "Observations",
  "Risk Assessment",
  "Compliance Rating",
  "Recommendations",
  "Supervisor Review",
  "Close Inspection",
];

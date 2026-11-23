import assert from "node:assert/strict";
import test from "node:test";
import { readableHours, workshopIdentity } from "../shared/workshopIdentity.js";

test("documentos mostram intervalos agrupados e podem ocultar o expediente", () => {
  const weekdays = [1, 2, 3, 4, 5].map(day => ({
    day, closed: false, open: "08:00", close: "18:00", break_start: "11:30", break_end: "13:30",
  }));
  const business_hours = [
    { day: 0, closed: true, open: "", close: "", break_start: "", break_end: "" },
    ...weekdays,
    { day: 6, closed: false, open: "09:00", close: "12:00", break_start: "", break_end: "" },
  ];
  const shop = workshopIdentity({ business_hours });
  assert.deepEqual(readableHours(shop), ["seg a sex das 8:00 às 11:30 e das 13:30 às 18:00", "sáb das 9:00 às 12:00"]);
  const hidden = workshopIdentity({ profile_data: JSON.stringify({ business_hours, show_document_hours: false }) });
  assert.deepEqual(readableHours(hidden), []);
  assert.deepEqual(hidden.business_hours, business_hours);
});

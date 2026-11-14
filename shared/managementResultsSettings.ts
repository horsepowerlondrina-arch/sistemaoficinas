export type ManagementResultsSettings = {
  hourly_rate: number; // cents per equivalent hour
  weekly_capacity: number;
  yellow_hours: number;
  green_hours: number;
  goals: number[]; // cents for an original 15→14 cycle
};

export const defaultManagementResultsSettings: ManagementResultsSettings = {
  hourly_rate: 17000,
  weekly_capacity: 80,
  yellow_hours: 48,
  green_hours: 52,
  goals: [4000000, 4500000, 6000000],
};

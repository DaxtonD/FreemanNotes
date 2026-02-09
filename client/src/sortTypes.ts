export type SortKey = 'default' | 'createdAt' | 'updatedAt' | 'title' | 'reminderDueAt';
export type SortDir = 'asc' | 'desc';

export type SmartFilterKey =
  | 'none'
  | 'archive'
  | 'trash'
  | 'dueSoon'
  | 'leastAccessed'
  | 'mostEdited'
  | 'atRisk'
  | 'remindersAll'
  | 'remindersToday'
  | 'remindersThisWeek'
  | 'remindersNextWeek'
  | 'remindersNextMonth';
export type GroupByKey = 'none' | 'week' | 'month';

export type SortConfig = {
  sortKey: SortKey;
  sortDir: SortDir;
  smartFilter: SmartFilterKey;
  groupBy: GroupByKey;
};

export const DEFAULT_SORT_CONFIG: SortConfig = {
  sortKey: 'default',
  sortDir: 'desc',
  smartFilter: 'none',
  groupBy: 'none',
};

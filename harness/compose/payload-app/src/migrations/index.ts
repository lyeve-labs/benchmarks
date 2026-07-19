import * as migration_20260719_133617_initial from './20260719_133617_initial';

export const migrations = [
  {
    up: migration_20260719_133617_initial.up,
    down: migration_20260719_133617_initial.down,
    name: '20260719_133617_initial'
  },
];

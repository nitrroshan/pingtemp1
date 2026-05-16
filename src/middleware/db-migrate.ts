import { exec } from 'child_process';

export const runMigrations = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    exec('psql -U $DB_USER -d $DB_NAME -f migrations/001-create-users-table.sql', (error, stdout, stderr) => {
      if (error) {
        console.error('Error running user table migration:', stderr);
        reject(error);
      } else {
        console.log('User table migration applied successfully:', stdout);
        exec('psql -U $DB_USER -d $DB_NAME -f migrations/002-create-notes-table.sql', (error, stdout, stderr) => {
          if (error) {
            console.error('Error running notes table migration:', stderr);
            reject(error);
          } else {
            console.log('Notes table migration applied successfully:', stdout);
            resolve();
          }
        });
      }
    });
  });
};
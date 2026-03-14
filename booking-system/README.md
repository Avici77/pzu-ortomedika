# Booking System MVP (Custom)

This is a standalone custom booking system for PZU Ortomedika.

## Includes
- Patient booking page: `/`
- Admin page for doctors/schedule: `/admin`
- API + SQLite database
- Slot conflict prevention (booked/confirmed slots are hidden)
- Doctor weekly availability and manual date blocks

## Run locally
1. Install dependencies:
   - `npm install`
2. Start server:
   - Set admin credentials (required):
     - `export ADMIN_USERNAME="admin"`
     - `export ADMIN_PASSWORD="your-strong-password"`
   - `npm run dev`
   - or live-reload mode (auto restart + auto browser refresh): `npm run dev:live`
3. Open:
   - `http://localhost:4000` (patient)
   - `http://localhost:4000/admin` (doctor/admin, protected)
   - live-reload URL: `http://127.0.0.1:4001`

## Production URLs
- Main site: `https://pzuortomedika.mk/`
- Booking page: `https://pzuortomedika.mk/booking-system/public/`
- Admin page: `https://pzuortomedika.mk/booking-system/public/admin.html`

## Notes
- This MVP includes basic admin login with cookie session.
- For production, use strong credentials via environment variables.
- Database file is `data.db` in this folder.

## Backup and restore
- Create backup:
  - `npm run backup:db`
  - backup files are stored in `backups/`.
- Daily backup + retention cleanup (default keep 14 days):
   - `npm run backup:daily`
   - optional retention override: `RETENTION_DAYS=30 npm run backup:daily`
- Restore backup:
  - stop the server first
  - `npm run restore:db -- backups/data-YYYYMMDD-HHMMSS.db`

### Cron (daily at 02:30, keep 14 days)
- Add cron job:
   - `(crontab -l 2>/dev/null; echo "30 2 * * * cd /Users/avici/Desktop/pzu-ortomedika-main/booking-system && npm run backup:daily >> /Users/avici/Desktop/pzu-ortomedika-main/booking-system/backups/cron.log 2>&1 # booking-system-backup") | crontab -`
- Verify cron entry:
   - `crontab -l | grep booking-system-backup`

### Restore drill (recommended monthly)
1. stop service (`pm2 stop booking-system`)
2. restore latest backup:
    - `LATEST=$(ls -t backups/data-*.db | head -n 1)`
    - `npm run restore:db -- "$LATEST"`
3. start service (`pm2 start booking-system`)
4. validate app and admin login

## Production process (PM2)
1. Install PM2 globally if needed:
   - `npm install -g pm2`
2. Set required environment variables:
   - `export ADMIN_USERNAME="admin"`
   - `export ADMIN_PASSWORD="your-strong-password"`
   - `export NODE_ENV="production"`
3. Start service:
   - `npm run pm2:start`
4. Useful commands:
   - `npm run pm2:logs`
   - `npm run pm2:restart`

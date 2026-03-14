const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "data.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialty TEXT,
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS doctor_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  FOREIGN KEY(doctor_id) REFERENCES doctors(id)
);

CREATE TABLE IF NOT EXISTS doctor_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  reason TEXT,
  FOREIGN KEY(doctor_id) REFERENCES doctors(id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  patient_name TEXT NOT NULL,
  patient_email TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  service_type TEXT,
  notes TEXT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(doctor_id) REFERENCES doctors(id)
);
`);

const doctorsCount = db.prepare("SELECT COUNT(*) as c FROM doctors").get().c;
if (doctorsCount === 0) {
  const insertDoctor = db.prepare(
    "INSERT INTO doctors(name, specialty, slot_minutes, active) VALUES (?, ?, ?, 1)"
  );
  const insertAvailability = db.prepare(
    "INSERT INTO doctor_availability(doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)"
  );

  const dr1 = insertDoctor.run("Д-р Ортомедика 1", "Ортопедија", 30).lastInsertRowid;
  const dr2 = insertDoctor.run("Д-р Ортомедика 2", "Ортопедија", 30).lastInsertRowid;

  [1, 4].forEach((dow) => {
    insertAvailability.run(dr1, dow, "12:00", "20:00");
    insertAvailability.run(dr2, dow, "12:00", "20:00");
  });
  [2, 3, 5].forEach((dow) => {
    insertAvailability.run(dr1, dow, "08:00", "16:00");
    insertAvailability.run(dr2, dow, "08:00", "16:00");
  });
}

module.exports = db;

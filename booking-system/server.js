const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || (IS_PRODUCTION ? "" : "Noli");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : "Danilo");
const MAX_APPOINTMENTS_PER_SLOT = 2;
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const SESSION_COOKIE = "admin_session";
const BABY_SERVICE = "преглед за бебиња до 6 месеци";
const BABY_SERVICE_ALLOWED_DAYS = new Set([1, 4]); // Monday, Thursday
const adminSessions = new Map();

if (IS_PRODUCTION && (!ADMIN_USERNAME || !ADMIN_PASSWORD)) {
  console.error("Missing required env vars: ADMIN_USERNAME and ADMIN_PASSWORD");
  process.exit(1);
}

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 7;
const ADMIN_API_MAX_REQUESTS = 300;
const BOOKING_API_MAX_REQUESTS = 80;

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce((acc, pair) => {
    const index = pair.indexOf("=");
    if (index === -1) return acc;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = adminSessions.get(token);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return null;
  }

  return session;
}

function createAdminSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const session = {
    token,
    username: String(username || ADMIN_USERNAME),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  adminSessions.set(token, session);
  return session;
}

function clearSessionByRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    adminSessions.delete(token);
  }
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: IS_PRODUCTION ? "strict" : "lax",
    secure: IS_PRODUCTION,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: IS_PRODUCTION ? "strict" : "lax",
    secure: IS_PRODUCTION,
    path: "/",
  });
}

function requireAdminPage(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.redirect("/admin/login");
  }
  req.adminSession = session;
  return next();
}

function requireAdminApi(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Неавторизиран пристап" });
  }
  req.adminSession = session;
  return next();
}

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:4000",
  "http://localhost:4000",
  "http://127.0.0.1:4001",
  "http://localhost:4001",
  "https://pzuortomedika.mk",
  "https://www.pzuortomedika.mk",
  "https://pzu-ortomedika-booking.onrender.com",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  })
);
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "10kb" }));

const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Премногу обиди за најава. Обидете се повторно за 15 минути." },
});

const adminApiLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: ADMIN_API_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Премногу барања. Обидете се повторно за кратко." },
});

const bookingLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: BOOKING_API_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Премногу обиди за закажување. Обидете се повторно за кратко." },
});

function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

app.use((req, res, next) => {
  if (req.path === "/admin.html") {
    return res.redirect("/admin");
  }
  if (req.path === "/admin-login.html") {
    return res.redirect("/admin/login");
  }
  return next();
});

app.use(express.static(path.join(__dirname, "public")));

function toMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return (hours * 60) + minutes;
}

function toTime(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function validateDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function getDayOfWeek(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.getDay();
}

function validateServiceDayRule(date, serviceType) {
  const normalizedService = String(serviceType || "").trim().toLowerCase();
  const babyServiceNormalized = BABY_SERVICE.toLowerCase();

  if (normalizedService !== babyServiceNormalized) {
    return null;
  }

  const dayOfWeek = getDayOfWeek(date);
  if (!BABY_SERVICE_ALLOWED_DAYS.has(dayOfWeek)) {
    return "Услугата „преглед за бебиња до 6 месеци“ е достапна само во Понеделник и Четврток.";
  }

  return null;
}

function parseIsoDateUTC(dateStr) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDateUTC(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatIsoDateLocal(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateToMk(dateStr) {
  const [year, month, day] = String(dateStr || "").split("-");
  if (!year || !month || !day) return String(dateStr || "");
  return `${day}.${month}.${year}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const escaped = normalized.replace(/"/g, '""');
  return `"${escaped}"`;
}

function statusLabelMk(status) {
  if (status === "booked") return "Закажан";
  if (status === "confirmed") return "Потврден";
  if (status === "cancelled") return "Откажан";
  if (status === "completed") return "Завршен";
  return status || "";
}

function getAvailableSlots(doctorId, date) {
  const allSlots = getSlotsWithAvailability(doctorId, date);
  return allSlots
    .filter((slot) => slot.available)
    .map((slot) => ({ start: slot.start, end: slot.end }));
}

function getSlotsWithAvailability(doctorId, date) {
  const doctor = db.prepare("SELECT * FROM doctors WHERE id = ? AND active = 1").get(doctorId);
  if (!doctor) return [];

  const dayOfWeek = getDayOfWeek(date);
  const availability = db
    .prepare(
      "SELECT start_time, end_time FROM doctor_availability WHERE doctor_id = ? AND day_of_week = ? ORDER BY start_time"
    )
    .all(doctorId, dayOfWeek);

  if (!availability.length) return [];

  const blocks = db
    .prepare(
      "SELECT start_time, end_time FROM doctor_blocks WHERE doctor_id = ? AND date = ?"
    )
    .all(doctorId, date)
    .map((block) => ({ start: toMinutes(block.start_time), end: toMinutes(block.end_time) }));

  const occupied = db
    .prepare(
      "SELECT start_time, end_time FROM appointments WHERE doctor_id = ? AND date = ? AND status IN ('booked', 'confirmed')"
    )
    .all(doctorId, date)
    .map((item) => ({ start: toMinutes(item.start_time), end: toMinutes(item.end_time) }));
  const slots = [];

  availability.forEach((window) => {
    const start = toMinutes(window.start_time);
    const end = toMinutes(window.end_time);

    for (let cursor = start; cursor + doctor.slot_minutes <= end; cursor += doctor.slot_minutes) {
      const slotStart = cursor;
      const slotEnd = cursor + doctor.slot_minutes;
      const hasBlockOverlap = blocks.some((item) => !(slotEnd <= item.start || slotStart >= item.end));
      const activeOverlapCount = occupied.filter(
        (item) => !(slotEnd <= item.start || slotStart >= item.end)
      ).length;

      const remaining = hasBlockOverlap
        ? 0
        : Math.max(0, MAX_APPOINTMENTS_PER_SLOT - activeOverlapCount);

      slots.push({
        start: toTime(slotStart),
        end: toTime(slotEnd),
        available: remaining > 0,
        remaining,
        capacity: MAX_APPOINTMENTS_PER_SLOT,
        status: hasBlockOverlap ? "blocked" : (remaining > 0 ? "available" : "full"),
      });
    }
  });

  return slots;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/doctors", (_req, res) => {
  const doctors = db
    .prepare("SELECT id, name, specialty, slot_minutes FROM doctors WHERE active = 1 ORDER BY id")
    .all();
  res.json(doctors);
});

app.get("/api/slots", (req, res) => {
  const doctorId = Number(req.query.doctorId);
  const date = req.query.date;
  const serviceType = String(req.query.serviceType || "");

  if (!doctorId || !validateDate(date)) {
    return res.status(400).json({ error: "doctorId и валиден date се задолжителни" });
  }

  const serviceRuleError = validateServiceDayRule(date, serviceType);
  if (serviceRuleError) {
    return res.json({ doctorId, date, slots: [], allSlots: [], message: serviceRuleError });
  }

  const allSlots = getSlotsWithAvailability(doctorId, date);
  const slots = allSlots
    .filter((slot) => slot.available)
    .map((slot) => ({ start: slot.start, end: slot.end }));
  return res.json({ doctorId, date, slots, allSlots });
});

app.get("/api/admin/auth/me", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, username: ADMIN_USERNAME });
});

app.post("/api/admin/auth/login", authLimiter, noStore, (req, res) => {
  const { username, password } = req.body || {};
  const normalizedUser = String(username || "").trim();
  const normalizedPass = String(password || "");

  if (normalizedUser !== ADMIN_USERNAME || normalizedPass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Погрешно корисничко име или лозинка" });
  }

  const session = createAdminSession(normalizedUser);
  setSessionCookie(res, session.token);
  return res.json({ ok: true });
});

app.post("/api/admin/auth/logout", (req, res) => {
  clearSessionByRequest(req);
  clearSessionCookie(res);
  return res.json({ ok: true });
});

app.use("/api/appointments", bookingLimiter);
app.use("/api/admin", adminApiLimiter);
app.use("/api/admin", requireAdminApi);

app.post("/api/appointments", (req, res) => {
  const {
    doctorId,
    patientName,
    patientEmail,
    patientPhone,
    serviceType,
    notes,
    date,
    startTime,
  } = req.body;

  if (!doctorId || !patientName || !patientEmail || !patientPhone || !date || !startTime) {
    return res.status(400).json({ error: "Недостасуваат задолжителни полиња" });
  }
  if (!validateDate(date)) {
    return res.status(400).json({ error: "Невалиден датум" });
  }

  const serviceRuleError = validateServiceDayRule(date, serviceType);
  if (serviceRuleError) {
    return res.status(400).json({ error: serviceRuleError });
  }

  const doctor = db.prepare("SELECT * FROM doctors WHERE id = ? AND active = 1").get(doctorId);
  if (!doctor) {
    return res.status(404).json({ error: "Докторот не е пронајден" });
  }

  const available = getAvailableSlots(Number(doctorId), date);
  const selected = available.find((slot) => slot.start === startTime);
  if (!selected) {
    return res.status(409).json({ error: "Терминот повеќе не е достапен" });
  }

  const insert = db.prepare(
    `INSERT INTO appointments(
      doctor_id, patient_name, patient_email, patient_phone, service_type, notes, date, start_time, end_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked')`
  );

  const result = insert.run(
    Number(doctorId),
    String(patientName).trim(),
    String(patientEmail).trim(),
    String(patientPhone).trim(),
    serviceType ? String(serviceType).trim() : "",
    notes ? String(notes).trim() : "",
    date,
    selected.start,
    selected.end
  );

  return res.status(201).json({
    id: result.lastInsertRowid,
    message: "Терминот е успешно закажан",
  });
});

app.post("/api/admin/appointments", (req, res) => {
  const {
    doctorId,
    patientName,
    patientEmail,
    patientPhone,
    serviceType,
    notes,
    date,
    startTime,
  } = req.body || {};

  if (!doctorId || !patientName || !patientPhone || !date || !startTime) {
    return res.status(400).json({ error: "Недостасуваат задолжителни полиња" });
  }
  if (!validateDate(date)) {
    return res.status(400).json({ error: "Невалиден датум" });
  }

  const finalStatus = "booked";

  const doctor = db.prepare("SELECT * FROM doctors WHERE id = ? AND active = 1").get(doctorId);
  if (!doctor) {
    return res.status(404).json({ error: "Докторот не е пронајден" });
  }

  const available = getAvailableSlots(Number(doctorId), date);
  const selected = available.find((slot) => slot.start === startTime);
  if (!selected) {
    return res.status(409).json({ error: "Терминот повеќе не е достапен" });
  }

  const insert = db.prepare(
    `INSERT INTO appointments(
      doctor_id, patient_name, patient_email, patient_phone, service_type, notes, date, start_time, end_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const result = insert.run(
    Number(doctorId),
    String(patientName).trim(),
    patientEmail ? String(patientEmail).trim() : "",
    String(patientPhone).trim(),
    serviceType ? String(serviceType).trim() : "",
    notes ? String(notes).trim() : "",
    date,
    selected.start,
    selected.end,
    finalStatus
  );

  return res.status(201).json({
    id: result.lastInsertRowid,
    message: "Терминот е успешно додаден",
  });
});

app.get("/api/admin/appointments", (req, res) => {
  const doctorId = Number(req.query.doctorId || 0);
  const from = req.query.from;
  const to = req.query.to;

  let sql = `
    SELECT a.id, a.date, a.start_time, a.end_time, a.status,
           a.patient_name, a.patient_email, a.patient_phone, a.service_type, a.notes,
           d.name AS doctor_name
    FROM appointments a
    JOIN doctors d ON d.id = a.doctor_id
    WHERE 1=1
  `;
  const params = [];

  if (doctorId) {
    sql += " AND a.doctor_id = ?";
    params.push(doctorId);
  }
  if (from && validateDate(from)) {
    sql += " AND a.date >= ?";
    params.push(from);
  }
  if (to && validateDate(to)) {
    sql += " AND a.date <= ?";
    params.push(to);
  }

  sql += " ORDER BY a.date ASC, a.start_time ASC";

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.get("/api/admin/appointments/export.csv", (req, res) => {
  const doctorId = Number(req.query.doctorId || 0);
  const from = req.query.from;
  const to = req.query.to;

  let sql = `
    SELECT a.date, a.start_time, a.end_time, a.status,
           a.patient_name, a.patient_email, a.patient_phone, a.service_type, a.notes,
           d.name AS doctor_name
    FROM appointments a
    JOIN doctors d ON d.id = a.doctor_id
    WHERE 1=1
  `;
  const params = [];

  if (doctorId) {
    sql += " AND a.doctor_id = ?";
    params.push(doctorId);
  }
  if (from && validateDate(from)) {
    sql += " AND a.date >= ?";
    params.push(from);
  }
  if (to && validateDate(to)) {
    sql += " AND a.date <= ?";
    params.push(to);
  }

  sql += " ORDER BY a.date ASC, a.start_time ASC";

  const rows = db.prepare(sql).all(...params);
  const header = [
    "Датум",
    "Почеток",
    "Крај",
    "Статус",
    "Пациент",
    "Телефон",
    "Е-пошта",
    "Услуга",
    "Забелешка",
  ];

  const body = rows.map((row) => [
    formatDateToMk(row.date),
    row.start_time,
    row.end_time,
    statusLabelMk(row.status),
    row.patient_name,
    row.patient_phone,
    row.patient_email,
    row.service_type,
    row.notes,
  ]);

  const csvLines = [header, ...body].map((line) => line.map(csvEscape).join(","));
  const csv = `\uFEFF${csvLines.join("\r\n")}`;
  const dateTag = formatIsoDateUTC(new Date());

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="termini-${dateTag}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  return res.send(csv);
});

app.patch("/api/admin/appointments/:id", (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const allowed = ["booked", "confirmed", "cancelled", "completed"];

  const existing = db
    .prepare(
      `SELECT id, doctor_id, status, date, start_time, end_time,
              patient_name, patient_email, patient_phone, service_type, notes
       FROM appointments
       WHERE id = ?`
    )
    .get(id);

  if (!existing) {
    return res.status(404).json({ error: "Терминот не е пронајден" });
  }

  const hasOnlyStatusUpdate =
    Object.keys(body).length === 1 &&
    Object.prototype.hasOwnProperty.call(body, "status");

  if (hasOnlyStatusUpdate) {
    const nextStatus = String(body.status || "").trim();
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: "Невалиден статус" });
    }

    const result = db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(nextStatus, id);
    if (!result.changes) {
      return res.status(404).json({ error: "Терминот не е пронајден" });
    }
    return res.json({ ok: true });
  }

  const doctorId = Number(existing.doctor_id);
  const patientName = Object.prototype.hasOwnProperty.call(body, "patientName")
    ? String(body.patientName || "").trim()
    : String(existing.patient_name || "").trim();
  const patientEmail = Object.prototype.hasOwnProperty.call(body, "patientEmail")
    ? String(body.patientEmail || "").trim()
    : String(existing.patient_email || "").trim();
  const patientPhone = Object.prototype.hasOwnProperty.call(body, "patientPhone")
    ? String(body.patientPhone || "").trim()
    : String(existing.patient_phone || "").trim();
  const serviceType = Object.prototype.hasOwnProperty.call(body, "serviceType")
    ? String(body.serviceType || "").trim()
    : String(existing.service_type || "").trim();
  const notes = Object.prototype.hasOwnProperty.call(body, "notes")
    ? String(body.notes || "").trim()
    : String(existing.notes || "").trim();
  const date = Object.prototype.hasOwnProperty.call(body, "date")
    ? String(body.date || "").trim()
    : String(existing.date || "").trim();
  const startTime = Object.prototype.hasOwnProperty.call(body, "startTime")
    ? String(body.startTime || "").trim()
    : String(existing.start_time || "").trim();
  const nextStatus = Object.prototype.hasOwnProperty.call(body, "status")
    ? String(body.status || "").trim()
    : String(existing.status || "booked").trim();

  if (!patientName || !patientPhone || !date || !startTime) {
    return res.status(400).json({ error: "Недостасуваат задолжителни полиња" });
  }
  if (!validateDate(date)) {
    return res.status(400).json({ error: "Невалиден датум" });
  }
  if (!allowed.includes(nextStatus)) {
    return res.status(400).json({ error: "Невалиден статус" });
  }

  const serviceRuleError = validateServiceDayRule(date, serviceType);
  if (serviceRuleError) {
    return res.status(400).json({ error: serviceRuleError });
  }

  const doctor = db.prepare("SELECT id FROM doctors WHERE id = ? AND active = 1").get(doctorId);
  if (!doctor) {
    return res.status(404).json({ error: "Докторот не е пронајден" });
  }

  const sameSlot = existing.date === date && existing.start_time === startTime;
  const allSlots = getSlotsWithAvailability(doctorId, date);
  const selected = allSlots.find((slot) => slot.start === startTime);

  if (!sameSlot) {
    if (!selected || !selected.available) {
      return res.status(409).json({ error: "Терминот повеќе не е достапен" });
    }
  }

  const endTime = sameSlot
    ? String(existing.end_time || "")
    : String((selected && selected.end) || "");

  if (!endTime) {
    return res.status(409).json({ error: "Терминот повеќе не е достапен" });
  }

  const result = db.prepare(
    `UPDATE appointments
     SET patient_name = ?,
         patient_email = ?,
         patient_phone = ?,
         service_type = ?,
         notes = ?,
         date = ?,
         start_time = ?,
         end_time = ?,
         status = ?
     WHERE id = ?`
  ).run(
    patientName,
    patientEmail,
    patientPhone,
    serviceType,
    notes,
    date,
    startTime,
    endTime,
    nextStatus,
    id
  );

  if (!result.changes) {
    return res.status(404).json({ error: "Терминот не е пронајден" });
  }

  res.json({ ok: true });
});

app.get("/api/admin/working-hours", (req, res) => {
  const doctorId = Number(req.query.doctorId);
  const date = String(req.query.date || "");

  if (!doctorId || !validateDate(date)) {
    return res.status(400).json({ error: "doctorId и валиден date се задолжителни" });
  }

  const dayOfWeek = getDayOfWeek(date);
  const windows = db
    .prepare(
      "SELECT start_time, end_time FROM doctor_availability WHERE doctor_id = ? AND day_of_week = ? ORDER BY start_time"
    )
    .all(doctorId, dayOfWeek);

  if (!windows.length) {
    return res.json({ date, dayOfWeek, windows: [], earliest: null, latest: null });
  }

  const earliest = windows[0].start_time;
  const latest = windows[windows.length - 1].end_time;
  return res.json({ date, dayOfWeek, windows, earliest, latest });
});

app.get("/api/admin/availability", (req, res) => {
  const doctorId = Number(req.query.doctorId);
  if (!doctorId) {
    return res.status(400).json({ error: "doctorId е задолжителен" });
  }

  const rows = db
    .prepare(
      "SELECT id, day_of_week, start_time, end_time FROM doctor_availability WHERE doctor_id = ? ORDER BY day_of_week, start_time"
    )
    .all(doctorId);

  res.json(rows);
});

app.post("/api/admin/availability", (req, res) => {
  const { doctorId, dayOfWeek, startTime, endTime } = req.body;
  if (
    !doctorId ||
    dayOfWeek === undefined ||
    dayOfWeek === null ||
    !startTime ||
    !endTime ||
    Number(dayOfWeek) < 0 ||
    Number(dayOfWeek) > 6
  ) {
    return res.status(400).json({ error: "Невалидни податоци за достапност" });
  }

  if (toMinutes(startTime) >= toMinutes(endTime)) {
    return res.status(400).json({ error: "Почетокот мора да е пред крајот" });
  }

  const result = db
    .prepare(
      "INSERT INTO doctor_availability(doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)"
    )
    .run(Number(doctorId), Number(dayOfWeek), startTime, endTime);

  res.status(201).json({ id: result.lastInsertRowid });
});

app.delete("/api/admin/availability/:id", (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM doctor_availability WHERE id = ?").run(id);
  if (!result.changes) {
    return res.status(404).json({ error: "Записот не е пронајден" });
  }
  res.json({ ok: true });
});

app.get("/api/admin/blocks", (req, res) => {
  const doctorId = Number(req.query.doctorId);
  if (!doctorId) {
    return res.status(400).json({ error: "doctorId е задолжителен" });
  }

  // Auto-clean historical blocks so admin list only keeps current/future dates.
  const todayLocal = formatIsoDateLocal();
  db.prepare("DELETE FROM doctor_blocks WHERE doctor_id = ? AND date < ?").run(doctorId, todayLocal);

  const rows = db
    .prepare(
      "SELECT id, date, start_time, end_time, reason FROM doctor_blocks WHERE doctor_id = ? ORDER BY date, start_time"
    )
    .all(doctorId);
  res.json(rows);
});

app.post("/api/admin/blocks", (req, res) => {
  const { doctorId, date, startTime, endTime, reason } = req.body;
  if (!doctorId || !validateDate(date) || !startTime || !endTime) {
    return res.status(400).json({ error: "Невалидни податоци за блокада" });
  }

  if (toMinutes(startTime) >= toMinutes(endTime)) {
    return res.status(400).json({ error: "Почетокот мора да е пред крајот" });
  }

  const result = db
    .prepare(
      "INSERT INTO doctor_blocks(doctor_id, date, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?)"
    )
    .run(Number(doctorId), date, startTime, endTime, reason ? String(reason) : "");

  res.status(201).json({ id: result.lastInsertRowid });
});

app.post("/api/admin/blocks/range", (req, res) => {
  const {
    doctorId,
    fromDate,
    toDate,
    startTime,
    endTime,
    reason,
    weekdaysOnly,
    fullDay,
  } = req.body || {};

  const isFullDay = Boolean(fullDay);

  if (!doctorId || !validateDate(fromDate) || !validateDate(toDate) || (!isFullDay && (!startTime || !endTime))) {
    return res.status(400).json({ error: "Невалидни податоци за периодска блокада" });
  }

  if (!isFullDay && toMinutes(startTime) >= toMinutes(endTime)) {
    return res.status(400).json({ error: "Почетокот мора да е пред крајот" });
  }

  const from = parseIsoDateUTC(fromDate);
  const to = parseIsoDateUTC(toDate);
  if (from > to) {
    return res.status(400).json({ error: "Почетниот датум мора да е пред крајниот" });
  }

  const dayDiff = Math.floor((to - from) / (24 * 60 * 60 * 1000));
  if (dayDiff > 366) {
    return res.status(400).json({ error: "Периодот е преголем (максимум 367 дена)" });
  }

  const existsStmt = db.prepare(
    "SELECT id FROM doctor_blocks WHERE doctor_id = ? AND date = ? AND start_time = ? AND end_time = ? LIMIT 1"
  );
  const insertStmt = db.prepare(
    "INSERT INTO doctor_blocks(doctor_id, date, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?)"
  );
  const availabilityByDayStmt = db.prepare(
    "SELECT start_time, end_time FROM doctor_availability WHERE doctor_id = ? AND day_of_week = ? ORDER BY start_time"
  );

  const normalizedReason = reason ? String(reason) : "";
  const isWeekdaysOnly = Boolean(weekdaysOnly);

  let inserted = 0;
  let skipped = 0;
  const slotStartMinutes = isFullDay ? null : toMinutes(startTime);
  const slotEndMinutes = isFullDay ? null : toMinutes(endTime);

  const availabilityCache = new Map();
  const getDayWindows = (dayOfWeek) => {
    if (!availabilityCache.has(dayOfWeek)) {
      const windows = availabilityByDayStmt
        .all(Number(doctorId), dayOfWeek)
        .map((window) => ({
          start: toMinutes(window.start_time),
          end: toMinutes(window.end_time),
          startTime: window.start_time,
          endTime: window.end_time,
        }));
      availabilityCache.set(dayOfWeek, windows);
    }
    return availabilityCache.get(dayOfWeek);
  };

  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dayOfWeek = cursor.getUTCDay();
    if (isWeekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
      continue;
    }

    const windows = getDayWindows(dayOfWeek);
    if (!windows.length) {
      continue;
    }
    if (isFullDay) {
      continue;
    }
    const fitsWorkingHours = windows.some((window) => slotStartMinutes >= window.start && slotEndMinutes <= window.end);

    if (!fitsWorkingHours) {
      return res.status(400).json({
        error: `Избраното време ${startTime}-${endTime} не е во работното време за ${formatIsoDateUTC(cursor)}.`,
      });
    }
  }

  const transaction = db.transaction(() => {
    for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const dayOfWeek = cursor.getUTCDay();
      if (isWeekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
        continue;
      }

      const windows = getDayWindows(dayOfWeek);
      if (!windows.length) {
        continue;
      }

      const date = formatIsoDateUTC(cursor);
      if (isFullDay) {
        for (const window of windows) {
          const existing = existsStmt.get(Number(doctorId), date, window.startTime, window.endTime);
          if (existing) {
            skipped += 1;
            continue;
          }

          insertStmt.run(Number(doctorId), date, window.startTime, window.endTime, normalizedReason);
          inserted += 1;
        }
        continue;
      }

      const existing = existsStmt.get(Number(doctorId), date, startTime, endTime);
      if (existing) {
        skipped += 1;
        continue;
      }

      insertStmt.run(Number(doctorId), date, startTime, endTime, normalizedReason);
      inserted += 1;
    }
  });

  transaction();

  return res.status(201).json({
    inserted,
    skipped,
    message: "Периодската блокада е обработена",
  });
});

app.delete("/api/admin/blocks/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id, doctor_id, date, start_time, end_time FROM doctor_blocks WHERE id = ?").get(id);
  const result = db.prepare("DELETE FROM doctor_blocks WHERE id = ?").run(id);
  if (!result.changes) {
    return res.status(404).json({ error: "Блокадата не е пронајдена" });
  }
  res.json({ ok: true });
});

app.get("/admin/login", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.get("/admin", requireAdminPage, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Booking system running on http://localhost:${PORT}`);
  console.log(
    `Admin cookie policy: sameSite=${IS_PRODUCTION ? "strict" : "lax"}, secure=${IS_PRODUCTION ? "true" : "false"}, env=${IS_PRODUCTION ? "production" : "development"}`
  );
});

const path = require("path");
const Database = require("better-sqlite3");

const RENDER_BASE = "https://pzu-ortomedika-booking.onrender.com";
const USERNAME = process.env.ADMIN_USERNAME || "Noli";
const PASSWORD = process.env.ADMIN_PASSWORD || "Danilo";

async function loginAndGetCookie(baseUrl) {
  const res = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Login failed on ${baseUrl}: ${res.status} ${txt}`);
  }

  const cookie = res.headers.get("set-cookie");
  if (!cookie) {
    throw new Error(`No set-cookie returned from ${baseUrl}`);
  }

  return cookie.split(";")[0];
}

async function fetchJsonWithCookie(url, cookie) {
  const res = await fetch(url, { headers: { Cookie: cookie } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Fetch failed ${url}: ${res.status} ${txt}`);
  }
  return res.json();
}

function keyOf(row) {
  return [
    String(row.doctor_name || "").trim().toLowerCase(),
    String(row.date || "").trim(),
    String(row.start_time || "").trim(),
    String(row.end_time || "").trim(),
    String(row.patient_name || "").trim().toLowerCase(),
    String(row.patient_phone || "").trim(),
  ].join("|");
}

async function main() {
  const dbPath = path.join(__dirname, "..", "data.db");
  const db = new Database(dbPath);

  const renderCookie = await loginAndGetCookie(RENDER_BASE);
  const renderRows = await fetchJsonWithCookie(`${RENDER_BASE}/api/admin/appointments`, renderCookie);

  const localDoctors = db.prepare("SELECT id, name FROM doctors").all();
  const doctorNameToId = new Map(localDoctors.map((d) => [String(d.name || "").trim().toLowerCase(), Number(d.id)]));

  const localRows = db.prepare(`
    SELECT a.date, a.start_time, a.end_time, a.patient_name, a.patient_phone, d.name AS doctor_name
    FROM appointments a
    JOIN doctors d ON d.id = a.doctor_id
  `).all();

  const localKeys = new Set(localRows.map(keyOf));
  const toInsert = [];

  for (const row of renderRows) {
    const k = keyOf(row);
    if (!localKeys.has(k)) {
      toInsert.push(row);
      localKeys.add(k);
    }
  }

  const insert = db.prepare(`
    INSERT INTO appointments(
      doctor_id, patient_name, patient_email, patient_phone, service_type, notes,
      date, start_time, end_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    let inserted = 0;
    let skippedNoDoctor = 0;

    for (const row of rows) {
      const doctorId = doctorNameToId.get(String(row.doctor_name || "").trim().toLowerCase());
      if (!doctorId) {
        skippedNoDoctor += 1;
        continue;
      }

      insert.run(
        doctorId,
        String(row.patient_name || "").trim(),
        String(row.patient_email || "").trim(),
        String(row.patient_phone || "").trim(),
        String(row.service_type || "").trim(),
        String(row.notes || "").trim(),
        String(row.date || "").trim(),
        String(row.start_time || "").trim(),
        String(row.end_time || "").trim(),
        String(row.status || "booked").trim() || "booked"
      );
      inserted += 1;
    }

    return { inserted, skippedNoDoctor };
  });

  const result = tx(toInsert);

  console.log(
    JSON.stringify(
      {
        renderTotal: renderRows.length,
        localBefore: localRows.length,
        missingFound: toInsert.length,
        inserted: result.inserted,
        skippedNoDoctor: result.skippedNoDoctor,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

const db = require("../db");

const RENDER_BASE = "https://pzu-ortomedika-booking.onrender.com";
const USERNAME = process.env.RENDER_ADMIN_USERNAME || "Noli";
const PASSWORD = process.env.RENDER_ADMIN_PASSWORD || "Danilo";

async function main() {
  const loginRes = await fetch(`${RENDER_BASE}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (!loginRes.ok) {
    const text = await loginRes.text();
    throw new Error(`Render login failed (${loginRes.status}): ${text}`);
  }

  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Render login succeeded but no session cookie was returned");
  }
  const cookie = setCookie.split(";")[0];

  const doctorsRes = await fetch(`${RENDER_BASE}/api/doctors`);
  if (!doctorsRes.ok) {
    throw new Error(`Failed to fetch doctors (${doctorsRes.status})`);
  }
  const doctors = await doctorsRes.json();

  const remoteRows = [];
  for (const d of doctors) {
    const url = `${RENDER_BASE}/api/admin/appointments?doctorId=${encodeURIComponent(d.id)}&from=2000-01-01&to=2100-12-31`;
    const res = await fetch(url, { headers: { Cookie: cookie } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed appointments fetch for doctor ${d.id} (${res.status}): ${text}`);
    }
    const rows = await res.json();
    for (const r of rows) {
      remoteRows.push({
        doctor_id: Number(r.doctor_id || d.id),
        patient_name: String(r.patient_name || "").trim(),
        patient_email: String(r.patient_email || "").trim(),
        patient_phone: String(r.patient_phone || "").trim(),
        service_type: String(r.service_type || "").trim(),
        notes: String(r.notes || "").trim(),
        date: String(r.date || "").trim(),
        start_time: String(r.start_time || "").trim(),
        end_time: String(r.end_time || "").trim(),
        status: String(r.status || "booked").trim(),
      });
    }
  }

  const allowedStatus = new Set(["booked", "confirmed", "cancelled", "completed"]);
  const insert = db.prepare(
    `INSERT INTO appointments(
      doctor_id, patient_name, patient_email, patient_phone, service_type, notes, date, start_time, end_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction((rows) => {
    db.prepare("DELETE FROM appointments").run();
    let inserted = 0;
    for (const r of rows) {
      if (!r.doctor_id || !r.patient_name || !r.patient_phone || !r.date || !r.start_time || !r.end_time) {
        continue;
      }
      const status = allowedStatus.has(r.status) ? r.status : "booked";
      insert.run(
        r.doctor_id,
        r.patient_name,
        r.patient_email,
        r.patient_phone,
        r.service_type,
        r.notes,
        r.date,
        r.start_time,
        r.end_time,
        status
      );
      inserted += 1;
    }
    return inserted;
  });

  const inserted = tx(remoteRows);
  console.log(JSON.stringify({ doctors: doctors.length, remoteAppointments: remoteRows.length, inserted }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});

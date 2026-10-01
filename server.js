import express from "express";
import cors from "cors";
import pg from "pg";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QR_FILE = path.join(__dirname, "qr-code.txt");

async function readQrCode() {
  try {
    return await fs.readFile(QR_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function saveQrCode(qrCode) {
  if (!qrCode) {
    await fs.rm(QR_FILE, {
      force: true,
    });

    return;
  }

  await fs.writeFile(
    QR_FILE,
    qrCode,
    "utf8"
  );
}
const PORT = Number(process.env.PORT || 4000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

const q = async (text, params = []) => {
  const result = await pool.query(text, params);
  return result.rows;
};

/*
 * ============================================================
 * DATE HELPERS
 * ============================================================
 */

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());

  return year + "-" + month + "-" + day;
}

function getFirstDayOfMonth(date = new Date()) {
  return formatDate(
    new Date(
      date.getFullYear(),
      date.getMonth(),
      1
    )
  );
}

function getLastDayOfMonth(date = new Date()) {
  return formatDate(
    new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0
    )
  );
}

function isValidDateString(value) {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parts = value.split("-");

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  const date = new Date(
    year,
    month - 1,
    day
  );

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function getDateRange(req) {
  const now = new Date();

  const from =
    req.query.from ||
    getFirstDayOfMonth(now);

  const to =
    req.query.to ||
    getLastDayOfMonth(now);

  if (!isValidDateString(from)) {
    throw new Error(
      "Ngày bắt đầu không hợp lệ: " + from
    );
  }

  if (!isValidDateString(to)) {
    throw new Error(
      "Ngày kết thúc không hợp lệ: " + to
    );
  }

  return {
    from,
    to,
  };
}

/*
 * ============================================================
 * DATABASE INITIALIZATION
 * ============================================================
 */

await q(`
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY,
  teacher_name TEXT NOT NULL DEFAULT 'Giáo viên',
  teacher_phone TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  bank_owner TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT 'MB Bank',
  parent_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  fee_per_lesson INTEGER NOT NULL DEFAULT 100000,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Nhận xét riêng của từng học sinh (tự động bổ sung cho database cũ)
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  teacher TEXT NOT NULL DEFAULT 'Giáo viên'
);

CREATE TABLE IF NOT EXISTS time_slots (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  subject TEXT NOT NULL,
  class_name TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  lesson_date DATE NOT NULL,
  time TEXT NOT NULL,
  subject TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','attended','absent')),
  is_extra BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(student_id, schedule_id, lesson_date)
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  lesson_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'attended',
  fee INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(student_id, lesson_id, lesson_date)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS share_links (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE
);
`);

/*
 * ============================================================
 * MIGRATION
 * ============================================================
 */

await q(`
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS lesson_id
INTEGER REFERENCES lessons(id) ON DELETE CASCADE
`);

await q(`
INSERT INTO app_settings(
  id,
  teacher_name,
  teacher_phone,
  bank_account,
  bank_owner,
  bank_name,
  parent_note
)
VALUES(
  1,
  'Giáo viên',
  '',
  '',
  '',
  'MB Bank',
  'Vui lòng thanh toán học phí đúng hạn.'
)
ON CONFLICT(id) DO NOTHING
`);

if (!(await q(`SELECT 1 FROM time_slots LIMIT 1`))[0]) {
  await q(`
    INSERT INTO time_slots(
      name,
      start_time,
      end_time,
      sort_order
    )
    VALUES
      ('Tiết 1','08:00','09:00',1),
      ('Tiết 2','09:00','10:00',2),
      ('Tiết 3','10:00','11:00',3),
      ('Tiết 4','13:30','14:30',4),
      ('Tiết 5','14:30','15:30',5),
      ('Tiết 6','15:30','16:30',6)
  `);
}

await q(`
UPDATE students
SET active = TRUE
WHERE active IS NULL
`);

/*
 * ============================================================
 * AUTO GENERATE LESSONS
 * ============================================================
 */

await q(`
INSERT INTO lessons(
  student_id,
  schedule_id,
  lesson_date,
  time,
  subject,
  class_name,
  room,
  fee,
  status,
  is_extra
)
SELECT
  s.student_id,
  s.id,
  gs.d::date,
  s.time,
  s.subject,
  s.class_name,
  s.room,
  COALESCE(st.fee_per_lesson, 0),
  'pending',
  false
FROM schedules s
JOIN students st
  ON st.id = s.student_id
CROSS JOIN LATERAL generate_series(
  CURRENT_DATE - INTERVAL '31 days',
  CURRENT_DATE + INTERVAL '31 days',
  INTERVAL '1 day'
) gs(d)
WHERE s.student_id IS NOT NULL
AND (
  (s.day='Thứ 2' AND EXTRACT(ISODOW FROM gs.d)=1) OR
  (s.day='Thứ 3' AND EXTRACT(ISODOW FROM gs.d)=2) OR
  (s.day='Thứ 4' AND EXTRACT(ISODOW FROM gs.d)=3) OR
  (s.day='Thứ 5' AND EXTRACT(ISODOW FROM gs.d)=4) OR
  (s.day='Thứ 6' AND EXTRACT(ISODOW FROM gs.d)=5) OR
  (s.day='Thứ 7' AND EXTRACT(ISODOW FROM gs.d)=6) OR
  (s.day='Chủ nhật' AND EXTRACT(ISODOW FROM gs.d)=7)
)
ON CONFLICT(
  student_id,
  schedule_id,
  lesson_date
)
DO NOTHING
`);

/*
 * ============================================================
 * EXPRESS
 * ============================================================
 */

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "5mb",
  })
);

/*
 * ============================================================
 * SELECT HELPERS
 * ============================================================
 */

const studentSelect = `
  id,
  name,
  class_name AS "className",
  phone,
  note,
  comment,
  fee_per_lesson AS "feePerLesson",
  active
`;

const scheduleSelect = `
  s.id,
  s.day,
  s.time,
  s.subject,
  s.class_name AS "className",
  s.room,
  s.student_id AS "studentId",
  st.name AS "studentName"
`;

const lessonSelect = `
  l.id,
  l.student_id AS "studentId",
  l.schedule_id AS "scheduleId",
  l.lesson_date::text AS "lessonDate",
  l.time,
  l.subject,
  l.class_name AS "className",
  l.room,
  l.fee,
  l.status,
  l.is_extra AS "isExtra",
  l.cancelled
`;

/*
 * ============================================================
 * HEALTH
 * ============================================================
 */

app.get("/api/health", async (_, res) => {
  try {
    await q("SELECT 1");

    res.json({
      success: true,
      database: "PostgreSQL",
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message,
    });
  }
});

/*
 * ============================================================
 * STUDENTS
 * ============================================================
 */

app.get("/api/students", async (_, res) => {
  res.json(
    await q(`
      SELECT ${studentSelect}
      FROM students
      ORDER BY name
    `)
  );
});

app.post("/api/students", async (req, res) => {
  const {
    name,
    className,
    phone = "",
    note = "",
    comment = "",
    feePerLesson = 100000,
    active = true,
  } = req.body;

  if (!name || !className) {
    return res.status(400).json({
      message: "name và className là bắt buộc",
    });
  }

  const rows = await q(
    `
    INSERT INTO students(
      name,
      class_name,
      phone,
      note,
      comment,
      fee_per_lesson,
      active
    )
    VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING ${studentSelect}
    `,
    [
      name,
      className,
      phone,
      note,
      comment,
      Number(feePerLesson),
      !!active,
    ]
  );

  res.status(201).json(rows[0]);
});

app.put("/api/students/:id", async (req, res) => {
  const {
    name,
    className,
    phone = "",
    note = "",
    comment = "",
    feePerLesson = 100000,
    active = true,
  } = req.body;

  const studentId = Number(req.params.id);
  const newFee = Number(feePerLesson);

  const rows = await q(
    `
    UPDATE students
    SET
      name=$1,
      class_name=$2,
      phone=$3,
      note=$4,
      comment=$5,
      fee_per_lesson=$6,
      active=$7
    WHERE id=$8
    RETURNING ${studentSelect}
    `,
    [
      name,
      className,
      phone,
      note,
      comment,
      newFee,
      !!active,
      studentId,
    ]
  );

  if (!rows[0]) {
    return res.status(404).json({
      message: "Không tìm thấy học sinh",
    });
  }

  await q(
    `
    UPDATE lessons
    SET fee=$1
    WHERE student_id=$2
      AND status='pending'
      AND is_extra=false
    `,
    [
      newFee,
      studentId,
    ]
  );

  res.json(rows[0]);
});

app.delete("/api/students/:id", async (req, res) => {
  await q(
    "DELETE FROM students WHERE id=$1",
    [Number(req.params.id)]
  );

  res.json({
    success: true,
  });
});

/*
 * ============================================================
 * CLASSES
 * ============================================================
 */

app.get("/api/classes", async (_, res) => {
  res.json(
    await q(`
      SELECT id,name,teacher
      FROM classes
      ORDER BY name
    `)
  );
});

app.post("/api/classes", async (req, res) => {
  const {
    name,
    teacher = "Giáo viên",
  } = req.body;

  const r = await q(
    `
    INSERT INTO classes(name,teacher)
    VALUES($1,$2)
    RETURNING id,name,teacher
    `,
    [name, teacher]
  );

  res.status(201).json(r[0]);
});

/*
 * ============================================================
 * TIME SLOTS
 * ============================================================
 */

app.get("/api/time-slots", async (_, res) => {
  res.json(
    await q(`
      SELECT
        id,
        name,
        start_time AS "startTime",
        end_time AS "endTime",
        sort_order AS "sortOrder"
      FROM time_slots
      ORDER BY sort_order
    `)
  );
});

app.post("/api/time-slots", async (req, res) => {
  const {
    name,
    startTime,
    endTime,
    sortOrder = 99,
  } = req.body;

  const r = await q(
    `
    INSERT INTO time_slots(
      name,
      start_time,
      end_time,
      sort_order
    )
    VALUES($1,$2,$3,$4)
    RETURNING
      id,
      name,
      start_time AS "startTime",
      end_time AS "endTime",
      sort_order AS "sortOrder"
    `,
    [
      name,
      startTime,
      endTime,
      Number(sortOrder),
    ]
  );

  res.status(201).json(r[0]);
});

app.put("/api/time-slots/:id", async (req, res) => {
  const {
    name,
    startTime,
    endTime,
    sortOrder = 99,
  } = req.body;

  const r = await q(
    `
    UPDATE time_slots
    SET
      name=$1,
      start_time=$2,
      end_time=$3,
      sort_order=$4
    WHERE id=$5
    RETURNING
      id,
      name,
      start_time AS "startTime",
      end_time AS "endTime",
      sort_order AS "sortOrder"
    `,
    [
      name,
      startTime,
      endTime,
      Number(sortOrder),
      Number(req.params.id),
    ]
  );

  res.json(r[0]);
});

app.delete("/api/time-slots/:id", async (req, res) => {
  await q(
    "DELETE FROM time_slots WHERE id=$1",
    [Number(req.params.id)]
  );

  res.json({
    success: true,
  });
});

/*
 * ============================================================
 * SCHEDULES
 * ============================================================
 */

app.get("/api/schedules", async (_, res) => {
  res.json(
    await q(`
      SELECT ${scheduleSelect}
      FROM schedules s
      LEFT JOIN students st
        ON st.id=s.student_id
      ORDER BY s.day,s.time
    `)
  );
});

app.post("/api/schedules", async (req, res) => {
  const {
    day,
    time,
    subject,
    className,
    room = "",
    studentId = null,
  } = req.body;

  if (!day || !time || !subject || !className) {
    return res.status(400).json({
      message: "Thiếu thông tin lịch",
    });
  }

  const ids = studentId
    ? [Number(studentId)]
    : (
        await q(
          `
          SELECT id
          FROM students
          WHERE class_name=$1
            AND active=true
          `,
          [className]
        )
      ).map(x => x.id);

  let first = null;

  for (const sid of ids) {
    const r = await q(
      `
      INSERT INTO schedules(
        day,
        time,
        subject,
        class_name,
        room,
        student_id
      )
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING id
      `,
      [
        day,
        time,
        subject,
        className,
        room,
        sid,
      ]
    );

    first = r[0] || first;
  }

  if (!first) {
    const r = await q(
      `
      INSERT INTO schedules(
        day,
        time,
        subject,
        class_name,
        room,
        student_id
      )
      VALUES($1,$2,$3,$4,$5,NULL)
      RETURNING id
      `,
      [
        day,
        time,
        subject,
        className,
        room,
      ]
    );

    first = r[0];
  }

  const row = (
    await q(
      `
      SELECT ${scheduleSelect}
      FROM schedules s
      LEFT JOIN students st
        ON st.id=s.student_id
      WHERE s.id=$1
      `,
      [first.id]
    )
  )[0];

  res.status(201).json(row);
});

app.put("/api/schedules/:id", async (req, res) => {
  const {
    day,
    time,
    subject,
    className,
    room = "",
    studentId = null,
  } = req.body;

  const r = await q(
    `
    UPDATE schedules
    SET
      day=$1,
      time=$2,
      subject=$3,
      class_name=$4,
      room=$5,
      student_id=$6
    WHERE id=$7
    RETURNING id
    `,
    [
      day,
      time,
      subject,
      className,
      room,
      studentId ? Number(studentId) : null,
      Number(req.params.id),
    ]
  );

  if (!r[0]) {
    return res.status(404).json({
      message: "Không tìm thấy lịch",
    });
  }

  const row = (
    await q(
      `
      SELECT ${scheduleSelect}
      FROM schedules s
      LEFT JOIN students st
        ON st.id=s.student_id
      WHERE s.id=$1
      `,
      [r[0].id]
    )
  )[0];

  res.json(row);
});

app.delete("/api/schedules/:id", async (req, res) => {
  await q(
    "DELETE FROM schedules WHERE id=$1",
    [Number(req.params.id)]
  );

  res.json({
    success: true,
  });
});

/*
 * ============================================================
 * DAY NUMBER
 * ============================================================
 */

function dayNumber(day) {
  return {
    "Thứ 2": 1,
    "Thứ 3": 2,
    "Thứ 4": 3,
    "Thứ 5": 4,
    "Thứ 6": 5,
    "Thứ 7": 6,
    "Chủ nhật": 7,
  }[day] || 0;
}

/*
 * ============================================================
 * LESSONS
 * ============================================================
 */

app.get("/api/lessons", async (req, res) => {
  try {
    const { from, to } = getDateRange(req);

    const schedules = await q(`
      SELECT
        s.*,
        st.fee_per_lesson
      FROM schedules s
      JOIN students st
        ON st.id=s.student_id
      WHERE s.student_id IS NOT NULL
    `);

    for (const s of schedules) {
      const dayNo = dayNumber(s.day);

      if (!dayNo) {
        continue;
      }

      await q(
        `
        INSERT INTO lessons(
          student_id,
          schedule_id,
          lesson_date,
          time,
          subject,
          class_name,
          room,
          fee,
          status,
          is_extra
        )
        SELECT
          $1,
          $2,
          d::date,
          $3,
          $4,
          $5,
          $6,
          $7,
          'pending',
          false
        FROM generate_series(
          $8::date,
          $9::date,
          INTERVAL '1 day'
        ) d
        WHERE EXTRACT(ISODOW FROM d)=$10
        ON CONFLICT(
          student_id,
          schedule_id,
          lesson_date
        )
        DO NOTHING
        `,
        [
          s.student_id,
          s.id,
          s.time,
          s.subject,
          s.class_name,
          s.room,
          Number(s.fee_per_lesson || 0),
          from,
          to,
          dayNo,
        ]
      );
    }

    const lessons = await q(
      `
      SELECT
        ${lessonSelect},
        st.name AS "studentName"
      FROM lessons l
      JOIN students st
        ON st.id=l.student_id
      WHERE l.lesson_date BETWEEN $1 AND $2
        AND l.cancelled=false
      ORDER BY
        l.lesson_date DESC,
        l.time
      `,
      [from, to]
    );

    res.json(lessons);
  } catch (error) {
    console.error("GET /api/lessons error:", error);

    res.status(400).json({
      message: error.message,
    });
  }
});

app.post("/api/lessons", async (req, res) => {
  const {
    studentId,
    lessonDate,
    time,
    subject,
    className = "",
    room = "",
    fee,
  } = req.body;

  if (!studentId || !lessonDate || !time || !subject) {
    return res.status(400).json({
      message:
        "Học sinh, ngày, giờ và môn là bắt buộc",
    });
  }

  if (!isValidDateString(lessonDate)) {
    return res.status(400).json({
      message:
        "Ngày học không hợp lệ: " + lessonDate,
    });
  }

  const s = (
    await q(
      `
      SELECT
        class_name,
        fee_per_lesson
      FROM students
      WHERE id=$1
      `,
      [Number(studentId)]
    )
  )[0];

  if (!s) {
    return res.status(404).json({
      message: "Không tìm thấy học sinh",
    });
  }

  const r = await q(
    `
    INSERT INTO lessons(
      student_id,
      lesson_date,
      time,
      subject,
      class_name,
      room,
      fee,
      status,
      is_extra
    )
    VALUES(
      $1,$2,$3,$4,$5,$6,$7,
      'pending',
      true
    )
    RETURNING id
    `,
    [
      Number(studentId),
      lessonDate,
      time,
      subject,
      className || s.class_name || "",
      room,
      Number(fee ?? s.fee_per_lesson ?? 0),
    ]
  );

  const row = (
    await q(
      `
      SELECT
        ${lessonSelect},
        st.name AS "studentName"
      FROM lessons l
      JOIN students st
        ON st.id=l.student_id
      WHERE l.id=$1
      `,
      [r[0].id]
    )
  )[0];

  res.status(201).json(row);
});

/*
 * ============================================================
 * RECURRING LESSONS
 * Tạo ca học lặp hàng tuần từ ngày bắt đầu đến hết năm
 * ============================================================
 */

app.post("/api/lessons/recurring", async (req, res) => {
  try {
    const {
      studentId,
      startDate,
      dayOfWeek,
      time,
      subject,
      className = "",
      room = "",
      fee,
    } = req.body;

    const sid = Number(studentId);
    const dayNo = Number(dayOfWeek);

    if (!sid || !startDate || !time || !subject) {
      return res.status(400).json({
        message:
          "Học sinh, ngày bắt đầu, giờ và môn là bắt buộc",
      });
    }

    if (!isValidDateString(startDate)) {
      return res.status(400).json({
        message:
          "Ngày bắt đầu không hợp lệ: " + startDate,
      });
    }

    if (!Number.isInteger(dayNo) || dayNo < 1 || dayNo > 7) {
      return res.status(400).json({
        message:
          "dayOfWeek phải từ 1 đến 7",
      });
    }

    // Kiểm tra học sinh
    const student = (
      await q(
        `
        SELECT
          id,
          class_name,
          fee_per_lesson
        FROM students
        WHERE id=$1
        `,
        [sid]
      )
    )[0];

    if (!student) {
      return res.status(404).json({
        message: "Không tìm thấy học sinh",
      });
    }

    const finalClassName =
      className || student.class_name || "";

    const finalFee =
      Number(fee ?? student.fee_per_lesson ?? 0);

    /*
     * Tên thứ theo cấu trúc schedules hiện tại
     */
    const dayNames = {
      1: "Thứ 2",
      2: "Thứ 3",
      3: "Thứ 4",
      4: "Thứ 5",
      5: "Thứ 6",
      6: "Thứ 7",
      7: "Chủ nhật",
    };

    const day = dayNames[dayNo];

    /*
     * Tạo schedule đại diện cho ca học.
     *
     * schedule này được dùng để:
     * - biết ca học lặp vào thứ nào
     * - liên kết các lessons
     * - hiển thị lịch
     */
    const scheduleResult = await q(
      `
      INSERT INTO schedules(
        day,
        time,
        subject,
        class_name,
        room,
        student_id
      )
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING id
      `,
      [
        day,
        time,
        subject,
        finalClassName,
        room,
        sid,
      ]
    );

    const scheduleId = scheduleResult[0].id;

    /*
     * Tạo tất cả buổi học:
     *
     * startDate
     *    ↓
     * đúng thứ đã chọn
     *    ↓
     * mỗi 7 ngày
     *    ↓
     * 31/12
     */
    const lessons = await q(
      `
      INSERT INTO lessons(
        student_id,
        schedule_id,
        lesson_date,
        time,
        subject,
        class_name,
        room,
        fee,
        status,
        is_extra
      )
      SELECT
        $1,
        $2,
        d::date,
        $3,
        $4,
        $5,
        $6,
        $7,
        'pending',
        false
      FROM generate_series(
        $8::date,
        make_date(
          EXTRACT(YEAR FROM $8::date)::integer,
          12,
          31
        ),
        INTERVAL '1 day'
      ) d
      WHERE EXTRACT(ISODOW FROM d)=$9
      ORDER BY d
      RETURNING
        id,
        lesson_date::text AS "lessonDate"
      `,
      [
        sid,
        scheduleId,
        time,
        subject,
        finalClassName,
        room,
        finalFee,
        startDate,
        dayNo,
      ]
    );

    /*
     * Lấy lại đầy đủ lesson để frontend
     * có thể cập nhật state ngay.
     */
    const createdLessons = await q(
      `
      SELECT
        ${lessonSelect},
        st.name AS "studentName"
      FROM lessons l
      JOIN students st
        ON st.id=l.student_id
      WHERE l.schedule_id=$1
        AND l.cancelled=false
      ORDER BY
        l.lesson_date,
        l.time
      `,
      [scheduleId]
    );

    res.status(201).json({
      success: true,
      scheduleId,
      day,
      count: createdLessons.length,
      lessons: createdLessons,
    });

  } catch (error) {
    console.error(
      "POST /api/lessons/recurring error:",
      error
    );

    res.status(500).json({
      message: error.message,
    });
  }
});

app.delete("/api/lessons/:id", async (req, res) => {
  const lessonId = Number(req.params.id);

  await q(
    `
    UPDATE lessons
    SET cancelled=true
    WHERE id=$1
    `,
    [lessonId]
  );

  await q(
    `
    DELETE FROM attendance
    WHERE lesson_id=$1
    `,
    [lessonId]
  );

  res.json({
    success: true,
  });
});

/*
 * ============================================================
 * ATTENDANCE
 * ============================================================
 */

app.get("/api/attendance", async (req, res) => {
  const params = [];
  let where = "1=1";

  if (req.query.studentId) {
    params.push(Number(req.query.studentId));
    where += ` AND a.student_id=$${params.length}`;
  }

  if (req.query.from) {
    if (!isValidDateString(req.query.from)) {
      return res.status(400).json({
        message:
          "Ngày from không hợp lệ: " +
          req.query.from,
      });
    }

    params.push(req.query.from);
    where += ` AND a.lesson_date>=$${params.length}`;
  }

  if (req.query.to) {
    if (!isValidDateString(req.query.to)) {
      return res.status(400).json({
        message:
          "Ngày to không hợp lệ: " +
          req.query.to,
      });
    }

    params.push(req.query.to);
    where += ` AND a.lesson_date<=$${params.length}`;
  }

  res.json(
    await q(
      `
      SELECT
        a.id,
        a.student_id AS "studentId",
        a.lesson_id AS "lessonId",
        a.schedule_id AS "scheduleId",
        a.lesson_date::text AS "lessonDate",
        a.status,
        a.fee,
        a.note,
        st.name AS "studentName",
        COALESCE(l.time,s.time) AS time,
        COALESCE(l.subject,s.subject) AS subject,
        s.day
      FROM attendance a
      JOIN students st
        ON st.id=a.student_id
      LEFT JOIN lessons l
        ON l.id=a.lesson_id
      LEFT JOIN schedules s
        ON s.id=a.schedule_id
      WHERE ${where}
      ORDER BY
        a.lesson_date DESC,
        a.id DESC
      `,
      params
    )
  );
});

app.post("/api/attendance", async (req, res) => {
  const {
    studentId,
    lessonId = null,
    scheduleId = null,
    lessonDate,
    status = "attended",
    fee = null,
    note = "",
  } = req.body;

  if (!studentId || !lessonDate) {
    return res.status(400).json({
      message:
        "studentId và lessonDate là bắt buộc",
    });
  }

  if (!isValidDateString(lessonDate)) {
    return res.status(400).json({
      message:
        "lessonDate không hợp lệ: " +
        lessonDate,
    });
  }

  const student = (
    await q(
      `
      SELECT fee_per_lesson
      FROM students
      WHERE id=$1
      `,
      [Number(studentId)]
    )
  )[0];

  if (!student) {
    return res.status(404).json({
      message: "Không tìm thấy học sinh",
    });
  }

  const finalFee =
    status === "attended"
      ? Number(
          fee ??
          student.fee_per_lesson ??
          0
        )
      : 0;

  if (lessonId) {
    await q(
      `
      UPDATE lessons
      SET
        status=$1,
        fee=$2
      WHERE id=$3
      `,
      [
        status,
        finalFee,
        Number(lessonId),
      ]
    );

    const ex = await q(
      `
      SELECT id
      FROM attendance
      WHERE lesson_id=$1
      `,
      [Number(lessonId)]
    );

    if (ex[0]) {
      await q(
        `
        UPDATE attendance
        SET
          status=$1,
          fee=$2,
          note=$3,
          lesson_date=$4
        WHERE id=$5
        `,
        [
          status,
          finalFee,
          note,
          lessonDate,
          ex[0].id,
        ]
      );
    } else {
      await q(
        `
        INSERT INTO attendance(
          student_id,
          lesson_id,
          schedule_id,
          lesson_date,
          status,
          fee,
          note
        )
        VALUES(
          $1,$2,$3,$4,$5,$6,$7
        )
        `,
        [
          Number(studentId),
          Number(lessonId),
          scheduleId
            ? Number(scheduleId)
            : null,
          lessonDate,
          status,
          finalFee,
          note,
        ]
      );
    }
  } else {
    const ex = await q(
      `
      SELECT id
      FROM attendance
      WHERE student_id=$1
        AND lesson_id IS NULL
        AND lesson_date=$2
      `,
      [
        Number(studentId),
        lessonDate,
      ]
    );

    if (ex[0]) {
      await q(
        `
        UPDATE attendance
        SET
          status=$1,
          fee=$2,
          note=$3
        WHERE id=$4
        `,
        [
          status,
          finalFee,
          note,
          ex[0].id,
        ]
      );
    } else {
      await q(
        `
        INSERT INTO attendance(
          student_id,
          schedule_id,
          lesson_date,
          status,
          fee,
          note
        )
        VALUES(
          $1,$2,$3,$4,$5,$6
        )
        `,
        [
          Number(studentId),
          scheduleId
            ? Number(scheduleId)
            : null,
          lessonDate,
          status,
          finalFee,
          note,
        ]
      );
    }
  }

  const row = (
    await q(
      `
      SELECT
        a.id,
        a.student_id AS "studentId",
        a.lesson_id AS "lessonId",
        a.schedule_id AS "scheduleId",
        a.lesson_date::text AS "lessonDate",
        a.status,
        a.fee,
        a.note,
        st.name AS "studentName"
      FROM attendance a
      JOIN students st
        ON st.id=a.student_id
      WHERE a.student_id=$1
        AND a.lesson_date=$2
      ORDER BY a.id DESC
      LIMIT 1
      `,
      [
        Number(studentId),
        lessonDate,
      ]
    )
  )[0];

  res.status(201).json(row);
});

/*
 * ============================================================
 * PAYMENTS
 * ============================================================
 */

app.get("/api/payments", async (_, res) => {
  res.json(
    await q(`
      SELECT
        id,
        student_id AS "studentId",
        month,
        amount,
        paid_at AS "paidAt",
        note
      FROM payments
      ORDER BY paid_at DESC
    `)
  );
});

app.post("/api/payments", async (req, res) => {
  const {
    studentId,
    month,
    amount,
    note = "",
  } = req.body;

  if (!studentId || !month) {
    return res.status(400).json({
      message:
        "studentId và month là bắt buộc",
    });
  }

  const r = await q(
    `
    INSERT INTO payments(
      student_id,
      month,
      amount,
      note
    )
    VALUES($1,$2,$3,$4)
    RETURNING
      id,
      student_id AS "studentId",
      month,
      amount,
      paid_at AS "paidAt",
      note
    `,
    [
      Number(studentId),
      month,
      Number(amount),
      note,
    ]
  );

  res.status(201).json(r[0]);
});

app.put("/api/payments/monthly", async (req, res) => {
  try {
    const {
      studentId,
      month,
      amount,
      note = "",
    } = req.body;

    const sid = Number(studentId);
    const value = Number(amount);

    // Cho phép amount = 0
    if (!Number.isInteger(sid) || sid <= 0) {
      return res.status(400).json({
        message: "studentId không hợp lệ",
      });
    }

    if (!month) {
      return res.status(400).json({
        message: "month là bắt buộc",
      });
    }

    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({
        message: "amount phải là số >= 0",
      });
    }

    // Kiểm tra học sinh
    const student = await q(
      `
      SELECT id
      FROM students
      WHERE id=$1
      `,
      [sid]
    );

    if (!student[0]) {
      return res.status(404).json({
        message: "Không tìm thấy học sinh",
      });
    }

    /*
     * Xóa toàn bộ các khoản thu cũ của học sinh
     * trong tháng.
     *
     * Sau đó nếu amount > 0 thì tạo lại một record
     * duy nhất.
     *
     * amount = 0 => không tạo record mới.
     * Kết quả tổng "Đã thu" sẽ chính xác bằng 0.
     */
    await q(
      `
      DELETE FROM payments
      WHERE student_id=$1
        AND month=$2
      `,
      [sid, month]
    );

    let row = null;

    if (value > 0) {
      const result = await q(
        `
        INSERT INTO payments(
          student_id,
          month,
          amount,
          note
        )
        VALUES($1,$2,$3,$4)
        RETURNING
          id,
          student_id AS "studentId",
          month,
          amount,
          paid_at AS "paidAt",
          note
        `,
        [
          sid,
          month,
          value,
          note,
        ]
      );

      row = result[0];
    }

    res.json({
      success: true,
      amount: value,
      payment: row,
    });
  } catch (error) {
    console.error(
      "PUT /api/payments/monthly error:",
      error
    );

    res.status(500).json({
      message: error.message,
    });
  }
});
/*
 * ============================================================
 * SETTINGS
 * ============================================================
 */

/*
 * ============================================================
 * SETTINGS
 * ============================================================
 */

app.get("/api/settings", async (_, res) => {
  try {
    const r = await q(`
      SELECT
        teacher_name AS "teacherName",
        teacher_phone AS "teacherPhone",
        bank_account AS "bankAccount",
        bank_owner AS "bankOwner",
        bank_name AS "bankName",
        parent_note AS "parentNote"
      FROM app_settings
      WHERE id=1
    `);

    const qrCode = await readQrCode();

    res.json({
      ...(r[0] || {}),
      qrCode,
    });
  } catch (error) {
    console.error(
      "GET /api/settings error:",
      error
    );

    res.status(500).json({
      message: error.message,
    });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const {
      teacherName = "",
      teacherPhone = "",
      bankAccount = "",
      bankOwner = "",
      bankName = "",
      parentNote = "",
      qrCode,
    } = req.body;

    /*
     * Chỉ cập nhật thông tin settings vào database.
     *
     * QR code KHÔNG lưu vào database.
     * QR được lưu thành file qr-code.txt.
     */

    const r = await q(
      `
      UPDATE app_settings
      SET
        teacher_name=$1,
        teacher_phone=$2,
        bank_account=$3,
        bank_owner=$4,
        bank_name=$5,
        parent_note=$6
      WHERE id=1
      RETURNING
        teacher_name AS "teacherName",
        teacher_phone AS "teacherPhone",
        bank_account AS "bankAccount",
        bank_owner AS "bankOwner",
        bank_name AS "bankName",
        parent_note AS "parentNote"
      `,
      [
        teacherName,
        teacherPhone,
        bankAccount,
        bankOwner,
        bankName,
        parentNote,
      ]
    );

    /*
     * Chỉ ghi QR khi frontend gửi qrCode.
     *
     * Nếu qrCode = ""
     * => xóa QR hiện tại.
     */
    if (qrCode !== undefined) {
      if (typeof qrCode !== "string") {
        return res.status(400).json({
          message: "qrCode phải là chuỗi",
        });
      }

      await saveQrCode(qrCode);
    }

    const currentQrCode = await readQrCode();

    res.json({
      ...(r[0] || {}),
      qrCode: currentQrCode,
    });
  } catch (error) {
    console.error(
      "PUT /api/settings error:",
      error
    );

    res.status(500).json({
      message: error.message,
    });
  }
});

app.put("/api/settings", async (req, res) => {
  const {
    teacherName = "",
    teacherPhone = "",
    bankAccount = "",
    bankOwner = "",
    bankName = "",
    parentNote = "",
  } = req.body;

  const r = await q(
    `
    UPDATE app_settings
    SET
      teacher_name=$1,
      teacher_phone=$2,
      bank_account=$3,
      bank_owner=$4,
      bank_name=$5,
      parent_note=$6
    WHERE id=1
    RETURNING
      teacher_name AS "teacherName",
      teacher_phone AS "teacherPhone",
      bank_account AS "bankAccount",
      bank_owner AS "bankOwner",
      bank_name AS "bankName",
      parent_note AS "parentNote"
    `,
    [
      teacherName,
      teacherPhone,
      bankAccount,
      bankOwner,
      bankName,
      parentNote,
    ]
  );

  res.json(r[0]);
});

/*
 * ============================================================
 * SHARE LINKS
 * ============================================================
 */

app.post("/api/share-links", async (req, res) => {
  const studentId = Number(req.body.studentId);

  let r = await q(
    `
    SELECT token
    FROM share_links
    WHERE student_id=$1
    LIMIT 1
    `,
    [studentId]
  );

  if (!r[0]) {
    const token =
      crypto.randomBytes(16).toString("hex");

    r = await q(
      `
      INSERT INTO share_links(
        student_id,
        token
      )
      VALUES($1,$2)
      RETURNING token
      `,
      [
        studentId,
        token,
      ]
    );
  }

  res.json({
    token: r[0].token,
  });
});

app.get("/api/share/:token", async (req, res) => {
  try {
    const s = (
      await q(
        `
        SELECT
          st.id,
          st.name,
          st.class_name AS "className",
          sl.token
        FROM share_links sl
        JOIN students st
          ON st.id=sl.student_id
        WHERE sl.token=$1
        `,
        [req.params.token]
      )
    )[0];

    if (!s) {
      return res.status(404).json({
        message: "Link không hợp lệ",
      });
    }

    /*
     * Lấy toàn bộ lịch học đã tạo của học sinh.
     *
     * Không giới hạn theo tháng để frontend có thể
     * chuyển qua tuần trước / tuần sau.
     */
    const lessons = await q(
      `
      SELECT
        ${lessonSelect}
      FROM lessons l
      WHERE l.student_id=$1
        AND l.cancelled=false
      ORDER BY
        l.lesson_date,
        l.time
      `,
      [s.id]
    );

    res.json({
      student: s,
      lessons,
    });
  } catch (error) {
    console.error("GET /api/share/:token error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/*
 * ============================================================
 * ERROR HANDLER
 * ============================================================
 */

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    message: err.message,
  });
});

/*
 * ============================================================
 * SERVER
 * ============================================================
 */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Teacher Schedule API running on ${PORT}`
    );
  }
);
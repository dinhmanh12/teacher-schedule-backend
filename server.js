import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* =========================================================
 * DATABASE
 * ========================================================= */

const dataDir = path.join(__dirname, "data");
await fs.mkdir(dataDir, { recursive: true });

const db = await open({
  filename: path.join(dataDir, "teacher_schedule.db"),
  driver: sqlite3.Database,
});

/*
 * Tạo toàn bộ database schema.
 *
 * QUAN TRỌNG:
 * Render tạo database mới nên tất cả table phải được CREATE
 * trước khi chạy SELECT / INSERT / ALTER TABLE.
 */
await db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    teacherName TEXT NOT NULL DEFAULT 'Nguyễn Thị Nam Giang',
    teacherPhone TEXT NOT NULL DEFAULT '123',
    bankAccount TEXT NOT NULL DEFAULT '12345',
    bankOwner TEXT NOT NULL DEFAULT 'Nguyễn Thị Nam Giang',
    bankName TEXT NOT NULL DEFAULT 'MB Bank',
    parentNote TEXT NOT NULL DEFAULT 'Vui lòng thanh toán học phí đúng hạn. Khi chuyển khoản, phụ huynh vui lòng ghi rõ họ tên học sinh để giáo viên dễ dàng kiểm tra.'
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    className TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    feePerLesson INTEGER NOT NULL DEFAULT 100000,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    teacher TEXT NOT NULL DEFAULT 'Nguyễn Văn An'
  );

  CREATE TABLE IF NOT EXISTS time_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    sortOrder INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    time TEXT NOT NULL,
    subject TEXT NOT NULL,
    className TEXT NOT NULL,
    room TEXT NOT NULL DEFAULT '',
    studentId INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    scheduleId INTEGER DEFAULT NULL,
    lessonDate TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'attended',
    fee INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    UNIQUE(studentId, scheduleId, lessonDate)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    month TEXT NOT NULL,
    amount INTEGER NOT NULL,
    paidAt TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE
  );
`);

/* =========================================================
 * DEFAULT SETTINGS
 * ========================================================= */

if (!(await db.get("SELECT id FROM app_settings WHERE id = 1"))) {
  await db.run(`
    INSERT INTO app_settings (
      id,
      teacherName,
      teacherPhone,
      bankAccount,
      bankOwner,
      bankName,
      parentNote
    )
    VALUES (
      1,
      'Nguyễn Thị Nam Giang',
      '123',
      '12345',
      'Nguyễn Thị Nam Giang',
      'MB Bank',
      'Vui lòng thanh toán học phí đúng hạn. Khi chuyển khoản, phụ huynh vui lòng ghi rõ họ tên học sinh để giáo viên dễ dàng kiểm tra.'
    )
  `);
}

/* =========================================================
 * DEFAULT TIME SLOTS
 * ========================================================= */

const timeSlotCount = await db.get(
  "SELECT COUNT(*) AS count FROM time_slots"
);

if (timeSlotCount.count === 0) {
  const defaultTimeSlots = [
    ["Tiết 1", "08:00", "09:00", 1],
    ["Tiết 2", "09:00", "10:00", 2],
    ["Tiết 3", "10:00", "11:00", 3],
    ["Tiết 4", "13:30", "14:30", 4],
    ["Tiết 5", "14:30", "15:30", 5],
    ["Tiết 6", "15:30", "16:30", 6],
  ];

  for (const [name, startTime, endTime, sortOrder] of defaultTimeSlots) {
    await db.run(
      `
      INSERT INTO time_slots (
        name,
        startTime,
        endTime,
        sortOrder
      )
      VALUES (?, ?, ?, ?)
      `,
      name,
      startTime,
      endTime,
      sortOrder
    );
  }
}

/* =========================================================
 * DEFAULT STUDENTS
 * ========================================================= */

const studentCount = await db.get(
  "SELECT COUNT(*) AS count FROM students"
);

if (studentCount.count === 0) {
  const defaultStudents = [
    [
      "Nguyễn Minh Anh",
      "8A",
      "0901 234 567",
      "",
      100000,
      1,
    ],
    [
      "Trần Gia Huy",
      "8A",
      "0902 345 678",
      "Học tốt môn Toán",
      100000,
      1,
    ],
    [
      "Lê Khánh Linh",
      "8B",
      "0903 456 789",
      "",
      120000,
      1,
    ],
    [
      "Phạm Đức Minh",
      "8B",
      "0904 567 890",
      "Cần hỗ trợ thêm",
      120000,
      1,
    ],
    [
      "Đỗ Hà My",
      "9A",
      "0905 678 901",
      "",
      150000,
      1,
    ],
  ];

  for (const [
    name,
    className,
    phone,
    note,
    feePerLesson,
    active,
  ] of defaultStudents) {
    await db.run(
      `
      INSERT INTO students (
        name,
        className,
        phone,
        note,
        feePerLesson,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      name,
      className,
      phone,
      note,
      feePerLesson,
      active
    );
  }
}

/* =========================================================
 * DEFAULT CLASSES
 * ========================================================= */

const classCount = await db.get(
  "SELECT COUNT(*) AS count FROM classes"
);

if (classCount.count === 0) {
  const defaultClasses = [
    ["8A", "Nguyễn Văn An"],
    ["8B", "Nguyễn Văn An"],
    ["9A", "Nguyễn Văn An"],
  ];

  for (const [name, teacher] of defaultClasses) {
    await db.run(
      `
      INSERT INTO classes (
        name,
        teacher
      )
      VALUES (?, ?)
      `,
      name,
      teacher
    );
  }
}

/* =========================================================
 * DEFAULT SCHEDULES
 * ========================================================= */

const scheduleCount = await db.get(
  "SELECT COUNT(*) AS count FROM schedules"
);

if (scheduleCount.count === 0) {
  const defaultSchedules = [
    ["Thứ 2", "08:00-09:00", "Toán", "8A", "P.101"],
    ["Thứ 2", "09:00-10:00", "Vật lý", "9A", "P.202"],
    ["Thứ 3", "08:00-09:00", "Toán", "8B", "P.101"],
    ["Thứ 3", "10:00-11:00", "Ôn tập", "8A", "P.103"],
    ["Thứ 4", "09:00-10:00", "Toán", "9A", "P.202"],
    ["Thứ 4", "13:30-14:30", "Vật lý", "8A", "P.101"],
    ["Thứ 5", "08:00-09:00", "Toán", "8B", "P.101"],
    ["Thứ 6", "09:00-10:00", "Ôn tập", "9A", "P.202"],
  ];

  for (const [
    day,
    time,
    subject,
    className,
    room,
  ] of defaultSchedules) {
    await db.run(
      `
      INSERT INTO schedules (
        day,
        time,
        subject,
        className,
        room,
        studentId
      )
      VALUES (?, ?, ?, ?, ?, NULL)
      `,
      day,
      time,
      subject,
      className,
      room
    );
  }
}

/* =========================================================
 * CONVERT CLASS SCHEDULES TO STUDENT SCHEDULES
 * ========================================================= */

/*
 * Nếu schedule cũ chỉ có className và studentId = NULL,
 * copy schedule đó cho từng học sinh đang active trong class.
 *
 * Giữ schedule class-wide ban đầu để không phá dữ liệu cũ.
 */

const classWideSchedules = await db.all(`
  SELECT *
  FROM schedules
  WHERE studentId IS NULL
`);

for (const schedule of classWideSchedules) {
  const students = await db.all(
    `
    SELECT id
    FROM students
    WHERE className = ?
      AND active = 1
    `,
    schedule.className
  );

  for (const student of students) {
    const existing = await db.get(
      `
      SELECT id
      FROM schedules
      WHERE day = ?
        AND time = ?
        AND subject = ?
        AND className = ?
        AND room = ?
        AND studentId = ?
      `,
      schedule.day,
      schedule.time,
      schedule.subject,
      schedule.className,
      schedule.room,
      student.id
    );

    if (!existing) {
      await db.run(
        `
        INSERT INTO schedules (
          day,
          time,
          subject,
          className,
          room,
          studentId
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        schedule.day,
        schedule.time,
        schedule.subject,
        schedule.className,
        schedule.room,
        student.id
      );
    }
  }
}

/* =========================================================
 * EXPRESS
 * ========================================================= */

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());

/* =========================================================
 * HEALTH
 * ========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await db.get("SELECT 1 AS ok");

    res.json({
      success: true,
      message: "Teacher Schedule Backend is running",
      database: "SQLite",
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* =========================================================
 * STUDENTS
 * ========================================================= */

app.get("/api/students", async (req, res) => {
  try {
    const students = await db.all(`
      SELECT *
      FROM students
      ORDER BY name COLLATE NOCASE
    `);

    res.json(students);
  } catch (error) {
    console.error("GET /api/students error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/api/students", async (req, res) => {
  try {
    const {
      name,
      className,
      phone = "",
      note = "",
      feePerLesson = 100000,
      active = 1,
    } = req.body;

    if (!name || !className) {
      return res.status(400).json({
        message: "name và className là bắt buộc",
      });
    }

    const result = await db.run(
      `
      INSERT INTO students (
        name,
        className,
        phone,
        note,
        feePerLesson,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      name,
      className,
      phone,
      note,
      feePerLesson,
      active ? 1 : 0
    );

    const student = await db.get(
      "SELECT * FROM students WHERE id = ?",
      result.lastID
    );

    res.status(201).json(student);
  } catch (error) {
    console.error("POST /api/students error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.put("/api/students/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const {
      name,
      className,
      phone = "",
      note = "",
      feePerLesson = 100000,
      active = 1,
    } = req.body;

    if (!name || !className) {
      return res.status(400).json({
        message: "name và className là bắt buộc",
      });
    }

    await db.run(
      `
      UPDATE students
      SET
        name = ?,
        className = ?,
        phone = ?,
        note = ?,
        feePerLesson = ?,
        active = ?
      WHERE id = ?
      `,
      name,
      className,
      phone,
      note,
      feePerLesson,
      active ? 1 : 0,
      id
    );

    const student = await db.get(
      "SELECT * FROM students WHERE id = ?",
      id
    );

    if (!student) {
      return res.status(404).json({
        message: "Không tìm thấy học sinh",
      });
    }

    res.json(student);
  } catch (error) {
    console.error("PUT /api/students error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.delete("/api/students/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const student = await db.get(
      "SELECT * FROM students WHERE id = ?",
      id
    );

    if (!student) {
      return res.status(404).json({
        message: "Không tìm thấy học sinh",
      });
    }

    await db.run(
      "DELETE FROM attendance WHERE studentId = ?",
      id
    );

    await db.run(
      "DELETE FROM payments WHERE studentId = ?",
      id
    );

    await db.run(
      "DELETE FROM share_links WHERE studentId = ?",
      id
    );

    await db.run(
      "DELETE FROM schedules WHERE studentId = ?",
      id
    );

    await db.run(
      "DELETE FROM students WHERE id = ?",
      id
    );

    res.json({
      success: true,
      message: "Đã xóa học sinh",
    });
  } catch (error) {
    console.error("DELETE /api/students error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * CLASSES
 * ========================================================= */

app.get("/api/classes", async (req, res) => {
  try {
    const classes = await db.all(`
      SELECT *
      FROM classes
      ORDER BY name
    `);

    res.json(classes);
  } catch (error) {
    console.error("GET /api/classes error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * TIME SLOTS
 * ========================================================= */

app.get("/api/time-slots", async (req, res) => {
  try {
    const slots = await db.all(`
      SELECT *
      FROM time_slots
      ORDER BY sortOrder
    `);

    res.json(slots);
  } catch (error) {
    console.error("GET /api/time-slots error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * SCHEDULES
 * ========================================================= */

app.get("/api/schedules", async (req, res) => {
  try {
    const schedules = await db.all(`
      SELECT
        s.*,
        st.name AS studentName
      FROM schedules s
      LEFT JOIN students st
        ON st.id = s.studentId
      ORDER BY
        CASE s.day
          WHEN 'Thứ 2' THEN 1
          WHEN 'Thứ 3' THEN 2
          WHEN 'Thứ 4' THEN 3
          WHEN 'Thứ 5' THEN 4
          WHEN 'Thứ 6' THEN 5
          WHEN 'Thứ 7' THEN 6
          WHEN 'Chủ nhật' THEN 7
          ELSE 99
        END,
        s.time
    `);

    res.json(schedules);
  } catch (error) {
    console.error("GET /api/schedules error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/api/schedules", async (req, res) => {
  try {
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
        message: "day, time, subject, className là bắt buộc",
      });
    }

    const result = await db.run(
      `
      INSERT INTO schedules (
        day,
        time,
        subject,
        className,
        room,
        studentId
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      day,
      time,
      subject,
      className,
      room,
      studentId || null
    );

    const schedule = await db.get(
      `
      SELECT
        s.*,
        st.name AS studentName
      FROM schedules s
      LEFT JOIN students st
        ON st.id = s.studentId
      WHERE s.id = ?
      `,
      result.lastID
    );

    res.status(201).json(schedule);
  } catch (error) {
    console.error("POST /api/schedules error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.put("/api/schedules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const {
      day,
      time,
      subject,
      className,
      room = "",
      studentId = null,
    } = req.body;

    await db.run(
      `
      UPDATE schedules
      SET
        day = ?,
        time = ?,
        subject = ?,
        className = ?,
        room = ?,
        studentId = ?
      WHERE id = ?
      `,
      day,
      time,
      subject,
      className,
      room,
      studentId || null,
      id
    );

    const schedule = await db.get(
      `
      SELECT
        s.*,
        st.name AS studentName
      FROM schedules s
      LEFT JOIN students st
        ON st.id = s.studentId
      WHERE s.id = ?
      `,
      id
    );

    if (!schedule) {
      return res.status(404).json({
        message: "Không tìm thấy lịch học",
      });
    }

    res.json(schedule);
  } catch (error) {
    console.error("PUT /api/schedules error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.delete("/api/schedules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await db.run(
      "DELETE FROM schedules WHERE id = ?",
      id
    );

    res.json({
      success: true,
      message: "Đã xóa lịch học",
    });
  } catch (error) {
    console.error("DELETE /api/schedules error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * ATTENDANCE
 * ========================================================= */

app.get("/api/attendance", async (req, res) => {
  try {
    const {
      studentId,
      from,
      to,
    } = req.query;

    let sql = `
      SELECT
        a.*,
        st.name AS studentName,
        s.subject,
        s.day,
        s.time
      FROM attendance a
      LEFT JOIN students st
        ON st.id = a.studentId
      LEFT JOIN schedules s
        ON s.id = a.scheduleId
      WHERE 1 = 1
    `;

    const params = [];

    if (studentId) {
      sql += " AND a.studentId = ?";
      params.push(Number(studentId));
    }

    if (from) {
      sql += " AND a.lessonDate >= ?";
      params.push(from);
    }

    if (to) {
      sql += " AND a.lessonDate <= ?";
      params.push(to);
    }

    sql += `
      ORDER BY
        a.lessonDate DESC,
        a.id DESC
    `;

    const rows = await db.all(sql, ...params);

    res.json(rows);
  } catch (error) {
    console.error("GET /api/attendance error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/api/attendance", async (req, res) => {
  try {
    const {
      studentId,
      scheduleId = null,
      lessonDate,
      status = "attended",
      fee = 0,
      note = "",
    } = req.body;

    if (!studentId || !lessonDate) {
      return res.status(400).json({
        message: "studentId và lessonDate là bắt buộc",
      });
    }

    const existing = await db.get(
      `
      SELECT id
      FROM attendance
      WHERE studentId = ?
        AND scheduleId IS ?
        AND lessonDate = ?
      `,
      studentId,
      scheduleId || null,
      lessonDate
    );

    let id;

    if (existing) {
      await db.run(
        `
        UPDATE attendance
        SET
          status = ?,
          fee = ?,
          note = ?
        WHERE id = ?
        `,
        status,
        fee,
        note,
        existing.id
      );

      id = existing.id;
    } else {
      const result = await db.run(
        `
        INSERT INTO attendance (
          studentId,
          scheduleId,
          lessonDate,
          status,
          fee,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        studentId,
        scheduleId || null,
        lessonDate,
        status,
        fee,
        note
      );

      id = result.lastID;
    }

    const attendance = await db.get(
      `
      SELECT *
      FROM attendance
      WHERE id = ?
      `,
      id
    );

    res.status(201).json(attendance);
  } catch (error) {
    console.error("POST /api/attendance error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * STUDENT SUMMARY
 * ========================================================= */

app.get("/api/summary/:studentId", async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);

    const student = await db.get(
      `
      SELECT *
      FROM students
      WHERE id = ?
      `,
      studentId
    );

    if (!student) {
      return res.status(404).json({
        message: "Không tìm thấy học sinh",
      });
    }

    const attendance = await db.all(
      `
      SELECT *
      FROM attendance
      WHERE studentId = ?
      ORDER BY lessonDate DESC
      `,
      studentId
    );

    const payment = await db.get(
      `
      SELECT
        COALESCE(SUM(amount), 0) AS totalPaid
      FROM payments
      WHERE studentId = ?
      `,
      studentId
    );

    const totalLessons = attendance.length;

    const attendedLessons = attendance.filter(
      (item) => item.status === "attended"
    ).length;

    const absentLessons = attendance.filter(
      (item) => item.status === "absent"
    ).length;

    const totalFee = attendance
      .filter((item) => item.status === "attended")
      .reduce(
        (sum, item) =>
          sum + Number(item.fee || student.feePerLesson || 0),
        0
      );

    const totalPaid = Number(payment?.totalPaid || 0);

    res.json({
      student,
      totalLessons,
      attendedLessons,
      absentLessons,
      totalFee,
      totalPaid,
      remaining: totalFee - totalPaid,
      attendance,
    });
  } catch (error) {
    console.error("GET /api/summary error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * PAYMENTS
 * ========================================================= */

app.get("/api/payments", async (req, res) => {
  try {
    const { studentId, month } = req.query;

    let sql = `
      SELECT
        p.*,
        s.name AS studentName
      FROM payments p
      LEFT JOIN students s
        ON s.id = p.studentId
      WHERE 1 = 1
    `;

    const params = [];

    if (studentId) {
      sql += " AND p.studentId = ?";
      params.push(Number(studentId));
    }

    if (month) {
      sql += " AND p.month = ?";
      params.push(month);
    }

    sql += " ORDER BY p.paidAt DESC, p.id DESC";

    const payments = await db.all(sql, ...params);

    res.json(payments);
  } catch (error) {
    console.error("GET /api/payments error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/api/payments", async (req, res) => {
  try {
    const {
      studentId,
      month,
      amount,
      paidAt,
      note = "",
    } = req.body;

    if (!studentId || !month || amount == null) {
      return res.status(400).json({
        message: "studentId, month và amount là bắt buộc",
      });
    }

    const result = await db.run(
      `
      INSERT INTO payments (
        studentId,
        month,
        amount,
        paidAt,
        note
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      studentId,
      month,
      Number(amount),
      paidAt || new Date().toISOString(),
      note
    );

    const payment = await db.get(
      `
      SELECT
        p.*,
        s.name AS studentName
      FROM payments p
      LEFT JOIN students s
        ON s.id = p.studentId
      WHERE p.id = ?
      `,
      result.lastID
    );

    res.status(201).json(payment);
  } catch (error) {
    console.error("POST /api/payments error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * SETTINGS
 * ========================================================= */

app.get("/api/settings", async (req, res) => {
  try {
    const settings = await db.get(
      `
      SELECT *
      FROM app_settings
      WHERE id = 1
      `
    );

    res.json(settings);
  } catch (error) {
    console.error("GET /api/settings error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const {
      teacherName,
      teacherPhone,
      bankAccount,
      bankOwner,
      bankName,
      parentNote,
    } = req.body;

    await db.run(
      `
      UPDATE app_settings
      SET
        teacherName = COALESCE(?, teacherName),
        teacherPhone = COALESCE(?, teacherPhone),
        bankAccount = COALESCE(?, bankAccount),
        bankOwner = COALESCE(?, bankOwner),
        bankName = COALESCE(?, bankName),
        parentNote = COALESCE(?, parentNote)
      WHERE id = 1
      `,
      teacherName ?? null,
      teacherPhone ?? null,
      bankAccount ?? null,
      bankOwner ?? null,
      bankName ?? null,
      parentNote ?? null
    );

    const settings = await db.get(
      `
      SELECT *
      FROM app_settings
      WHERE id = 1
      `
    );

    res.json(settings);
  } catch (error) {
    console.error("PUT /api/settings error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * SHARE LINKS
 * ========================================================= */

app.post("/api/share-links", async (req, res) => {
  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({
        message: "studentId là bắt buộc",
      });
    }

    const student = await db.get(
      `
      SELECT *
      FROM students
      WHERE id = ?
      `,
      studentId
    );

    if (!student) {
      return res.status(404).json({
        message: "Không tìm thấy học sinh",
      });
    }

    const token = crypto.randomBytes(24).toString("hex");

    const result = await db.run(
      `
      INSERT INTO share_links (
        studentId,
        token
      )
      VALUES (?, ?)
      `,
      studentId,
      token
    );

    const shareLink = await db.get(
      `
      SELECT *
      FROM share_links
      WHERE id = ?
      `,
      result.lastID
    );

    res.status(201).json(shareLink);
  } catch (error) {
    console.error("POST /api/share-links error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

app.get("/api/share/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const shareLink = await db.get(
      `
      SELECT *
      FROM share_links
      WHERE token = ?
      `,
      token
    );

    if (!shareLink) {
      return res.status(404).json({
        message: "Link chia sẻ không tồn tại",
      });
    }

    const student = await db.get(
      `
      SELECT *
      FROM students
      WHERE id = ?
      `,
      shareLink.studentId
    );

    if (!student) {
      return res.status(404).json({
        message: "Không tìm thấy học sinh",
      });
    }

    const attendance = await db.all(
      `
      SELECT
        a.*,
        s.subject,
        s.day,
        s.time
      FROM attendance a
      LEFT JOIN schedules s
        ON s.id = a.scheduleId
      WHERE a.studentId = ?
      ORDER BY a.lessonDate DESC
      `,
      student.id
    );

    const payments = await db.all(
      `
      SELECT *
      FROM payments
      WHERE studentId = ?
      ORDER BY paidAt DESC
      `,
      student.id
    );

    const settings = await db.get(
      `
      SELECT *
      FROM app_settings
      WHERE id = 1
      `
    );

    res.json({
      student,
      attendance,
      payments,
      settings,
    });
  } catch (error) {
    console.error("GET /api/share/:token error:", error);

    res.status(500).json({
      message: error.message,
    });
  }
});

/* =========================================================
 * 404
 * ========================================================= */

app.use((req, res) => {
  res.status(404).json({
    message: "API endpoint không tồn tại",
    path: req.path,
  });
});

/* =========================================================
 * ERROR HANDLER
 * ========================================================= */

app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);

  res.status(500).json({
    message: error.message || "Internal Server Error",
  });
});

/* =========================================================
 * START SERVER
 * ========================================================= */

const PORT = Number(process.env.PORT) || 4000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Teacher Schedule Backend running on ${HOST}:${PORT}`);
  console.log(`Database: ${path.join(dataDir, "teacher_schedule.db")}`);
});
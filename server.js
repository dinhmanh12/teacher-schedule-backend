import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
await fs.mkdir(dataDir, { recursive: true });

const db = await open({
  filename: path.join(dataDir, "teacher_schedule.db"),
  driver: sqlite3.Database
});

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
`);

if (!(await db.get("SELECT id FROM app_settings WHERE id=1"))) {
  await db.run("INSERT INTO app_settings(id) VALUES(1)");
}

async function addColumnIfMissing(table, column, definition) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === column)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
await addColumnIfMissing("students", "feePerLesson", "INTEGER NOT NULL DEFAULT 100000");
await addColumnIfMissing("students", "active", "INTEGER NOT NULL DEFAULT 1");
await addColumnIfMissing("schedules", "studentId", "INTEGER DEFAULT NULL");

if (!(await db.get("SELECT id FROM app_settings WHERE id=1"))) {
  await db.run("INSERT INTO app_settings(id) VALUES(1)");
}

const defaults = [
  ["Tiết 1", "08:00", "09:00", 1], ["Tiết 2", "09:00", "10:00", 2],
  ["Tiết 3", "10:00", "11:00", 3], ["Tiết 4", "13:30", "14:30", 4],
  ["Tiết 5", "14:30", "15:30", 5], ["Tiết 6", "15:30", "16:30", 6]
];
if ((await db.get("SELECT COUNT(*) n FROM time_slots")).n === 0) {
  for (const r of defaults) await db.run("INSERT INTO time_slots(name,startTime,endTime,sortOrder) VALUES(?,?,?,?)", r);
}

if ((await db.get("SELECT COUNT(*) n FROM students")).n === 0) {
  const seed = [
    ["Nguyễn Minh Anh","8A","0901 234 567","",100000],
    ["Trần Gia Huy","8A","0902 345 678","Học tốt môn Toán",100000],
    ["Lê Khánh Linh","8B","0903 456 789","",120000],
    ["Phạm Đức Minh","8B","0904 567 890","Cần hỗ trợ thêm",120000],
    ["Đỗ Hà My","9A","0905 678 901","",150000]
  ];
  for (const r of seed) await db.run("INSERT INTO students(name,className,phone,note,feePerLesson) VALUES(?,?,?,?,?)", r);
}
if ((await db.get("SELECT COUNT(*) n FROM classes")).n === 0) {
  for (const name of ["8A","8B","9A"]) await db.run("INSERT INTO classes(name) VALUES(?)", [name]);
}
if ((await db.get("SELECT COUNT(*) n FROM schedules")).n === 0) {
  const rows = [
    ["Thứ 2","08:00 - 09:00","Toán","8A","P.101"], ["Thứ 2","09:00 - 10:00","Vật lý","9A","P.202"],
    ["Thứ 3","08:00 - 09:00","Toán","8B","P.101"], ["Thứ 3","10:00 - 11:00","Ôn tập","8A","P.103"],
    ["Thứ 4","09:00 - 10:00","Toán","9A","P.202"], ["Thứ 4","13:30 - 14:30","Vật lý","8A","P.101"],
    ["Thứ 5","08:00 - 09:00","Toán","8B","P.101"], ["Thứ 6","09:00 - 10:00","Ôn tập","9A","P.202"]
  ];
  for (const r of rows) await db.run("INSERT INTO schedules(day,time,subject,className,room) VALUES(?,?,?,?,?)", r);
}

// Convert old class-wide schedules to individual student schedules.
const unassignedSchedules = await db.all("SELECT * FROM schedules WHERE studentId IS NULL");
for (const old of unassignedSchedules) {
  const classStudents = await db.all("SELECT id FROM students WHERE className=? AND active=1 ORDER BY id", [old.className]);
  if (classStudents.length) {
    await db.run("UPDATE schedules SET studentId=? WHERE id=?", [classStudents[0].id, old.id]);
    for (const st of classStudents.slice(1)) {
      await db.run(
        "INSERT INTO schedules(day,time,subject,className,room,studentId) VALUES(?,?,?,?,?,?)",
        [old.day, old.time, old.subject, old.className, old.room || "", st.id]
      );
    }
  }
}

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 4000;
const ok = (res, data) => res.json(data);
const bad = (res, msg, code=400) => res.status(code).json({error:msg});

app.get("/api/health", (_req,res) => ok(res,{ok:true,service:"teacher-schedule-backend"}));
app.get("/api/students", async (_req,res) => {
  const rows = await db.all(`SELECT s.*, COALESCE((SELECT COUNT(*) FROM attendance a WHERE a.studentId=s.id AND a.status='attended'),0) attendedLessons,
    COALESCE((SELECT SUM(a.fee) FROM attendance a WHERE a.studentId=s.id AND a.status='attended'),0) totalEarned,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.studentId=s.id),0) totalPaid FROM students s ORDER BY s.id`);
  ok(res, rows);
});
app.post("/api/students", async (req,res) => {
  const {name,className,phone="",note="",feePerLesson=100000}=req.body;
  if (!name || !className) return bad(res,"name and className are required");
  const r=await db.run("INSERT INTO students(name,className,phone,note,feePerLesson) VALUES(?,?,?,?,?)",[name,className,phone,note,Number(feePerLesson)||0]);
  res.status(201).json(await db.get("SELECT * FROM students WHERE id=?",[r.lastID]));
});
app.put("/api/students/:id", async (req,res)=>{
  const {name,className,phone="",note="",feePerLesson=100000,active=1}=req.body;
  await db.run("UPDATE students SET name=?,className=?,phone=?,note=?,feePerLesson=?,active=? WHERE id=?",[name,className,phone,note,Number(feePerLesson)||0,active?1:0,req.params.id]);
  ok(res,await db.get("SELECT * FROM students WHERE id=?",[req.params.id]));
});
app.delete("/api/students/:id", async (req,res)=>{await db.run("DELETE FROM students WHERE id=?",[req.params.id]);ok(res,{ok:true});});

app.get("/api/classes", async (_req,res)=>ok(res,await db.all(`SELECT c.id,c.name,c.teacher,(SELECT COUNT(*) FROM students s WHERE s.className=c.name AND s.active=1) count FROM classes c ORDER BY c.id`)));
app.post("/api/classes", async (req,res)=>{const {name,teacher="Nguyễn Văn An"}=req.body;if(!name)return bad(res,"name is required");try{const r=await db.run("INSERT INTO classes(name,teacher) VALUES(?,?)",[name,teacher]);res.status(201).json(await db.get("SELECT c.id,c.name,c.teacher,0 count FROM classes c WHERE c.id=?",[r.lastID]));}catch{bad(res,"Class already exists",409);}});
app.delete("/api/classes/:id",async(req,res)=>{await db.run("DELETE FROM classes WHERE id=?",[req.params.id]);ok(res,{ok:true});});

app.get("/api/time-slots",async(_req,res)=>ok(res,await db.all("SELECT * FROM time_slots ORDER BY sortOrder,id")));
app.post("/api/time-slots",async(req,res)=>{const {name,startTime,endTime}=req.body;if(!startTime||!endTime)return bad(res,"startTime and endTime are required");const max=await db.get("SELECT COALESCE(MAX(sortOrder),0) n FROM time_slots");const r=await db.run("INSERT INTO time_slots(name,startTime,endTime,sortOrder) VALUES(?,?,?,?)",[name||`Tiết ${max.n+1}`,startTime,endTime,max.n+1]);res.status(201).json(await db.get("SELECT * FROM time_slots WHERE id=?",[r.lastID]));});
app.put("/api/time-slots/:id",async(req,res)=>{const {name,startTime,endTime}=req.body;await db.run("UPDATE time_slots SET name=?,startTime=?,endTime=? WHERE id=?",[name,startTime,endTime,req.params.id]);ok(res,await db.get("SELECT * FROM time_slots WHERE id=?",[req.params.id]));});
app.delete("/api/time-slots/:id",async(req,res)=>{await db.run("DELETE FROM time_slots WHERE id=?",[req.params.id]);ok(res,{ok:true});});

app.get("/api/schedules", async (req,res)=>{
  const studentId=req.query.studentId;
  const base="SELECT sc.*, s.name studentName FROM schedules sc LEFT JOIN students s ON s.id=sc.studentId";
  const sql=studentId?`${base} WHERE sc.studentId=? ORDER BY sc.id`:`${base} ORDER BY sc.id`;
  ok(res,studentId?await db.all(sql,[studentId]):await db.all(sql));
});
app.post("/api/schedules", async (req,res)=>{
  const {day,time,subject,className,room="",studentId}=req.body;
  if(!day||!time||!subject||!studentId)return bad(res,"day, time, subject and studentId are required");
  const st=await db.get("SELECT className FROM students WHERE id=?",[studentId]);
  if(!st)return bad(res,"Student not found",404);
  const r=await db.run("INSERT INTO schedules(day,time,subject,className,room,studentId) VALUES(?,?,?,?,?,?)",[day,time,subject,st.className,room,Number(studentId)]);
  ok(res,await db.get("SELECT sc.*,s.name studentName FROM schedules sc LEFT JOIN students s ON s.id=sc.studentId WHERE sc.id=?",[r.lastID]));
});
app.put("/api/schedules/:id",async(req,res)=>{
  const {day,time,subject,room="",studentId}=req.body;
  if(!day||!time||!subject||!studentId)return bad(res,"day, time, subject and studentId are required");
  const st=await db.get("SELECT className FROM students WHERE id=?",[studentId]);
  if(!st)return bad(res,"Student not found",404);
  await db.run("UPDATE schedules SET day=?,time=?,subject=?,className=?,room=?,studentId=? WHERE id=?",[day,time,subject,st.className,room,Number(studentId),req.params.id]);
  ok(res,await db.get("SELECT sc.*,s.name studentName FROM schedules sc LEFT JOIN students s ON s.id=sc.studentId WHERE sc.id=?",[req.params.id]));
});
app.delete("/api/schedules/:id",async(req,res)=>{await db.run("DELETE FROM schedules WHERE id=?",[req.params.id]);ok(res,{ok:true});});

app.get("/api/attendance",async(req,res)=>{const {studentId,month}=req.query;let sql="SELECT a.*,s.name studentName,s.feePerLesson FROM attendance a JOIN students s ON s.id=a.studentId WHERE 1=1",p=[];if(studentId){sql+=" AND a.studentId=?";p.push(studentId);}if(month){sql+=" AND substr(a.lessonDate,1,7)=?";p.push(month);}sql+=" ORDER BY a.lessonDate DESC,a.id DESC";ok(res,await db.all(sql,p));});
app.post("/api/attendance",async(req,res)=>{const {studentId,scheduleId=null,lessonDate,status="attended",note=""}=req.body;if(!studentId||!lessonDate)return bad(res,"studentId and lessonDate are required");const st=await db.get("SELECT feePerLesson FROM students WHERE id=?",[studentId]);if(!st)return bad(res,"Student not found",404);const fee=status==="attended"?Number(st.feePerLesson):0;await db.run(`INSERT INTO attendance(studentId,scheduleId,lessonDate,status,fee,note) VALUES(?,?,?,?,?,?) ON CONFLICT(studentId,scheduleId,lessonDate) DO UPDATE SET status=excluded.status,fee=excluded.fee,note=excluded.note`,[studentId,scheduleId||null,lessonDate,status,fee,note]);ok(res,await db.get("SELECT * FROM attendance WHERE studentId=? AND scheduleId IS ? AND lessonDate=?",[studentId,scheduleId||null,lessonDate]));});
app.delete("/api/attendance/:id",async(req,res)=>{await db.run("DELETE FROM attendance WHERE id=?",[req.params.id]);ok(res,{ok:true});});

app.get("/api/summary/:studentId",async(req,res)=>{const s=await db.get("SELECT * FROM students WHERE id=?",[req.params.studentId]);if(!s)return bad(res,"Student not found",404);const attended=await db.get("SELECT COUNT(*) n,COALESCE(SUM(fee),0) amount FROM attendance WHERE studentId=? AND status='attended'",[s.id]);const absent=await db.get("SELECT COUNT(*) n FROM attendance WHERE studentId=? AND status='absent'",[s.id]);const paid=await db.get("SELECT COALESCE(SUM(amount),0) amount FROM payments WHERE studentId=?",[s.id]);ok(res,{student:s,attendedLessons:attended.n,absentLessons:absent.n,totalAmount:attended.amount,totalPaid:paid.amount,balance:attended.amount-paid.amount});});
app.get("/api/payments",async(req,res)=>{const {studentId,month}=req.query;let sql="SELECT p.*,s.name studentName FROM payments p JOIN students s ON s.id=p.studentId WHERE 1=1",p=[];if(studentId){sql+=" AND p.studentId=?";p.push(studentId);}if(month){sql+=" AND p.month=?";p.push(month);}sql+=" ORDER BY p.id DESC";ok(res,await db.all(sql,p));});
app.post("/api/payments",async(req,res)=>{const {studentId,month,amount,note=""}=req.body;if(!studentId||!amount)return bad(res,"studentId and amount are required");const r=await db.run("INSERT INTO payments(studentId,month,amount,paidAt,note) VALUES(?,?,?,?,?)",[studentId,month||new Date().toISOString().slice(0,7),Number(amount),new Date().toISOString(),note]);res.status(201).json(await db.get("SELECT * FROM payments WHERE id=?",[r.lastID]));});

app.get("/api/settings",async(_req,res)=>ok(res,await db.get("SELECT * FROM app_settings WHERE id=1")));
app.put("/api/settings",async(req,res)=>{
  const {teacherName="",teacherPhone="",bankAccount="",bankOwner="",bankName="",parentNote=""}=req.body;
  await db.run("UPDATE app_settings SET teacherName=?,teacherPhone=?,bankAccount=?,bankOwner=?,bankName=?,parentNote=? WHERE id=1",[teacherName,teacherPhone,bankAccount,bankOwner,bankName,parentNote]);
  ok(res,await db.get("SELECT * FROM app_settings WHERE id=1"));
});

app.post("/api/share-links",async(req,res)=>{const {studentId}=req.body;if(!studentId)return bad(res,"studentId is required");let row=await db.get("SELECT * FROM share_links WHERE studentId=?",[studentId]);if(!row){const token=crypto.randomBytes(18).toString("base64url");const r=await db.run("INSERT INTO share_links(studentId,token) VALUES(?,?)",[studentId,token]);row=await db.get("SELECT * FROM share_links WHERE id=?",[r.lastID]);}ok(res,row);});
app.get("/api/share/:token",async(req,res)=>{const link=await db.get("SELECT * FROM share_links WHERE token=?",[req.params.token]);if(!link)return bad(res,"Share link not found",404);const student=await db.get("SELECT id,name,className FROM students WHERE id=?",[link.studentId]);const schedules=await db.all("SELECT * FROM schedules WHERE studentId=? OR (studentId IS NULL AND className=?) ORDER BY id",[student.id,student.className]);ok(res,{student,schedules});});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running: http://0.0.0.0:${PORT}`);
});

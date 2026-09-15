# Teacher Schedule Backend v2

## Chạy local
```bash
npm install
npm start
```

API: http://localhost:4000/api/health

## Tính năng v2
- Học sinh có học phí/buổi.
- Điểm danh từng buổi: attended/absent.
- Tự tính tổng tiền đã học và số tiền còn lại.
- Ghi nhận thanh toán.
- Link chia sẻ riêng từng học sinh.
- Cấu hình giờ/tiết học bằng time-slots.

## Lưu ý deploy
SQLite phù hợp để chạy local/demo. Khi deploy production trên Render nên chuyển DB sang PostgreSQL/Supabase để dữ liệu không phụ thuộc filesystem của server.

# ระบบตรวจสอบหน่วยคะแนนการศึกษาต่อเนื่อง — Frontend (GitHub Pages)

## ขึ้นปีใหม่ต้องทำอะไร
**แค่สร้างชีตปีใหม่ในสเปรดชีต** (ตั้งชื่อชีตเป็นปี พ.ศ. 4 หลัก เช่น `2570`) — ไม่ต้องแก้โค้ดใดๆ
- ตัวเลือกปีทั้งสองแท็บมาจาก `?action=years` (Backend อ่านชื่อชีตจริง)
- ปีเริ่มต้น = ปี พ.ศ. ปัจจุบัน ถ้ามีชีตปีนั้น ไม่งั้นใช้ปีล่าสุดที่มีข้อมูล (ไม่แสดง error ช่วงที่ยังไม่สร้างชีต)
- ถ้าต้องการให้เห็นข้อมูลใหม่ทันที ติดตั้ง `setupTriggers()` ใน Backend หนึ่งครั้ง (แคชจะล้างเองเมื่อแก้ชีต)

## ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `index.html`, `app.js`, `style.css` | หน้าเว็บ — ตั้งค่า API/แชทที่ `CONFIG` บนสุดของ `app.js` |
| `tailwind.css` | Tailwind ที่ build แล้ว (commit ขึ้น GitHub ด้วย) |
| `vendor/` | SweetAlert2 และ Font Awesome (self-host ไม่พึ่ง CDN) |
| `tailwind.config.js`, `input.css`, `package.json` | ใช้ build Tailwind เท่านั้น |

## เมื่อเพิ่มคลาส Tailwind ใหม่ใน HTML/JS
```
npm install
npm run build:css
```
แล้ว commit `tailwind.css` ที่ได้ (ถ้าไม่เพิ่มคลาสใหม่ ไม่ต้อง build)

## Deploy
อัปโหลดทุกไฟล์ (ยกเว้น `node_modules/`) ขึ้น GitHub Pages ทับของเดิม

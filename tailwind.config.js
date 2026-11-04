/** ใช้ตอน build เท่านั้น: npm run build:css  (ดู README.md) */
module.exports = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      colors: {
        'c-red': '#E61C2A',   // สีแดง
        'c-sky': '#1178A3',   // สีฟ้า
        'c-navy': '#1C3868',  // สีน้ำเงิน
        'c-main': '#d97706',  // สีส้มทอง
        'c-black': '#1D1D1B', // สีดำ
      },
      fontFamily: { sans: ['Sarabun', 'sans-serif'] },
    },
  },
};

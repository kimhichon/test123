# Bách Gia Các · Bản an toàn local

Ứng dụng quản lý nhiều Facebook Page, lưu nội dung và đăng bài qua Meta Graph API.

## Yêu cầu

- Node.js 22.5 trở lên.
- Tài khoản Meta App đã cấu hình OAuth.
- Không đưa thư mục data, file .env hoặc token vào GitHub.

## Cài đặt và chạy

Mở PowerShell trong thư mục dự án:

    npm install
    $env:PAGEOPS_ADMIN_USER='admin'
    $env:PAGEOPS_ADMIN_PASSWORD='đặt-mật-khẩu-rất-mạnh'
    $env:PAGEOPS_ENCRYPTION_KEY='64-ký-tự-hex'
    $env:META_APP_ID='YOUR_META_APP_ID'
    $env:META_APP_SECRET='YOUR_META_APP_SECRET'
    $env:META_REDIRECT_URI='http://localhost:4173/auth/meta/callback'
    $env:META_GRAPH_VERSION='v26.0'
    npm start

Tạo khóa mã hóa:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

Sau đó mở http://127.0.0.1:4173 và đăng nhập.

## Chuyển dữ liệu cũ

Nếu máy đã có data/state.json, lần chạy đầu tiên sẽ đọc dữ liệu cũ, mã hóa token bằng PAGEOPS_ENCRYPTION_KEY, ghi vào data/pageops.sqlite và xóa state.json sau khi chuyển thành công.

Nếu dữ liệu cũ chứa token đã từng lộ, hãy thu hồi token trên Meta và tạo token mới trước khi chạy.

## Kiểm thử

    npm run check

Bộ kiểm thử kiểm tra mã hóa bí mật, chống đường dẫn thoát thư mục, nhận diện file và lưu/đọc SQLite.

## Bảo mật

- Đăng nhập bằng cookie HttpOnly, SameSite Strict.
- Tài khoản hiện tại là quản trị viên nội bộ.
- Mọi API và file media yêu cầu đăng nhập.
- Token được mã hóa AES-256-GCM trong SQLite.
- Giới hạn kích thước request và upload.
- Kiểm tra chữ ký file media.
- Không lưu token trong giao diện trình duyệt.
- Không chạy qua Internet nếu chưa có HTTPS, người dùng riêng và cơ chế phân quyền phù hợp.

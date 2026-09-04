# 🎓 Internship Management Portal

A full-stack, enterprise-grade web application designed for managing the complete lifecycle of student internships, administrative workflows, document generation (Gyapan, Offer Letters, and Certificates), and secure record management at the **Instruments Research & Development Establishment (IRDE), DRDO**.

---

## 📌 Overview

The **Internship Management Portal** provides a centralized platform that bridges the gap between student applicants and institute administration. It automates repetitive administrative procedures, ensures strict role-based access control, securely stores sensitive student records with AES-256 field-level encryption, and generates official documents in real time.

### 🌟 Key Capabilities
- 📝 **Student Registration & Portal**: Dual pathways for Paid and Unpaid internships, real-time application tracking, profile management, and document uploads.
- 🛡️ **Administrative Dashboard**: Real-time analytics, filtering by branch/institution/financial year, multi-stage approval/rejection workflows, and batch operations.
- 🏢 **Division & Seat Capacity Management**: Configurable intake quotas and division-wise seat allocations.
- 📑 **Dynamic Document Generation**: Automated PDF generation via Puppeteer for official Gyapans, customized Offer Letters, and sequentially numbered Internship Certificates.
- 🔒 **Data Protection & Secure Storage**: S3-compatible MinIO object storage with authenticated streaming proxy and AES-256 encryption for sensitive records (Aadhaar, Bank details).
- ✉️ **Automated Notifications**: Email alerts for application status updates, acceptance, and official communications via Nodemailer.

---

## 🏗️ System Architecture

```
                                  ┌─────────────────────────┐
                                  │      React Frontend     │
                                  │       Vite + JSX        │
                                  │    localhost:5173       │
                                  └────────────┬────────────┘
                                               │
                                               │ REST API (JSON / FormData)
                                               │ Credentials: Include (HttpOnly Cookie)
                                               ▼
                                  ┌─────────────────────────┐
                                  │    Node.js + Express    │
                                  │        Backend          │
                                  │     localhost:5000      │
                                  └────────────┬────────────┘
                                               │
                         ┌─────────────────────┴─────────────────────┐
                         │                                           │
                         ▼                                           ▼
                ┌─────────────────┐                         ┌─────────────────┐
                │   PostgreSQL    │                         │      MinIO      │
                │                 │                         │  Object Storage │
                │ Student Records │                         │                 │
                │ Admin Records   │                         │ Student Photos  │
                │ Configurations  │                         │ Resumes & Docs  │
                │ Activity Logs   │                         │ Generated PDFs  │
                │ Gyapan & Certs  │                         │ Offer Letters   │
                └─────────────────┘                         └─────────────────┘
                         │
                         ▼
                ┌─────────────────┐
                │    Puppeteer    │
                │                 │
                │ Dynamic PDF     │
                │ Document Engine │
                └─────────────────┘
```

---

## 💻 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 18, Vite, React Router v6, Lucide React, Modern CSS & Responsive Design |
| **Backend** | Node.js, Express.js, `cookie-parser`, `cors`, `helmet`, `express-rate-limit` |
| **Database** | PostgreSQL (`pg`), JSONB hybrid querying, automated index initialization |
| **Object Storage** | MinIO (S3-compatible SDK `@aws-sdk/client-s3`) |
| **Document Generation** | Puppeteer, Puppeteer-Core (Headless Chrome) |
| **Security & Auth** | JWT (HttpOnly Cookies), AES-256-CBC Field Encryption, Bcrypt.js |
| **Email Service** | Nodemailer, Google OAuth2 / SMTP |

---

## 🚀 Getting Started & Installation

### Prerequisites
Make sure you have the following installed on your machine:
- **Node.js** (v18.x or v20.x recommended)
- **PostgreSQL** (v14+) running locally or accessible remotely
- **MinIO Server** for local S3 object storage
- **Git**

---

### 1. Clone the Repository
```bash
git clone https://github.com/irdeinternship-spec/Internship-Management-Portal.git
cd Internship-Management-Portal
```

---

### 2. Database Setup (PostgreSQL)
Create a new PostgreSQL database (e.g. `internship_portal`):
```sql
CREATE DATABASE internship_portal;
```

---

### 3. Object Storage Setup (MinIO)
1. Download and start your MinIO server:
```bash
minio.exe server C:\minio\data --console-address ":9001"
```
2. Log into the MinIO Console (`http://localhost:9001`) and create a bucket named `webportal`.

---

### 4. Backend Configuration & Setup

1. Navigate to the `backend` directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the `backend/` folder based on `.env.example`:
```env
PORT=5000
NODE_ENV=development
JWT_SECRET=your_super_secret_jwt_key_here
ENCRYPTION_KEY=32_byte_hex_or_string_key_for_aes256

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=internship_portal
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# Admin Config
MAIN_ADMIN_EMAIL=admin@drdo.local

# MinIO (S3) Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=webportal
MINIO_REGION=us-east-1

# CORS
CORS_ORIGINS=http://localhost:5173

# Email (Optional)
EMAIL_ENABLED=false
```

4. Initialize the database schema & seed administrator:
```bash
npm run db:init
node seedAdmin.js
```

5. Start the backend server:
```bash
npm run dev
```
*Backend runs on `http://localhost:5000`.*

---

### 5. Frontend Configuration & Setup

1. Open a new terminal and navigate to the `web-portal` directory:
```bash
cd web-portal
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file in `web-portal/`:
```env
VITE_API_URL=http://localhost:5000
```

4. Start the frontend development server:
```bash
npm run dev
```
*Frontend runs on `http://localhost:5173`.*

---

## 📁 Project Structure

```
Internship-Management-Portal/
├── backend/
│   ├── config/             # System configuration
│   ├── controllers/        # Route controllers (Admin, Student, Gyapan, Offer Letters)
│   ├── middleware/         # Auth, Role Verification, File Security, Upload middleware
│   ├── models/             # Schema definitions and data access models
│   ├── routes/             # Express API endpoints
│   ├── services/           # DB Store, MinIO S3, Puppeteer PDF generator, Email
│   ├── templates/          # HTML templates for certificates & offer letters
│   ├── utils/              # Encryption utilities and helpers
│   ├── db.js               # PostgreSQL connection pool
│   └── server.js           # Main Express server entry point
│
├── web-portal/
│   ├── src/
│   │   ├── auth/           # Authentication context and hooks
│   │   ├── components/     # Reusable UI components & Protected Routes
│   │   ├── pages/          # Dashboard, Student Portal, Gyapan Editor, Certificates
│   │   ├── services/       # Frontend API communication layer
│   │   ├── styles/         # CSS style definitions
│   │   ├── App.jsx         # App routes & lazy-loading setup
│   │   └── main.jsx        # React root entry point
│   ├── index.html
│   └── vite.config.js
│
└── README.md
```

---

## 🔒 Security Features

- **HttpOnly Cookies**: Prevents client-side script access to sensitive authentication tokens, neutralizing XSS session hijacking.
- **AES-256 Field Encryption**: Encrypts Aadhaar numbers and financial/bank account details at rest before storing in PostgreSQL.
- **Protected File Access Proxy**: All documents uploaded to MinIO are routed through authentication middleware (`protectFileAccess`) with `nosniff` and strict sandbox `Content-Security-Policy`.
- **Brute-Force & Rate Limiting**: Implements IP-based rate limiting on authentication and registration endpoints.
- **No-Cache Headers**: Prevents shared or browser caches from retaining authenticated views after logout.

---

## 👨‍💻 Author & Academic Credits

- **Developer**: Ayush Nautiyal
- **Institution**: **Graphic Era Hill University**
- **Project Domain**: Web Portal & Internship Management System
- **Organization**: Instruments Research & Development Establishment (IRDE), DRDO

---

## 📜 License

This project is developed for academic, internship management, and workflow automation purposes. Refer to the organization and repository guidelines for usage terms.
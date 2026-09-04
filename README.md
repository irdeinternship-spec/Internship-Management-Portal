# Web Portal – Student Internship Management System

A full-stack web application developed for managing the complete student internship lifecycle, including student registration, document submission, verification, administration, internship records, certificate generation, and related administrative activities.

The system provides separate workflows for students and administrators and uses PostgreSQL for application data and MinIO for secure local object/file storage.

---

## Overview

The Web Portal is designed to simplify and centralize internship management activities.

The system allows:

- Students to register for internships.
- Students to submit required documents.
- Administrators to verify and manage student applications.
- Administrators to manage internship-related information.
- Administrators to configure internship settings.
- Generation of internship certificates and other documents.
- Sequential certificate number allocation.
- Storage of application data in PostgreSQL.
- Storage of uploaded files in MinIO.
- Management of administration data and activity logs.

---

# Main Features

## Student Management

- Student registration and profile management.
- Internship application management.
- Application status tracking.
- Reference ID based student records.
- Student document uploads.
- Student authentication and session management.
- Storage of student information in PostgreSQL.

## Admin Management

Administrators can:

- View and manage student applications.
- Verify submitted information and documents.
- Manage internship records.
- Manage administration settings.
- Configure internship capacities and categories.
- Generate and manage certificates.
- View system activity.
- Manage certificate numbering.

## PostgreSQL Database

PostgreSQL is used as the primary database for application data.

The system stores data such as:

- Students
- Administrators
- Administration settings
- Gyapan records
- Activity logs
- Internship durations
- Configuration data

PostgreSQL JSONB structures are used where flexible application data needs to be stored.

Database indexes are created for frequently accessed fields to improve query performance.

---

# MinIO File Storage

MinIO is used as the local S3-compatible object storage system.

Uploaded files are stored in a MinIO bucket instead of being stored directly inside the application directory.

Examples of stored files include:

- Student photographs
- Aadhaar documents
- Resumes
- Permission letters
- Internship documents
- Generated certificates
- Other uploaded application documents

The application uses a dedicated MinIO bucket:

```text
webportal

Files are organized using student-specific prefixes such as:

students/<referenceId>/

MinIO connectivity and bucket availability are checked when the backend starts.

If the configured bucket does not exist, the application can create it automatically.

Certificate Generation

The system supports automated internship certificate generation.

Certificate numbers are sequentially allocated.

For example, if the administrator sets:

Starting Certificate Number = 104

the system generates:

Certificate 1 → 104
Certificate 2 → 105
Certificate 3 → 106
Certificate 4 → 107

The administrator can change the next certificate number from the system configuration page.

Certificate allocation is handled using PostgreSQL transaction and row-level locking to prevent duplicate certificate numbers when multiple requests occur at the same time.

Re-downloading an already generated certificate does not consume another certificate number.

Document Generation

The backend uses Puppeteer for dynamic document generation.

It is used for generating documents such as:

Internship certificates
Offer letters
Gyapans
Other PDF-based documents

Documents are generated dynamically using student and administration data.

Security Features

The application includes several security improvements.

Authentication

JWT-based authentication is used for protected application areas.

Authentication tokens are handled through secure backend-configured cookies.

Protected APIs verify authentication before allowing access to sensitive operations.

Password Security

Passwords are securely hashed before storage.

Passwords and authentication credentials are not printed in application logs.

Environment Variables

Sensitive configuration values are stored in environment variables rather than being hardcoded into the source code.

Examples include:

Database credentials
JWT secret
MinIO credentials
Application configuration
File Upload Security

Uploaded files are validated before storage.

The system includes protections such as:

File type validation
Filename sanitization
Upload restrictions
Protected file access
MinIO-based file storage
SQL Injection Protection

Database operations use parameterized PostgreSQL queries.

Dynamic table and column operations are restricted using allowlists where required.

Security Headers

Security-related HTTP headers are configured on the backend.

Rate Limiting

Rate limiting is applied to protect sensitive endpoints from excessive requests and automated abuse.

Technology Stack
Frontend
React.js
Vite
JavaScript
JSX
CSS
Backend
Node.js
Express.js
PostgreSQL
pg
JWT
Cookie-based authentication
File Storage
MinIO
S3-compatible object storage
AWS SDK for JavaScript
Document Generation
Puppeteer
Other Technologies
Nodemailer
Multer
CORS
dotenv
bcrypt
Archiver
Project Structure
Web-Portal/
│
├── backend/
│   ├── server.js
│   ├── db.js
│   ├── package.json
│   ├── .env
│   ├── controllers/
│   ├── routes/
│   ├── middleware/
│   ├── services/
│   └── ...
│
├── web-portal/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── README.md
└── ...
Database Structure

The application uses PostgreSQL database:

Webportal

Important database tables include:

students
admins
administration
gyapan
activity_logs
durations

The exact database structure may evolve as new application functionality is added.

Environment Configuration

Create a .env file inside the backend directory.

Example:

PORT=5000

# PostgreSQL
PGUSER=postgres
PGHOST=localhost
PGDATABASE=Webportal
PGPASSWORD=your_postgres_password
PGPORT=5432

# JWT
JWT_SECRET=your_secure_jwt_secret

# MinIO
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=your_minio_access_key
MINIO_SECRET_KEY=your_minio_secret_key
MINIO_BUCKET=webportal

Do not commit the .env file to GitHub.

Add it to .gitignore:

.env
.env.*
PostgreSQL Setup

Install PostgreSQL on the development machine.

Create the application database:

CREATE DATABASE Webportal;

Then configure the PostgreSQL credentials in:

backend/.env

The backend automatically establishes a PostgreSQL connection during startup.

A successful connection should display:

✅ PostgreSQL connected
PostgreSQL test successful:
MinIO Setup

MinIO is required for local file storage.

On Windows, place the MinIO executable in:

C:\minio\minio.exe

Create the data directory:

C:\minio\data

The structure should look like:

C:\minio
│
├── minio.exe
│
└── data

Start MinIO using PowerShell:

cd C:\minio

.\minio.exe server C:\minio\data --console-address ":9001"

When MinIO starts successfully, it provides:

API: http://127.0.0.1:9000
WebUI: http://127.0.0.1:9001

Open the MinIO web console:

http://localhost:9001

Create or use the configured bucket:

webportal

Keep the MinIO PowerShell window running while the application is using local MinIO storage.

Installing the Project

Clone the repository:

git clone <repository-url>

Move into the project:

cd Web-Portal
Backend Setup

Open a terminal in the backend directory:

cd backend

Install dependencies:

npm install

Start the backend in development mode:

npm run dev

Or start normally:

npm start

A successful startup should display messages similar to:

🚀 Server running on port 5000
✅ PostgreSQL connected
✅ MinIO connected
✅ MinIO bucket ready: webportal
Frontend Setup

Open another terminal.

Move to the frontend directory:

cd web-portal

Install dependencies:

npm install

Start the frontend:

npm run dev

The frontend will normally be available at:

http://localhost:5173
Running the Complete Application

For local development, two services need to be running.

Terminal 1 – MinIO
cd C:\minio
.\minio.exe server C:\minio\data --console-address ":9001"
Terminal 2 – Backend
cd C:\Users\DELL\Downloads\Web-Portal\backend
npm run dev
Terminal 3 – Frontend
cd C:\Users\DELL\Downloads\Web-Portal\web-portal
npm run dev

Then open:

http://localhost:5173
Important URLs
Frontend
http://localhost:5173
Admin Dashboard
http://localhost:5173/admin/dashboard
System Configuration
http://localhost:5173/admin/system-configuration

This page is used to manage system configuration such as:

Internship seat capacities
Division categories
Starting/next certificate number
Admin Certificates
http://localhost:5173/admin/certificates

This page provides certificate-related administrative operations such as:

Certificate generation
Certificate editing
Batch downloading
Printing
Signature configuration
MinIO Console
http://localhost:9001
PostgreSQL

PostgreSQL normally runs on:

localhost:5432
Data Storage Architecture

The application uses separate storage systems depending on the type of data.

                    Web Portal
                        |
              +---------+---------+
              |                   |
          PostgreSQL             MinIO
              |                   |
        Application Data       Uploaded Files
              |                   |
       +------+-------+       +---+------------+
       |      |       |       |   |    |       |
    Students Admin Logs    Photos PDFs Resumes Documents

PostgreSQL stores structured application information, while MinIO stores uploaded and generated files.

Data Flow

A typical student registration flow is:

Student
   |
   v
React Frontend
   |
   v
Express Backend
   |
   +------> PostgreSQL
   |          |
   |          +--> Student/Application Data
   |
   +------> MinIO
              |
              +--> Uploaded Documents
Certificate Flow
Administrator
      |
      v
System Configuration
      |
      v
Starting Certificate Number
      |
      v
Student Certificate Request
      |
      v
PostgreSQL Transaction
      |
      v
Allocate Next Certificate Number
      |
      v
Puppeteer
      |
      v
Generate Certificate
      |
      v
MinIO
API Architecture

The backend follows a REST-style architecture.

Frontend
   |
   v
Express API
   |
   +---- Authentication
   |
   +---- Student APIs
   |
   +---- Admin APIs
   |
   +---- Administration APIs
   |
   +---- Certificate APIs
   |
   +---- File APIs
   |
   +---- Activity Log APIs
   |
   +---- PostgreSQL
   |
   +---- MinIO
Migration from JSON Storage

The earlier version of the application used JSON files for storing application information.

The updated architecture uses PostgreSQL as the primary application database.

The migration process includes:

Reading existing JSON data.
Mapping the data to PostgreSQL tables.
Inserting existing records into PostgreSQL.
Updating application APIs to use PostgreSQL.
Verifying data through the application.
Moving uploaded files to MinIO.
Testing all major workflows.
Removing legacy JSON storage only after successful verification.

Legacy data should not be deleted until the PostgreSQL and MinIO implementation has been fully tested.

File Storage Migration

Previously, uploaded files could be stored locally inside the application.

The updated system uses MinIO.

Old:

Application
    |
    +--> Local Upload Folder


New:

Application
    |
    +--> MinIO
          |
          +--> webportal
                |
                +--> student/referenceId/

This separates application code from uploaded file storage and provides an S3-compatible storage interface.

Development Commands
Backend

Install dependencies:

npm install

Development server:

npm run dev

Production-style start:

npm start
Frontend

Install dependencies:

npm install

Development server:

npm run dev
Troubleshooting
PostgreSQL connection error

Check:

PostgreSQL service is running.
Database name is correct.
Username is correct.
Password is correct.
Port is correct.

Default PostgreSQL port:

5432
MinIO connection error

If the backend shows:

❌ MinIO connection failed
ECONNREFUSED 127.0.0.1:9000

make sure MinIO is running.

Start it with:

cd C:\minio
.\minio.exe server C:\minio\data --console-address ":9001"

Then verify:

http://localhost:9001
MinIO executable error

If Windows reports:

The specified executable is not a valid application for this OS platform.

check that minio.exe is a valid Windows AMD64 executable and that the file is not corrupted.

Check its size:

Get-Item C:\minio\minio.exe | Select-Object Name,Length

A valid downloaded executable should be much larger than a few bytes.

Security Recommendations

For deployment:

Never commit .env files.
Use strong PostgreSQL passwords.
Use strong MinIO credentials.
Use a strong randomly generated JWT secret.
Do not use default MinIO credentials in production.
Keep PostgreSQL inaccessible from unnecessary external networks.
Keep MinIO private unless external access is specifically required.
Use HTTPS in production.
Keep dependencies updated.
Regularly run dependency vulnerability checks.
Keep backups of PostgreSQL and MinIO data.
Future Improvements

Possible future improvements include:

Automated database backups.
Automated MinIO backups.
Production deployment.
HTTPS configuration.
Email notification improvements.
Advanced admin reporting.
Internship analytics dashboard.
Automated certificate verification.
Role-based administrative permissions.
Improved audit logging.
License

This project is developed for internship/project purposes.

Author

Naina Kharola

Student Internship Management System
Web Portal Project
Web Portal – Student Internship Management System

A full-stack web application for managing student internship registrations, administrative workflows, training management, document management, Gyapan generation, offer letters, and internship certificates at Instruments Research & Development Establishment (IRDE), DRDO.

📌 Overview

The Web Portal – Student Internship Management System is designed to provide a centralized platform for managing the complete student internship lifecycle.

The system supports:

Student internship registration
Student login and authentication
Administrative login and management
Student approval/rejection workflows
Internship and training management
Division and seat management
Student document management
Secure file storage
Offer letter generation
Gyapan generation
Internship certificate generation
Sequential certificate numbering
Activity logging
Duration management
System configuration

The application uses:

React + Vite for the frontend
Node.js + Express for the backend
PostgreSQL for application data
MinIO for S3-compatible object/file storage
Puppeteer for dynamic document generation
🏗️ System Architecture
                         ┌─────────────────────────┐
                         │      React Frontend     │
                         │       Vite + JSX        │
                         │    localhost:5173       │
                         └────────────┬────────────┘
                                      │
                                      │ REST API
                                      ▼
                         ┌─────────────────────────┐
                         │    Node.js + Express     │
                         │        Backend           │
                         │     localhost:5000       │
                         └────────────┬────────────┘
                                      │
                         ┌────────────┴────────────┐
                         │                         │
                         ▼                         ▼
                ┌─────────────────┐       ┌─────────────────┐
                │   PostgreSQL    │       │      MinIO      │
                │                 │       │                 │
                │ Student Data    │       │ Photos          │
                │ Admin Data      │       │ Resumes         │
                │ Configuration   │       │ Result Files    │
                │ Activity Logs   │       │ Certificates     │
                │ Gyapan Data     │       │ Offer Letters   │
                │ Certificates    │       │ Other Documents│
                └─────────────────┘       └─────────────────┘
                                      │
                                      ▼
                              ┌─────────────────┐
                              │    Puppeteer    │
                              │                 │
                              │ PDF Generation  │
                              │ Certificates    │
                              │ Offer Letters   │
                              │ Gyapans         │
                              └─────────────────┘
🔐 Authentication & Session Security

The application uses HttpOnly cookies for authentication sessions.

Authentication tokens are handled by the backend and are not directly accessible to JavaScript running in the browser.

Authenticated frontend requests use:

credentials: "include"

This allows the browser to automatically include the authentication cookie with requests to the backend.

The backend is responsible for:

Authentication
Session verification
Authorization
Protected API access
Administrative access control
Student access control
🗄️ PostgreSQL Database

PostgreSQL is the primary persistent database used by the application.

The database stores application metadata and structured information, including:

Student records
Administrator records
System configuration
Administration data
Training Management data
Gyapan data
Activity logs
Duration information
Certificate information

The application uses PostgreSQL JSONB structures where appropriate while maintaining PostgreSQL as the persistent storage layer.

Database Indexes

Database indexes are automatically initialized when the backend starts.

Indexes are created for frequently accessed fields such as:

email
status
referenceId

This improves query performance and reduces unnecessary full-table scans.

On startup, the backend performs database initialization and reports:

Creating database indexes if not exist...
✅ Database indexes ready
📦 MinIO Object Storage

MinIO is used as the application's S3-compatible object storage system.

The actual uploaded files are stored in MinIO rather than PostgreSQL.

Files can include:

Student photographs
Aadhaar documents
Resumes
Result documents
Permission letters
Generated certificates
Offer letters
Other internship-related documents

The configured bucket is:

webportal
MinIO Storage Structure

Files are organized using student-specific prefixes based on their unique referenceId.

Example:

webportal/
│
├── <referenceId-1>/
│   ├── photo/
│   ├── resume/
│   ├── result/
│   ├── permission-letter/
│   └── certificates/
│
├── <referenceId-2>/
│   ├── photo/
│   ├── resume/
│   └── result/
│
└── ...
MinIO Startup Check

When the backend starts, it checks:

Whether MinIO is reachable
Whether the configured bucket exists
Whether the bucket is ready for use

If the bucket does not exist, it is created automatically.

Successful startup output:

✅ MinIO connected
✅ MinIO bucket ready: webportal
🔢 Sequential Certificate Numbering

The internship certificate generator supports sequential certificate numbering.

Administrators can configure the Starting/Next Certificate Number from:

/admin/system-configuration

For example, if the administrator sets:

Starting/Next Certificate Number: 104

the system generates:

Certificate 1 → 104
Certificate 2 → 105
Certificate 3 → 106
Certificate 4 → 107

If the administrator changes the next number to:

200

the next generated certificate becomes:

200

followed by:

201
202
203
...
Transaction-Safe Number Allocation

Certificate number allocation uses PostgreSQL transactions and row-level locking.

The implementation uses:

SELECT ... FOR UPDATE

This prevents race conditions when multiple certificates are generated at the same time.

The certificate number is reserved atomically before the sequence advances.

Existing Certificates

Generating or downloading an existing certificate does not consume another certificate number.

For example:

Student A → Certificate No. 104

If the certificate is downloaded again, it remains:

Certificate No. 104

It does not become:

105

This prevents unnecessary gaps and duplicate certificate numbers.

📄 Document Generation

The application uses Puppeteer to dynamically render HTML templates into documents.

Puppeteer is used for:

Internship certificates
Offer letters
Gyapan documents
Training-related documents
Other generated PDF documents

The general workflow is:

Application Data
      ↓
HTML Template
      ↓
Dynamic Data Replacement
      ↓
Puppeteer
      ↓
PDF
      ↓
MinIO
🎓 Student Registration Workflow

The general student workflow is:

Student Registration
        ↓
Form Validation
        ↓
Student Data
        ↓
PostgreSQL
        ↓
Uploaded Documents
        ↓
MinIO
        ↓
Admin Review
        ↓
Approval / Rejection
        ↓
Training Management
        ↓
Internship Workflow
        ↓
Certificate / Documents
👨‍💼 Administration

The administrative system provides functionality for managing students and internship workflows.

Administrators can manage:

Student registrations
Student status
Student approvals/rejections
Internship information
Training Management
Division allocation
Seat capacities
System configuration
Certificates
Gyapans
Documents
Activity logs
Other administrative information
⚙️ System Configuration

System configuration is available at:

http://localhost:5173/admin/system-configuration

The page provides configuration functionality such as:

Seat capacities
Division categories
Starting/Next Certificate Number
Other configurable portal settings
📜 Certificate Management

Certificate management is available at:

http://localhost:5173/admin/certificates

Administrators can:

Generate certificates
Download certificates
Batch download certificates
Print certificates
Configure authorized signature information
Manage certificate generation workflows

Certificates contain the sequential certificate number assigned by the PostgreSQL-backed numbering system.

📝 Gyapan Management

The portal supports Gyapan generation for internship-related administrative workflows.

Gyapan information is persisted through PostgreSQL.

Puppeteer is used to generate the final document from the appropriate HTML template.

The generated document can be stored and managed through the application's document storage system.

📁 File Upload Workflow

The application uses MinIO for uploaded documents.

The workflow is:

Student
   ↓
React Frontend
   ↓
Express Backend
   ↓
Validation
   ↓
MinIO
   ↓
Object Storage

PostgreSQL stores the corresponding application metadata and object references.

The actual file binary is stored in MinIO.

🧩 Technology Stack
Frontend
Technology	Purpose
React.js	Frontend framework
Vite	Frontend development/build tool
JavaScript	Application language
JSX	React UI
CSS	Styling
Backend
Technology	Purpose
Node.js	Backend runtime
Express.js	REST API framework
pg	PostgreSQL driver
cookie-parser	Cookie handling
JWT	Authentication
MinIO / AWS S3 SDK	Object storage
Puppeteer	Document generation
Storage
PostgreSQL

Used for:

Student information
Admin information
Administration data
System configuration
Training Management
Gyapan data
Activity logs
Durations
Certificate information
Application metadata
MinIO

Used for:

Photos
Aadhaar documents
Resumes
Result documents
Permission letters
Certificates
Offer letters
Generated documents
Other uploaded files
📁 Project Structure
Web-Portal/
│
├── backend/
│   │
│   ├── data/
│   │
│   ├── templates/
│   │
│   ├── server.js
│   ├── package.json
│   ├── .env
│   └── ...
│
├── web-portal/
│   │
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── README.md
└── ...
💻 Local Development Requirements

Before running the project, install:

Node.js
npm
PostgreSQL
MinIO

The default local service configuration is:

Service	Address
Frontend	http://localhost:5173
Backend	http://localhost:5000
PostgreSQL	localhost:5432
MinIO API	http://127.0.0.1:9000
MinIO Console	http://localhost:9001
🗄️ PostgreSQL Setup

Make sure PostgreSQL is installed and running.

Create the application database:

Webportal

PostgreSQL should be available on:

localhost:5432

Example configuration:

PGUSER=postgres
PGHOST=localhost
PGDATABASE=Webportal
PGPASSWORD=your_postgres_password
PGPORT=5432
📦 MinIO Setup

Create a local MinIO data directory.

Example:

C:\minio\data

Start MinIO:

cd C:\minio


.\minio.exe server C:\minio\data --console-address ":9001"

MinIO will provide:

API:
http://127.0.0.1:9000

and:

Web Console:
http://localhost:9001

The application's configured bucket is:

webportal
🔐 Environment Configuration

Create:

backend/.env

Example:

PORT=5000


JWT_SECRET=your_secure_jwt_secret


# PostgreSQL
PGUSER=postgres
PGHOST=localhost
PGDATABASE=Webportal
PGPASSWORD=your_postgres_password
PGPORT=5432


# MinIO
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=webportal

Important: The credentials above are examples for local development. Use strong credentials for production.

Never commit your real .env file to Git.

🚀 Running the Backend

Open a terminal:

cd Web-Portal\backend

Install dependencies:

npm install

Run the development server:

npm run dev

A successful startup should look similar to:

🚀 Server running on port 5000
✅ MinIO connected
✅ MinIO bucket ready: webportal
✅ PostgreSQL connected
PostgreSQL test successful:
Creating database indexes if not exist...
✅ Database indexes ready
🌐 Running the Frontend

Open another terminal:

cd Web-Portal\web-portal

Install dependencies:

npm install

Start the frontend:

npm run dev

The frontend will normally be available at:

http://localhost:5173
🔗 Important Application URLs
Main Application
http://localhost:5173
Admin Dashboard
http://localhost:5173/admin/dashboard
System Configuration
http://localhost:5173/admin/system-configuration

Used for:

Seat capacities
Division configuration
Certificate numbering
Other system configuration
Certificate Management
http://localhost:5173/admin/certificates

Used for:

Certificate generation
Certificate downloads
Batch certificate downloads
Printing
Authorized signature configuration
MinIO Console
http://localhost:9001
🔄 Complete Data Flow
Student Data
Student
   ↓
React Form
   ↓
Express API
   ↓
Validation
   ↓
PostgreSQL
Student Documents
Student
   ↓
React Upload
   ↓
Express API
   ↓
File Validation
   ↓
MinIO
   ↓
webportal Bucket
Certificate
Admin
   ↓
Select Student
   ↓
Certificate Generator
   ↓
PostgreSQL Certificate Number
   ↓
HTML Template
   ↓
Puppeteer
   ↓
PDF
   ↓
MinIO
🔢 Certificate Number Example

Suppose the administrator configures:

Next Certificate Number = 104

The system produces:

Student 1 → 104
Student 2 → 105
Student 3 → 106
Student 4 → 107

If the administrator changes the configuration to:

Next Certificate Number = 500

then:

Next certificate → 500
Next certificate → 501
Next certificate → 502

Previously generated certificates retain their original numbers.

🧪 Testing

Before considering the system ready for production, verify the following.

Authentication
Admin login works
Student login works
Unauthorized users cannot access protected APIs
Authentication cookies are correctly handled
PostgreSQL
Student registration is stored
Admin data is stored
Configuration changes persist
Certificate numbers persist after server restart
MinIO
Files upload successfully
Files appear inside webportal
Files can be retrieved by authorized users
Deleted files are removed correctly
MinIO remains available after backend restart
Certificate Generation
Certificate generates successfully
Certificate number is correct
Certificate number increments correctly
Existing certificates retain their numbers
Concurrent generation does not produce duplicate numbers
Documents
Offer letters generate correctly
Gyapans generate correctly
Certificates generate correctly
Generated files can be downloaded
🛠️ Troubleshooting
PostgreSQL Connection Error

If PostgreSQL fails to connect, check:

PGUSER
PGHOST
PGDATABASE
PGPASSWORD
PGPORT

Verify PostgreSQL is running on:

localhost:5432
MinIO Connection Error

If the backend shows:

❌ MinIO connection failed
connect ECONNREFUSED 127.0.0.1:9000

MinIO is probably not running.

Start it using:

cd C:\minio


.\minio.exe server C:\minio\data --console-address ":9001"

Keep the MinIO PowerShell window open.

Then restart the backend.

MinIO Console Not Opening

Open:

http://localhost:9001

Make sure the MinIO server terminal is still running.

Frontend Not Opening

Make sure the frontend development server is running:

npm run dev

Then open:

http://localhost:5173
🔒 Security Guidelines

The following information should never be committed to the repository:

.env
Database passwords
JWT secrets
MinIO secret keys
OAuth credentials
API keys
Private credentials

Use environment variables for all sensitive configuration.

For production deployments, use:

HTTPS
Strong JWT secrets
Strong PostgreSQL passwords
Strong MinIO credentials
Restricted CORS origins
Secure cookie configuration
Network/firewall restrictions
Regular dependency updates
Regular security testing
Regular database backups
🚀 Production Considerations

Before deploying the application to production:

Replace development credentials.
Use HTTPS.
Configure secure cookies.
Restrict CORS to trusted domains.
Use strong PostgreSQL credentials.
Use strong MinIO credentials.
Do not expose MinIO unnecessarily to the public internet.
Configure database backups.
Configure MinIO backups.
Review application logs for sensitive information.
Run dependency vulnerability scans.
Perform authentication and authorization testing.
Test file-upload security.
Verify that private student documents cannot be accessed without authorization.
📊 Storage Architecture

The application separates database storage from file/object storage.

                 WEB PORTAL
                     │
            ┌────────┴────────┐
            │                 │
            ▼                 ▼
       PostgreSQL           MinIO
            │                 │
            │                 │
     Structured Data       File Objects
            │                 │
            ├── Students      ├── Photos
            ├── Admins        ├── Resumes
            ├── Config        ├── Results
            ├── Logs          ├── Permission Letters
            ├── Gyapan        ├── Certificates
            ├── Durations     └── Offer Letters
            └── Certificates

This separation allows PostgreSQL to handle application data while MinIO handles large binary files.

📌 Key Features Summary
Feature	Technology
Frontend	React + Vite
Backend	Node.js + Express
Database	PostgreSQL
Object Storage	MinIO
Authentication	JWT + HttpOnly Cookies
Document Generation	Puppeteer
Student Management	PostgreSQL
Admin Management	PostgreSQL
File Management	MinIO
Certificate Numbering	PostgreSQL Transactions
Certificate Generation	Puppeteer
Gyapan Generation	Puppeteer
Offer Letter Generation	Puppeteer
Configuration	PostgreSQL
📜 License

This project is developed for internship management and administrative workflow purposes at:

Instruments Research & Development Establishment (IRDE), DRDO

Refer to the repository's applicable licensing and usage policies for further information.

👩‍💻 Project

Project Name: Web Portal – Student Internship Management System

Organization: Instruments Research & Development Establishment (IRDE), DRDO

Architecture:

React + Vite
      │
      ▼
Node.js + Express
      │
 ┌────┴─────────────┐
 ▼                  ▼
PostgreSQL          MinIO
 │                  │
 │                  │
 ▼                  ▼
Application       Documents
Data              & Files
 │
 └────────┬─────────┘
          ▼
      Puppeteer
          │
          ▼
 Generated Documents
⭐ Quick Start

For a quick local setup:

1. Start PostgreSQL

Make sure PostgreSQL is running on:

localhost:5432
2. Start MinIO
cd C:\minio
.\minio.exe server C:\minio\data --console-address ":9001"
3. Start Backend
cd C:\Users\DELL\Downloads\Web-Portal\backend
npm install
npm run dev
4. Start Frontend
cd C:\Users\DELL\Downloads\Web-Portal\web-portal
npm install
npm run dev
5. Open the Application
http://localhost:5173

The application is now ready for local development and testing.#   I n t e r n s h i p - M a n a g e m e n t - P o r t a l  
 
# CIT Student FAQ Portal

FAQ automation project for Cambridge Institute of Technology, KR Puram.

**Flow:** `cit_faq.xlsx` → UiPath robot → Salesforce (`Student_FAQ__c`) → this website

| Page | URL | Who | What |
|---|---|---|---|
| Home | `/` | Everyone | Search, topics, most asked questions |
| FAQ | `/faq` | Students | Search and read answers (read only) |
| Admin | `/admin` | Admin (password) | Add, edit, upload FAQs from Excel |

## Tech stack
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js + Express (`server.js`)
- Database: Salesforce custom object `Student_FAQ__c`
  - `FAQ_Code__c` (Text, Unique, External ID), `Question__c`, `Answer__c`, `Category__c`
- Salesforce access: REST API with OAuth 2.0 Client Credentials (External Client App)
- Excel import: UiPath Studio robot (`CIT_FAQ_Sync`), plus Excel upload on the admin page

## Security
- Salesforce credentials live only on the server (`.env` / Render environment variables), never in the browser.
- Admin routes are protected on the server with a signed, httpOnly session cookie. Hiding the Admin link would not be enough, so the API itself rejects unauthenticated writes (HTTP 401).
- All FAQ text is HTML escaped before display.
- Duplicate prevention: every insert uses Salesforce upsert on the External ID `FAQ_Code__c`.

## Run locally
```
npm install
copy .env.example .env      (Windows)   or   cp .env.example .env
```
Fill in `.env`, then:
```
npm start
```
Open http://localhost:3000

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/faqs` | Public | List all FAQs |
| POST | `/api/admin/login` | Public | Admin sign in |
| POST | `/api/admin/logout` | Admin | Sign out |
| POST | `/api/admin/faqs` | Admin | Add FAQ (code auto generated) |
| PATCH | `/api/admin/faqs/:id` | Admin | Edit FAQ |
| POST | `/api/admin/faqs/bulk` | Admin | Upsert rows from Excel |

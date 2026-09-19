# Teacher Schedule Backend

## Render + PostgreSQL
Set these Environment Variables in the Render Web Service:

- `DATABASE_URL`: Internal Database URL of the Render PostgreSQL database
- `PORT`: Render provides this automatically; the server listens on `process.env.PORT`

Build/Start:
- Build command: `npm install`
- Start command: `npm start`

The backend now uses PostgreSQL and creates its tables automatically on first start. Do not commit the real database password to GitHub.

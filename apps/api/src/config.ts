import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    console.warn(`[config] Missing env: ${name} (continuing — some endpoints may fail)`);
    return '';
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

export const config = {
  db: {
    host: required('DB_HOST'),
    port: Number(optional('DB_PORT', '5432')),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    ssl: optional('DB_SSL', 'false').toLowerCase() === 'true',
  },
  s3: {
    endpoint: required('S3_ENDPOINT'),
    bucket: required('S3_BUCKET'),
    accessKey: required('S3_ACCESS_KEY'),
    secretKey: required('S3_SECRET_KEY'),
    region: optional('S3_REGION', 'us-east-1'),
  },
  server: {
    port: Number(optional('PORT', '3001')),
    // Detrás de Nginx el API no debe quedar expuesto al exterior: por defecto
    // escucha solo en loopback. Usar 0.0.0.0 únicamente si se accede directo.
    host: optional('HOST', '127.0.0.1'),
    corsOrigin: optional('CORS_ORIGIN', '*'),
  },
};

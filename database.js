/**
 * Firebase Realtime Database Data Access Object (DAO)
 * Replaces SQLite. Uses REST API to avoid heavy dependencies.
 */
require('dotenv').config();

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://payment-2e43c-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_DB_SECRET || '';

function getUrl(path, queryParams = '') {
  const authParam = FIREBASE_SECRET ? `auth=${FIREBASE_SECRET}` : '';
  const q = [authParam, queryParams].filter(Boolean).join('&');
  return `${FIREBASE_DB_URL}/${path}.json${q ? '?' + q : ''}`;
}

async function get(path) {
  const res = await fetch(getUrl(path));
  if (!res.ok) {
    const err = await res.text();
    console.warn('[DB GET Error]', res.status, err);
    return null;
  }
  return await res.json();
}

async function put(path, data) {
  const res = await fetch(getUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Firebase PUT failed');
  return json;
}

async function patch(path, data) {
  const res = await fetch(getUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Firebase PATCH failed');
  return json;
}

async function remove(path) {
  const res = await fetch(getUrl(path), { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Firebase DELETE failed');
  return json;
}

/**
 * Gets all items under a path and returns as an array of objects
 */
async function getAll(path) {
  const data = await get(path);
  if (!data) return [];
  return Object.values(data);
}

/**
 * Query items efficiently via Firebase REST API
 */
async function query(path, field, value) {
  // Ensure the value is JSON stringified for the URL (e.g., "ent_123" needs to be literally '"ent_123"')
  const queryParams = `orderBy="${field}"&equalTo=${encodeURIComponent(JSON.stringify(value))}`;
  const res = await fetch(getUrl(path, queryParams));
  if (!res.ok) return [];
  const data = await res.json();
  if (!data) return [];
  return Object.values(data);
}

/**
 * Filter items in memory (Use query() instead for large collections)
 */
async function find(path, predicate) {
  const arr = await getAll(path);
  return arr.filter(predicate);
}

async function findOne(path, predicate) {
  const arr = await getAll(path);
  return arr.find(predicate) || null;
}

module.exports = { get, put, patch, remove, getAll, find, findOne, query };

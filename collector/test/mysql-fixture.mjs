import { randomBytes } from 'node:crypto';
import { MySqlStore } from '../src/mysql-store.mjs';

// Exercise the real MySQL transaction implementation in a disposable table.
// The application's records table is never used for fixture data.
export async function mysqlFixture() {
  if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL required for isolated MySQL tests');
  const original = await MySqlStore.connect(process.env.MYSQL_URL);
  const table = 'reader_probe_' + randomBytes(8).toString('hex');
  await original.pool.query(`CREATE TABLE ${table} LIKE records`);
  function wrap(target) {
    return new Proxy(target, { get(object, key) {
      if (key === 'execute') return (sql, params) => object.execute(sql.replace(/\brecords\b/g, table), params);
      if (key === 'getConnection') return async () => wrap(await object.getConnection());
      const value = Reflect.get(object, key);
      return typeof value === 'function' ? value.bind(object) : value;
    } });
  }
  const store = new MySqlStore(wrap(original.pool));
  store.close = async () => {
    try { await original.pool.query(`DROP TABLE ${table}`); }
    finally { await original.close(); }
  };
  return store;
}

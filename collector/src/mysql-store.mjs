import mysql from 'mysql2/promise';

export class MySqlStore {
  constructor(pool) { this.pool = pool; }

  static async connect(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mysql:') throw new Error('MYSQL_URL must use mysql://');
    const pool = mysql.createPool({
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.slice(1)),
      waitForConnections: true,
      connectionLimit: 5,
      timezone: 'Z',
    });
    try {
      await pool.query('CREATE TABLE IF NOT EXISTS records (kind VARCHAR(32) NOT NULL, id VARCHAR(255) NOT NULL, body JSON NOT NULL, PRIMARY KEY(kind,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
      return new MySqlStore(pool);
    } catch (error) { await pool.end(); throw error; }
  }

  async get(kind, id) {
    const [rows] = await this.pool.execute('SELECT body FROM records WHERE kind=? AND id=?', [kind, id]);
    return rows.length ? parseBody(rows[0].body) : null;
  }
  async getForUpdate(kind, id) {
    const [rows] = await this.pool.execute('SELECT body FROM records WHERE kind=? AND id=? FOR UPDATE', [kind, id]);
    return rows.length ? parseBody(rows[0].body) : null;
  }
  async list(kind) {
    const [rows] = await this.pool.execute('SELECT body FROM records WHERE kind=?', [kind]);
    return rows.map(row => parseBody(row.body));
  }
  async put(kind, value) {
    await this.pool.execute('INSERT INTO records (kind,id,body) VALUES (?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body)', [kind, value.id, JSON.stringify(value)]);
    return value;
  }
  async delete(kind, id) { await this.pool.execute('DELETE FROM records WHERE kind=? AND id=?', [kind, id]); }
  async touchDevice(id, at) { await this.pool.execute("UPDATE records SET body=JSON_SET(body,'$.lastSeen',?) WHERE kind='device' AND id=?", [at, id]); }
  async transaction(work) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MySqlStore(connection));
      await connection.commit();
      return result;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async close() { await this.pool.end(); }
}

function parseBody(body) { return typeof body === 'string' ? JSON.parse(body) : body; }

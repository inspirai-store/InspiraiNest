import fs from 'node:fs/promises';
import path from 'node:path';
import OSS from 'ali-oss';

export class LocalStorage {
  constructor(root) { this.root = root; }
  async put(key, buffer) {
    const file = path.join(this.root, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, buffer, { mode: 0o600 });
    await fs.rename(temp, file);
  }
  async get(key) { return fs.readFile(path.join(this.root, key)); }
}

export class OssStorage {
  constructor(options) {
    this.client = new OSS({ ...options, secure: true });
  }
  async put(key, buffer) {
    await this.client.put(key, buffer, { headers: { 'Content-Type': 'application/json', 'x-oss-object-acl': 'private' } });
  }
  async get(key) { return (await this.client.get(key)).content; }
}

import fs from 'node:fs';
import path from 'node:path';
import { hash, requireValue, canonicalJson } from './common.mjs';
import { packageSkill } from './skill-package.mjs';

export const sharedSkillRoot = home => path.join(home, '.agent', 'skills');
export const pathExists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
export const linkType = process.platform === 'win32' ? 'junction' : 'dir';
export function skillArtifacts(entry, id) {
  // Keep prior versions and staging outside every Agent's skills directory.
  const root = path.join(path.dirname(path.dirname(entry)), '.lingnest-skill-state');
  const name = id + '-' + hash(entry).slice(0, 12);
  return { stage: path.join(root, name + '.stage'), backup: path.join(root, name + '.backup') };
}

// Resolve the parent, preserving the last component so replacing an Agent
// reference never renames or removes the directory it currently points at.
export function entryPath(file) {
  const parent = path.dirname(file);
  if (fs.existsSync(parent)) return path.join(fs.realpathSync(parent), path.basename(file));
  requireValue(!pathExists(parent), '技能目录的上层链接已失效，请先修复');
  requireValue(parent !== file, '技能目录无效');
  return path.join(entryPath(parent), path.basename(file));
}

export function referenceState(file) {
  const entry = entryPath(file);
  const stat = pathExists(entry) ? fs.lstatSync(entry) : null;
  const link = stat?.isSymbolicLink() ? fs.readlinkSync(entry) : null;
  requireValue(!stat || stat.isDirectory() || link !== null, '技能入口不是目录');
  let real = entry;
  if (stat) {
    requireValue(fs.existsSync(entry), '技能共享链接已失效，请先修复');
    real = fs.realpathSync(entry);
  }
  const value = { entry, kind: link !== null ? 'link' : stat ? 'directory' : 'missing', link, real,
    hash: stat ? packageSkill(real, { validate: false }).hash : null };
  return { ...value, fingerprint: hash(canonicalJson(value)) };
}

export function pointsTo(file, destination) {
  try { return fs.lstatSync(file).isSymbolicLink() && path.resolve(path.dirname(file), fs.readlinkSync(file)) === path.resolve(destination); } catch { return false; }
}

export function removeEntry(file) {
  if (!pathExists(file)) return;
  if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
  else fs.rmSync(file, { recursive: true });
}

export function applySkillLinks(links) {
  for (const link of links) {
    fs.mkdirSync(path.dirname(link.entry), { recursive: true });
    fs.mkdirSync(path.dirname(link.stage), { recursive: true });
    fs.mkdirSync(path.dirname(link.backup), { recursive: true });
    requireValue(!pathExists(link.stage) && !pathExists(link.backup), '技能链接临时目录已存在');
    if (link.restore) {
      if (link.originalLink !== null) fs.symlinkSync(process.platform==='win32' ? path.resolve(path.dirname(link.entry),link.originalLink) : link.originalLink, link.stage, linkType);
      else fs.cpSync(link.restore, link.stage, { recursive: true, dereference: false });
    } else if (!link.remove) fs.symlinkSync(link.destination, link.stage, linkType);
    if (pathExists(link.entry)) fs.renameSync(link.entry, link.backup);
    if (pathExists(link.stage)) fs.renameSync(link.stage, link.entry);
  }
}

export function recoverSkillLinks(transaction) {
  if (transaction.committed) return;
  for (const link of [...(transaction.links || [])].reverse()) {
    if (pathExists(link.backup)) {
      if (pathExists(link.entry)) {
        if (pointsTo(link.entry, link.destination)) removeEntry(link.entry);
        else {
          // A user may edit a restored directory during interrupted rollback.
          // Keep it rather than deleting anything not proven to be our link.
          const preserved = path.join(path.dirname(link.entry), '.lingnest-preserved-' + transaction.id + '-' + hash(link.entry).slice(0, 12));
          requireValue(!pathExists(preserved), '恢复目录已存在，请先保留本地修改');
          fs.renameSync(link.entry, preserved);
        }
      }
      fs.renameSync(link.backup, link.entry);
    } else if (link.originalKind === 'missing' && pointsTo(link.entry, link.destination)) removeEntry(link.entry);
    removeEntry(link.stage);
  }
}

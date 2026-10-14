import type { Connection } from '../../records/data/types.ts';

export type LibraryFile = { path: string; role: string; bytes: number | null; sha256: string | null };
export type LibraryEntry = { id: string; archive_id: string; title: string; type: string; status: string; summary?: string; tags?: string[]; collected_at?: string | null; source_url?: string | null; canonical_url?: string | null; files: LibraryFile[]; index_status?: string };
export type LibraryFilters = { q?: string; type?: string; status?: string; tag?: string; from?: string; to?: string; limit?: number; offset?: number };
export type LibraryList = { items: LibraryEntry[]; total: number; limit: number; offset: number; index: { complete: boolean; pending: number; failed: number } };
export type LibraryContent = { id: string; archive_id: string; file: string; content: string; next_line: number | null; next_column: number | null; truncated: boolean };
export type LibraryPreview = { dataUrl: string; name: string };
export type LibraryTrashItem = { id: string; archiveId: string; title: string; deletedAt: string; deviceId: string };
export interface LibraryBridge {
  status(): Promise<Connection>;
  entries(filters: LibraryFilters): Promise<LibraryList>;
  entry(id: string): Promise<LibraryEntry>;
  content(input: { id: string; file?: string; startLine?: number; startColumn?: number }): Promise<LibraryContent>;
  preview?(input: { id: string; file: string }): Promise<LibraryPreview>;
  restore?(id:string):Promise<unknown>;
  trash?(): Promise<LibraryTrashItem[]>;
}

/** A session change invalidates outstanding reads even when the new account uses the same server. */
export class LibraryClient {
  private epoch = 0;
  private bridge: LibraryBridge;
  constructor(bridge: LibraryBridge) { this.bridge = bridge; }
  invalidateSession() { this.epoch++; }
  private async read<T>(action: (assertSession: () => void) => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const assertSession = () => { if (epoch !== this.epoch) throw new Error('资料空间已切换'); };
    const before = await this.bridge.status();
    assertSession();
    if (!before.paired) throw new Error('请先登录资料空间');
    const result = await action(assertSession);
    const after = await this.bridge.status();
    if (epoch !== this.epoch || !after.paired || before.server !== after.server || before.deviceId !== after.deviceId) throw new Error('资料空间已切换');
    return result;
  }
  entries(filters: LibraryFilters) { return this.read(() => this.bridge.entries(filters)); }
  entry(id: string) { return this.read(() => this.bridge.entry(id)); }
  preview(id: string, file: string) { return this.read(() => {
    if (!this.bridge.preview) throw new Error('附件预览接口不可用');
    return this.bridge.preview({ id, file });
  }); }
  trash() { return this.read(() => {
    if (!this.bridge.trash) throw new Error('回收站接口不可用');
    return this.bridge.trash();
  }); }
  restore(id:string){return this.read(()=>{if(!this.bridge.restore)throw Error('恢复接口不可用');return this.bridge.restore(id);});}
  async content(id: string, file?: string) {
    return this.read(async assertSession => {
      let startLine = 1, startColumn = 0, archive: string | undefined, actualFile = file;
      const parts: string[] = [];
      while (true) {
        assertSession();
        const page = await this.bridge.content({ id, file: actualFile, startLine, startColumn });
        assertSession();
        if (page.id !== id || archive && page.archive_id !== archive || actualFile && page.file !== actualFile) throw new Error('资料版本已变化，请重新加载');
        archive = page.archive_id; actualFile = page.file;
        parts.push(page.content);
        if (!page.truncated) return { archiveId: archive, file: actualFile, content: parts.join('') };
        const nextLine = page.next_line, nextColumn = page.next_column;
        if (nextLine === null || nextColumn === null || nextLine < startLine || nextLine === startLine && nextColumn <= startColumn) throw new Error('资料内容分页无效');
        // A line boundary is omitted between API chunks; a split long line has no separator.
        if (nextColumn === 0) parts.push('\n');
        startLine = nextLine; startColumn = nextColumn;
      }
    });
  }
}

export type RichNode = {type:string; text?:string; attrs?:Record<string, unknown>; marks?:{type:string;attrs?:Record<string,unknown>}[]; content?:RichNode[]};
export type RichDocument = {version:1; doc:RichNode};
export type Thumbnail = { blob?: Blob; mime: string; sha256: string; bytes: number };
export type Attachment = { id: string; name: string; mime: string; sha256: string; bytes: number; blob?: Blob; thumbnail?: Thumbnail | null; thumbnailSha256?: string };
export type ProcessRequest = { requestId: string; baseVersion: number; preset: string; instructions: string; deviceId: string | null; agent: string | null };
export type RecordTask = { id: string; state: string; recordVersion?: number; events?: { message: string }[] };
export type RecordPayload = { requestId: string; baseVersion: number; text: string; document?: RichDocument; createdAt: string; attachments: { id: string; name: string; sha256: string; thumbnailSha256?: string }[] };
export type RecordSnapshot = {text:string;document?:RichDocument;attachments:Attachment[];version:number;createdAt?:string;updatedAt?:string};
export type RecordConflict = {id:string;local:RecordSnapshot;remote:RecordSnapshot;base?:RecordSnapshot};
export type ConflictChoice = 'local'|'remote'|'copy'|'merge';
export type DeletionOperation={requestId:string;action:'delete'|'restore';version:number;trashVersion:number};
export type LocalRecord = {origin?:'user'|'collection_input';deletedAt?:string|null;trashVersion?:number;deletionQueue?:DeletionOperation[];deletionError?:string;discardedDraft?:LocalDraft;localOnly?:boolean; accountScope?: string; id: string; text: string; document?: RichDocument; attachments: Attachment[]; createdAt: string; version: number; remoteVersion: number; server: string | null; sync: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict'; error: string; errorCode?:string; baseSnapshot?:RecordSnapshot; acknowledged?:RecordSnapshot; backups?:{at:string;reason:string;local:RecordSnapshot;payload?:RecordPayload|null;remote?:RecordSnapshot}[]; payload?: RecordPayload | null; pendingProcess?: ProcessRequest; tasks?: RecordTask[]; [key: string]: unknown };
export type LocalDraft = { accountScope?: string; id: 'draft'; recordId: string; editingId?: string; baseVersion?: number; baseSnapshot?:RecordSnapshot; resolvingVersion?:number; text: string; document?: RichDocument; attachments: Attachment[]; [key: string]: unknown };
export type StoredItem = LocalRecord | LocalDraft;
export type Connection = { paired: boolean; server: string; deviceId?: string | null };
export type CaptureInput = { route: string; method?: 'GET' | 'PUT' | 'POST'; server?: string; deviceId?: string | null; json?: unknown; bytes?: string; mime?: string };
export type CaptureReply = { status: number; json?: unknown; bytes?: string; mime?: string };
export interface RecordStore { all(): Promise<StoredItem[]>; putMany?(items: StoredItem[]): Promise<void>; get(id: string): Promise<StoredItem | undefined>; put(item: StoredItem): Promise<void>; commit(item: LocalRecord, draft: LocalDraft): Promise<void>; }
export interface RecordTransport { status(): Promise<Connection>; request(input: CaptureInput): Promise<CaptureReply>; }

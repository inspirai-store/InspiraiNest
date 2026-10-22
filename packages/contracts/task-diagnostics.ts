export type CapabilityState='ready'|'queued'|'configuration'|'authorization'|'connection'|'offline'|'unknown'|'disabled';
export type CapabilityVerification='passed'|'untested'|'changed';
export type CapabilityFact={id:string;agent:string;available:boolean;enabled?:boolean;permission?:'blocked'|'unknown'|'ready';missing?:string[];connected?:boolean;fingerprint:string;skill?:string;checkedAt:string};
export type ExecutionEvent={id:string;taskId:string;attemptId:string;runId:string;deviceId:string;at:string;state:string;stage:string;code:string;category:string;message:string;reportedBy:'worker'|'agent'|'server'|'legacy';details:Record<string,string|number|boolean>};
export type ExecutionAttempt={id:string;taskId:string;deviceId:string;deviceName:string;createdAt:string;parentAttemptId:string|null;clientVersion:string|null;system:string|null;agent:string|null;skillVersions:unknown[];environmentDigest:string|null;state:string};

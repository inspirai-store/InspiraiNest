import Foundation

struct TaskDiagnosticReport: Decodable {
    struct Diagnosis: Decodable { struct Recovery: Decodable { let code: String; let action: String }; let status: String; let reason: String?; let code: String?; let recovery_conditions: [Recovery]? }
    struct TaskRef: Decodable { let id: String; let state: String }
    struct Attempt: Decodable, Identifiable { let id: String; let deviceName: String; let agent: String?; let clientVersion: String?; let state: String }
    struct Artifact: Decodable { let path: String; let sha256: String?; let bytes: Int }
    struct Event: Decodable, Identifiable { let artifacts: [Artifact]?; let id: String; let attemptId: String?; let at: String; let message: String; let code: String; let reportedBy: String }
    struct Completeness: Decodable { let complete: Bool; let legacy: Bool; let local_evidence_may_be_pending: Bool; let truncated: Bool }
    let task: TaskRef
    let attempts: [Attempt]
    let events: [Event]
    let completeness: Completeness
    let diagnosis: Diagnosis
}
struct NodeCapabilityReport: Decodable {
    struct Capability: Decodable, Identifiable { let id: String; let label: String; let state: String; let verification: String; let agent: String?; let skill: String? }
    let capabilities: [Capability]
}

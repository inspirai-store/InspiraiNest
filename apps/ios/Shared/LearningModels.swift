import Foundation

struct LearningSource: Decodable, Identifiable {
    let kind: String; let sourceId: String; let version: String; let title: String; let coverage: String
    let url: String?; let quote: String?; let text: String?; let location: String?
    var id: String { kind+":"+sourceId+":"+version }
}
struct LearningSources: Decodable { let items: [LearningSource] }
struct LearningCandidate: Decodable, Identifiable {
    let id: String; let revision: Int; let title: String; let expectedAbility: String; let reason: String; let state: String
    let citations: [LearningSource]
}
struct LearningIndex: Decodable { let goals: [LearningGoal]; let candidates: [LearningCandidate] }
struct LearningGoal: Decodable, Identifiable {
    let id: String; let revision: Int; let title: String; let foundation: String; let expectedAbility: String; let state: String
    let nodes: [LearningNode]; let sources: [LearningSource]
    let nextNodeId: String?
    let attempts: [LearningAttempt]?; let artifacts: [LearningArtifact]?
    let jobs: [LearningJob]?
}
struct LearningNode: Decodable, Identifiable {
    let id: String; let title: String; let stage: String; let explanation: String; let mastery: String; let notes: String
    let contentRevision: Int; let objectives: [String]; let dependsOn: [String]; let recall: [String]; let exercises: [String]; let citations: [LearningSource]
}
struct LearningAttempt: Decodable, Identifiable { let id: String; let nodeId: String; let question: String; let answer: String; let feedback: String? }
struct LearningArtifact: Decodable, Identifiable { let id: String; let nodeId: String; let title: String; let kind: String; let mime: String; let sha256: String; let nodeRevision: Int }
struct LearningArtifactBody: Decodable { let bytes: String; let mime: String }
struct LearningSubmission: Decodable { let id: String?; let state: String?; let sourceTaskId: String?; let goalId: String? }
struct LearningJob: Decodable, Identifiable { let id: String; let state: String; let message: String? }
let learningMasteryLabels = ["pending":"待学","learning":"学习中","review":"待复习","mastered":"已掌握"]

extension LearningGoal {
 var stageNames:[String] { var result:[String]=[];for node in nodes {if !result.contains(node.stage){result.append(node.stage)}};return result }
}

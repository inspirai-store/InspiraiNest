import XCTest
@testable import PersonalLibrary
final class PluginCatalogTests: XCTestCase {
 func testPluginConflictUsesStructuredSafeDetails() throws {
  let input=Data(#"{"code":"plugin_busy","details":{"dependents":["writing","untrusted-secret"],"jobs":[]}}"#.utf8)
  let problem=try JSONDecoder().decode(PluginChangeProblem.self,from:input)
  XCTAssertTrue(problem.message.contains("写作工作台"));XCTAssertFalse(problem.message.contains("untrusted-secret"))
 }
 func testSharedPluginContract() throws {
  let file=try XCTUnwrap(Bundle(for:Self.self).url(forResource:"plugins",withExtension:"json",subdirectory:"fixtures"))
  let snapshot=try JSONDecoder().decode(ProductPluginSnapshot.self,from:Data(contentsOf:file))
  XCTAssertEqual(snapshot.protocolVersion,1);XCTAssertTrue(snapshot.supports("ai-assistant"));XCTAssertFalse(snapshot.supports("writing"))
  XCTAssertEqual(snapshot.plugins.first { $0.id == "writing" }?.dependencies,["ai-assistant"])
 }
}
